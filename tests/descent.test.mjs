// Who infected whom (src/descent.js), checked against the tick, and the tick's
// own conservation and determinism.

import './env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Compartment, Flag, Animal, Topology, MemoryKind, DEFAULTS, OPENING_SEEDS } from '../src/config.js';
import { Grid } from '../src/grid.js';
import { initializeGrid, seedPopulation } from '../src/initialization.js';
import { createRegistry, strainCount } from '../src/strains.js';
import { tick } from '../src/dynamics.js';
import { PRESETS, applyPreset } from '../src/presets.js';
import { DEFAULT_PARAMS } from '../src/default-params.js';
import { DEFAULT_TOGGLES } from '../src/default-toggles.js';
import { hexBounds, getNeighborTable } from '../src/topology.js';
import { memoryOf, remember } from '../src/immunity.js';
import { Descent, SRC_ANIMAL, SRC_TRANSFORM, NO_DIR, WINDOW, openState } from '../src/descent.js';
import { chainStats, SPAN_DAYS } from '../src/chains.js';

// A world set up as main.js does: the preset, its coverage, and the opening's
// two seeds (a ring of seven cells each) placed through the seed brush's log.
function world(key, R, topology, seed) {
    const params = { ...DEFAULT_PARAMS }, toggles = { ...DEFAULT_TOGGLES }, sim = { topology };
    if (key !== 'sandbox') applyPreset(PRESETS.find((p) => p.key === key), params, toggles, sim);
    const W = 2 * R + 2, grid = new Grid(W, W);
    initializeGrid(grid);
    const rng = mulberry32(seed);
    seedPopulation(grid, params, rng);
    const reg = createRegistry(params), mem = memoryOf(grid);
    for (const i of grid.activeIndices) {
        if (toggles.V && params.vax_coverage > 0 && grid.compartment[i] === Compartment.S && rng() < params.vax_coverage) {
            grid.compartment[i] = Compartment.V; remember(mem, i, 0, 0, MemoryKind.VACCINE);
        }
    }
    const { cq, cr } = hexBounds(W, W);
    for (const [dq0, dr0] of OPENING_SEEDS) {
        const dq = Math.round(dq0 * R / DEFAULTS.R), dr = Math.round(dr0 * R / DEFAULTS.R);
        for (const [a, b] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, -1], [-1, 1]]) {
            const i = (cr + dr + b) * W + (cq + dq + a), c = grid.compartment[i];
            if (c === Compartment.D || c === Compartment.EMPTY || c === Compartment.Z) continue;
            grid.compartment[i] = Compartment.I; grid.flags[i] = 0;
            grid.strain_ids[i * 4] = 0; grid.strain_loads[i * 4] = 1;
            for (let s = 1; s < 4; s++) { grid.strain_ids[i * 4 + s] = 0xFFFF; grid.strain_loads[i * 4 + s] = 0; }
            grid.descent.introduce(i);
        }
    }
    return { grid, params, toggles, reg, rng, topology: sim.topology };
}

const transmits = (c, f, t) => c === Compartment.Z || c === Compartment.I
    || (c === Compartment.R && t.C && (f & Flag.CARRIER))
    || (c === Compartment.D && t.F && (f & Flag.F_CORPSE));

// Every subtree's size by brute force, against the log's own counts.
function checkTrees(d, label) {
    const m = d.mask, desc = d.countDescendants(), kids = new Map(), sub = new Map();
    for (let s = d.base; s < d.head; s++) {
        const p = d.parent[s & m];
        if (p >= d.base) { if (!kids.has(p)) kids.set(p, []); kids.get(p).push(s); }
    }
    for (let s = d.head - 1; s >= d.base; s--) {
        const ch = kids.get(s) || [];
        let n = 0;
        for (const c of ch) n += 1 + sub.get(c);
        sub.set(s, n);
        assert.equal(desc[s & m], n, `${label}: descendants of ${s}`);
        assert.equal(d.kids[s & m], ch.length, `${label}: children of ${s}`);
    }
    for (let t = 0; t < d.tNext; t++) {
        if (d.tOpen[t] > 0 && d.tRoot[t] >= d.base) assert.equal(d.tSize[t], sub.get(d.tRoot[t]) + 1, `${label}: tree ${t}'s size`);
    }
}

