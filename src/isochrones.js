// isochrones.js — the day the latest wave reached each cell, contoured.
//
// The plate keeps the outbreak's history after the wave has passed: every
// eight days a contour marks how far the disease had reached, and every
// twenty-fourth day is labeled. `arrival` holds the tick each cell was last
// newly E, I or Z (Infinity until then): the first exposure, or, when the
// cell is exposed again at least REARRIVE_GAP days later, that wave's. main.js
// calls `record` after every tick and after paint, `clear` on reset.
//
// Contours run on the lattice itself. Arrival times are smoothed by a few
// passes of neighbor averaging over the surface's own neighbor table, so the
// field is continuous across glued edges (a neighbor more than CLIFF days
// away is left out, so a new wave's stamps do not smear into the old one's),
// then each triangle of three mutually adjacent cell centers is contoured
// linearly (marching triangles). Where one wave meets the stamps of an older
// one the field jumps by hundreds of days; a triangle spanning more than
// CLIFF_SPAN is not contoured, which would stack a line for every level.
// A contour is faded by how far its level lies behind `latest`, the newest
// stamp (isoFade), so the plate keeps the newest waves and lets old ones go;
// the clock is `latest`, not the tick, so a finished outbreak stops fading.
// Triangles that reach past a glued edge read their outer corner through the
// copy of the world beyond it (topology.wrap), so the lines run up to the
// edge and on into the faded copies. Segments come back in axial units
// relative to the world center; the renderer scales them.

import { Compartment } from './config.js';
import { getNeighborTable, hexBounds, wrap } from './topology.js';

export const ISO_STEP = 8;       // days between contours
export const ISO_LABEL = 24;     // days between labeled contours
export const REARRIVE_GAP = 4 * ISO_STEP;   // days before an exposed cell counts as a new wave's
export const CLIFF = 3 * ISO_STEP;          // smoothing mixes only neighbors this close in value
export const CLIFF_SPAN = 4 * ISO_STEP;     // triangles spanning more than this are not contoured
export const FADE_DAYS = 420;    // age at which a contour is down to FADE_FLOOR (quadratic ramp)
export const FADE_FLOOR = 0.12;
export const LABEL_FADE = 0.5;   // only contours at least this opaque are labeled
export const LABEL_RUN = 6;      // cells of connected line a labeled contour needs
const SMOOTH_PASSES = 3;

/** Opacity multiplier of a contour whose level lies `age` days behind the newest stamp. */
export function isoFade(age) {
    const x = Math.max(0, age) / FADE_DAYS;
    return Math.max(FADE_FLOOR, 1 - x * x);
}

