# Miasma

Stochastic spatial epidemic simulator on a hex lattice, public at a9l.im/miasma: SEIRD
plus vaccinated, maternal-immunity and zombie compartments, strains that evolve with
immunity by antigenic distance, an animal reservoir, painted interventions, and four
surfaces made by gluing the edges of a hexagonal world. Six presets, each an experiment
with one knob and a measured number, drawn as plates from an epidemiological atlas
after John Snow's cholera map.

Vanilla ES modules, no dependencies, no build step of its own; the lattice renders in
WebGPU only (without it the plate shows a notice and the margin still runs). It is a
submodule of the a9l.im repository (`projects/miasma`). The root `AGENTS.md` covers the
shared layer, the design system ("Inside the scene", "Show, don't tell"), build and
deployment; the parent's `docs/sim-overhaul/PLAN.md` holds the visual plan ("Miasma:
the atlas"). `docs/ROADMAP.md` is the plan and a9's decisions; `docs/VISION.md` is the
first ideation round.

## Running and checking

Preview from the parent root with `node docs/sim-overhaul/serve.mjs <port>` and open
`/miasma/`; `docs/sim-overhaul/check.mjs` screenshots the page headless with WebGPU on
and reports console errors, overflow and frame rate. Query flags: `?seed=<string>`
(reproducible run), `?mi=plane|torus|klein|rp2`, `?view=<view mode>`, `?r=<radius>`
(16–239; the World row offers 59, 89, 119, 179).

```bash
node --test 'tests/*.test.mjs'          # the suite, about 0.6 s; Node 22+, nothing else
for f in main.js colors.js src/*.js tools/*.mjs tests/*.mjs; do node --check "$f"; done
```

(`node --test tests/` works on Node 26 but not on Node 24 or older, which read a bare
directory as a module.) Add a test only where a failure would be silent (the gluing, an
analytic oracle, the lineage log against the tick, determinism), one per mechanism,
never a snapshot of a tuned number.

HTML↔JS id contract (BSD/macOS-safe):

```bash
comm -3 \
  <(rg -No "(?:getElementById|\\$)\('([^']+)'\)" src main.js --replace '$1' | sed 's/.*://' | sort -u) \
  <(rg -No 'id="([^"]+)"' index.html --replace '$1' | sort -u)
```

The clean output is two HTML-side lines, `sim-container` (a CSS hook) and
`tab-experiments` (found by `shared/tabs.js` from `data-tab`); anything else is a broken
lookup.

The dynamics import in Node (`Grid` → `initializeGrid` → `createRegistry(params)` →
`tick`) once `globalThis.mulberry32` and `gaussian` (from `/shared/utils.js`) are
defined, as `tests/env.mjs` does. Tools:

- `tools/bench.mjs [presets] [radii] [ticks] [seed]` times the tick, census and
  isochrones per preset and radius and prints a fingerprint of the final state; a
  refactor meant to keep behaviour keeps every fingerprint.
- `tools/presets-survey.mjs` runs presets across seeds (the Presets table below); a
  fifth argument sweeps the knob, `SET="key=value,…"` overrides params.
- `tools/survey.mjs` long runs: fates, strain composition, genome drift.
- `tools/spirals.mjs` the recurring-wave prototype behind roadmap §6.
- `tools/klein-lemma.mjs` the computation behind the Klein bottle's cone points.

In the browser, `window.__miasma` exposes the sim; its `applyScene(presetObject)`
applies any preset-shaped object, which is how a candidate preset is screenshotted
without editing `presets.js`.

## Layout

