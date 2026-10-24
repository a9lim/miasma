// Headless preset survey (docs/VISION.md, "What the measurements say").
// usage: node tools/survey.mjs [ticks=3000] [preset,preset,...|__default]
// env: SEED=<int> (default 12345); TOG='{"auto_quarantine":false}' overrides toggles after the preset.
// Seeds two 7-cell clusters at the opening offsets; prints peak, extinction tick, strain counts,
// active E+I+Z every ticks/15, and the carriers' strain composition and mean genome at the end.
// The dynamics call the /shared/utils.js globals; define them for Node.
globalThis.mulberry32 = function (seed) { let a = seed | 0; return function () { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
globalThis.gaussian = function (rng) { rng = rng || Math.random; let u1 = rng(); if (u1 < 1e-12) u1 = 1e-12; return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rng()); };
const M = new URL('../src/', import.meta.url).href;
const { Grid } = await import(M + 'grid.js');
const { initializeGrid, initializeAnimals } = await import(M + 'initialization.js');
const { createRegistry, strainCount, getStrain, countLiving } = await import(M + 'strains.js');
const { tick } = await import(M + 'dynamics.js');
const { PRESETS, applyPreset } = await import(M + 'presets.js');
const { DEFAULT_PARAMS } = await import(M + 'default-params.js');
const { DEFAULT_TOGGLES } = await import(M + 'default-toggles.js');
const { Compartment, DEFAULTS } = await import(M + 'config.js');
const { hexBounds } = await import(M + 'topology.js');
const T = +(process.argv[2] || 3000);
const keys = (process.argv[3] || PRESETS.map(p => p.key).concat(['__default']).join(',')).split(',');
for (const key of keys) {
  const params = { ...DEFAULT_PARAMS }, toggles = { ...DEFAULT_TOGGLES }, sim = { topology: DEFAULTS.topology };
  if (key !== "__default") applyPreset(PRESETS.find(p => p.key === key), params, toggles, sim);
  if (process.env.TOG) Object.assign(toggles, JSON.parse(process.env.TOG));
  if (process.env.SEED) globalThis.__seed = +process.env.SEED;
  const grid = new Grid(120, 120); initializeGrid(grid);
  const rng = mulberry32(globalThis.__seed || 12345);
  initializeAnimals(grid, params, rng);
  const reg = createRegistry(params);
  const { cq, cr } = hexBounds(120, 120);
  for (const [dq, dr] of [[30, -42], [-24, 10]]) for (const [a, b] of [[0,0],[1,0],[0,1],[-1,0],[0,-1],[1,-1],[-1,1]]) {
    const i = (cr + dr + b) * 120 + (cq + dq + a);
    grid.compartment[i] = Compartment.I; grid.strain_ids[i * 4] = 0; grid.strain_loads[i * 4] = 1;
  }
  const series = []; let peak = 0, peakT = 0, extinctAt = -1; let sToE = 0;
  for (let k = 1; k <= T; k++) {
    const c = tick(grid, params, toggles, sim.topology, rng, reg, k);
    sToE += c.sToE;
    let I = 0, E = 0, Z = 0, S = 0, R = 0, D = 0, pop = 0;
    for (const i of grid.activeIndices) { const x = grid.compartment[i]; if (x === 2) I++; else if (x === 1) E++; else if (x === 7) Z++; else if (x === 0) S++; else if (x === 3) R++; if (x !== 8) pop++; }
    const act = I + E + Z;
    if (act > peak) { peak = act; peakT = k; }
    if (act === 0 && extinctAt < 0) extinctAt = k;
    if (k % (T / 15) === 0) series.push(act);
  }
  // dominant living strain and its drift from α
  const counts = new Map();
  for (const i of grid.activeIndices) { const s = grid.strain_ids[i * 4]; if (s !== 0xFFFF && [1,2,7].includes(grid.compartment[i])) counts.set(s, (counts.get(s) || 0) + 1); }
  let dom = null, dn = 0; for (const [s, n] of counts) if (n > dn) { dom = s; dn = n; }
  const a = getStrain(reg, 0), d = dom != null ? getStrain(reg, dom) : null;
  const drift = d ? `dom=${d.name} β ${a.beta.toFixed(3)}→${d.beta.toFixed(3)} γ ${a.gamma.toFixed(3)}→${d.gamma.toFixed(3)} μ ${a.mu.toFixed(4)}→${d.mu.toFixed(4)}` : 'no carriers';
  { let alpha = 0, mut = 0, sb = 0, sg = 0, sm = 0, n = 0; const depth = s => { let d = 0; let st = getStrain(reg, s); while (st && st.parent != null && st.parent !== 0xFFFF && st.parent >= 0 && d < 999) { d++; st = getStrain(reg, st.parent); } return d; }; let sd = 0, md = 0;
    for (const i of grid.activeIndices) { if (![1,2,7].includes(grid.compartment[i])) continue; const s = grid.strain_ids[i*4]; if (s === 0xFFFF) continue; const st = getStrain(reg, s); if (s === 0) alpha++; else mut++; sb += st.beta; sg += st.gamma; sm += st.mu; n++; const dd = depth(s); sd += dd; if (dd > md) md = dd; }
    if (n) console.log(`   carriers ${n}: α ${alpha} (${(100*alpha/n).toFixed(0)}%), mutants ${mut}; mean β ${(sb/n).toFixed(3)} γ ${(sg/n).toFixed(3)} μ ${(sm/n).toFixed(4)}; mean depth ${(sd/n).toFixed(1)} max ${md}`); }
  console.log(`${key.padEnd(26)} peak ${String(peak).padStart(5)}@${String(peakT).padStart(4)} extinct@${extinctAt} strains ${strainCount(reg)} living ${countLiving(reg)} | active/${T/15}: ${series.join(' ')} | ${drift}`);
}
