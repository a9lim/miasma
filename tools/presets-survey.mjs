// The presets' facts (AGENTS.md "Presets"): each preset at its default knob,
// seeded with the opening's two cases, run headlessly.
// usage: node tools/presets-survey.mjs [preset,...] [seeds=10] [days=3000]
// Prints, per preset: takeoff (runs whose cumulative E+I passed 10% of the
// cells, or for the reservoir that kept human cases going), peak E+I, the
// day the outbreak ended (if it did), and what each preset's caption
// measures, as the median over seeds.
// The dynamics call the /shared/utils.js globals; define them for Node.
globalThis.mulberry32 = function (seed) { let a = seed | 0; return function () { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
globalThis.gaussian = function (rng) { rng = rng || Math.random; let u1 = rng(); if (u1 < 1e-12) u1 = 1e-12; return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rng()); };
const M = new URL('../src/', import.meta.url).href;
const { Grid } = await import(M + 'grid.js');
const { initializeGrid, initializeAnimals } = await import(M + 'initialization.js');
const { createRegistry, countLiving } = await import(M + 'strains.js');
const { tick } = await import(M + 'dynamics.js');
const { PRESETS, applyPreset } = await import(M + 'presets.js');
const { Compartment, MemoryKind } = await import(M + 'config.js');
const { hexBounds } = await import(M + 'topology.js');
const { memoryOf, remember } = await import(M + 'immunity.js');

const keys = (process.argv[2] || PRESETS.map(p => p.key).join(',')).split(',');
const SEEDS = +(process.argv[3] || 10), T = +(process.argv[4] || 3000);
const med = (a) => { const b = a.filter(Number.isFinite).sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : NaN; };

for (const key of keys) {
    const preset = PRESETS.find(p => p.key === key);
    const out = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
        const params = {}, toggles = {}, sim = {};
        applyPreset(preset, params, toggles, sim);
        const grid = new Grid(120, 120); initializeGrid(grid);
        const rng = mulberry32(seed);
        initializeAnimals(grid, params, rng);
        const reg = createRegistry(params);
        // coverage at reset, as main.js applyCoverage
        let unvax = 0;
        const mem = memoryOf(grid);
        for (const i of grid.activeIndices) {
            const c = grid.compartment[i];
            if (c === Compartment.EMPTY || c === Compartment.D) continue;
            if (toggles.V && params.vax_coverage > 0 && c === Compartment.S && rng() < params.vax_coverage) {
                grid.compartment[i] = Compartment.V; remember(mem, i, 0, 0, MemoryKind.VACCINE);
            } else unvax++;
        }
        const { cq, cr } = hexBounds(120, 120);
        for (const [dq, dr] of [[30, -42], [-24, 10]]) for (const [a, b] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, -1], [-1, 1]]) {
            const i = (cr + dr + b) * 120 + (cq + dq + a), c = grid.compartment[i];
            if (c === Compartment.D || c === Compartment.EMPTY || c === Compartment.Z) continue;
            grid.compartment[i] = Compartment.I; grid.flags[i] = 0;
            grid.strain_ids[i * 4] = 0; grid.strain_loads[i * 4] = 1;
            for (let s = 1; s < 4; s++) { grid.strain_ids[i * 4 + s] = 0xFFFF; grid.strain_loads[i * 4 + s] = 0; }
        }
        const ever = new Uint8Array(grid.W * grid.H);
        let peak = 0, end = -1, hh = 0, sp = 0, rem = 0, Z1000 = NaN, Zend = 0, living = 0;
        for (let k = 1; k <= T; k++) {
            const c = tick(grid, params, toggles, sim.topology, rng, reg, k);
            if (k > 1000) { hh += c.sToE; sp += c.spillovers; rem += c.iToR + c.iToD; }
            let act = 0, z = 0;
            for (const i of grid.activeIndices) {
                const x = grid.compartment[i];
                if (x === Compartment.E || x === Compartment.I || x === Compartment.Z) { act++; ever[i] = 1; }
                if (x === Compartment.Z) z++;
            }
            if (act > peak) peak = act;
            if (k === 1000) Z1000 = z;
            Zend = z;
            if (act === 0 && end < 0) { end = k; if (!params.spillover_rate) break; }
        }
        let reached = 0;
        for (const i of grid.activeIndices) if (ever[i]) reached++;
        living = countLiving(reg);
        out.push({ peak, end, reached: reached / grid.activeIndices.length, unvaxReached: reached / unvax, re: rem ? hh / rem : NaN, share: sp / Math.max(1, sp + hh), Z1000, Zend, living });
    }
    const ended = out.filter(o => o.end > 0);
    console.log(`${key}: seeds ${SEEDS}, days ${T}; peak E+I(+Z) median ${med(out.map(o => o.peak))}; ended in ${ended.length} (median day ${ended.length ? med(ended.map(o => o.end)) : '–'}); ` +
        `reached median ${(100 * med(out.map(o => o.reached))).toFixed(0)}%, of the unvaccinated ${(100 * med(out.map(o => Math.min(1, o.unvaxReached)))).toFixed(0)}%; ` +
        `human Re (days 1000–${T}) ${med(out.map(o => o.re)).toFixed(2)}, reservoir share ${(100 * med(out.map(o => o.share))).toFixed(0)}%; ` +
        `Z at day 1000 ${med(out.map(o => o.Z1000))}, at the end ${med(out.map(o => o.Zend))}; living strains at the end ${med(out.map(o => o.living))}`);
}
