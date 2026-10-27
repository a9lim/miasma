// topology.js — the four surfaces, as gluings of the world hexagon's edges.
//
// Miasma's world is the inscribed regular hexagon F of hex cells carved out of
// the W×H axial rhombus by `applyHexMask`: center (cq, cr), radius
// R = min(cq, cr, W-1-cq, H-1-cr), cells with cube distance ≤ R. Cells outside
// it are inert. A surface is a rule for gluing the six edges of F in pairs:
//
//   PLANE  no gluing; all six edges are open shore.
//   TORUS  all three opposite pairs translate.
//   KLEIN  N/S translate; SE/NW and SW/NE twist (two twisted pairs, one
//          translated pair).
//   RP2    all three opposite pairs twist (the antipodal gluing).
//
// Edges are numbered k = 0..5 by outward normal 30° + 60°k on the canvas
// (y down): SE, S, SW, NW, N, NE. Edge k runs from corner cell R·dir_k to
// corner cell R·dir_(k+1), stepping by dir_(k+2), and its cells face out
// through directions k and k+1.
//
// ─── Slots ───
// A gluing is a matching of boundary slots: a slot is one cell-edge of a
// boundary cell that faces out of F. There are 12R + 6 of them, and slot
// (k, j), j = 0..2R, is the cell R·dir_k + ⌊j/2⌋·dir_(k+2) facing out through
// direction k (j even) or k+1 (j odd). Slot (k, 0) is the "middle" slot of
// corner k, pointing straight out of the corner. Matching slot a with slot b
// makes the two cells neighbors through those cell-edges, so the neighbor
// relation is symmetric by construction.
//
// A translation matches an arc of 2R+1 slots on edge e against the arc on the
// opposite edge in reverse order; a twist matches them in the same order,
// shifted by one slot, so the zigzag of one edge still interlocks with the
// zigzag of its partner (a peak of one meets a notch of the other). An arc
// starts at its edge's corner-middle slot (offset 0) or one slot later
// (offset 1), which picks one of the two chiral tilings: the hexagon of cells
// tiles the plane by translation in exactly two ways, the lattice
//   T1 = (2R+1, -R), T2 = (R, R+1), T3 = (-R-1, 2R+1)
// (offset 1) and its mirror image (offset 0).
//
// ─── Why Klein has corner defects ───
// The ratified plan asked for the flat Klein bottle: N/S translated and the
// edge pairs meeting at the E and W corners glued by glide reflection. On the
// cell lattice no defect-free Klein bottle exists, for any R ≥ 2. A gluing
// where every cell has six distinct neighbors and every cell-vertex is shared
// by three cells is a flat closed surface; its deck group tiles the plane with
// translates of F (F has all twelve symmetries of the lattice). The ring of
// cells around F can be covered by non-overlapping translates of F in exactly
// two ways, the two chiral lattices above, so every such tiling is one of
// them, and every reflection of the cell lattice swaps them. No glide can map
// either tiling to itself, so the deck group holds only translations and the
// surface is a torus. (An exhaustive search over every edge pairing and every
// lattice isometry finds the same: 4864 complete gluings at R = 59, exactly
// two defect-free, both tori.) Klein therefore takes the plan's fallback, two
// twisted pairs and one translated pair: χ = 0, non-orientable, flat except
// for two cone points, a cell-vertex shared by two cells (240°) and one shared
// by four (480°). A twist puts the two chiral tilings on its two sides, so
// four slots near the corners are left over and are closed up by hand
// (`close` below). The two cells at the 240° point are neighbors twice.
//
// RP² can't be flat at all (χ = 1). Its three twists leave six corner slots;
// the closing used here has one cone point of 120°, two of 240° and one of
// 480° (total curvature 360° = 2π·χ). At the 120° point a corner cell's two
// outer edges are glued to each other, so that cell lists itself as a
// neighbor twice.
//
// The closings were found by exhaustive search over every pairing (and both
// orientations) of the leftover slots, keeping the ones with the right χ and
// orientability and the fewest defects; `topology.test.mjs` re-checks χ,
// orientability, symmetry and the vertex classes.

import { Topology, HEX_DIRS } from './config.js';

/** Cube-coord distance from (dq, dr) to origin. */
function cubeDist(dq, dr) {
    const ds = -dq - dr;
    const adq = dq < 0 ? -dq : dq;
    const adr = dr < 0 ? -dr : dr;
    const ads = ds < 0 ? -ds : ds;
    return adq > adr ? (adq > ads ? adq : ads) : (adr > ads ? adr : ads);
}

/** Inscribed-hex geometry for a W×H axial rhombus. Mirrors applyHexMask. */
export function hexBounds(W, H) {
    const cq = Math.floor(W / 2);
    const cr = Math.floor(H / 2);
    const R  = Math.min(cq, cr, W - 1 - cq, H - 1 - cr);
    return { cq, cr, R };
}