// One run per kind of source: transmission across twisted edges (Threshold on
// the Klein bottle), carriers, F-corpses and spillover (the Sandbox on RP²),
// transformations founding clones (Immunoediting), and zombies carrying a
// case on (Zombie apocalypse).
const RUNS = [
    ['threshold', Topology.KLEIN, []], ['sandbox', Topology.RP2, ['animal', Compartment.R, Compartment.D]],
    ['immunoediting', Topology.PLANE, ['transform', 'Z']], ['zombie-apocalypse', Topology.TORUS, ['Z']],
];
for (const [key, topo, mustSee] of RUNS) {
    test(`${key}: every event's source, edge and parent match the tick; open cases are the cells holding them`, () => {
        const w = world(key, 24, topo, 3), { grid, params, toggles, reg, rng } = w, d = grid.descent;
        const { idx: nbr, back } = getNeighborTable(grid.W, grid.H, w.topology);
        const N = grid.W * grid.H;
        const comp0 = new Uint8Array(N), flags0 = new Uint8Array(N), animal0 = new Uint8Array(N), evt0 = new Int32Array(N);
        const kinds = new Set();
        let events = 0;
        for (let k = 1; k <= 300; k++) {
            comp0.set(grid.compartment); flags0.set(grid.flags); animal0.set(grid.animal); evt0.set(d.evt);
            const h0 = d.head;
            tick(grid, params, toggles, w.topology, rng, reg, k);
            for (let s = h0; s < d.head; s++) {
                const e = s & d.mask, cell = d.cell[e], src = d.src[e], dir = d.dir[e];
                events++;
                assert.equal(d.tick[e], k);
                if (src >= 0) {
                    kinds.add(comp0[src] === Compartment.Z ? 'Z' : comp0[src]);
                    assert.ok(transmits(comp0[src], flags0[src], toggles), `tick ${k}: source ${src} was transmitting`);
                    assert.ok(dir < NO_DIR && nbr[cell * 6 + dir] === src && nbr[src * 6 + back[cell * 6 + dir]] === cell, `tick ${k}: the event's edge`);
                    assert.equal(d.parent[e], evt0[src] >= d.base && evt0[src] < h0 ? evt0[src] : -1, `tick ${k}: parent`);
                } else if (src === SRC_ANIMAL) {
                    kinds.add('animal');
                    assert.ok(animal0[cell] === Animal.I && d.parent[e] === -1, 'spillover is from an infectious animal and roots a tree');
                } else if (src === SRC_TRANSFORM) {
                    kinds.add('transform');
                    assert.ok(comp0[cell] === Compartment.E && (flags0[cell] & Flag.LATENT) && d.parent[e] === -1, 'a transformation is a latent cell\'s and roots a tree');
                } else assert.fail(`tick ${k}: source code ${src}`);
            }
            for (let j = 0; j < d.nOpen; j++) {
                const s = d.openS[j], c = d.openC[j];
                assert.ok(d.evt[c] === s && openState(grid.compartment[c], grid.flags[c], toggles.C, toggles.F) && !d.closed[s & d.mask], `tick ${k}: open case at ${c}`);
            }
            for (const i of grid.activeIndices) {
                const s = d.eventAt(i);
                assert.ok(!(s >= 0 && d.closed[s & d.mask] && openState(grid.compartment[i], grid.flags[i], toggles.C, toggles.F) && d.evt[i] === s), `tick ${k}: closed case still held at ${i}`);
            }
        }
        assert.ok(events > 50, `${events} events`);
        for (const kind of mustSee) assert.ok(kinds.has(kind), `saw ${kind}: ${[...kinds]}`);
        checkTrees(d, key);
    });
}

test('Re by count is children per closed case; a tree closes with its last case', () => {
    const grid = new Grid(8, 8), d = grid.descent, a = 9, kids = [10, 17, 18];
    grid.compartment[a] = Compartment.I;
    d.introduce(a);
    for (const c of kids) { d.infect(c, a, 0, 1); grid.compartment[c] = Compartment.E; }
    d.settle(grid, 1, false, false);
    grid.compartment[a] = Compartment.R;
    d.settle(grid, 2, false, false);
    assert.equal(d.reCounted(), 3);
    grid.compartment[kids[0]] = Compartment.R;
    d.settle(grid, 3, false, false);
    assert.equal(d.reCounted(), 1.5);
    assert.equal(d.trees, 0, 'open while any case is');
    grid.compartment[kids[1]] = Compartment.R; grid.compartment[kids[2]] = Compartment.D;
    d.settle(grid, 4, false, false);
    assert.ok(d.trees === 1 && d.treeSize[0] === 4);
    d.now = 100;
    assert.ok(Number.isNaN(d.reCounted()), 'closures older than RE_DAYS are forgotten');
});

