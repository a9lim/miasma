// descent.test.mjs — who infected whom (descent.js), checked against the tick.
// node src/descent.test.mjs
//
// Runs the presets and the Sandbox on a small world and checks, every tick,
// that each new event's source was transmitting at the start of the tick,
// across the edge the event names, and that its parent is the case the source
// held then; that open cases are exactly the cells still holding them; that
// children counts and descendant counts equal the tree's own; that closed
// trees had their size; the log's ring, undo and redo, and the view's texel
// on their own; the space–time figure's record of the centre row; and
// Fig. 4's chains.

globalThis.mulberry32 = function (seed) { let a = seed | 0; return function () { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
globalThis.gaussian = function (rng) { rng = rng || Math.random; let u1 = rng(); if (u1 < 1e-12) u1 = 1e-12; return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rng()); };

const { Compartment, Flag, Animal, Topology, MemoryKind, DEFAULTS, OPENING_SEEDS } = await import('./config.js');
const { Grid } = await import('./grid.js');
const { initializeGrid, seedPopulation } = await import('./initialization.js');
const { createRegistry } = await import('./strains.js');
const { tick } = await import('./dynamics.js');
const { PRESETS, applyPreset } = await import('./presets.js');
const { DEFAULT_PARAMS } = await import('./default-params.js');
const { DEFAULT_TOGGLES } = await import('./default-toggles.js');
const { hexBounds, getNeighborTable } = await import('./topology.js');
const { memoryOf, remember } = await import('./immunity.js');
const { Descent, SRC_INTRO, SRC_ANIMAL, SRC_TRANSFORM, NO_DIR, WINDOW, openState, packDescent, ROOT_INTRO } = await import('./descent.js');

let pass = 0, fail = 0;
function check(name, ok, detail) {
    if (ok) pass++;
    else { fail++; console.log('FAIL', name, detail === undefined ? '' : detail); }
}

// A world set up as main.js does: the preset, its coverage, the opening's two
// seeds (a ring of seven cells each) placed by hand.
function world(key, R, topology, seed) {
    const params = { ...DEFAULT_PARAMS }, toggles = { ...DEFAULT_TOGGLES }, sim = { topology };
    if (key !== 'sandbox') applyPreset(PRESETS.find(p => p.key === key), params, toggles, sim);
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

// Every subtree's size by brute force, against countDescendants.
function checkTrees(d, label) {
    const m = d.mask, desc = d.countDescendants();
    const kids = new Map(), sub = new Map();
    for (let s = d.base; s < d.head; s++) {
        const p = d.parent[s & m];
        if (p >= d.base) { if (!kids.has(p)) kids.set(p, []); kids.get(p).push(s); }
    }
    let descOk = true, kidsOk = true, sizeOk = true;
    for (let s = d.head - 1; s >= d.base; s--) {
        const ch = kids.get(s) || [];
        let n = 0;
        for (const c of ch) n += 1 + sub.get(c);
        sub.set(s, n);
        if (desc[s & m] !== n) descOk = false;
        if (d.kids[s & m] !== ch.length) kidsOk = false;
    }
    // every live tree's size is its root's subtree, while the root is kept
    for (let t = 0; t < d.tNext; t++) {
        if (d.tOpen[t] > 0 && d.tRoot[t] >= d.base && d.tSize[t] !== sub.get(d.tRoot[t]) + 1) sizeOk = false;
    }
    check(`${label}: descendants equal subtree sizes`, descOk);
    check(`${label}: children counts equal the tree's`, kidsOk);
    check(`${label}: a tree's size is its root's subtree`, sizeOk);
}

const transmits = (c, f, t) => c === Compartment.I
    || (c === Compartment.R && t.C && (f & Flag.CARRIER))
    || (c === Compartment.D && t.F && (f & Flag.F_CORPSE));

const runs = [
    ['threshold', Topology.TORUS], ['threshold', Topology.KLEIN], ['herd-immunity', Topology.RP2],
    ['antigenic-drift', Topology.TORUS], ['spillover', Topology.TORUS], ['immunoediting', Topology.PLANE],
    ['zombie-apocalypse', Topology.KLEIN], ['sandbox', Topology.TORUS]
];
for (const [key, topo] of runs) {
    const w = world(key, 24, topo, 3);
    const { grid, params, toggles, reg, rng } = w, d = grid.descent;
    const { idx: nbr, back } = getNeighborTable(grid.W, grid.H, w.topology);
    const N = grid.W * grid.H;
    const comp0 = new Uint8Array(N), flags0 = new Uint8Array(N), animal0 = new Uint8Array(N), evt0 = new Int32Array(N);
    let srcOk = true, edgeOk = true, parentOk = true, animalOk = true, transformOk = true, openOk = true, closedOk = true, kinds = new Set();
    let events = 0, introSeen = 0, reMid = NaN, ratioMid = NaN, sToE = 0, removed = 0;
    for (let k = 1; k <= 400; k++) {
        comp0.set(grid.compartment); flags0.set(grid.flags); animal0.set(grid.animal); evt0.set(d.evt);
        const h0 = d.head;
        const c = tick(grid, params, toggles, w.topology, rng, reg, k);
        if (k > 40 && k <= 100) { sToE += c.sToE; removed += c.iToR + c.iToD; }
        if (k === 100) { reMid = d.reCounted(); ratioMid = sToE / removed; }
        for (let s = h0; s < d.head; s++) {
            const e = s & d.mask, cell = d.cell[e], src = d.src[e], dir = d.dir[e];
            events++;
            if (d.tick[e] !== k) srcOk = false;
            if (src >= 0) {
                const c = comp0[src];
                const z = c === Compartment.Z;
                kinds.add(z ? 'Z' : c);
                if (!transmits(c, flags0[src], toggles) && !z) srcOk = false;
                if (dir >= NO_DIR || nbr[cell * 6 + dir] !== src || nbr[src * 6 + back[cell * 6 + dir]] !== cell) edgeOk = false;
                const p0 = evt0[src] >= d.base && evt0[src] < h0 ? evt0[src] : -1;
                if (d.parent[e] !== p0) parentOk = false;
            } else if (src === SRC_ANIMAL) {
                kinds.add('animal');
                if (animal0[cell] !== Animal.I || d.parent[e] !== -1) animalOk = false;
            } else if (src === SRC_TRANSFORM) {
                kinds.add('transform');
                if (comp0[cell] !== Compartment.E || !(flags0[cell] & Flag.LATENT) || d.parent[e] !== -1) transformOk = false;
            } else srcOk = false;
        }
        // open cases are exactly the cells still holding them
        for (let j = 0; j < d.nOpen; j++) {
            const s = d.openS[j], e = s & d.mask, c = d.openC[j];
            if (d.evt[c] !== s || !openState(grid.compartment[c], grid.flags[c], toggles.C, toggles.F) || d.closed[e]) openOk = false;
        }
        for (const i of grid.activeIndices) {
            const s = d.eventAt(i);
            if (s >= 0 && d.closed[s & d.mask] && openState(grid.compartment[i], grid.flags[i], toggles.C, toggles.F) && d.evt[i] === s) closedOk = false;
        }
    }
    for (let s = d.base; s < d.head; s++) if (d.src[s & d.mask] === SRC_INTRO) introSeen++;
    const label = `${key} on ${['plane', 'torus', 'Klein', 'RP²'][topo]}`;
    check(`${label}: logs infections`, events > 50, events);
    check(`${label}: every source was transmitting at the start of its tick`, srcOk, [...kinds]);
    check(`${label}: every source sits across the event's edge, and back`, edgeOk);
    check(`${label}: every parent is the case its source held`, parentOk);
    check(`${label}: spillover comes from an infectious animal and starts a tree`, animalOk);
    check(`${label}: a transformation is a latent cell's, and starts a tree`, transformOk);
    check(`${label}: open cases are the cells holding them`, openOk);
    check(`${label}: a closed case's cell no longer holds it`, closedOk);
    checkTrees(d, label);
    if (key === 'spillover') check(`${label}: spillover is logged`, kinds.has('animal'), [...kinds]);
    if (key === 'zombie-apocalypse') check(`${label}: zombies are sources`, kinds.has('Z'), [...kinds]);
    if (key === 'immunoediting') check(`${label}: transformations found clones`, kinds.has('transform') && kinds.has('Z'), [...kinds]);
    if (key === 'threshold' && topo === Topology.TORUS) {
        check(`${label}: the opening's cases are kept`, introSeen === 14, introSeen);
        check(`${label}: Re by counting near the ratio estimator on the front`, Math.abs(reMid - ratioMid) < 0.25, [reMid, ratioMid]);
    }
}

// Re by counting, by hand: one case with three children closes, then one with none.
{
    const grid = new Grid(8, 8), d = grid.descent;
    const a = 9, kids = [10, 17, 18];
    grid.compartment[a] = Compartment.I;
    d.introduce(a);
    for (const c of kids) d.infect(c, a, 0, 1);
    for (const c of kids) grid.compartment[c] = Compartment.E;
    d.settle(grid, 1, false, false);
    check('children counted on the parent', d.kids[d.evt[a] & d.mask] === 3);
    grid.compartment[a] = Compartment.R;
    d.settle(grid, 2, false, false);
    check('a recovered case closes with its children', d.reCounted() === 3, d.reCounted());
    grid.compartment[kids[0]] = Compartment.R;
    d.settle(grid, 3, false, false);
    check('Re by counting averages the closed cases', d.reCounted() === 1.5, d.reCounted());
    check('the tree stays open while a case is', d.trees === 0);
    grid.compartment[kids[1]] = Compartment.R; grid.compartment[kids[2]] = Compartment.D;
    d.settle(grid, 4, false, false);
    check('the tree closes with its last case, with its size', d.trees === 1 && d.treeSize[0] === 4, [d.trees, d.treeSize[0]]);
    grid.compartment[kids[1]] = Compartment.R;
    check('a carrier stays open only while carriers transmit', openState(Compartment.R, Flag.CARRIER, true, false) && !openState(Compartment.R, Flag.CARRIER, false, false));
    check('Re by counting forgets closures older than its window', Number.isNaN((() => { d.now = 100; return d.reCounted(); })()));
}

// The ring: it grows past its capacity, drops events older than the window
// (counted from the newest event, so a finished outbreak keeps its tree).
{
    const grid = new Grid(40, 40), d = new Descent(1600);
    grid.descent = d;
    const cap0 = d.cap;
    for (let t = 0; t < 3; t++) for (let i = 0; i < 2000; i++) d.infect(i % 1600, -1, NO_DIR, t);
    d.settle(grid, 2, false, false);
    check('the ring grows', d.cap > cap0 && d.head - d.base === 6000, [d.cap, d.head - d.base]);
    for (let i = 0; i < 10; i++) d.infect(i, -1, NO_DIR, WINDOW + 2);
    d.settle(grid, WINDOW + 2, false, false);
    check('events older than the window are dropped', d.head - d.base === 2010, d.head - d.base);
    d.settle(grid, WINDOW + 500, false, false);
    check('with no new events nothing more is dropped', d.head - d.base === 2010);
}

// A tree outlives its oldest events: a chain that runs past the window stays
// one tree, keeps its size and its generation, and closes with all of it.
{
    const grid = new Grid(40, 40), d = grid.descent;
    grid.compartment[0] = Compartment.I;
    d.introduce(0);
    d.settle(grid, 0, false, false);
    const T = WINDOW + 200;
    for (let t = 1; t <= T; t++) {
        const prev = (t - 1) % 1600, c = t % 1600;
        d.infect(c, prev, NO_DIR, t);
        grid.compartment[c] = Compartment.I; grid.compartment[prev] = Compartment.R;
        d.settle(grid, t, false, false);
    }
    check('a chain past the window stays one tree', d.summary().trees === 1 && d.growing() === T + 1, [d.summary(), d.growing()]);
    check('and keeps its generation', d.summary().generation === T);
    grid.compartment[T % 1600] = Compartment.R;
    d.settle(grid, T + 1, false, false);
    check('and closes with all of it', d.trees === 1 && d.treeSize[0] === T + 1, [d.trees, d.treeSize[0]]);
}

// Undo and redo of a stroke that placed cases.
{
    const grid = new Grid(8, 8), d = grid.descent;
    grid.compartment[20] = Compartment.I;
    d.introduce(20);
    d.settle(grid, 1, false, false);
    const h0 = d.head, before = d.evt[21];
    d.introduce(21);
    const again = d.introduce(21);
    check('a stroke crossing a cell twice places it once', d.head === h0 + 1 && again === h0);
    const h1 = d.head;
    d.evt[21] = before; d.truncate(h0);
    check('undo drops the stroke\'s cases', d.head === h0 && d.nOpen === 1);
    d.evt[21] = h0; d.extend(h1);
    check('redo brings them back, open', d.head === h1 && d.nOpen === 2 && d.eventAt(21) === h0);
}

// The view's texel: a stroke is drawn in both cells it joins, through the
// gluing; a case placed by hand is a root mark.
{
    const W = 12, grid = new Grid(W, W);
    initializeGrid(grid);
    const d = grid.descent, { idx: nbr, back } = getNeighborTable(W, W, Topology.KLEIN);
    // a cell on the rim and its neighbour across a twisted edge
    let a = -1, dir = -1;
    for (const i of grid.activeIndices) {
        for (let k = 0; k < 6 && a < 0; k++) {
            const j = nbr[i * 6 + k];
            if (j >= 0 && back[i * 6 + k] !== (k + 3) % 6) { a = i; dir = k; }
        }
        if (a >= 0) break;
    }
    const b = nbr[a * 6 + dir];
    grid.compartment[a] = Compartment.R; grid.compartment[b] = Compartment.I;
    d.introduce(a);
    d.infect(b, a, back[a * 6 + dir], 1);
    d.settle(grid, 1, false, false);
    const out = packDescent(d, grid, back, new Uint32Array(W * W * 4));
    const slot = (cell, k) => (out[cell * 4 + (k >> 1)] >>> ((k & 1) << 4)) & 0xFFFF;
    const hb = slot(b, back[a * 6 + dir]), ha = slot(a, dir);
    check('a stroke across a twist is drawn in both cells', hb !== 0 && hb === ha, [hb, ha]);
    check('a live tip is the disease\'s ink', (hb >> 14) === 1);
    check('a case placed by hand is a root mark', (out[a * 4 + 3] >>> 16) === ROOT_INTRO);
    check('a root weighs its descendants', (out[a * 4 + 3] & 255) > (hb & 255));
}

// The space–time figure (spacetime.js) reads the log's events along the centre row.
{
    const { createSpacetime, columnOf, bandOf, SPAN_DAYS } = await import('./spacetime.js');
    const R = 24, W = 2 * R + 2, { cq, cr } = hexBounds(W, W), band = bandOf(R);
    const at = (q, r) => r * W + q;
    check('the centre is the middle column, the corners A and A′ the ends',
        columnOf(at(cq, cr), W, cq, cr, R, band) === R && columnOf(at(cq - R, cr), W, cq, cr, R, band) === 0 && columnOf(at(cq + R, cr), W, cq, cr, R, band) === 2 * R);
    check('a cell up the band sits over its column', columnOf(at(cq - 1, cr + 2), W, cq, cr, R, band) === R);
    check('outside the band, no column', columnOf(at(cq, cr + band + 1), W, cq, cr, R, band) === -1 && columnOf(at(cq + 1, cr - 2), W, cq, cr, R, band) === R);
    const w = world('threshold', R, Topology.TORUS, 5), fig = createSpacetime({}, { getContext: () => ({}) });
    const T = SPAN_DAYS + 120;
    for (let k = 1; k <= T; k++) {
        tick(w.grid, w.params, w.toggles, w.topology, w.rng, w.reg, k);
        fig.record(w.grid, w.reg, k);
    }
    const d = w.grid.descent, want = new Map();
    for (let s = d.base; s < d.head; s++) {
        const k = s & d.mask, col = columnOf(d.cell[k], W, cq, cr, R, band);
        if (col < 0 || d.tick[k] <= T - SPAN_DAYS) continue;
        want.set(d.tick[k], (want.get(d.tick[k]) || 0) + 1);
    }
    let ok = want.size > 0;
    for (let t = T - SPAN_DAYS + 1; t <= T; t++) {
        const row = fig.day(t), got = row ? row.reduce((a, b) => a + b, 0) : 0;
        if (got !== (want.get(t) || 0)) ok = false;
    }
    check('each day holds the band\'s infections that day', ok);
    check('days older than the span are gone', fig.day(T - SPAN_DAYS) === null);
}

// Fig. 4 (chains.js) reads the chains closed over its span from the log.
{
    const { chainStats, SPAN_DAYS } = await import('./chains.js');
    const grid = new Grid(16, 16), d = grid.descent;
    // three chains closing: sizes 1, 3 and 6, the first long ago
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
    check('chains closed within the span, by size', c.n === 2 && c.mean === 4.5 && c.max === 6 && c.bins[1] === 1 && c.bins[2] === 1, c);
}

console.log(`descent.test: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