/** True iff (q, r) is inside the inscribed hexagon. */
export function inHex(q, r, W, H) {
    const { cq, cr, R } = hexBounds(W, H);
    return cubeDist(q - cq, r - cr) <= R;
}

// ─── Surfaces ───
// pairs: [edge e, edge f, 't' | 'g', shift, arc offset on e, arc offset on f]
// close: leftover slots matched by hand, [[edge, pos], [edge, pos], flipped];
// pos 'end' is 2R.
const SPECS = {
    [Topology.PLANE]: { pairs: [], close: [] },
    [Topology.TORUS]: {
        pairs: [[0, 3, 't', 0, 1, 1], [1, 4, 't', 0, 1, 1], [2, 5, 't', 0, 1, 1]],
        close: []
    },
    [Topology.KLEIN]: {
        pairs: [[1, 4, 't', 0, 0, 0], [0, 3, 'g', -1, 0, 0], [2, 5, 'g', 1, 0, 0]],
        close: [[[3, 'end'], [5, 0], 1], [[2, 'end'], [0, 0], 1]]
    },
    [Topology.RP2]: {
        pairs: [[0, 3, 'g', -1, 0, 0], [1, 4, 'g', -1, 0, 0], [2, 5, 'g', -1, 0, 0]],
        close: [[[3, 'end'], [1, 0], 1], [[4, 'end'], [2, 0], 1], [[0, 0], [5, 'end'], 0]]
    }
};

/**
 * What each surface is, for the plate and the tests. `pairs` lists the glued
 * opposite-edge pairs as [edge, partner, kind] with kind 'translate' or
 * 'twist'; chevron counts on the plate follow this order.
 */
export const SURFACES = Object.freeze({
    [Topology.PLANE]: { key: 'plane', label: 'Plane', name: 'plane', chi: 1, orientable: true,  closed: false, pairs: [] },
    [Topology.TORUS]: { key: 'torus', label: 'Torus', name: 'torus', chi: 0, orientable: true,  closed: true,
                        pairs: [[2, 5, 'translate'], [0, 3, 'translate'], [1, 4, 'translate']] },
    [Topology.KLEIN]: { key: 'klein', label: 'Klein', name: 'Klein bottle', chi: 0, orientable: false, closed: true,
                        pairs: [[2, 5, 'twist'], [0, 3, 'twist'], [1, 4, 'translate']] },
    [Topology.RP2]:   { key: 'rp2', label: 'RP²', name: 'projective plane', chi: 1, orientable: false, closed: true,
                        pairs: [[2, 5, 'twist'], [0, 3, 'twist'], [1, 4, 'twist']] }
});

const D = HEX_DIRS.map(d => [d.dq, d.dr]);

/** Relative cell and outward direction of slot (k, j). */
function slotAt(R, k, j) {
    if (j > 2 * R) { k = (k + 1) % 6; j -= 2 * R + 1; }
    const t = j >> 1, a = D[k], b = D[(k + 2) % 6];
    return { q: R * a[0] + t * b[0], r: R * a[1] + t * b[1], d: j & 1 ? (k + 1) % 6 : k };
}

/**
 * The glued cell complex of a surface at radius R, in compact relative
 * indexing: cells[i] = [q, r] relative to the center; for slot s = i*6 + d,
 * nb[s] is the neighboring cell (-1 on an open edge), back[s] the direction
 * the neighbor sees this cell through, and flip[s] = 1 where crossing that
 * cell-edge reverses orientation.
 */
export function buildComplex(topology, R) {
    const spec = SPECS[topology] || SPECS[Topology.TORUS];
    const side = 2 * R + 1;
    const index = new Int32Array(side * side).fill(-1);
    const cells = [];
    for (let r = -R; r <= R; r++) {
        for (let q = -R; q <= R; q++) {
            if (cubeDist(q, r) > R) continue;
            index[(r + R) * side + (q + R)] = cells.length;
            cells.push([q, r]);
        }
    }
    const at = (q, r) => (cubeDist(q, r) > R ? -1 : index[(r + R) * side + (q + R)]);
    const N = cells.length;
    const nb = new Int32Array(N * 6).fill(-1);
    const back = new Int8Array(N * 6).fill(-1);
    const flip = new Uint8Array(N * 6);
    for (let i = 0; i < N; i++) {
        const [q, r] = cells[i];
        for (let d = 0; d < 6; d++) {
            const j = at(q + D[d][0], r + D[d][1]);
            if (j < 0) continue;
            nb[i * 6 + d] = j;
            back[i * 6 + d] = (d + 3) % 6;
        }
    }
    const slot = (k, j) => { const s = slotAt(R, k, j); return at(s.q, s.r) * 6 + s.d; };
    const link = (a, b, f) => {
        nb[a] = (b / 6) | 0; back[a] = b % 6; flip[a] = f;
        nb[b] = (a / 6) | 0; back[b] = a % 6; flip[b] = f;
    };
    for (const [e, f, kind, shift, oe, of] of spec.pairs) {
        for (let i = 0; i <= 2 * R; i++) {
            const ii = kind === 't' ? 2 * R - i + shift : i + shift;
            if (ii < 0 || ii > 2 * R) continue;
            link(slot(e, i + oe), slot(f, ii + of), kind === 't' ? 0 : 1);
        }
    }
    const pos = p => (p === 'end' ? 2 * R : p);
    for (const [[e, i], [f, j], fl] of spec.close) link(slot(e, pos(i)), slot(f, pos(j)), fl);
    return { R, N, cells, at, nb, back, flip };
}

