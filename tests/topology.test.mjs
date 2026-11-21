// The four surfaces: each glued slot table, read as a cell complex, must have
// the surface's χ, orientability and cone points; the grid's neighbour table
// and the plate's edge copies must agree with it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Topology, HEX_DIRS, DEFAULTS } from '../src/config.js';
import { Grid } from '../src/grid.js';
import { initializeGrid } from '../src/initialization.js';
import { hexBounds, inHex, buildComplex, edgeGluings, wrap, SURFACES, getNeighborTable } from '../src/topology.js';

const R = 5;
const ALL = [Topology.PLANE, Topology.TORUS, Topology.KLEIN, Topology.RP2];
const cubeDist = (dq, dr) => Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));

// Faces are cells, edges are cell-edges, vertices are cell-vertices. Corner j of
// cell i sits between its directions j and j+1; gluing a cell-edge identifies
// the corners at its two ends with the neighbour's, reversed when the crossing
// flips orientation. The cone angle at a vertex is 120° per cell corner there.
function complexStats({ N, nb, back, flip }) {
    let asym = 0, open = 0, self = 0, dupCells = 0, edges = 0;
    for (let i = 0; i < N; i++) {
        const seen = new Set();
        let dup = false;
        for (let d = 0; d < 6; d++) {
            const s = i * 6 + d, j = nb[s];
            if (j < 0) { open++; edges++; continue; }
            if (j === i) self++;
            if (seen.has(j)) dup = true;
            seen.add(j);
            const bd = back[s];
            if (nb[j * 6 + bd] !== i || back[j * 6 + bd] !== d || flip[j * 6 + bd] !== flip[s]) asym++;
            if (j > i || (j === i && bd > d)) edges++;
        }
        if (dup) dupCells++;
    }
    const P = new Int32Array(N * 6).map((_, k) => k);
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
    const cones = [...size.values()].filter((v) => v !== 3).map((v) => `${v * 120}°`).sort().join(' ');
    const o = new Int8Array(N);
    let orientable = true;
    o[0] = 1;
    const stack = [0];
    while (stack.length) {
        const i = stack.pop();
        for (let d = 0; d < 6; d++) {
            const j = nb[i * 6 + d];
            if (j < 0) continue;
            const want = flip[i * 6 + d] ? -o[i] : o[i];
            if (!o[j]) { o[j] = want; stack.push(j); } else if (o[j] !== want) orientable = false;
        }
    }
    return { asym, open, self, dupCells, chi: size.size - edges + N, orientable, cones };
}

// Every closed surface glues every slot. The torus is flat. The Klein bottle
// and RP² carry the cone points their corner closings leave: no gluing of the
// hexagon of cells by glide reflections is defect-free (tools/klein-lemma.mjs),
// and RP² (χ 1) can't be flat at all.
const EXPECT = {
    [Topology.PLANE]: { open: 12 * R + 6 },
    [Topology.TORUS]: { open: 0, cones: '', dupCells: 0, self: 0 },
    [Topology.KLEIN]: { open: 0, cones: '240° 480°', dupCells: 2, self: 0 },
    [Topology.RP2]: { open: 0, cones: '120° 240° 240° 480°' },
};

for (const topo of ALL) {
    const S = SURFACES[topo];
    test(`${S.key}: the slot table is a ${S.closed ? 'closed' : 'bounded'} surface with χ ${S.chi}, ${S.orientable ? '' : 'non-'}orientable`, () => {
        const st = complexStats(buildComplex(topo, R));
        assert.equal(st.asym, 0, 'every slot is its partner\'s partner');
        assert.equal(st.chi, S.chi);
        assert.equal(st.orientable, S.orientable);
        for (const [k, v] of Object.entries(EXPECT[topo])) assert.equal(st[k], v, k);
    });
}

test('the hex mask and hexBounds agree on the world', () => {
    const W = 2 * R + 2, grid = new Grid(W, W);
    initializeGrid(grid);
    const inside = [];
    for (let r = 0; r < W; r++) for (let q = 0; q < W; q++) if (inHex(q, r, W, W)) inside.push(r * W + q);
    assert.deepEqual([...grid.activeIndices.slice(0, grid.activeCount)], inside);
    assert.equal(inside.length, 3 * R * (R + 1) + 1);
    assert.equal(hexBounds(W, W).R, R);
});

test('the grid\'s neighbour table is symmetric, and back names the edge each neighbour sees', () => {
    const W = 2 * DEFAULTS.R + 2;
    for (const topo of ALL) {
        const { idx, back } = getNeighborTable(W, W, topo);
        for (let r = 0; r < W; r++) for (let q = 0; q < W; q++) {
            if (!inHex(q, r, W, W)) continue;
            const i = r * W + q;
            for (let d = 0; d < 6; d++) {
                const j = idx[i * 6 + d], bd = back[i * 6 + d];
                if (j < 0) { assert.equal(bd, -1); continue; }
                assert.ok(bd >= 0 && idx[j * 6 + bd] === i && back[j * 6 + bd] === d, `${SURFACES[topo].key} (${q},${r}) dir ${d}`);
            }
        }
    }
});

for (const topo of [Topology.TORUS, Topology.KLEIN, Topology.RP2]) {
    test(`${SURFACES[topo].key}: each edge's copy wraps onto the slot gluing, mirrored iff the edge is twisted`, () => {
        const RW = DEFAULTS.R, W = 2 * RW + 2, gs = edgeGluings(topo, RW), { cq, cr } = hexBounds(W, W);
        for (let e = 0; e < 6; e++) {
            const g = gs[e], h = gs[g.partner];
            const [a, b, c, d] = g.m;
            assert.equal(a * d - b * c, g.kind === 'translate' ? 1 : -1, `edge ${e} orientation`);
            const x = [3, -7], y = [a * x[0] + b * x[1] + g.v[0], c * x[0] + d * x[1] + g.v[1]];
            assert.deepEqual([h.m[0] * y[0] + h.m[1] * y[1] + h.v[0], h.m[2] * y[0] + h.m[3] * y[1] + h.v[1]], x, `edge ${e}'s partner undoes it`);
        }
        // Along each edge, away from the corners, the cell beyond a boundary
        // cell wraps back onto the slot table's neighbour.
        const cx = buildComplex(topo, RW);
        let checked = 0;
        for (let i = 0; i < cx.N; i++) {
            const [q, r] = cx.cells[i];
            if (cubeDist(q, r) !== RW) continue;
            if ([0, 1, 2, 3, 4, 5].some((k) => cubeDist(q - RW * HEX_DIRS[k].dq, r - RW * HEX_DIRS[k].dr) <= 1)) continue;
            for (let d = 0; d < 6; d++) {
                const pq = q + HEX_DIRS[d].dq, pr = r + HEX_DIRS[d].dr;
                if (cubeDist(pq, pr) <= RW) continue;
                const w = wrap(cq + pq, cr + pr, topo, W, W), n = cx.cells[cx.nb[i * 6 + d]];
                assert.deepEqual([w.q - cq, w.r - cr], [n[0], n[1]], `(${q},${r}) dir ${d}`);
                checked++;
            }
        }
        assert.equal(checked, 6 * 2 * (RW - 3), 'two slots for each edge cell clear of a corner');
    });
}
