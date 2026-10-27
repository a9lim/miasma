// Per-tick cost of the simulation, headless: the tick itself and the work
// main.js does after every tick (census, isochrone stamps, and the contour
// build every fourth tick), for each preset and the Sandbox, at one or more
// world radii (the build contours only the labeled levels, as under WebGPU;
// ALL=1 contours every level, as the Canvas fallback does). A fingerprint of the final state checks that a refactor meant
// to preserve behavior does (same seed, same state).
// usage: node tools/bench.mjs [presets=all] [radii=the default] [ticks=600] [seed=1]
// The dynamics call the /shared/utils.js globals; define them for Node.
globalThis.mulberry32 = function (seed) { let a = seed | 0; return function () { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
globalThis.gaussian = function (rng) { rng = rng || Math.random; let u1 = rng(); if (u1 < 1e-12) u1 = 1e-12; return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rng()); };
const M = new URL('../src/', import.meta.url).href;
const { Grid } = await import(M + 'grid.js');
const { initializeGrid, seedPopulation } = await import(M + 'initialization.js');
const { createRegistry, countLiving } = await import(M + 'strains.js');
const { tick } = await import(M + 'dynamics.js');
const { PRESETS, applyPreset } = await import(M + 'presets.js');
const { DEFAULT_PARAMS } = await import(M + 'default-params.js');
const { DEFAULT_TOGGLES } = await import(M + 'default-toggles.js');
const { Compartment, MemoryKind, DEFAULTS, OPENING_SEEDS } = await import(M + 'config.js');
const { hexBounds } = await import(M + 'topology.js');
const { memoryOf, remember } = await import(M + 'immunity.js');
const { computeStats } = await import(M + 'stats.js');
const { createIsochrones } = await import(M + 'isochrones.js');

const all = ['sandbox', ...PRESETS.map(p => p.key)];
const keys = (process.argv[2] && process.argv[2] !== 'all' ? process.argv[2] : all.join(',')).split(',');
const radii = (process.argv[3] || String(DEFAULTS.R)).split(',').map(Number);
const T = +(process.argv[4] || 600), SEED = +(process.argv[5] || 1);

function fnv(h, arr) {
    const b = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    for (let k = 0; k < b.length; k++) h = Math.imul(h ^ b[k], 16777619);
    return h >>> 0;
}

for (const R of radii) {
    const W = 2 * R + 2;
    for (const key of keys) {
        const params = { ...DEFAULT_PARAMS }, toggles = { ...DEFAULT_TOGGLES }, sim = { topology: DEFAULTS.topology };
        if (key !== 'sandbox') applyPreset(PRESETS.find(p => p.key === key), params, toggles, sim);
        const grid = new Grid(W, W); initializeGrid(grid);
        const rng = mulberry32(SEED);
        seedPopulation(grid, params, rng);
        const reg = createRegistry(params);
        const mem = memoryOf(grid);
        for (const i of grid.activeIndices) {
            const c = grid.compartment[i];
            if (toggles.V && params.vax_coverage > 0 && c === Compartment.S && rng() < params.vax_coverage) {
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
            }
        }
        const iso = createIsochrones();
        iso.record(grid, 0);
        let tTick = 0, tStats = 0, tRec = 0, tBuild = 0, peak = 0;
        for (let k = 1; k <= T; k++) {
            let t0 = performance.now();
            tick(grid, params, toggles, sim.topology, rng, reg, k);
            let t1 = performance.now(); tTick += t1 - t0;
            const st = computeStats(grid);
            let t2 = performance.now(); tStats += t2 - t1;
            iso.record(grid, k);
            let t3 = performance.now(); tRec += t3 - t2;
            if (k % 4 === 0) iso.build(grid, sim.topology, k, 0, process.env.ALL === '1');
            tBuild += performance.now() - t3;
            const act = st.E + st.I + st.Z;
            if (act > peak) peak = act;
        }
        let h = 2166136261;
        for (const a of [grid.compartment, grid.flags, grid.status, grid.age, grid.health, grid.strain_ids, grid.strain_loads,
            grid.mem_n, grid.mem_x, grid.mem_y, grid.mem_kind, grid.animal, grid.animal_age, grid.animal_strain,
            Float64Array.from(reg.ag_x), Float64Array.from(reg.beta), Int32Array.from(reg.parent, v => v ?? -1)]) h = fnv(h, a);
        const f = (x) => (x / T).toFixed(3).padStart(7);
        console.log(`R ${String(R).padStart(3)} (${grid.activeIndices.length} cells) ${key.padEnd(18)} tick ${f(tTick)} ms  stats ${f(tStats)}  record ${f(tRec)}  build/4 ${f(tBuild)}  ` +
            `| peak ${peak}, strains ${countLiving(reg)}/${reg.ids.length}, hash ${h.toString(16)}`);
    }
}