// ─── Edge isometries (ghost copies and picking) ───
// Across each glued edge e lies a copy of the world, g_e(F), with
// g_e(x) = M·x + v a symmetry of the cell lattice (M a signed permutation of
// cube coordinates, written as an integer matrix on axial (q, r)). It is read
// off the slot matching in the middle of the edge, where the gluing is exact.

const LINEAR = [];
for (const p of [[0, 1, 2], [1, 2, 0], [2, 0, 1], [0, 2, 1], [2, 1, 0], [1, 0, 2]]) {
    for (const s of [1, -1]) {
        const ap = (q, r) => { const c = [q, r, -q - r]; return [s * c[p[0]], s * c[p[1]]]; };
        const [a, c] = ap(1, 0), [b, d] = ap(0, 1);
        LINEAR.push([a, b, c, d]);
    }
}

const _gluingCache = new Map();

/**
 * Per-edge gluing isometries for a surface at radius R: an array of six
 * entries, null for an open edge, else { partner, kind, m: [a, b, c, d], v: [vq, vr] }
 * with g(q, r) = (a·q + b·r + vq, c·q + d·r + vr) carrying F onto the copy
 * beyond the edge.
 */
export function edgeGluings(topology, R) {
    const key = topology * 4096 + R;
    let out = _gluingCache.get(key);
    if (out) return out;
    const spec = SPECS[topology] || SPECS[Topology.TORUS];
    const cx = buildComplex(topology, R);
    out = [null, null, null, null, null, null];
    for (const [e, f, kind] of spec.pairs) {
        for (const [from, to] of [[e, f], [f, e]]) {
            // Middle slots of edge `from`: cell c facing out to p = c + dir, glued to
            // cell c' facing out through `back`. g carries c' to p and c' + back to c;
            // both rows are needed, since one row alone fits g and its mirror image.
            const samples = [];
            for (let j = R - 2; j <= R + 2; j++) {
                const s = slotAt(R, from, j), i = cx.at(s.q, s.r), n = cx.nb[i * 6 + s.d];
                const c2 = cx.cells[n], bd = D[cx.back[i * 6 + s.d]];
                samples.push({ p: [s.q + D[s.d][0], s.r + D[s.d][1]], c2 });
                samples.push({ p: [s.q, s.r], c2: [c2[0] + bd[0], c2[1] + bd[1]] });
            }
            for (const m of LINEAR) {
                const [a, b, c, d] = m, s0 = samples[0];
                const v = [s0.p[0] - (a * s0.c2[0] + b * s0.c2[1]), s0.p[1] - (c * s0.c2[0] + d * s0.c2[1])];
                if (samples.every(({ p, c2 }) => a * c2[0] + b * c2[1] + v[0] === p[0] && c * c2[0] + d * c2[1] + v[1] === p[1])) {
                    out[from] = { partner: to, kind: kind === 't' ? 'translate' : 'twist', m, v };
                    break;
                }
            }
        }
    }
    _gluingCache.set(key, out);
    return out;
}

/** Inverse of an edge isometry applied to (q, r). */
function unglue(g, q, r) {
    const [a, b, c, d] = g.m, det = a * d - b * c;
    const x = q - g.v[0], y = r - g.v[1];
    return [(d * x - b * y) / det, (-c * x + a * y) / det];
}

/**
 * Map a cell to its representative in the world: itself when inside the
 * hexagon; for a cell in one of the copies beyond a glued edge, the world cell
 * it is a copy of; otherwise null (an open edge, or a corner gap between
 * copies). Neighbor lookups use the slot table instead, which is exact at the
 * corners too.
 */
export function wrap(q, r, topology, W, H) {
    const { cq, cr, R } = hexBounds(W, H);
    const dq = q - cq, dr = r - cr;
    if (cubeDist(dq, dr) <= R) return { q, r };
    const gs = edgeGluings(topology, R);
    for (let e = 0; e < 6; e++) {
        const g = gs[e];
        if (!g) continue;
        const [x, y] = unglue(g, dq, dr);
        if (cubeDist(x, y) <= R) return { q: cq + x, r: cr + y };
    }
    return null;
}

