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
// edge and on into the faded copies. The WebGPU plate draws every line from
// the padded field; segments are built only for the levels a label can sit
// on, in axial units relative to the world center, for the label placement.

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

/**
 * The isochrones of one arrival field: smooth it, pad it one cell past the
 * edges through the gluing (the WebGPU plate draws the lines from that), and
 * contour the levels a label can sit on (every ISO_LABEL days, while still
 * plain enough to label). `job` is
 * { arrival, compartment, act, W, H, topology, latest }; `bufs` is the
 * caller's scratch, reused between calls. Pure, so it runs in the isochrone
 * worker (isochrones-worker.js) or, without one, on the main thread.
 * Returns { padded, side, maxLevel, latest, contours }, padded null while no
 * cell has been reached.
 */
export function buildContours(job, bufs) {
    const { arrival, compartment: empty, act, W, H, topology, latest } = job;
    const N = W * H;
    if (!bufs.field || bufs.field.length !== N) {
        bufs.field = new Float32Array(N);
        bufs.field2 = new Float32Array(N);
        bufs.holeFlag = new Uint8Array(N);
        bufs.holes = new Int32Array(N);
        bufs.holeVal = new Float32Array(N);
    }
    let field = bufs.field;
    const { field2, holeFlag, holes, holeVal } = bufs;
    const nb = getNeighborTable(W, H, topology).idx;
    const ahead = latest + ISO_STEP * 0.75;      // value for cells the wave has not reached
        // EMPTY cells that were never reached carry no information (holes);
        // they take their neighbors' values so the lines pass through.
        let nHoles = 0, reached = 0;
        for (let k = 0; k < act.length; k++) {
            const i = act[k], a = arrival[i];
            if (a === Infinity) {
                field[i] = ahead;
                if (empty[i] === Compartment.EMPTY) holes[nHoles++] = i;
            } else { field[i] = a; reached++; }
        }
        const contours = [];
        if (!reached) return { padded: null, side: 0, maxLevel: 0, latest: 0, contours };
        // Every other cell averages only the neighbors within CLIFF of its
        // own value, so the edge between one wave's stamps and another's stays
        // sharp, for SMOOTH_PASSES passes; the holes keep filling for two more.
        const isHole = holeFlag;
        for (let k = 0; k < act.length; k++) isHole[act[k]] = 0;
        for (let h = 0; h < nHoles; h++) isHole[holes[h]] = 1;
        let src = field, dst = field2;
        for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
            for (let k = 0; k < act.length; k++) {
                const i = act[k], own = src[i], base = i * 6;
                let s = 0, n = 0;
                if (isHole[i]) {
                    for (let d = 0; d < 6; d++) { const j = nb[base + d]; if (j >= 0) { s += src[j]; n++; } }
                    dst[i] = n ? s / n : own;
                } else {
                    // unrolled: this is the build's hottest loop
                    const j0 = nb[base], j1 = nb[base + 1], j2 = nb[base + 2], j3 = nb[base + 3], j4 = nb[base + 4], j5 = nb[base + 5];
                    if (j0 >= 0) { const v = src[j0]; if (Math.abs(v - own) <= CLIFF) { s += v; n++; } }
                    if (j1 >= 0) { const v = src[j1]; if (Math.abs(v - own) <= CLIFF) { s += v; n++; } }
                    if (j2 >= 0) { const v = src[j2]; if (Math.abs(v - own) <= CLIFF) { s += v; n++; } }
                    if (j3 >= 0) { const v = src[j3]; if (Math.abs(v - own) <= CLIFF) { s += v; n++; } }
                    if (j4 >= 0) { const v = src[j4]; if (Math.abs(v - own) <= CLIFF) { s += v; n++; } }
                    if (j5 >= 0) { const v = src[j5]; if (Math.abs(v - own) <= CLIFF) { s += v; n++; } }
                    dst[i] = 0.5 * own + 0.5 * (n ? s / n : own);
                }
            }
            const t = src; src = dst; dst = t;
        }
        for (let pass = SMOOTH_PASSES; pass < SMOOTH_PASSES + 2; pass++) {
            for (let h = 0; h < nHoles; h++) {
                const i = holes[h], base = i * 6;
                let s = 0, n = 0;
                for (let d = 0; d < 6; d++) { const j = nb[base + d]; if (j >= 0) { s += src[j]; n++; } }
                holeVal[h] = n ? s / n : src[i];
            }
            for (let h = 0; h < nHoles; h++) src[holes[h]] = holeVal[h];
        }
        if (src !== field) { bufs.field2 = field; bufs.field = field = src; }
        let maxLevel = 0;
        for (let L = ISO_STEP; L < latest - 2; L += ISO_STEP) maxLevel = L;
        const { R } = hexBounds(W, H);
        // Padded field for the GPU: relative (q, r) in [-R-1, R+1], read
        // through the gluing; -1 beyond an open edge.
        const side = 2 * R + 3;
        const look0 = lookupTable(W, H, topology);
        let padded = bufs.padded;
        if (!padded || padded.length !== side * side) bufs.padded = padded = new Float32Array(side * side);
        for (let k = 0; k < padded.length; k++) padded[k] = look0[k] >= 0 ? field[look0[k]] : -1;
        const out = { padded, side, maxLevel, latest, contours };
        if (!maxLevel) return out;
        // The levels to contour: the labeled ones still plain enough to carry a label.
        const levels = [];
        for (let L = ISO_LABEL; L <= maxLevel; L += ISO_LABEL) {
            if (isoFade(latest - L) >= LABEL_FADE) levels.push(L);
        }
        if (!levels.length) return out;
        const lo0 = levels[0], hi0 = levels[levels.length - 1], stepL = ISO_LABEL;
        const segs = levels.map(() => []);
        const inW = worldMask(R);
        const SQ3 = Math.sqrt(3);
        // One triangle of cell centers; values -1 mark a corner beyond an open edge.
        const tri = (q0, r0, v0, q1, r1, v1, q2, r2, v2) => {
            if (v0 < 0 || v1 < 0 || v2 < 0) return;
            const lo = v0 < v1 ? (v0 < v2 ? v0 : v2) : (v1 < v2 ? v1 : v2);
            const hi = v0 > v1 ? (v0 > v2 ? v0 : v2) : (v1 > v2 ? v1 : v2);
            if (hi - lo > CLIFF_SPAN || hi < lo0 || lo > hi0) return;
            let L = Math.ceil(lo / stepL) * stepL;
            if (L < lo0) L = lo0;
            if (L > hi) return;
            const x0 = SQ3 * (q0 + r0 / 2), y0 = 1.5 * r0, x1 = SQ3 * (q1 + r1 / 2), y1 = 1.5 * r1, x2 = SQ3 * (q2 + r2 / 2), y2 = 1.5 * r2;
            for (; L <= hi && L <= hi0; L += stepL) {
                if (L === lo && L === hi) continue;
                const out = segs[(L - lo0) / stepL];
                if (!out) continue;
                let n = 0, ax = 0, ay = 0;
                // edges 0–1, 1–2, 2–0: a crossing where one end is below L and the other not
                if ((v0 < L) !== (v1 < L)) { const t = (L - v0) / (v1 - v0); ax = x0 + t * (x1 - x0); ay = y0 + t * (y1 - y0); n = 1; }
                if ((v1 < L) !== (v2 < L)) {
                    const t = (L - v1) / (v2 - v1), x = x1 + t * (x2 - x1), y = y1 + t * (y2 - y1);
                    if (n) { out.push(ax, ay, x, y); continue; }
                    ax = x; ay = y; n = 1;
                }
                if (n && (v2 < L) !== (v0 < L)) { const t = (L - v2) / (v0 - v2); out.push(ax, ay, x2 + t * (x0 - x2), y2 + t * (y0 - y2)); }
            }
        };
        // Every triangle with at least one corner in the world. Corners outside
        // read through the gluing; those beyond an open edge drop the triangle.
        for (let r = -R - 1; r <= R; r++) {
            const row = (r + R + 1) * side + R + 1;
            for (let q = -R - 1; q <= R; q++) {
                const k = row + q, kb = k + 1, kc = k + side, kd = kc + 1;
                const inA = inW[k] | inW[kb] | inW[kc], inB = inW[kb] | inW[kc] | inW[kd];
                if (!inA && !inB) continue;
                const b = padded[kb], c = padded[kc];
                if (inA) tri(q, r, padded[k], q + 1, r, b, q, r + 1, c);
                if (inB) tri(q + 1, r, b, q, r + 1, c, q + 1, r + 1, padded[kd]);
            }
        }
        for (let n = 0; n < levels.length; n++) {
            if (!segs[n].length) continue;
            const ls = Float32Array.from(segs[n]);
            contours.push({ level: levels[n], segs: ls, runLen: runLengths(ls) });
        }
        return out;
}

