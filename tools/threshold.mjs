// Final-size sweep through the lattice epidemic threshold (docs/VISION.md, finding 1).
// usage: node tools/threshold.mjs
// SEIR vanilla on the plane, one seed cell at the center, eight RNG seeds per beta.
// The dynamics call the /shared/utils.js globals; define them for Node.
globalThis.mulberry32 = function (seed) { let a = seed | 0; return function () { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
globalThis.gaussian = function (rng) { rng = rng || Math.random; let u1 = rng(); if (u1 < 1e-12) u1 = 1e-12; return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rng()); };
const M = new URL('../src/', import.meta.url).href;
const { Grid } = await import(M + 'grid.js');
const { initializeGrid, seedPopulation } = await import(M + 'initialization.js');
const { createRegistry } = await import(M + 'strains.js');
const { tick } = await import(M + 'dynamics.js');
const { PRESETS, applyPreset } = await import(M + 'presets.js');
const { DEFAULT_PARAMS } = await import(M + 'default-params.js');
const { DEFAULT_TOGGLES } = await import(M + 'default-toggles.js');
const { Topology } = await import(M + 'config.js');
const { hexBounds } = await import(M + 'topology.js');
const betas = [0.03, 0.045, 0.055, 0.06, 0.065, 0.07, 0.08, 0.09, 0.11, 0.15, 0.32];
const SEEDS = 8;
for (const b of betas) {
  const sizes = [];
  for (let s = 1; s <= SEEDS; s++) {
    const params = { ...DEFAULT_PARAMS }, toggles = { ...DEFAULT_TOGGLES }, sim = {};
    applyPreset(PRESETS.find(p => p.key === 'seir-vanilla'), params, toggles, sim);
    params.beta = b;
    const grid = new Grid(120, 120); initializeGrid(grid);
    const rng = mulberry32(1000 + s);
    seedPopulation(grid, params, rng);
    const reg = createRegistry(params);
    const { cq, cr } = hexBounds(120, 120);
    const c = cr * 120 + cq; grid.compartment[c] = 2; grid.strain_ids[c * 4] = 0; grid.strain_loads[c * 4] = 1;
    let k = 0, ever = 1;
    for (; k < 4000; k++) {
      const t = tick(grid, params, toggles, Topology.PLANE, rng, reg, k + 1);
      ever += t.sToE;
      let act = 0; for (const i of grid.activeIndices) { const x = grid.compartment[i]; if (x === 1 || x === 2) { act = 1; break; } }
      if (!act) break;
    }
    sizes.push(ever / grid.activeIndices.length);
  }
  sizes.sort((a, b) => a - b);
  const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;
  const big = sizes.filter(x => x > 0.1).length;
  console.log(`beta ${b.toFixed(3)}  mean final size ${(100 * mean).toFixed(1)}%  P(>10%) ${big}/${SEEDS}  sizes% ${sizes.map(x => (100 * x).toFixed(0)).join(' ')}`);
}
