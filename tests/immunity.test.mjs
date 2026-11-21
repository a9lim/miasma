// Immunity by antigenic distance, the strain registry and its sweep, and a
// coinfected host read as a mixture of its strains.

import './env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ANTIGENIC_SIZE as S, MEMORY_SLOTS, MemoryKind, Compartment, Topology, Animal, Flag } from '../src/config.js';
import { agDist, agMid, susceptibility, remember, memoryOf } from '../src/immunity.js';
import { Grid } from '../src/grid.js';
import { initializeGrid } from '../src/initialization.js';
import { createRegistry, registerStrain, mutateStrain, recombineStrains, getStrain, strainCount, hostMean, hostPick, EMPTY_STRAIN } from '../src/strains.js';
import { runExtinctionSweep, EXTINCTION_SWEEP_INTERVAL } from '../src/strain-extinction.js';
import { tick } from '../src/dynamics.js';
import { PRESETS, applyPreset } from '../src/presets.js';
import { DEFAULT_PARAMS } from '../src/default-params.js';
import { DEFAULT_TOGGLES } from '../src/default-toggles.js';

const near = (a, b, e) => Math.abs(a - b) <= e;

test('antigenic distance and midpoint take the short way round the torus', () => {
    assert.ok(near(agDist(0.2, 0.2, S - 0.2, S - 0.2), Math.hypot(0.4, 0.4), 1e-9));
    assert.ok(near(agDist(0, 0, S / 2, S / 2), Math.hypot(S / 2, S / 2), 1e-9));
    assert.ok(near(agMid(0.5, S - 0.5) % S, 0, 1e-9));
});

function memory(n) {
    return { x: new Float32Array(n * MEMORY_SLOTS), y: new Float32Array(n * MEMORY_SLOTS), kind: new Uint8Array(n * MEMORY_SLOTS), n: new Uint8Array(n) };
}

test('σ = 1 − max c·e^(−d) over what a cell remembers', () => {
    const mem = memory(2), c = 0.9, v = 0.8;
    assert.equal(susceptibility(mem, 0, 3, 3, c, v), 1, 'an empty memory');
    remember(mem, 0, 1, 1, MemoryKind.INFECTION);
    assert.ok(near(susceptibility(mem, 0, 1, 1, c, v), 1 - c, 1e-6));
    assert.ok(near(susceptibility(mem, 0, 2, 1, c, v), 1 - c * Math.exp(-1), 1e-6));
    remember(mem, 1, 4, 4, MemoryKind.VACCINE);
    assert.ok(near(susceptibility(mem, 1, 4, 4, c, v), 1 - v, 1e-6), 'a vaccine memory uses vax_efficacy');
    remember(mem, 1, 4.5, 4, MemoryKind.INFECTION);
    assert.ok(near(susceptibility(mem, 1, 4.5, 4, 0.5, v), 1 - 0.5, 1e-6), 'the best memory wins');
});

test('memory merges a near antigen of the same kind and drops the oldest when full', () => {
    const mem = memory(1);
    remember(mem, 0, 1, 1, MemoryKind.INFECTION);
    remember(mem, 0, 1.05, 1, MemoryKind.INFECTION);
    assert.equal(mem.n[0], 1);
    remember(mem, 0, 1.05, 1, MemoryKind.VACCINE);
    assert.equal(mem.n[0], 2, 'the other kind takes a slot');
    for (let k = 0; k < MEMORY_SLOTS; k++) remember(mem, 0, 3 + k, 0, MemoryKind.INFECTION);
    assert.equal(mem.n[0], MEMORY_SLOTS);
    assert.ok(near(mem.x[0], 3, 1e-6) && near(mem.x[MEMORY_SLOTS - 1], 2 + MEMORY_SLOTS, 1e-6), 'oldest first, newest last');
});

