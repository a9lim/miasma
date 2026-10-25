// immunity.test.mjs — antigenic distance, memory, within-host selection, reclamation.
// node src/immunity.test.mjs

globalThis.mulberry32 = function (seed) { let a = seed | 0; return function () { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
globalThis.gaussian = function (rng) { rng = rng || Math.random; let u1 = rng(); if (u1 < 1e-12) u1 = 1e-12; return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rng()); };

const { ANTIGENIC_SIZE, MEMORY_SLOTS, MemoryKind, Compartment, Topology } = await import('./config.js');
const { agDelta, agDist, agMid, agWrap, susceptibility, remember, forget, memoryOf } = await import('./immunity.js');
const { Grid } = await import('./grid.js');
const { initializeGrid } = await import('./initialization.js');
const { createRegistry, registerStrain, mutateStrain, recombineStrains, getStrain, strainCount, bornCount, countLiving } = await import('./strains.js');
const { runExtinctionSweep, EXTINCTION_SWEEP_INTERVAL } = await import('./strain-extinction.js');
const { tick } = await import('./dynamics.js');
const { DEFAULT_PARAMS } = await import('./default-params.js');
const { DEFAULT_TOGGLES } = await import('./default-toggles.js');

let pass = 0, fail = 0;
function check(name, ok, detail) {
    if (ok) pass++;
    else { fail++; console.log('FAIL', name, detail === undefined ? '' : detail); }
}
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const S = ANTIGENIC_SIZE;

// ─── Torus geometry ───
check('wrap into [0,S)', near(agWrap(-0.5), S - 0.5) && near(agWrap(S + 1), 1) && agWrap(S) === 0);
check('delta is shortest', near(agDelta(0.5, S - 0.5), -1) && near(agDelta(S - 0.5, 0.5), 1));
check('distance across the seam', near(agDist(0.2, 0.2, S - 0.2, S - 0.2), Math.hypot(0.4, 0.4)));
check('distance symmetric', near(agDist(1, 2, 5, 7), agDist(5, 7, 1, 2)));
check('max distance is half the diagonal', near(agDist(0, 0, S / 2, S / 2), Math.hypot(S / 2, S / 2)));
check('midpoint the short way', near(agMid(0.5, S - 0.5), 0) || near(agMid(0.5, S - 0.5), S));

// ─── Memory and susceptibility ───
{
    const N = 4;
    const mem = { x: new Float32Array(N * MEMORY_SLOTS), y: new Float32Array(N * MEMORY_SLOTS), kind: new Uint8Array(N * MEMORY_SLOTS), n: new Uint8Array(N) };
    check('empty memory → σ = 1', susceptibility(mem, 0, 3, 3, 0.9, 0.8) === 1);
    remember(mem, 0, 1, 1, MemoryKind.INFECTION);
    check('identical antigen → σ = 1 − c', near(susceptibility(mem, 0, 1, 1, 0.9, 0.8), 0.1, 1e-6));
    let prev = -1, mono = true;
    for (let d = 0; d <= 4; d += 0.25) {
        const v = susceptibility(mem, 0, 1 + d, 1, 0.9, 0.8);
        if (v < prev - 1e-12) mono = false;
        prev = v;
    }
    check('σ rises monotonically with distance', mono);
    check('σ → 1 far away', susceptibility(mem, 0, 1 + S / 2, 1 + S / 2, 0.9, 0.8) > 0.995);
    check('σ = 1 − c·e^(−d)', near(susceptibility(mem, 0, 2, 1, 0.9, 0.8), 1 - 0.9 * Math.exp(-1), 1e-6));
    remember(mem, 1, 4, 4, MemoryKind.VACCINE);
    check('vaccine memory uses vax_efficacy', near(susceptibility(mem, 1, 4, 4, 0.9, 0.8), 0.2, 1e-6));
    check('best memory wins', near(susceptibility(mem, 0, 1, 1, 0.5, 0.8), 0.5, 1e-6));
    remember(mem, 0, 1.05, 1, MemoryKind.INFECTION);
    check('near antigen of the same kind merges', mem.n[0] === 1);
    remember(mem, 0, 1.05, 1, MemoryKind.VACCINE);
    check('same place, other kind takes a slot', mem.n[0] === 2);
    for (let k = 0; k < MEMORY_SLOTS + 2; k++) remember(mem, 2, k, 0, MemoryKind.INFECTION);
    check('memory caps at MEMORY_SLOTS', mem.n[2] === MEMORY_SLOTS);
    const base = 2 * MEMORY_SLOTS;
    check('oldest dropped, newest last', near(mem.x[base], 2) && near(mem.x[base + MEMORY_SLOTS - 1], MEMORY_SLOTS + 1));
    forget(mem, 2);
    check('forget empties', mem.n[2] === 0 && susceptibility(mem, 2, 0, 0, 0.9, 0.8) === 1);
}

// ─── Registry: positions, steps, recombination ───
{
    const reg = createRegistry(DEFAULT_PARAMS);
    check('α at the origin', reg.ag_x[0] === 0 && reg.ag_y[0] === 0);
    const rng = mulberry32(7);
    const still = mutateStrain(reg, 0, 0.05, rng, 1, 0, 0);
    check('zero step keeps the antigen', reg.ag_x[still] === 0 && reg.ag_y[still] === 0);
    let sum = 0;
    const M = 4000;
    for (let k = 0; k < M; k++) {
        const id = mutateStrain(reg, 0, 0.05, rng, 1, 0.3, 0);
        sum += agDist(0, 0, reg.ag_x[id], reg.ag_y[id]);
    }
    check('mean step ≈ ag_step', Math.abs(sum / M - 0.3) < 0.02, sum / M);
    const jump = mutateStrain(reg, 0, 0.05, rng, 1, 0, 1);
    check('a jump moves 2 AU', near(agDist(0, 0, reg.ag_x[jump], reg.ag_y[jump]), 2, 1e-5));
    const a = registerStrain(reg, DEFAULT_PARAMS, 0, 1, null, 0.5, 1);
    const b = registerStrain(reg, DEFAULT_PARAMS, 0, 1, null, S - 0.5, 1);
    const h = recombineStrains(reg, a, b, mulberry32(3), 2);
    check('recombinant near the short-way midpoint', agDist(reg.ag_x[h], reg.ag_y[h], 0, 1) < 0.3, [reg.ag_x[h], reg.ag_y[h]]);
    check('names follow the birth serial', reg.names[0] === 'α' && reg.names[1] === 'β');
}

// ─── Reclamation ───
{
    const grid = new Grid(24, 24);
    initializeGrid(grid);
    const reg = createRegistry(DEFAULT_PARAMS);
    const p1 = registerStrain(reg, DEFAULT_PARAMS, 0, 1);        // dead, one living line below
    const live = registerStrain(reg, DEFAULT_PARAMS, p1, 2);     // carried by a cell
    const dead = registerStrain(reg, DEFAULT_PARAMS, 0, 3);      // dead leaf
    const deadKid = registerStrain(reg, DEFAULT_PARAMS, dead, 4); // dead leaf's dead child
    const inAnimal = registerStrain(reg, DEFAULT_PARAMS, p1, 5);  // carried only by an animal
    const cell = grid.activeIndices[0];
    grid.compartment[cell] = Compartment.I;
    grid.strain_ids[cell * 4] = live; grid.strain_loads[cell * 4] = 1;
    grid.animal_strain[grid.activeIndices[1]] = inAnimal;
    runExtinctionSweep(grid, reg, EXTINCTION_SWEEP_INTERVAL);
    check('carried strain alive', !reg.extinct[live] && !reg.freed[live]);
    check('animal-only strain alive', !reg.extinct[inAnimal] && !reg.freed[inAnimal]);
    check('a dead branch point is kept', reg.extinct[p1] && !reg.freed[p1]);
    check('generations survive', reg.gen[live] === 2 && reg.gen[p1] === 1);
    check('dead branch reclaimed', reg.freed[dead] && reg.freed[deadKid]);
    check('α never tombstoned', !reg.extinct[0]);
    check('freed strain unreadable', getStrain(reg, dead) === null);
    const before = strainCount(reg);
    const reused = registerStrain(reg, DEFAULT_PARAMS, live, 9);
    check('a freed id is reused', (reused === dead || reused === deadKid) && strainCount(reg) === before);
    check('reused id gets a fresh name', reg.names[reused] === 'η', reg.names[reused]);
    check('born counts every strain', bornCount(reg) === 7);
    check('living count', countLiving(reg) === 4, countLiving(reg));

    // Once the animal strain dies, p1 has one living line left: spliced.
    grid.animal_strain[grid.activeIndices[1]] = 0xFFFF;
    grid.compartment[grid.activeIndices[2]] = Compartment.I;
    grid.strain_ids[grid.activeIndices[2] * 4] = reused; grid.strain_loads[grid.activeIndices[2] * 4] = 1;
    runExtinctionSweep(grid, reg, 2 * EXTINCTION_SWEEP_INTERVAL);
    check('a single-line dead ancestor is spliced out', reg.freed[p1] && reg.parent[live] === 0, [reg.freed[p1], reg.parent[live]]);
    check('splicing keeps the generation count', reg.gen[live] === 2);
}

// ─── The tick: memory written, reinfection by distance, within-host selection ───
function world() {
    const grid = new Grid(40, 40);
    initializeGrid(grid);
    const params = { ...DEFAULT_PARAMS, mutation_rate: 0, recombination_rate: 0, birth_rate: 0, mortality_baseline: 0, mortality_age_max: 0, animal_density: 0, spillover_rate: 0, reverse_spillover_rate: 0, mu: 0 };
    const toggles = { ...DEFAULT_TOGGLES, V: false, M: false, L: false, C: false, F: false, auto_hospital: false, auto_quarantine: false, vax_rollout: false };
    return { grid, params, toggles };
}
{
    const { grid, params, toggles } = world();
    params.gamma = 1;   // recover in one tick
    const reg = createRegistry(params);
    const far = registerStrain(reg, params, 0, 0, null, 3, 3);
    const i = grid.activeIndices[Math.floor(grid.activeIndices.length / 2)];
    grid.compartment[i] = Compartment.I;
    grid.strain_ids[i * 4] = 0; grid.strain_loads[i * 4] = 0.6;
    grid.strain_ids[i * 4 + 1] = far; grid.strain_loads[i * 4 + 1] = 0.4;
    tick(grid, params, toggles, Topology.TORUS, mulberry32(1), reg, 1);
    check('recovered', grid.compartment[i] === Compartment.R);
    check('recovery remembers every carried antigen', grid.mem_n[i] === 2, grid.mem_n[i]);
    const mem = memoryOf(grid);
    check('remembered α', near(susceptibility(mem, i, 0, 0, params.immunity_strength, params.vax_efficacy), 1 - params.immunity_strength, 1e-6));
}
{
    // A ring of R cells primed against α around an infectious α source: with
    // c = 1 nothing gets through; a strain 3 AU away infects them.
    function attack(agx, c) {
        const { grid, params, toggles } = world();
        params.immunity_strength = c; params.beta = 0.9; params.gamma = 0.01; params.sigma = 0.01;
        const reg = createRegistry(params);
        const sid = agx === 0 ? 0 : registerStrain(reg, params, 0, 0, null, agx, 0);
        const mem = memoryOf(grid);
        for (const k of grid.activeIndices) { grid.compartment[k] = Compartment.R; remember(mem, k, 0, 0, MemoryKind.INFECTION); }
        const src = grid.activeIndices[Math.floor(grid.activeIndices.length / 2)];
        grid.compartment[src] = Compartment.I; grid.strain_ids[src * 4] = sid; grid.strain_loads[src * 4] = 1;
        const rng = mulberry32(11);
        let exposed = 0;
        for (let t = 1; t <= 20; t++) exposed += tick(grid, params, toggles, Topology.TORUS, rng, reg, t).sToE;
        return exposed;
    }
    check('c = 1 blocks the remembered antigen', attack(0, 1) === 0, attack(0, 1));
    check('a distant strain reinfects', attack(3, 1) > 3, attack(3, 1));
}
{
    // Within-host: a host primed against α carries α and a strain 3 AU away
    // at equal β; the escaping strain gains load.
    const { grid, params, toggles } = world();
    params.gamma = 0; params.competition_strength = 0.2; params.min_strain_load = 0;
    const reg = createRegistry(params);
    const esc = registerStrain(reg, params, 0, 0, null, 3, 0);
    const i = grid.activeIndices[Math.floor(grid.activeIndices.length / 2)];
    remember(memoryOf(grid), i, 0, 0, MemoryKind.INFECTION);
    grid.compartment[i] = Compartment.I;
    grid.strain_ids[i * 4] = 0; grid.strain_loads[i * 4] = 0.65;
    grid.strain_ids[i * 4 + 1] = esc; grid.strain_loads[i * 4 + 1] = 0.35;
    const rng = mulberry32(5);
    for (let t = 1; t <= 10; t++) tick(grid, params, toggles, Topology.TORUS, rng, reg, t);
    const slot = grid.strain_ids[i * 4] === esc ? 0 : 1;
    check('the escaping strain gains load', grid.strain_loads[i * 4 + slot] > 0.5, grid.strain_loads[i * 4 + slot]);

    // A naive host with equal β: neither gains (no incumbent advantage).
    const { grid: g2, params: p2, toggles: t2 } = world();
    p2.gamma = 0; p2.competition_strength = 0.2; p2.min_strain_load = 0;
    const reg2 = createRegistry(p2);
    const other = registerStrain(reg2, p2, 0, 0, null, 3, 0);
    const j = g2.activeIndices[Math.floor(g2.activeIndices.length / 2)];
    g2.compartment[j] = Compartment.I;
    g2.strain_ids[j * 4] = 0; g2.strain_loads[j * 4] = 0.65;
    g2.strain_ids[j * 4 + 1] = other; g2.strain_loads[j * 4 + 1] = 0.35;
    const rng2 = mulberry32(5);
    for (let t = 1; t <= 10; t++) tick(g2, p2, t2, Topology.TORUS, rng2, reg2, t);
    check('no incumbent advantage at equal fitness', near(g2.strain_loads[j * 4], 0.65, 1e-5), g2.strain_loads[j * 4]);
}

console.log(`immunity.test: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