// ─── Precomputed neighbor-index tables ──────────────────────────────────────
// Hot dynamics loops read neighbors per cell per step, so the table is built
// once per (W, H, topology):
//   idx:   Int32Array(N*6) — flat cell index of each neighbor, or -1 across an
//          open edge. Cell i's neighbors start at i*6, in HEX_DIRS order.
//   back:  Int8Array(N*6) — the direction through which that neighbor sees
//          cell i (the opposite one except across a twisted gluing), or -1.
//   count: Uint8Array(N) — number of entries that are not -1.
// Cells outside the hexagon get their plain in-hexagon lattice neighbors.

const _nbrCache = new Map();

/**
 * Precompute (or fetch from cache) the neighbor table for a grid + topology.
 * The same object is returned on later calls with the same key.
 */
export function getNeighborTable(W, H, topology) {
    const key = W | (H << 12) | (topology << 24);
    let cached = _nbrCache.get(key);
    if (cached) return cached;

    const { cq, cr, R } = hexBounds(W, H);
    const cx = buildComplex(topology, R);
    const N = W * H;
    const idx = new Int32Array(N * 6).fill(-1);
    const back = new Int8Array(N * 6).fill(-1);
    const count = new Uint8Array(N);
    for (let r = 0; r < H; r++) {
        for (let q = 0; q < W; q++) {
            const cell = r * W + q;
            const i = cx.at(q - cq, r - cr);
            let c = 0;
            for (let d = 0; d < 6; d++) {
                let n = -1;
                if (i >= 0) {
                    const j = cx.nb[i * 6 + d];
                    if (j >= 0) { n = (cr + cx.cells[j][1]) * W + (cq + cx.cells[j][0]); back[cell * 6 + d] = cx.back[i * 6 + d]; }
                } else {
                    const nq = q + D[d][0], nr = r + D[d][1];
                    if (nq >= 0 && nq < W && nr >= 0 && nr < H && cx.at(nq - cq, nr - cr) >= 0) { n = nr * W + nq; back[cell * 6 + d] = (d + 3) % 6; }
                }
                idx[cell * 6 + d] = n;
                if (n >= 0) c++;
            }
            count[cell] = c;
        }
    }
    cached = { idx, back, count };
    _nbrCache.set(key, cached);
    return cached;
}

/** Valid neighbors of (q, r) under the given topology, in HEX_DIRS order. */
export function neighbors(q, r, topology, W, H) {
    const t = getNeighborTable(W, H, topology);
    const base = (r * W + q) * 6, out = [];
    for (let d = 0; d < 6; d++) {
        const n = t.idx[base + d];
        if (n >= 0) out.push({ q: n % W, r: (n / W) | 0 });
    }
    return out;
}

// ─── Cone points ───
// Where a cell-vertex is shared by other than three cells, the surface is
// curved (cone angle = 120° per cell corner). On these gluings that happens
// only at the corners of the world hexagon. Returns, per corner k of F (the
// corner cell R·dir_k), the cone angle of the vertex there, 360 when flat.
const _coneCache = new Map();
export function cornerCones(topology, R) {
    const key = topology * 4096 + R;
    let out = _coneCache.get(key);
    if (out) return out;
    const cx = buildComplex(topology, R), { N, nb, back, flip } = cx;
    const P = new Int32Array(N * 6);
    for (let k = 0; k < P.length; k++) P[k] = k;
    const find = (x) => { while (P[x] !== x) { P[x] = P[P[x]]; x = P[x]; } return x; };
    const unite = (a, b) => { a = find(a); b = find(b); if (a !== b) P[a] = b; };
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < 6; j++) {
            const s = i * 6 + j, n = nb[s];
            if (n >= 0) unite(s, n * 6 + (flip[s] ? back[s] : (back[s] + 5) % 6));
            const s1 = i * 6 + (j + 1) % 6, m = nb[s1];
            if (m >= 0) unite(s, m * 6 + (flip[s1] ? (back[s1] + 5) % 6 : back[s1]));
        }
    }
    const size = new Map();
    for (let k = 0; k < P.length; k++) { const r = find(k); size.set(r, (size.get(r) || 0) + 1); }
    out = [];
    for (let k = 0; k < 6; k++) {
        const i = cx.at(R * D[k][0], R * D[k][1]);
        // the corner cell's outward middle cell-edge k has corners k-1 and k
        const angles = [];
        for (const j of [(k + 5) % 6, k]) {
            const n = size.get(find(i * 6 + j));
            if (n !== 3 && !angles.includes(n * 120)) angles.push(n * 120);
        }
        out.push(angles.sort((a, b) => a - b));
    }
    _coneCache.set(key, out);
    return out;
}
