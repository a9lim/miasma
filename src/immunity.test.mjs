// immunity.test.mjs — antigenic distance, memory, within-host selection, reclamation,
// and a coinfected host as a mixture (in the tick) and as drawn (the Strain view).
// node src/immunity.test.mjs

globalThis.mulberry32 = function (seed) { let a = seed | 0; return function () { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
globalThis.gaussian = function (rng) { rng = rng || Math.random; let u1 = rng(); if (u1 < 1e-12) u1 = 1e-12; return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rng()); };

const { ANTIGENIC_SIZE, MEMORY_SLOTS, MemoryKind, Compartment, Topology, Animal, Flag } = await import('./config.js');
const { agDelta, agDist, agMid, agWrap, susceptibility, remember, forget, memoryOf } = await import('./immunity.js');
const { Grid } = await import('./grid.js');
const { initializeGrid } = await import('./initialization.js');
const { createRegistry, registerStrain, mutateStrain, recombineStrains, getStrain, strainCount, bornCount, countLiving, hostMean, hostPick, isMixed, EMPTY_STRAIN } = await import('./strains.js');
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
    check('below the splice threshold the full descent is kept', !reg.freed[p1] && reg.parent[live] === p1);
    runExtinctionSweep(grid, reg, 3 * EXTINCTION_SWEEP_INTERVAL, 0);
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

// ─── A coinfected host as a mixture ───
{
    const E = EMPTY_STRAIN;
    const ids = Uint16Array.from([0, E, 1, E]), loads = Float32Array.from([0.75, 0, 0.25, 0]);
    const vals = [0.2, 0.6], ws = [1, 3];
    const v = (s) => vals[s], w = (s) => ws[s];
    check('slot 0 alone is not mixed', !isMixed(Uint16Array.from([0, E, E, E]), Float32Array.from([1, 0, 0, 0]), 0, 4));
    check('two strains are mixed', isMixed(ids, loads, 0, 4));
    check('one strain past slot 0 is mixed', isMixed(Uint16Array.from([E, E, 1, E]), Float32Array.from([0, 0, 1, 0]), 0, 4));
    check('an id without load does not count', !isMixed(Uint16Array.from([0, 1, E, E]), Float32Array.from([1, 0, 0, 0]), 0, 4));
    check('mean by load', near(hostMean(ids, loads, 0, 4, v, null), 0.75 * 0.2 + 0.25 * 0.6, 1e-7));
    check('mean by load × weight', near(hostMean(ids, loads, 0, 4, v, w), (0.75 * 0.2 + 0.25 * 3 * 0.6) / (0.75 + 0.25 * 3), 1e-7));
    check('one strain gives its value exactly', hostMean(Uint16Array.from([E, E, 1, E]), Float32Array.from([0, 0, 1, 0]), 0, 4, v, null) === 0.6);
    check('shared values come back exactly', hostMean(ids, loads, 0, 4, () => 0.1, w) === 0.1);
    check('zero weights fall back to the first strain', hostMean(ids, loads, 0, 4, v, () => 0) === 0.2);
    check('no strain → NaN', Number.isNaN(hostMean(Uint16Array.from([E, E, E, E]), new Float32Array(4), 0, 4, v, null)));
    const swapped = Uint16Array.from([1, E, E, 0]), swappedLoads = Float32Array.from([0.25, 0, 0, 0.75]);
    check('slot order does not matter', near(hostMean(swapped, swappedLoads, 0, 4, v, w), hostMean(ids, loads, 0, 4, v, w), 1e-12));
    // u sweeps [0, 1): each strain's share of it is its load × weight share.
    const share = (I, L, wf) => { let n0 = 0; const N = 10000; for (let k = 0; k < N; k++) if (hostPick(I, L, 0, 4, wf, (k + 0.5) / N) === 0) n0++; return n0 / N; };
    check('pick by load', near(share(ids, loads, null), 0.75, 1e-3));
    check('pick by load × weight', near(share(ids, loads, w), 0.75 / (0.75 + 0.75), 1e-3));
    check('pick ignores slot order', near(share(swapped, swappedLoads, w), share(ids, loads, w), 1e-3));
    check('a zero weight is never picked', share(ids, loads, (s) => (s === 0 ? 0 : 1)) === 0);
}
{
    // The tick reads every I cell's strains as a mixture. Each test fills the
    // world with I cells carrying two strains at equal β, so nothing new
    // enters a host and within-host loads stay put.
    function mixedWorld(setup) {
        const { grid, params, toggles } = world();
        const reg = createRegistry(params);
        const b = registerStrain(reg, params, 0, 0, null, 3, 0);
        // The registry clamps γ to its range; zero both strains' exits here.
        for (const s of [0, b]) { reg.gamma[s] = 0; reg.mu[s] = 0; }
        setup(params, toggles, reg, b);
        let k = 0;
        for (const i of grid.activeIndices) {
            grid.compartment[i] = Compartment.I;
            for (let s = 0; s < 4; s++) { grid.strain_ids[i * 4 + s] = EMPTY_STRAIN; grid.strain_loads[i * 4 + s] = 0; }
            // Half the cells hold the pair in slots 0 and 1, half in 3 and 2.
            const [sa, sb] = k++ % 2 ? [0, 1] : [3, 2];
            grid.strain_ids[i * 4 + sa] = 0; grid.strain_loads[i * 4 + sa] = 0.5;
            grid.strain_ids[i * 4 + sb] = b; grid.strain_loads[i * 4 + sb] = 0.5;
        }
        return { grid, params, toggles, reg, b };
    }
    const halves = (grid, test) => {
        let n = [0, 0], hit = [0, 0], k = 0;
        for (const i of grid.activeIndices) { const h = k++ % 2; n[h]++; if (test(i)) hit[h]++; }
        return [hit[0] / n[0], hit[1] / n[1]];
    };

    // Recovery at the load-weighted γ: α never recovers, b always would.
    {
        const { grid, params, toggles, reg } = mixedWorld((p, t, reg, b) => { reg.gamma[b] = 1; });
        tick(grid, params, toggles, Topology.TORUS, mulberry32(3), reg, 1);
        const [h0, h1] = halves(grid, (i) => grid.compartment[i] === Compartment.R);
        check('recovery at the load-weighted γ', near(h0, 0.5, 0.06) && near(h1, 0.5, 0.06), [h0, h1]);
    }
    // A carrier keeps the strain whose c_seed made it one.
    {
        const { grid, params, toggles, reg, b } = mixedWorld((p, t, reg, b) => {
            t.C = true; reg.gamma[0] = 1; reg.gamma[b] = 1; reg.c_seed[0] = 0; reg.c_seed[b] = 1;
        });
        tick(grid, params, toggles, Topology.TORUS, mulberry32(4), reg, 1);
        const carrier = (i) => (grid.flags[i] & Flag.CARRIER) !== 0;
        const [h0, h1] = halves(grid, carrier);
        check('carriers at the γ-weighted c_seed', near(h0, 0.5, 0.06) && near(h1, 0.5, 0.06), [h0, h1]);
        check('a carrier keeps the strain that made it one', grid.activeIndices.every((i) => !carrier(i) || grid.strain_ids[i * 4] === b));
    }
    // An F-corpse keeps the strain that killed it.
    {
        const { grid, params, toggles, reg, b } = mixedWorld((p, t, reg, b) => { t.F = true; reg.mu[b] = 1; });
        tick(grid, params, toggles, Topology.TORUS, mulberry32(5), reg, 1);
        const dead = grid.activeIndices.filter((i) => grid.compartment[i] === Compartment.D);
        check('deaths at the load-weighted μ', near(dead.length / grid.activeIndices.length, 0.5, 0.06), dead.length);
        check('an F-corpse keeps the strain that killed it', dead.every((i) => grid.strain_ids[i * 4] === b));
    }
    // A new Z carries the strain whose dz_alive made it.
    {
        const { grid, params, toggles, reg, b } = mixedWorld((p, t, reg, b) => { t.Z = true; reg.dz_alive[0] = 0; reg.dz_alive[b] = 1; });
        tick(grid, params, toggles, Topology.TORUS, mulberry32(6), reg, 1);
        const z = grid.activeIndices.filter((i) => grid.compartment[i] === Compartment.Z);
        check('I → Z at the load-weighted dz_alive', near(z.length / grid.activeIndices.length, 0.5, 0.06), z.length);
        check('a new Z carries the strain that made it', z.every((i) => grid.strain_ids[i * 4] === b));
    }
    // A host whose one strain sits past slot 0 is that strain's host, for
    // its rates and for a spillover into an animal.
    {
        const { grid, params, toggles } = world();
        params.gamma = 0; params.reverse_spillover_rate = 1;
        const reg = createRegistry(params);
        const b = registerStrain(reg, params, 0, 0, null, 3, 0);
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
        check('a strain past slot 0 sets the rates', grid.compartment[i] === Compartment.R);
        check('and spills over into an animal', grid.animal[j] === Animal.I && grid.animal_strain[j] === b, [grid.animal[j], grid.animal_strain[j]]);
    }
}
{
    // The Strain view draws every strain a carrier holds (strain-style.js strainMarks).
    const { strainMarks, loadLevel, LOAD_LEVELS } = await import('./strain-style.js');
    const grid = new Grid(8, 8);
    const reg = createRegistry(DEFAULT_PARAMS);
    const far = registerStrain(reg, DEFAULT_PARAMS, 0, 0, null, 4, 2);
    const twin = registerStrain(reg, DEFAULT_PARAMS, 0, 0, null, 0, 0);   // α's antigen, another id
    const set = (ids, loads) => { for (let s = 0; s < 4; s++) { grid.strain_ids[s] = ids[s]; grid.strain_loads[s] = loads[s]; } };
    const out = { a: new Uint8Array(4), h: new Uint8Array(4), l: new Float32Array(4) };
    set([0, far, EMPTY_STRAIN, EMPTY_STRAIN], [0.3, 0.7, 0, 0]);
    let n = strainMarks(grid, 0, reg, out);
    check('marks every strain, heaviest first', n === 2 && near(out.l[0], 0.7, 1e-6) && near(out.l[1], 0.3, 1e-6) && out.a[0] !== out.a[1], [n, ...out.l]);
    set([0, twin, far, 1], [0.25, 0.25, 0.5, 0]);
    n = strainMarks(grid, 0, reg, out);
    check('strains with one mark merge; a slot without load is skipped', n === 2 && near(out.l[0], 0.5, 1e-6) && near(out.l[1], 0.5, 1e-6), [n, ...out.l]);
    check('a whole load is the heaviest line, a trace the lightest', loadLevel(1) === LOAD_LEVELS && loadLevel(0.001) === 1);
}

console.log(`immunity.test: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