```
index.html               page shell, SEO/JSON-LD, edu content, colophon, plate figure and tools, margin
main.js                  init, opening scene, rAF loop, DOM cache, reset/preset wiring, zoom/pan, shortcuts
colors.js                --epi-* compartment colors (the accent and inks) over the shared palette
styles.css               layout, hairline controls, census swatches drawn as the plate's marks
src/config.js            enums, DEFAULTS, world radii, ANTIGENIC_SIZE, MEMORY_SLOTS, HEX_DIRS
src/grid.js              Grid (structure-of-arrays cell state), axial ↔ pixel math
src/initialization.js    applyHexMask; seedPopulation (steady-state ages, the reservoir)
src/topology.js          the four surfaces as edge gluings: slot table, edge isometries, cone points
src/dynamics.js          tick(): steps 1–9 (numbered in its comments), buffer swap, transition counters
src/dynamics-animal.js   step 10: reservoir demography, animal SIR, spillover
src/dynamics-scratch.js  next-state buffers, stamps and index lists recycled between ticks
src/default-*.js         DEFAULT_PARAMS (sim-wide knobs plus the seed genome), DEFAULT_TOGGLES
src/immunity.js          the antigenic torus and per-cell memory: susceptibility, remember, forget
src/strains.js           registry, mutation, recombination, reclamation, a coinfected host as a mixture
src/strain-extinction.js periodic sweep: tombstone, reclaim dead branches, splice under pressure
src/strain-style.js      a strain's mark from its antigen, the marks a carrier's strains make
src/descent.js           who infected whom: the infection log, cases, trees, Re by count, the Descent texel
src/antigenic-map.js     Fig. 5, the antigenic map (Strains tab)
src/presets.js           the six experiments, applyPreset, their theory and knob, the list of plates
src/params.js, toggles.js the params and toggles objects, STRAIN_GENOME_LAYOUT, slider and switch rows
src/model.js             Fig. 7, the model as a compartment diagram holding every switch and rate
src/paint.js             paint controller (brushes, undo/redo, paint keys), the brush rail
src/camera.js            zoom/pan over the fitted plate
src/isochrones*.js       latest-wave arrival day per cell, smoothed, contoured and faded (built in a worker)
src/plate.js             the plate per frame: edges, cone points, labels, title, cartouche, scale bar, trunk
src/gpu-plate.js         WebGPU: the lattice, its copies and isolines from a state texture, every mark
src/histology.js         Immunoediting's State view as an H&E section, its Reference rows
src/caption.js           the live figure caption and the Reference cartouche rows
src/stats.js             the Counts tab: census, observed Re
src/rose.js, spacetime.js, chains.js   its figures: Nightingale's rose, Fig. 3 space–time, Fig. 4 chains by size
src/lineage.js           strain prevalence, Strains tab, Fig. 6 the phylogeny, genome editor
src/history.js           per-tick ring buffer: transitions, spillovers, the Z census
src/prng.js              ?seed= RNG; rare per-cell rolls by skipping
src/ui.js                wires the controls: view picker, surfaces, world, plates, knob, Model, rail, about
tests/                   the suite (node:test); env.mjs defines the shared globals
tools/                   bench, surveys, spirals and the Klein lemma (above)
docs/ROADMAP.md          the plan: 2.3 beyond the neighbours, 2.4 time that recurs, 3.0 the game
docs/VISION.md           the first ideation round and the measurements behind it
```

## The model

### State and the tick