test('mutation steps ag_step on average, jumps 2 AU; a recombinant sits at the short-way midpoint', () => {
    const reg = createRegistry(DEFAULT_PARAMS), rng = mulberry32(7);
    let sum = 0;
    const M = 2000;
    for (let k = 0; k < M; k++) {
        const id = mutateStrain(reg, 0, 0.05, rng, 1, 0.3, 0);
        sum += agDist(0, 0, reg.ag_x[id], reg.ag_y[id]);
    }
    assert.ok(near(sum / M, 0.3, 0.02), `mean step ${sum / M}`);
    const jump = mutateStrain(reg, 0, 0.05, rng, 1, 0, 1);
    assert.ok(near(agDist(0, 0, reg.ag_x[jump], reg.ag_y[jump]), 2, 1e-5));
    const a = registerStrain(reg, DEFAULT_PARAMS, 0, 1, null, 0.5, 1);
    const b = registerStrain(reg, DEFAULT_PARAMS, 0, 1, null, S - 0.5, 1);
    const h = recombineStrains(reg, a, b, mulberry32(3), 2);
    assert.ok(agDist(reg.ag_x[h], reg.ag_y[h], 0, 1) < 0.3);
});

test('a strain is born in the host it first infects', () => {
    const params = { ...DEFAULT_PARAMS }, toggles = { ...DEFAULT_TOGGLES }, sim = { topology: Topology.TORUS };
    applyPreset(PRESETS.find((p) => p.key === 'antigenic-drift'), params, toggles, sim);
    const grid = new Grid(50, 50);
    initializeGrid(grid);
    const reg = createRegistry(params), rng = mulberry32(11);
    for (const i of grid.activeIndices.slice(1000, 1040)) { grid.compartment[i] = Compartment.I; grid.strain_ids[i * 4] = 0; grid.strain_loads[i * 4] = 1; }
    let born = 0;
    for (let t = 1; t <= 400; t++) {
        tick(grid, params, toggles, sim.topology, rng, reg, t);
        for (let id = 0; id < reg.ids.length; id++) {
            if (reg.birthTick[id] !== t || reg.parent[id] === null) continue;
            born++;
            const c = reg.bornAt[id];
            assert.ok(c >= 0 && [0, 1, 2, 3].some((k) => grid.strain_ids[c * 4 + k] === id), `strain ${id} at ${c}`);
        }
    }
    assert.ok(born >= 3, `${born} mutants`);
});

test('the sweep keeps every referenced strain and branch point, reclaims dead branches, splices single lines', () => {
    const grid = new Grid(24, 24);
    initializeGrid(grid);
    const reg = createRegistry(DEFAULT_PARAMS), P = DEFAULT_PARAMS, cells = grid.activeIndices;
    const p1 = registerStrain(reg, P, 0, 1);          // dead, with living lines below
    const live = registerStrain(reg, P, p1, 2);       // carried by an I cell
    const dead = registerStrain(reg, P, 0, 3);        // dead leaf
    const deadKid = registerStrain(reg, P, dead, 4);  // its dead child
    const inAnimal = registerStrain(reg, P, p1, 5);   // carried only by an animal
    const remembered = registerStrain(reg, P, 0, 6);  // only a carrier's slot-0 memory, at load 0
    grid.compartment[cells[0]] = Compartment.I;
    grid.strain_ids[cells[0] * 4] = live; grid.strain_loads[cells[0] * 4] = 1;
    grid.animal_strain[cells[1]] = inAnimal;
    grid.compartment[cells[2]] = Compartment.R; grid.flags[cells[2]] = Flag.CARRIER;
    grid.strain_ids[cells[2] * 4] = remembered; grid.strain_loads[cells[2] * 4] = 0;
    runExtinctionSweep(grid, reg, EXTINCTION_SWEEP_INTERVAL);
    for (const id of [live, inAnimal, remembered]) assert.ok(!reg.extinct[id] && !reg.freed[id], `strain ${id} alive`);
    assert.ok(reg.extinct[p1] && !reg.freed[p1], 'a dead branch point is kept');
    assert.ok(reg.freed[dead] && reg.freed[deadKid] && getStrain(reg, dead) === null, 'a dead branch is reclaimed');
    assert.ok(!reg.extinct[0], 'α is never tombstoned');
    const before = strainCount(reg), reused = registerStrain(reg, P, live, 9);
    assert.ok((reused === dead || reused === deadKid) && strainCount(reg) === before, 'a freed id is reused');

    // Once the animal's strain dies, p1 has one living line left.
    grid.animal_strain[cells[1]] = EMPTY_STRAIN;
    runExtinctionSweep(grid, reg, 2 * EXTINCTION_SWEEP_INTERVAL);
    assert.ok(!reg.freed[p1] && reg.parent[live] === p1, 'below the splice threshold the descent is kept');
    runExtinctionSweep(grid, reg, 3 * EXTINCTION_SWEEP_INTERVAL, 0);
    assert.ok(reg.freed[p1] && reg.parent[live] === 0 && reg.gen[live] === 2, 'spliced, keeping the generation');
});

