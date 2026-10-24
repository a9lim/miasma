// isochrones.js — the day each cell was first exposed, contoured.
//
// The plate keeps the outbreak's history after the wave has passed: every
// eight days a contour marks how far the disease had reached, and every
// twenty-fourth day is labeled. `arrival` holds the first tick each cell was
// E, I or Z (Infinity until then); main.js calls `record` after every tick
// and after paint, `clear` on reset.
//
// Contours run on the lattice itself. Arrival times are smoothed by a few
// passes of neighbor averaging over the surface's own neighbor table, so the
// field is continuous across glued edges, then each triangle of three
// mutually adjacent cell centers is contoured linearly (marching triangles).
// Triangles that reach past a glued edge read their outer corner through the
// copy of the world beyond it (topology.wrap), so the lines run up to the
// edge and on into the faded copies. Segments come back in axial units
// relative to the world center; the renderer scales them.

import { Compartment } from './config.js';
import { getNeighborTable, hexBounds, wrap } from './topology.js';

export const ISO_STEP = 8;       // days between contours
export const ISO_LABEL = 24;     // days between labeled contours
const SMOOTH_PASSES = 3;

export function createIsochrones() {
    let arrival = null;          // Float32Array(W*H), first-exposure tick
    let field = null, tmp = null;
    let contours = [];           // [{ level, segs: Float32Array [x0,y0,x1,y1,...] }]
    let padded = null, side = 0, maxLevelOut = 0;   // the field one cell past the edges, for the GPU
    let lastBuild = -1, lastTopo = -1, dirty = true;

    function ensure(grid) {
        const N = grid.W * grid.H;
        if (!arrival || arrival.length !== N) {
            arrival = new Float32Array(N).fill(Infinity);
            field = new Float32Array(N);
            tmp = new Float32Array(N);
            contours = [];
            dirty = true;
        }
    }

    /** Stamp the tick on every newly exposed cell. O(active cells). */
    function record(grid, tick) {
        ensure(grid);
        const comp = grid.compartment, act = grid.activeIndices;
        let any = false;
        for (let k = 0; k < act.length; k++) {
            const i = act[k];
            if (arrival[i] !== Infinity) continue;
            const c = comp[i];
            if (c === Compartment.E || c === Compartment.I || c === Compartment.Z) { arrival[i] = tick; any = true; }
        }
        if (any) dirty = true;
    }

    function clear() {
        if (arrival) arrival.fill(Infinity);
        contours = [];
        lastBuild = -1;
        dirty = true;
    }

    /**
     * Rebuild the contours if the field changed and at least `every` ticks have
     * passed. Returns true when the contours changed.
     */
    function build(grid, topology, tick, every = 4) {
        ensure(grid);
        if (!dirty && topology === lastTopo) return false;
        if (topology === lastTopo && lastBuild >= 0 && tick - lastBuild < every && tick >= lastBuild) return false;
        lastBuild = tick; lastTopo = topology; dirty = false;
        const { W, H } = grid;
        const act = grid.activeIndices;
        const nb = getNeighborTable(W, H, topology).idx;
        const ahead = tick + ISO_STEP * 0.75;        // value for cells the wave has not reached
        let reached = 0;
        for (let k = 0; k < act.length; k++) {
            const i = act[k], a = arrival[i];
            if (a !== Infinity) reached++;
            field[i] = a === Infinity ? ahead : a;
        }
        if (!reached) { contours = []; maxLevelOut = 0; return true; }
        // EMPTY cells that were never reached carry no information; let them
        // take their neighbors' values so the lines pass through.
        const empty = grid.compartment;
        for (let pass = 0; pass < SMOOTH_PASSES + 2; pass++) {
            for (let k = 0; k < act.length; k++) {
                const i = act[k];
                let s = 0, n = 0;
                for (let d = 0; d < 6; d++) {
                    const j = nb[i * 6 + d];
                    if (j >= 0) { s += field[j]; n++; }
                }
                const avg = n ? s / n : field[i];
                const hole = arrival[i] === Infinity && empty[i] === Compartment.EMPTY;
                tmp[i] = hole ? avg : (pass < SMOOTH_PASSES ? 0.5 * field[i] + 0.5 * avg : field[i]);
            }
            for (let k = 0; k < act.length; k++) field[act[k]] = tmp[act[k]];
        }
        let maxLevel = 0;
        for (let L = ISO_STEP; L < tick - 2; L += ISO_STEP) maxLevel = L;
        maxLevelOut = maxLevel;
        contours = [];
        const { cq, cr, R } = hexBounds(W, H);
        // Padded field for the GPU: relative (q, r) in [-R-1, R+1], read
        // through the gluing; -1 beyond an open edge.
        side = 2 * R + 3;
        const look0 = lookupTable(W, H, topology);
        if (!padded || padded.length !== side * side) padded = new Float32Array(side * side);
        for (let k = 0; k < padded.length; k++) padded[k] = look0[k] >= 0 ? field[look0[k]] : -1;
        if (!maxLevel) return true;
        const out = new Map();
        for (let L = ISO_STEP; L <= maxLevel; L += ISO_STEP) out.set(L, []);
        // Value at a lattice point (relative coords); NaN beyond an open edge.
        const valueAt = (q, r) => {
            const i = look0[(r + R + 1) * side + (q + R + 1)];
            return i >= 0 ? field[i] : NaN;
        };
        const SQ3 = Math.sqrt(3);
        const px = (q, r) => SQ3 * (q + r / 2), py = (q, r) => 1.5 * r;
        const tri = (q0, r0, v0, q1, r1, v1, q2, r2, v2) => {
            if (v0 !== v0 || v1 !== v1 || v2 !== v2) return;
            const lo = Math.min(v0, v1, v2), hi = Math.max(v0, v1, v2);
            const first = Math.ceil(lo / ISO_STEP) * ISO_STEP;
            for (let L = Math.max(first, ISO_STEP); L <= hi && L <= maxLevel; L += ISO_STEP) {
                if (L === lo && L === hi) continue;
                const pts = [];
                const edge = (qa, ra, va, qb, rb, vb) => {
                    if ((va < L) === (vb < L)) return;
                    const t = (L - va) / (vb - va);
                    pts.push(px(qa, ra) + t * (px(qb, rb) - px(qa, ra)), py(qa, ra) + t * (py(qb, rb) - py(qa, ra)));
                };
                edge(q0, r0, v0, q1, r1, v1);
                edge(q1, r1, v1, q2, r2, v2);
                edge(q2, r2, v2, q0, r0, v0);
                if (pts.length === 4) out.get(L).push(pts[0], pts[1], pts[2], pts[3]);
            }
        };
        // Every triangle with at least one corner in the world. Corners outside
        // read through the gluing; those beyond an open edge drop the triangle.
        for (let r = -R - 1; r <= R; r++) {
            for (let q = -R - 1; q <= R; q++) {
                const inA = cube(q, r) <= R || cube(q + 1, r) <= R || cube(q, r + 1) <= R;
                const inB = cube(q + 1, r) <= R || cube(q, r + 1) <= R || cube(q + 1, r + 1) <= R;
                if (!inA && !inB) continue;
                const a = valueAt(q, r), b = valueAt(q + 1, r), c = valueAt(q, r + 1);
                if (inA) tri(q, r, a, q + 1, r, b, q, r + 1, c);
                if (inB) tri(q + 1, r, b, q, r + 1, c, q + 1, r + 1, valueAt(q + 1, r + 1));
            }
        }
        for (const [level, segs] of out) if (segs.length) contours.push({ level, segs: Float32Array.from(segs) });
        return true;
    }

    return {
        record, clear, build,
        get contours() { return contours; },
        get padded() { return padded; },
        get side() { return side; },
        get maxLevel() { return maxLevelOut; },
        get arrival() { return arrival; },
        markDirty() { dirty = true; }
    };
}

// Relative lattice point (q, r) within one step of the world → world cell
// index through the gluing, or -1. Cached per (W, H, topology).
const _lookCache = new Map();
function lookupTable(W, H, topology) {
    const key = W + 'x' + H + ':' + topology;
    let t = _lookCache.get(key);
    if (t) return t;
    const { cq, cr, R } = hexBounds(W, H);
    const side = 2 * R + 3;
    t = new Int32Array(side * side).fill(-1);
    for (let r = -R - 1; r <= R + 1; r++) {
        for (let q = -R - 1; q <= R + 1; q++) {
            const w = wrap(cq + q, cr + r, topology, W, H);
            if (w) t[(r + R + 1) * side + (q + R + 1)] = w.r * W + w.q;
        }
    }
    _lookCache.set(key, t);
    return t;
}

function cube(q, r) {
    return Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
}