/**
 * The arrival field of a run and its isochrones. main.js calls `record` after
 * every tick and paint stroke and `build` before drawing; with
 * `opts.worker` the build runs in a Web Worker and lands a frame or two
 * later, calling `opts.onBuilt`; without one (Node, or no module workers) it
 * runs in place.
 */
export function createIsochrones(opts = {}) {
    let arrival = null;          // Float32Array(W*H), tick of the latest wave's arrival
    let was = null;              // Uint8Array(W*H), E/I/Z at the previous record
    let latest = 0, latestOut = 0;   // newest stamp; and its value at the last build
    // [{ level, segs: Float32Array [x0,y0,x1,y1,...], runLen }]; runLen[k]
    // is the length in cells of the connected line that segment k belongs to
    let contours = [];
    let padded = null, side = 0, maxLevelOut = 0;   // the field one cell past the edges, for the GPU
    let lastBuild = -1, lastTopo = -1, dirty = true;
    let reached = 0;             // cells stamped at least once
    const bufs = {};
    // One build in flight at a time; a newer request waits in `queued`, and a
    // result from before a clear (`gen`) is dropped.
    let worker = null, busy = false, queued = null, gen = 0, sentAct = null;
    if (opts.worker && typeof Worker !== 'undefined') {
        try {
            worker = new Worker(new URL('./isochrones-worker.js', import.meta.url), { type: 'module' });
            worker.onmessage = (e) => {
                busy = false;
                if (e.data.gen === gen) { apply(e.data); if (opts.onBuilt) opts.onBuilt(); }
                if (queued) { const q = queued; queued = null; post(q.job, q.act); }
            };
            // a worker that cannot start leaves the build on the main thread
            worker.onerror = () => { worker = null; busy = false; queued = null; dirty = true; if (opts.onBuilt) opts.onBuilt(); };
        } catch (e) {
            worker = null;
        }
    }

    function apply(r) {
        contours = r.contours;
        maxLevelOut = r.maxLevel;
        latestOut = r.latest;
        if (r.padded) { padded = r.padded; side = r.side; }
    }

    function post(job, act) {
        busy = true;
        // the active cells go once per world; the worker keeps them
        if (act !== sentAct) { job.act = act; sentAct = act; }
        worker.postMessage(job, [job.arrival.buffer, job.compartment.buffer]);
    }

    function ensure(grid) {
        const N = grid.W * grid.H;
        if (!arrival || arrival.length !== N) {
            arrival = new Float32Array(N).fill(Infinity);
            was = new Uint8Array(N);
            latest = 0;
            reached = 0;
            contours = [];
            padded = null;
            gen++;
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
                    if (arrival[i] === Infinity) reached++;
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
        reached = 0;
        contours = [];
        maxLevelOut = 0;
        lastBuild = -1;
        gen++;
        queued = null;
        dirty = true;
    }

    /**
     * Rebuild the isochrones if the field changed and at least `every` ticks
     * have passed. Returns true when they changed
     * in place; a worker's result arrives later, through `opts.onBuilt`.
     */
    function build(grid, topology, tick, every = 4) {
        ensure(grid);
        if (!dirty && topology === lastTopo) return false;
        if (topology === lastTopo && lastBuild >= 0 && tick - lastBuild < every && tick >= lastBuild) return false;
        lastBuild = tick; lastTopo = topology; dirty = false;
        const { W, H } = grid;
        if (worker) {
            const job = { gen, arrival: arrival.slice(), compartment: grid.compartment.slice(), act: null, W, H, topology, latest };
            if (busy) queued = { job, act: grid.activeIndices };
            else post(job, grid.activeIndices);
            return false;
        }
        apply(buildContours({ arrival, compartment: grid.compartment, act: grid.activeIndices, W, H, topology, latest }, bufs));
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
        get reached() { return reached; },
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

// The padded lattice (side 2R + 3) as 1 inside the world, 0 outside. Cached per R.
const _maskCache = new Map();
function worldMask(R) {
    let m = _maskCache.get(R);
    if (m) return m;
    const side = 2 * R + 3;
    m = new Uint8Array(side * side);
    for (let r = -R - 1; r <= R + 1; r++) {
        for (let q = -R - 1; q <= R + 1; q++) if (cube(q, r) <= R) m[(r + R + 1) * side + (q + R + 1)] = 1;
    }
    _maskCache.set(R, m);
    return m;
}