Storage is a (2R + 2)-square axial rhombus indexed `r * W + q`; `applyHexMask` carves
the inscribed hexagon into `grid.activeIndices`, and `topology.hexBounds` recomputes the
same centre and radius independently, so the two must agree. The default world is R 89
(24,031 cells, a9's call). Each cell has four strain slots (`0xFFFF` empty); active
loads (E, I, Z) sum to 1, and slot 0 doubles as strain memory at load 0 on M, R+CARRIER
and D+F_CORPSE cells, so their per-strain rates resolve off the right strain.

The tick is a simultaneous update. Fields a neighbour reads (compartment, flags, status,
strain slots, the animal and its strain) are read from start-of-tick arrays, written to
scratch copies and swapped in at the end. Fields only a cell's own update reads (age,
health, immune memory, the animal's age) are written in place after their last read. A
new field a neighbour reads needs a scratch buffer, the copy-in and the swap; one that
only rare events write can instead defer its writes past the swap, as the lineages'
`evt` does (`descent.js` `settle`).

Later steps overwrite `next`, and the order (numbered in `dynamics.js`) is deliberate:
Z overwrites everything before it, rollout and auto-quarantine read `next` so a
same-tick recovery is eligible, and animals run after Z so spillover respects
conversions. Rare rolls made at every cell are drawn by skipping (`prng.js`
`nextSuccess`), thinned from the highest rate any age has, so each cell keeps exactly
its own chance.

Most rates are per strain: the 26 genome fields live in registry arrays and the tick
reads them through the `*Of(i)` resolvers, falling back to `params` only with no
strain. `createRegistry(params)` copies params into α on every reset and preset apply,
so changing a genome field in `params` alone does nothing mid-run; the knob and the
Model tab write it onto every strain (main.js `setGenome`).

Non-obvious rules a reader would otherwise rediscover:

- R and V take no compartment multiplier on infection: their memory does the work, so
  an identical strain meets `1 − c` and a drifted one almost a naive host. Every →E
  counts in `sToE`, so observed Re includes breakthroughs.
- LATENT and CARRIER are set only on transitions (→E with `l_seed`, I → R with
  `c_seed`); without them `l_reactivate` and `c_transmit_mult` do nothing.
- Transitions overwrite `nextFlags`, so a provenance pass re-marks AUTO_Q on cells still
  in Q; without it an auto-quarantined contact that got infected would stay quarantined
  forever. Painted Q carries no AUTO_Q and is never released.
- Age effects ramp to "old age" (4,500 days), far past the mean life (about 1,030), so
  their population averages sit near 1.1, not at the sliders' values. A new world
  starts at the steady-state ages of its death rates.
- `animal_density: 0` is the reservoir's off switch (there is no toggle). Every animal
  S → I sets `animal_strain` and every exit resets it, or the lookup silently falls back
  to `params`. A reservoir sustains itself only with chronic animal infection and
  turnover.
- Z is one parameterized state machine read two ways (Zombie apocalypse, Immunoediting)
  because the math is identical. A Z's encounter outcomes are exclusive buckets of one
  roll; a target is affected only while `next[ni] === compartment[ni]` (first affect
  wins). `z_die_fighting` rolls per encounter, so only a tumour's rim is surveilled.

### Immunity, strains, coinfection

Antigenic space is a square torus 8 AU around (a9's call), distances the short way, so
drift can come back to old antigens. A cell remembers up to four antigens (infection or
vaccine; a near one of the same kind refreshes, the oldest drops). Susceptibility is
`σ = 1 − max_k c_k·exp(−d_k)` with `c` the `immunity_strength` or `vax_efficacy`, and
scales every roll on a target with memory, spillover included. Textbook SEIR is
`immunity_strength: 1, ag_step: 0`. Within a coinfected host, load follows replicator
dynamics on `β·σ_host`: no incumbent advantage at equal fitness.

A coinfected I cell (`isMixed`: two strains, or one outside slot 0) is read everywhere
as a load-weighted mixture (`hostMean`, `hostPick`): its rates are the mean, and an
outcome that keeps one strain (carrier, F-corpse, new Z, reverse spillover) credits it
by load × the rate behind the outcome, reusing the uniform that rolled it. No read of
an I cell depends on the slot a strain sits in; a single strain in slot 0 takes the
plain resolvers, so presets whose strains share one genome are bit-identical to reading
slot 0 alone. Coinfection is rare (under 1% of infected cell-days).

Strain ids are Uint16 and reused once reclaimed; names follow a monotone birth serial
so a reused id never repeats a name, and `gen` survives splicing. α (id 0) is the paint
seed and spillover fallback and is never tombstoned. Every 30 ticks the sweep tombstones
strains no slot or animal references, reclaims tombstoned strains no living strain
descends from, and above 16,384 slots splices dead single-line ancestors. **The sweep
must count every reference** (active slots, slot-0 memory, `animal_strain`) before it
reclaims; cells remember antigens, not ids, and the lineage events keep no strain id for
the same reason. Recombination's noise lets selection inflate β, which is why Drift
turns it off. Each strain keeps its birthplace (`bornAt`) for the trunk on the map.

### Lineages

`descent.js` keeps who infected whom as live state, not an archive (a9's call:
lineages, not records). Every infection is an event `(cell, src, dir, tick)` pointing
at its parent case: a transmission, a Z's conversion, exposure or kill, spillover from
the cell's own animal (`SRC_ANIMAL`), or a case placed by hand (`SRC_INTRO`, the seed
brush and the opening). A latent cell's transformation founds a clone and starts a tree
(`SRC_TRANSFORM`); a Z made from an I cell or corpse is the same case going on, and a
coinfection is not an event. Logging draws no RNG, so fingerprints don't move.

A case is open while its cell is E, I, Z, a carrier (with `t.C`) or an F-corpse (with
`t.F`) and still holds the event. Events live in a growable ring over `WINDOW` (420)
days counted from the newest event, so a finished outbreak keeps its tree; trees live in
a pool of their own so a tree outlasting the window (an immortal clone, a long chain)
keeps its size. Descendants are counted only when the Descent view packs its texture,
in one sweep from the newest event back. Undo drops a stroke's cases (`truncate`), safe
because each tick clears paint history. Re by count (children per case closed in the last 30 days) agrees with the
ratio estimator on a front and parts from it in the Z presets, where Z deaths never
enter the ratio's removals.

### Surfaces

`topology.js` glues the hexagon's edges: the 12R + 6 boundary slots are matched in
pairs, so neighbours are symmetric by construction. A translation matches an edge's
arc to its opposite in reverse order; a twist in the same order, shifted one slot so
the zigzags interlock. `buildComplex` gives the slot table, `getNeighborTable` maps it
to grid indices (with `back`, the direction a neighbour sees you through), and
`edgeGluings` the isometry `g(x) = M·x + v` onto each copy beyond an edge, which the
plate's faded copies, picking and the isochrones' padded field use through `wrap`.

- Plane: no gluing (χ 1). Torus: three translations (χ 0, flat).
- Klein bottle: N/S translated, SE/NW and SW/NE twisted (χ 0), with a 240° cone point
  at the E and W corners (its two cells are neighbours twice) and a 480° one.
- RP²: three twists (χ 1), with cone points of 120°, 240° (two) and 480°; at the 120°
  point a corner cell lists itself as a neighbour twice.

**Why the cone points:** a flat Klein bottle can't be tiled by these hex cells. The ring
of cells around the hexagon can be covered by non-overlapping translates in exactly two
ways, the lattice ⟨T1, T2⟩ and its mirror image, and every reflection of the lattice
swaps them, so a defect-free gluing has only translations as deck transformations and
is a torus (`tools/klein-lemma.mjs`; an exhaustive search over 4,864 complete gluings at
R = 59 agreed). RP², with χ 1, can't be flat at all. The corner closings
(`SPECS[...].close`) were found by exhaustive search over the leftover slots.

## The plate and the page

- The disease is the one red (infectious solid, exposed pale); interventions are inks,
  and every state is a pattern before a color. A strain's mark is its antigen drawn
  directly: `ag_x` turns the hatching through 180°, `ag_y` walks an OKLCH hue wheel
  fitted like the inks, which hurries through the accent's hue with its chroma dipping
  so no strain reads as the disease. The Strain view draws every strain a carrier holds
  by load, so coinfection shows as the seams where lineages meet.
- The Descent view draws each infection as two half-strokes, each from a cell's centre
  to the shared edge in that cell's frame, so strokes cross glued edges and mirror in
  copies for free; weight is log₂ descendants (width and tone), fading on the log's
  clock.
- Isochrones (a9's call: they fade) are re-stamped when a new wave arrives, smoothed and
  contoured only within a cliff (where a new wave meets old stamps the field jumps by
  hundreds of days), and faded against the newest stamp, not the tick, so nothing fades
  once an outbreak ends.
- `gpu-plate.js` draws the lattice in one full-screen pass from a state texture
  re-packed only when the world, view, brush or theme changed (main.js `markState`). The
  texel is full; the strain view and the Descent view each carry a second texture. The
  Reference cartouche draws its swatches with the same marks in 2D (`plate.js`
  `swatch`, `histology.js` `HISTOLOGY_ROWS`): **a mark changed in the shader needs its
  swatch changed too.**
- What acts on the plate sits on it (view picker, run tools, brush rail, zoom); the
  margin is the atlas's apparatus (Experiments, Counts, Strains, Model). The page opens
  on a living frame: Threshold on the torus warmed up 300 days, two cases seeded, playing
  (paused and 120 days further under reduced motion). **Restart** reruns the model as
  edited; **Restore** puts back the experiment's values.
- The caption is the day and the view's live values, plus the preset's measure; what
  things mean lives in the about panel.

## Conventions

- At 4× the loop runs about 40 ticks a second. Tick-driven panels bail unless their
  `.tab-panel` has `active` (via `classList`; `offsetParent` forces layout) and wake
  through `wakeRenders()`, or they show stale numbers while paused. Text runs on the
  `PANEL_MS` / `CAPTION_MS` cadence over a census a tick only marks stale; panels build
  their DOM once and guard writes by text equality. `document.startViewTransition`
  stays out of tick paths (its snapshot was the main source of jank).
- The plate never re-fits as text changes: the caption is a fixed two-line block and the
  frame is measured only on resize. `buildPanelSkeleton` rebuilds the Counts tab but
  keeps its figures, whose canvas contexts are captured once.
- Defaults are a showcase (the Sandbox): `DEFAULT_PARAMS` avoids 0 and 1 so every
  mechanic shows, and Z is off. `applyPreset` resets to defaults before merging, so a
  preset sets every key it needs and quiets what it doesn't use (`QUIET_TOGGLES`,
  `NO_ANIMALS`, `NO_DEMOGRAPHY`, `NO_EVOLUTION`); a new mechanic needs a quiet default
  there so the plates keep their fingerprints.
- A preset earns its place as an experiment (a9's rule): one knob, a phenomenon, a
  measured number in the caption, a predicted one where theory gives it, and a survey
  across at least ten seeds before it ships.
- Every param a mechanic reads needs a row in a Model part (`model.js` `PARTS`); a
  genome field also needs its row in `STRAIN_GENOME_LAYOUT`, and a counter the figure
  weighs goes in `FLUX_KEYS`.
- Paint snapshots per-cell state for undo (`captureCellState`); anything per-cell that
  paint can change belongs in it.
- The hex lattice is what gives isotropic wavefronts; shrink the grid rather than move
  to squares for speed. A pass over every cell costs about 1 ms per 100,000 cells: fold
  new per-cell work into a pass that already visits every cell, or visit only cells that
  can act (the `near` and contact stamps, the I and AUTO_Q lists), and run
  `tools/bench.mjs` before and after.
- A change to the RNG's draw order changes every seeded run: re-survey the presets and
  re-record the bench fingerprints in the same commit.
- Calibration and model ideation trip vendor biology filters on Sonnet lanes and Codex;
  keep them in the main loop. Rendering, UI and pure-math lanes delegate fine.

## Performance

On an M5 Max (2026-10-25), the Node tick for Threshold / Sandbox runs 0.21 / 0.57 ms at
10,621 cells and 1.3 / 3.2 ms at 96,661, and the opening holds 60 fps at 4× on every
world size even under 4× CPU throttling. What remains on the main thread at large sizes
is the tick's passes and copy-in, packing and uploading the state texture, and the
isochrones' `record`; the tick in a worker is the next lever (roadmap §8).

## Presets

Each preset's comment in `presets.js` records its calibration. `tools/presets-survey.mjs`
reproduces these (ten seeds, 3,000 days, default knob and world; surveyed 2026-10-25 and
2026-10-27). Each plate opens in its own view: Drift in Strain, Spillover in Descent,
the rest in State.

| Preset | Knob (default) | Measured in the caption | Ten seeds, 3,000 days |
|---|---|---|---|
| Threshold (opening) | β (0.11, 1.8× critical) | β against the critical β (≈ 0.061, independent edges); share of cells reached | takes off 10/10, reaches the edge by day 193, peak 782 E+I, ends by day 840, reaches 97% (30% by day 300, the opening) |
| Herd immunity | coverage (0.48, reset) | coverage against the lattice threshold (near 50%) and 1 − 1/R₀ (82%); share of the unvaccinated reached | peak 179, ends by day 1,874, reaches 66% of the unvaccinated (10% at 0.50) |
| Antigenic drift | antigenic step (1.2 AU) | the leading strain's distance from α along its descent, per year; carriers' mean generation | never ends, peak 4,620, 154 living strains at the end, waves locked to the season |
| Spillover | human β (0.03, between the branching and lattice thresholds, 0.023 and 0.048) | mean size of chains closed over the last year; the largest still growing; reservoir share of human cases | chains average 5.6 cases in the first year (3.2 at β 0.02, 12.6 at 0.05, 20.2 at 0.08), human Re 0.77, 24% from the reservoir; no single chain takes over at any β |
| Immunoediting | surveillance (0.29) | transformed-cell trend over 100 days; mean size of the clones cleared over the last year; the most cells one clone holds | 843 transformed cells at day 1,000, 1,693 at the end, the largest clone 120 cells, cleared clones' sizes as s^−1.49 (critical); escape at 0.25 (6,782; largest clone 361), shrinking from 0.32 (largest 15) |
| Zombie apocalypse | fight-back (0.06) | zombie trend over 100 days against the living | 3,327 zombies at day 1,000, 3,238 at the end, against 1,809 and 1,617 living; burns out in 0/10 (5/10 at 0.03) |

## Open work

`docs/ROADMAP.md` holds the plan (2.3 beyond the neighbours, 2.4 time that recurs, 3.0
the tactical game, the engine track), its open items for a9, and the deferred ideas.
When an item lands, add it to the roadmap's Landed list and update this file.
