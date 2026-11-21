# Miasma

Stochastic spatial epidemic on a hex lattice, at a9l.im/miasma: SEIRD plus vaccinated,
maternal-immunity and zombie compartments, strains with immunity by antigenic distance,
an animal reservoir, painted interventions, and four surfaces glued from a hexagon. Six
presets are experiments with one knob and a measured number, drawn as atlas plates after
Snow's cholera map. Vanilla ES modules, no dependencies, WebGPU only.

The parent's `AGENTS.md` covers the shared layer, the design system ("Inside the
scene", "Show, don't tell"), build and deployment. `about.md` is the about panel;
`docs/ROADMAP.md` is what's next.

## Running and checking

From the parent root, `node tools/sims/serve.mjs [port]` serves `/miasma/` live, and
`node tools/sims/check.mjs BASE OUTDIR /miasma/` screenshots it headless with WebGPU on
and reports console errors, overflow and frame rate. Query flags: `?seed=`, `?mi=plane|torus|klein|rp2`,
`?view=`, `?r=<radius>` (16–239).

```bash
node --test 'tests/*.test.mjs'          # the suite, under a second; Node 22+
for f in main.js colors.js src/*.js tools/*.mjs tests/*.mjs; do node --check "$f"; done
comm -3 \
  <(rg -No "(?:getElementById|\\$)\('([^']+)'\)" src main.js --replace '$1' | sed 's/.*://' | sort -u) \
  <(rg -No 'id="([^"]+)"' index.html --replace '$1' | sort -u)
```

The last is the HTML↔JS id contract: clean output is `sim-container` (a CSS hook) and
`tab-experiments` (found by `shared/tabs.js`). `node --test tests/` fails on Node 24 and
older, which read a bare directory as a module. Add a test only where a failure would be
silent, one per mechanism, never a snapshot of a tuned number.

The dynamics run in Node once `globalThis.mulberry32` and `gaussian` are defined
(`tests/env.mjs`). In the browser, `window.__miasma.applyScene(presetObject)` applies
any preset-shaped object, so a candidate preset can be screenshotted without editing
`presets.js`.

## Layout

```
index.html, main.js       page shell and SEO; init, the opening scene, rAF loop, wiring, shortcuts
src/dynamics*.js          the tick (steps numbered in comments), the reservoir, scratch buffers
src/topology.js           the four surfaces: slot table, edge isometries, cone points
src/immunity.js, strains.js, strain-extinction.js   antigenic memory, the strain registry, its sweep
src/descent.js            who infected whom: the infection log, cases, trees, Re by count
src/presets.js            the six experiments, their calibration comments, the knob
src/plate.js, gpu-plate.js   the plate: WebGPU lattice and marks, 2D furniture over it
src/isochrones*.js        arrival-day field, contoured and faded (built in a worker)
src/model.js              Fig. 7, the compartment diagram holding every switch and rate
tests/                    the suite (node:test)
tools/bench.mjs           tick cost per preset and radius, with a state fingerprint
tools/presets-survey.mjs  presets across seeds; a fifth argument sweeps the knob
tools/survey.mjs          long runs: fates, strain composition, genome drift
tools/spirals.mjs         recurring waves on the real gluing, for 2.4's waning
tools/klein-lemma.mjs     why the Klein bottle needs cone points
```

## Invariants

- `applyHexMask` and `topology.hexBounds` compute the world's centre and radius
  independently, so they must agree; everything sized by the world reads `hexBounds`.
- The tick is a simultaneous update: a field a neighbour reads needs a scratch buffer,
  copy-in and swap (`dynamics-scratch.js`); a field only its own cell reads is written in
  place after its last read; a neighbour-read field only rare events write may defer
  its writes past the swap, as the lineages' `evt` does (`descent.js` `settle`).
- Step order is load-bearing: Z overwrites everything before it, rollout and
  auto-quarantine read `next` so a same-tick recovery counts, and animals run after Z so
  spillover respects conversions.
- Rare per-cell rolls are drawn by skipping (`prng.js` `nextSuccess`), thinned from the
  highest rate any age has, so each cell keeps exactly its own chance at one draw per
  success.
- Active loads (E, I, Z) sum to 1. Slot 0 doubles as strain memory at load 0 on M,
  R+CARRIER and D+F_CORPSE cells, so their per-strain rates resolve off the right strain.
- `createRegistry(params)` copies params into α on every reset, so a genome field
  changed in `params` mid-run does nothing; the knob and Model tab write it onto every
  strain (main.js `setGenome`).
