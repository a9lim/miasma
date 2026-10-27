// The presets' facts (AGENTS.md "Presets"): each preset at its default knob,
// seeded with the opening's two cases, run headlessly.
// usage: node tools/presets-survey.mjs [preset,...|all] [seeds=10] [days=3000] [radius=the default] [knob values,...]
// SET="key=value,..." overrides params after the preset is applied.
// With knob values, each preset runs once per value of its knob instead of at
// its default. Prints, per run: the runs that took off (reached more than 10%
// of the cells left unvaccinated), peak E+I(+Z), the outbreaks that ended (and the
// median day), the day the wave first reached the world's rim, the share of
// cells reached (and of the unvaccinated) by days 200 and 300 and at the end,
// what each preset's caption measures, the living (S E I R V M) at day 1000 and
// at the end, living strains, and the chains of infection (descent.js): the
// mean size of those that closed after day 1000, the largest of them, and the
// largest still growing at the end; the mean size of those that closed in the
// first year and the runs where one grew past EMERGE cases (and the median
// day); and the clones (trees a transformation founded): the mean size of those
// closed after day 1000 and the most cells one holds at the end; as medians over
// seeds. A preset with `seed: false` gets no opening cases.
// The dynamics call the /shared/utils.js globals; define them for Node.
globalThis.mulberry32 = function (seed) { let a = seed | 0; return function () { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
globalThis.gaussian = function (rng) { rng = rng || Math.random; let u1 = rng(); if (u1 < 1e-12) u1 = 1e-12; return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rng()); };
const M = new URL('../src/', import.meta.url).href;
const { Grid } = await import(M + 'grid.js');
const { initializeGrid, seedPopulation } = await import(M + 'initialization.js');
const { createRegistry, countLiving } = await import(M + 'strains.js');
const { tick } = await import(M + 'dynamics.js');
const { PRESETS, applyPreset } = await import(M + 'presets.js');
const { Compartment, MemoryKind, DEFAULTS, OPENING_SEEDS } = await import(M + 'config.js');
const { hexBounds } = await import(M + 'topology.js');
const { SRC_TRANSFORM } = await import(M + 'descent.js');
const EMERGE = 1000;
const { memoryOf, remember } = await import(M + 'immunity.js');

const keys = (process.argv[2] && process.argv[2] !== 'all' ? process.argv[2] : PRESETS.map(p => p.key).join(',')).split(',');
const SEEDS = +(process.argv[3] || 10), T = +(process.argv[4] || 3000), R = +(process.argv[5] || DEFAULTS.R);
const knobValues = process.argv[6] ? process.argv[6].split(',').map(Number) : [null];
const SET = (process.env.SET || '').split(',').filter(Boolean).map(kv => { const [k, v] = kv.split('='); return [k, +v]; });
const W = 2 * R + 2;
const med = (a) => { const b = a.filter(Number.isFinite).sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : NaN; };
const pct = (x) => (100 * x).toFixed(0) + '%';

for (const key of keys) {
    const preset = PRESETS.find(p => p.key === key);
    for (const kv of knobValues) {
        const out = [];
        for (let seed = 1; seed <= SEEDS; seed++) {
            const params = {}, toggles = {}, sim = {};
            applyPreset(preset, params, toggles, sim);
            if (kv !== null) params[preset.knob.key] = kv;
            for (const [k, v] of SET) params[k] = v;
            const grid = new Grid(W, W); initializeGrid(grid);
            const rng = mulberry32(seed);
            seedPopulation(grid, params, rng);
            const reg = createRegistry(params);
            const act = grid.activeIndices, n = act.length;
            // coverage at reset, as main.js applyCoverage
            let unvax = 0;
            const mem = memoryOf(grid);
            for (let k = 0; k < n; k++) {
                const i = act[k], c = grid.compartment[i];
                if (c === Compartment.EMPTY || c === Compartment.D) continue;
                if (toggles.V && params.vax_coverage > 0 && c === Compartment.S && rng() < params.vax_coverage) {
                    grid.compartment[i] = Compartment.V; remember(mem, i, params.vax_ag_x || 0, params.vax_ag_y || 0, MemoryKind.VACCINE);
                } else unvax++;
            }
            const { cq, cr } = hexBounds(W, W);
            for (const [dq0, dr0] of preset.seed === false ? [] : OPENING_SEEDS) {
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
            const rim = [];
            for (let k = 0; k < n; k++) {
                const i = act[k], q = (i % W) - cq, r = ((i / W) | 0) - cr;
                if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) === R) rim.push(i);
            }
            const ever = new Uint8Array(W * W);
            let peak = 0, end = -1, edge = -1, hh = 0, sp = 0, rem = 0, Z1000 = NaN, Zend = 0, reached = 0, r200 = NaN, r300 = NaN;
            let L1000 = NaN, Lend = 0, chains = 0, chainCases = 0, chainMax = 0, seenTrees = 0;
            let early = 0, earlyCases = 0, clones = 0, cloneCases = 0, emerged = -1;
            const d = grid.descent;
            for (let k = 1; k <= T; k++) {
                const c = tick(grid, params, toggles, sim.topology, rng, reg, k);
                for (; seenTrees < d.trees; seenTrees++) {
                    const t = seenTrees % d.treeSize.length;
                    if (d.treeTick[t] <= 365) { early++; earlyCases += d.treeSize[t]; }
                    if (d.treeTick[t] <= 1000) continue;
                    if (d.treeSrc[t] === SRC_TRANSFORM) { clones++; cloneCases += d.treeSize[t]; }
                    chains++; chainCases += d.treeSize[t];
                    if (d.treeSize[t] > chainMax) chainMax = d.treeSize[t];
                }
                if (emerged < 0 && k % 10 === 0 && d.growing() >= EMERGE) emerged = k;
                if (k > 1000) { hh += c.sToE; sp += c.spillovers; rem += c.iToR + c.iToD; }
                let live = 0, living = 0;
                const comp = grid.compartment;
                for (let j = 0; j < n; j++) {
                    const i = act[j], x = comp[i];
                    if (x !== Compartment.EMPTY && x !== Compartment.D && x !== Compartment.Z) living++;
                    if (x === Compartment.E || x === Compartment.I || x === Compartment.Z) {
                        live++;
                        if (!ever[i]) { ever[i] = 1; reached++; }
                    }
                }
                if (edge < 0) for (const i of rim) if (ever[i]) { edge = k; break; }
                if (live > peak) peak = live;
                if (k === 200) r200 = reached;
                if (k === 300) r300 = reached;
                if (k === 1000) { Z1000 = c.zPop; L1000 = living; }
                Zend = c.zPop; Lend = living;
                if (live === 0 && end < 0) { end = k; if (!params.spillover_rate) break; }
            }
            if (!Number.isFinite(r200)) r200 = reached;
            if (!Number.isFinite(r300)) r300 = reached;
            const growing = d.growing();
            out.push({ chain: chains ? chainCases / chains : NaN, chainMax, growing, early: early ? earlyCases / early : NaN, emerged,
                clone: clones ? cloneCases / clones : NaN, cloneNow: d.largestNow(SRC_TRANSFORM), peak, end, edge, reached: reached / n, r200: r200 / n, r300: r300 / n, unvaxReached: Math.min(1, reached / unvax),
                re: rem ? hh / rem : NaN, share: sp / Math.max(1, sp + hh), Z1000, Zend, L1000, Lend, living: countLiving(reg) });
        }
        const ended = out.filter(o => o.end > 0), tookOff = out.filter(o => o.unvaxReached > 0.1).length;
        const knob = (kv === null ? 'default knob' : `${preset.knob.key} ${kv}`) + SET.map(([k, v]) => `, ${k} ${v}`).join('');
        console.log(`${key} (${knob}, R ${R}, ${(3 * R * (R + 1) + 1).toLocaleString('en-US')} cells): seeds ${SEEDS}, days ${T}; ` +
            `took off ${tookOff}/${SEEDS}; peak E+I(+Z) median ${med(out.map(o => o.peak))}; ended in ${ended.length} (median day ${ended.length ? med(ended.map(o => o.end)) : '–'}); ` +
            `rim reached by day ${med(out.map(o => o.edge > 0 ? o.edge : NaN))}; reached ${pct(med(out.map(o => o.r200)))} by day 200, ` +
            `${pct(med(out.map(o => o.r300)))} by 300, ${pct(med(out.map(o => o.reached)))} in all, of the unvaccinated ${pct(med(out.map(o => o.unvaxReached)))}; ` +
            `human Re (days 1000–${T}) ${med(out.map(o => o.re)).toFixed(2)}, reservoir share ${pct(med(out.map(o => o.share)))}; ` +
            `Z at day 1000 ${med(out.map(o => o.Z1000))}, at the end ${med(out.map(o => o.Zend))}; ` +
            `the living at day 1000 ${med(out.map(o => o.L1000))}, at the end ${med(out.map(o => o.Lend))}; living strains at the end ${med(out.map(o => o.living))}; ` +
            `chains closed after day 1000: mean size ${med(out.map(o => o.chain)).toFixed(2)}, largest ${med(out.map(o => o.chainMax))}; largest growing at the end ${med(out.map(o => o.growing))}; ` +
            `chains closed in the first year: mean size ${med(out.map(o => o.early)).toFixed(2)}; a chain past ${EMERGE} cases in ${out.filter(o => o.emerged > 0).length}/${SEEDS} (median day ${med(out.map(o => o.emerged > 0 ? o.emerged : NaN))}); ` +
            `clones closed after day 1000: mean size ${med(out.map(o => o.clone)).toFixed(2)}, the largest clone's cells at the end ${med(out.map(o => o.cloneNow))}`);
    }
}