export function createIsochrones() {
    let arrival = null;          // Float32Array(W*H), tick of the latest wave's arrival
    let was = null;              // Uint8Array(W*H), E/I/Z at the previous record
    let latest = 0, latestOut = 0;   // newest stamp; and its value at the last build
    let field = null, tmp = null;
    // [{ level, segs: Float32Array [x0,y0,x1,y1,...], runLen? }]; on the labeled levels runLen[k]
    // is the length in cells of the connected line that segment k belongs to
    let contours = [];
    let padded = null, side = 0, maxLevelOut = 0;   // the field one cell past the edges, for the GPU
    let lastBuild = -1, lastTopo = -1, dirty = true;

    function ensure(grid) {
        const N = grid.W * grid.H;
        if (!arrival || arrival.length !== N) {
            arrival = new Float32Array(N).fill(Infinity);
            was = new Uint8Array(N);
            latest = 0;
            field = new Float32Array(N);
            tmp = new Float32Array(N);
            contours = [];
            dirty = true;
        }
    }

    /**
     * Stamp the tick on every cell that has just become E, I or Z (it was not
     * at the previous record), unless it was stamped less than REARRIVE_GAP
     * days ago: that is the same wave still passing through. O(active cells).
     */
    function record(grid, tick) {
        ensure(grid);
        const comp = grid.compartment, act = grid.activeIndices;
        let any = false;
        for (let k = 0; k < act.length; k++) {
            const i = act[k], c = comp[i];
            if (c === Compartment.E || c === Compartment.I || c === Compartment.Z) {
                if (was[i]) continue;
                was[i] = 1;
                if (arrival[i] === Infinity || tick - arrival[i] >= REARRIVE_GAP) {
                    arrival[i] = tick; any = true;
                    if (tick > latest) latest = tick;
                }
            } else was[i] = 0;
        }
        if (any) dirty = true;
    }

    function clear() {
        if (arrival) { arrival.fill(Infinity); was.fill(0); }
        latest = latestOut = 0;
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
        const ahead = latest + ISO_STEP * 0.75;      // value for cells the wave has not reached
        let reached = 0;
        for (let k = 0; k < act.length; k++) {
            const i = act[k], a = arrival[i];
            if (a !== Infinity) reached++;
            field[i] = a === Infinity ? ahead : a;
        }
        if (!reached) { contours = []; maxLevelOut = 0; latestOut = 0; return true; }
        // EMPTY cells that were never reached carry no information; let them
        // take their neighbors' values so the lines pass through. Every other
        // cell averages only the neighbors within CLIFF of its own value, so the
        // edge between one wave's stamps and another's stays sharp.
        const empty = grid.compartment;
        for (let pass = 0; pass < SMOOTH_PASSES + 2; pass++) {
            for (let k = 0; k < act.length; k++) {
                const i = act[k], own = field[i];
                const hole = arrival[i] === Infinity && empty[i] === Compartment.EMPTY;
                let s = 0, n = 0;
                for (let d = 0; d < 6; d++) {
                    const j = nb[i * 6 + d];
                    if (j >= 0 && (hole || Math.abs(field[j] - own) <= CLIFF)) { s += field[j]; n++; }
                }
                const avg = n ? s / n : own;
                tmp[i] = hole ? avg : (pass < SMOOTH_PASSES ? 0.5 * own + 0.5 * avg : own);
            }
            for (let k = 0; k < act.length; k++) field[act[k]] = tmp[act[k]];
        }
        latestOut = latest;
        let maxLevel = 0;
        for (let L = ISO_STEP; L < latest - 2; L += ISO_STEP) maxLevel = L;
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
            if (hi - lo > CLIFF_SPAN) return;
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
        for (const [level, segs] of out) {
            if (!segs.length) continue;
            const c = { level, segs: Float32Array.from(segs) };
            if (level % ISO_LABEL === 0) c.runLen = runLengths(c.segs);
            contours.push(c);
        }
        return true;
    }

    return {
        record, clear, build,
        get contours() { return contours; },
        get padded() { return padded; },
        get side() { return side; },
        get maxLevel() { return maxLevelOut; },
        get latest() { return latestOut; },
        get arrival() { return arrival; },
        markDirty() { dirty = true; }
    };
}

/**
 * For each segment, the length in cells of the connected line it belongs to.
 * Segments of neighboring triangles share an endpoint up to rounding, so
 * endpoints are matched on a 1/256-cell grid and joined with union-find.
 */
function runLengths(segs) {
    const n = segs.length / 4, SQ3 = Math.sqrt(3), ids = new Map();
    const id = (x, y) => {
        const key = (Math.round(x * 256) + 65536) * 131072 + Math.round(y * 256) + 65536;
        let v = ids.get(key);
        if (v === undefined) { v = ids.size; ids.set(key, v); }
        return v;
    };
    const ea = new Int32Array(n), eb = new Int32Array(n);
    for (let k = 0; k < n; k++) { ea[k] = id(segs[4 * k], segs[4 * k + 1]); eb[k] = id(segs[4 * k + 2], segs[4 * k + 3]); }
    const parent = new Int32Array(ids.size), len = new Float32Array(ids.size);
    for (let v = 0; v < parent.length; v++) parent[v] = v;
    const find = (v) => { while (parent[v] !== v) { parent[v] = parent[parent[v]]; v = parent[v]; } return v; };
    for (let k = 0; k < n; k++) { const ra = find(ea[k]), rb = find(eb[k]); if (ra !== rb) parent[rb] = ra; }
    for (let k = 0; k < n; k++) len[find(ea[k])] += Math.hypot(segs[4 * k + 2] - segs[4 * k], segs[4 * k + 3] - segs[4 * k + 1]) / SQ3;
    const out = new Float32Array(n);
    for (let k = 0; k < n; k++) out[k] = len[find(ea[k])];
    return out;
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