test('the log grows past its capacity and drops events older than the window, counted from the newest', () => {
    const grid = new Grid(40, 40), d = new Descent(1600);
    grid.descent = d;
    const cap0 = d.cap;
    for (let t = 0; t < 3; t++) for (let i = 0; i < 2000; i++) d.infect(i % 1600, -1, NO_DIR, t);
    d.settle(grid, 2, false, false);
    assert.ok(d.cap > cap0 && d.head - d.base === 6000);
    for (let i = 0; i < 10; i++) d.infect(i, -1, NO_DIR, WINDOW + 2);
    d.settle(grid, WINDOW + 2, false, false);
    assert.equal(d.head - d.base, 2010);
    d.settle(grid, WINDOW + 500, false, false);
    assert.equal(d.head - d.base, 2010, 'a finished outbreak keeps its tree');
});

test('a chain longer than the window stays one tree, keeps its generation and closes whole', () => {
    const grid = new Grid(40, 40), d = grid.descent, T = WINDOW + 200;
    grid.compartment[0] = Compartment.I;
    d.introduce(0);
    d.settle(grid, 0, false, false);
    for (let t = 1; t <= T; t++) {
        const prev = (t - 1) % 1600, c = t % 1600;
        d.infect(c, prev, NO_DIR, t);
        grid.compartment[c] = Compartment.I; grid.compartment[prev] = Compartment.R;
        d.settle(grid, t, false, false);
    }
    assert.ok(d.summary().trees === 1 && d.growing() === T + 1 && d.summary().generation === T);
    grid.compartment[T % 1600] = Compartment.R;
    d.settle(grid, T + 1, false, false);
    assert.ok(d.trees === 1 && d.treeSize[0] === T + 1);
});

test('undo drops the cases a stroke placed and redo restores them, open', () => {
    const grid = new Grid(8, 8), d = grid.descent;
    grid.compartment[20] = Compartment.I;
    d.introduce(20);
    d.settle(grid, 1, false, false);
    const h0 = d.head, before = d.evt[21];
    d.introduce(21);
    assert.equal(d.introduce(21), h0, 'a stroke crossing a cell twice places it once');
    const h1 = d.head;
    d.evt[21] = before; d.truncate(h0);
    assert.ok(d.head === h0 && d.nOpen === 1);
    d.evt[21] = h0; d.extend(h1);
    assert.ok(d.head === h1 && d.nOpen === 2 && d.eventAt(21) === h0);
});

test('Fig. 4 counts the chains closed within its span, by size', () => {
    const grid = new Grid(16, 16), d = grid.descent;
    const chain = (size, t0, t1) => {
        const root = 20 + d.head;
        grid.compartment[root] = Compartment.I;
        d.introduce(root);
        for (let k = 1; k < size; k++) { d.infect(root + k, root, 0, t0); grid.compartment[root + k] = Compartment.E; }
        d.settle(grid, t0, false, false);
        for (let k = 0; k < size; k++) grid.compartment[root + k] = Compartment.R;
        d.settle(grid, t1, false, false);
    };
    chain(1, 1, 2);
    chain(3, SPAN_DAYS + 10, SPAN_DAYS + 12);
    chain(6, SPAN_DAYS + 20, SPAN_DAYS + 30);
    const c = chainStats(d);
    assert.ok(c.n === 2 && c.mean === 4.5 && c.max === 6 && c.bins[1] === 1 && c.bins[2] === 1, JSON.stringify(c));
});

// The tick itself, on the Sandbox (every mechanism on but Z): a seed fixes the
// run, which ?seed= and tools/bench.mjs's fingerprints rely on, and an active
// cell's loads always sum to one.
function fingerprint(w) {
    let h = 2166136261;
    for (const a of [w.grid.compartment, w.grid.flags, w.grid.strain_ids, w.grid.strain_loads, w.grid.animal, w.grid.mem_x]) {
        const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
        for (let k = 0; k < b.length; k++) h = Math.imul(h ^ b[k], 16777619);
    }
    return [h >>> 0, strainCount(w.reg), w.grid.descent.head];
}
test('the tick is determined by its seed and keeps every carrier\'s loads summing to one', () => {
    const runs = [1, 2].map(() => {
        const w = world('sandbox', 24, Topology.TORUS, 9);
        for (let k = 1; k <= 300; k++) {
            tick(w.grid, w.params, w.toggles, w.topology, w.rng, w.reg, k);
            if (k % 50) continue;
            for (const i of w.grid.activeIndices) {
                const c = w.grid.compartment[i];
                if (c !== Compartment.E && c !== Compartment.I && c !== Compartment.Z) continue;
                let sum = 0;
                for (let s = 0; s < 4; s++) if (w.grid.strain_ids[i * 4 + s] !== 0xFFFF) sum += w.grid.strain_loads[i * 4 + s];
                assert.ok(Math.abs(sum - 1) < 1e-4, `tick ${k}: cell ${i} (${c}) loads sum to ${sum}`);
            }
        }
        return fingerprint(w);
    });
    assert.ok(runs[0][1] > 1, 'the run mutated');
    assert.deepEqual(runs[0], runs[1]);
});