// A world with nothing but the mechanism under test.
function world() {
    const grid = new Grid(40, 40);
    initializeGrid(grid);
    const params = { ...DEFAULT_PARAMS, mutation_rate: 0, recombination_rate: 0, birth_rate: 0, mortality_baseline: 0, mortality_age_max: 0, animal_density: 0, spillover_rate: 0, reverse_spillover_rate: 0, mu: 0 };
    const toggles = { ...DEFAULT_TOGGLES, V: false, M: false, L: false, C: false, F: false, auto_hospital: false, auto_quarantine: false, vax_rollout: false };
    return { grid, params, toggles, mid: grid.activeIndices[Math.floor(grid.activeIndices.length / 2)] };
}

test('recovery remembers every carried antigen; reinfection depends on distance from it', () => {
    {
        const { grid, params, toggles, mid: i } = world();
        params.gamma = 1;
        const reg = createRegistry(params), far = registerStrain(reg, params, 0, 0, null, 3, 3);
        grid.compartment[i] = Compartment.I;
        grid.strain_ids[i * 4] = 0; grid.strain_loads[i * 4] = 0.6;
        grid.strain_ids[i * 4 + 1] = far; grid.strain_loads[i * 4 + 1] = 0.4;
        tick(grid, params, toggles, Topology.TORUS, mulberry32(1), reg, 1);
        assert.equal(grid.compartment[i], Compartment.R);
        assert.equal(grid.mem_n[i], 2);
    }
    // Everyone remembers α with c = 1, around one infectious source.
    const attack = (agx) => {
        const { grid, params, toggles, mid: src } = world();
        Object.assign(params, { immunity_strength: 1, beta: 0.9, gamma: 0.01, sigma: 0.01 });
        const reg = createRegistry(params), sid = agx === 0 ? 0 : registerStrain(reg, params, 0, 0, null, agx, 0);
        const mem = memoryOf(grid);
        for (const k of grid.activeIndices) { grid.compartment[k] = Compartment.R; remember(mem, k, 0, 0, MemoryKind.INFECTION); }
        grid.compartment[src] = Compartment.I; grid.strain_ids[src * 4] = sid; grid.strain_loads[src * 4] = 1;
        const rng = mulberry32(11);
        let exposed = 0;
        for (let t = 1; t <= 20; t++) exposed += tick(grid, params, toggles, Topology.TORUS, rng, reg, t).sToE;
        return exposed;
    };
    assert.equal(attack(0), 0, 'the remembered antigen is blocked');
    assert.ok(attack(3) > 3, 'a strain 3 AU away reinfects');
});

test('within a host, load follows fitness β·σ: the escaping strain gains, equal fitness holds still', () => {
    const run = (primed) => {
        const { grid, params, toggles, mid: i } = world();
        Object.assign(params, { gamma: 0, competition_strength: 0.2, min_strain_load: 0 });
        const reg = createRegistry(params), esc = registerStrain(reg, params, 0, 0, null, 3, 0);
        if (primed) remember(memoryOf(grid), i, 0, 0, MemoryKind.INFECTION);
        grid.compartment[i] = Compartment.I;
        grid.strain_ids[i * 4] = 0; grid.strain_loads[i * 4] = 0.65;
        grid.strain_ids[i * 4 + 1] = esc; grid.strain_loads[i * 4 + 1] = 0.35;
        const rng = mulberry32(5);
        for (let t = 1; t <= 10; t++) tick(grid, params, toggles, Topology.TORUS, rng, reg, t);
        return grid.strain_loads[i * 4 + (grid.strain_ids[i * 4] === esc ? 0 : 1)];
    };
    assert.ok(run(true) > 0.5, 'a host primed against α favours the escaping strain');
    assert.ok(near(run(false), 0.35, 1e-5), 'no incumbent advantage in a naive host');
});