- R and V take no compartment multiplier on infection: their memory does it, so an
  identical strain meets `1 − c` and a drifted one almost a naive host.
- LATENT and CARRIER are set only on transitions, so without `l_seed`/`c_seed` rolls
  `l_reactivate` and `c_transmit_mult` do nothing.
- A provenance pass re-marks AUTO_Q on cells still in Q, because transitions overwrite
  `nextFlags`; without it an auto-quarantined contact that got infected stays forever.
- Every animal S → I sets `animal_strain` and every exit resets it, or the lookup
  silently falls back to `params`. `animal_density: 0` is the reservoir's off switch.
- Z is one parameterized state machine read two ways (Zombie apocalypse, Immunoediting)
  because the math is identical. An encounter's outcomes are exclusive buckets of one
  roll, a target is affected only while `next[ni] === compartment[ni]`, and
  `z_die_fighting` rolls per encounter, so only a tumour's rim is surveilled.
- A coinfected I cell is read everywhere as its strains' load-weighted mixture
  (`hostMean`, `hostPick`), so no read depends on the slot a strain sits in; one strain
  in slot 0 takes the plain resolvers, which keeps single-genome runs bit-identical.
- The extinction sweep must count every strain reference (active slots, slot-0 memory,
  `animal_strain`) before it reclaims, because ids are reused; cells remember antigens,
  not ids, and lineage events keep no strain id for the same reason.
- Lineages are live state, not an archive: the event ring keeps `WINDOW` (420) days
  counted from the newest event, so a finished outbreak keeps its tree, and trees are
  pooled apart from the ring, so a tree outlasting the window keeps its size. Logging
  draws no RNG.
- Surfaces glue the 12R + 6 boundary slots in pairs (a translation in reverse order, a
  twist in the same order shifted one slot), so neighbours are symmetric by
  construction; the copies, picking and the isochrones' padded field go through `wrap`.
- **The Klein bottle and RP² carry cone points because neither can be flat on this
  lattice:** the ring around the hexagon tiles by translates in exactly two
  mirror-image ways, so any defect-free gluing is a torus (`tools/klein-lemma.mjs`), and
  RP² has χ 1. Their corner closings were found by exhaustive search.
- A shader mark needs its 2D swatch changed too (`plate.js` `swatch`, `histology.js`),
  because the Reference cartouche draws the same marks on canvas. The state texture is
  re-packed only when world, view, brush or theme change, and its texel is full.
- Isochrones fade against the newest stamp, not the tick, so nothing fades once an
  outbreak ends.

## Conventions

- The red is the disease alone; interventions are inks, and every state is a pattern
  before a colour. A strain's mark is its antigen drawn directly (hatch angle × an
  OKLCH hue wheel that dips through the accent), so no strain reads as the disease.
- At 4× the loop runs about 40 ticks a second: tick-driven panels bail unless their
  `.tab-panel` has `active` and wake through `wakeRenders()`, text runs on the
  `PANEL_MS`/`CAPTION_MS` cadence, and `startViewTransition` stays out of tick paths
  (its snapshot was the main source of jank). The plate never re-fits as text changes.
- `applyPreset` resets to the defaults before merging, so a preset sets every key it
  needs and quiets the rest (`QUIET_TOGGLES`, `NO_ANIMALS`, `NO_DEMOGRAPHY`,
  `NO_EVOLUTION`); a new mechanic needs a quiet default there to keep the presets'
  fingerprints. The Sandbox defaults avoid 0 and 1 so every mechanic shows.
- A preset is an experiment (a9's rule): one knob, a phenomenon, a measured number in
  the caption, a predicted one where theory gives it, and a survey across at least ten
  seeds before it ships. Its calibration lives in its comment in `presets.js`.
- Every param a mechanic reads needs a Model row (`model.js` `PARTS`); a genome field
  also needs its `STRAIN_GENOME_LAYOUT` row, and a counter the figure weighs goes in
  `FLUX_KEYS`. Anything per-cell that paint can change belongs in `captureCellState`.
- A pass over every cell costs about 1 ms per 100,000 cells, so fold new per-cell work
  into an existing pass or visit only cells that can act, and run `tools/bench.mjs`
  before and after; a refactor meant to keep behaviour keeps every fingerprint. A
  change to the RNG's draw order changes every seeded run: re-survey and re-record in
  the same commit.
- The hex lattice is what gives isotropic wavefronts; shrink the grid rather than move
  to squares.
- Calibration and model ideation trip vendor biology filters on Sonnet lanes and Codex;
  keep them in the main loop.