test('a coinfected host\'s rates and picks are its strains\' load-weighted mixture, whatever the slots', () => {
    const E = EMPTY_STRAIN, v = (s) => [0.2, 0.6][s], w = (s) => [1, 3][s];
    const ids = Uint16Array.from([0, E, 1, E]), loads = Float32Array.from([0.75, 0, 0.25, 0]);
    const swapped = Uint16Array.from([1, E, E, 0]), swappedLoads = Float32Array.from([0.25, 0, 0, 0.75]);
    const want = (0.75 * 0.2 + 0.25 * 3 * 0.6) / (0.75 + 0.25 * 3);
    assert.ok(near(hostMean(ids, loads, 0, 4, v, w), want, 1e-7));
    assert.ok(near(hostMean(swapped, swappedLoads, 0, 4, v, w), want, 1e-7));
    const share = (I, L) => { let n0 = 0; const N = 10000; for (let k = 0; k < N; k++) if (hostPick(I, L, 0, 4, w, (k + 0.5) / N) === 0) n0++; return n0 / N; };
    assert.ok(near(share(ids, loads), 0.5, 1e-3) && near(share(swapped, swappedLoads), 0.5, 1e-3), 'picked by load × weight');
});

test('in the tick, a mixed host dies at the load-weighted μ and its corpse keeps the strain that killed it', () => {
    const { grid, params, toggles } = world();
    toggles.F = true;
    const reg = createRegistry(params), b = registerStrain(reg, params, 0, 0, null, 3, 0);
    for (const s of [0, b]) { reg.gamma[s] = 0; reg.mu[s] = 0; }
    reg.mu[b] = 1;
    let k = 0;
    for (const i of grid.activeIndices) {
        grid.compartment[i] = Compartment.I;
        for (let s = 0; s < 4; s++) { grid.strain_ids[i * 4 + s] = EMPTY_STRAIN; grid.strain_loads[i * 4 + s] = 0; }
        const [sa, sb] = k++ % 2 ? [0, 1] : [3, 2];   // half the hosts in slots 0/1, half in 3/2
        grid.strain_ids[i * 4 + sa] = 0; grid.strain_loads[i * 4 + sa] = 0.5;
        grid.strain_ids[i * 4 + sb] = b; grid.strain_loads[i * 4 + sb] = 0.5;
    }
    tick(grid, params, toggles, Topology.TORUS, mulberry32(5), reg, 1);
    const dead = grid.activeIndices.filter((i) => grid.compartment[i] === Compartment.D);
    assert.ok(near(dead.length / grid.activeIndices.length, 0.5, 0.06), `${dead.length} deaths`);
    assert.ok(dead.every((i) => grid.strain_ids[i * 4] === b && (grid.flags[i] & Flag.F_CORPSE)));
});

test('a host whose one strain sits past slot 0 takes that strain\'s rates, and passes it to an animal', () => {
    const { grid, params, toggles } = world();
    Object.assign(params, { gamma: 0, reverse_spillover_rate: 1 });
    const reg = createRegistry(params), b = registerStrain(reg, params, 0, 0, null, 3, 0);
    reg.gamma[b] = 1;
    const i = grid.activeIndices[Math.floor(grid.activeIndices.length / 2)];
    const j = grid.activeIndices[Math.floor(grid.activeIndices.length / 3)];
    for (const c of [i, j]) {
        grid.compartment[c] = Compartment.I;
        for (let s = 0; s < 4; s++) { grid.strain_ids[c * 4 + s] = EMPTY_STRAIN; grid.strain_loads[c * 4 + s] = 0; }
        grid.strain_ids[c * 4 + 2] = b; grid.strain_loads[c * 4 + 2] = 1;
    }
    grid.animal[j] = Animal.S;
    tick(grid, params, toggles, Topology.TORUS, mulberry32(7), reg, 1);
    assert.equal(grid.compartment[i], Compartment.R);
    assert.ok(grid.animal[j] === Animal.I && grid.animal_strain[j] === b);
});
