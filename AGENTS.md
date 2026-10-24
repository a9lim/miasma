# Miasma

Stochastic spatial epidemic simulator on a hex grid, public at a9l.im/miasma: SEIRD
plus vaccinated, maternal-immunity, and zombie compartments, multi-strain evolution,
an animal reservoir, painted interventions, and four surfaces made by gluing the edges
of a hexagonal world. The map is drawn as a plate from an epidemiological atlas.
Vanilla ES modules; the lattice renders in WebGPU with a Canvas 2D fallback; no
dependencies and no build step of its own. It is a submodule of the a9l.im repository
(`a9lim.github.io`, at `projects/miasma`); the root `AGENTS.md` covers the shared
layer, the design system (including "Inside the scene"), build, and deployment, and
`docs/sim-overhaul/PLAN.md` in the parent holds the plan this rebuild follows.

## Running and checking

Preview from the parent root with `node docs/sim-overhaul/serve.mjs <port>` (serves
`shared/` and `projects/` live from the working tree) and open `/miasma/`; the parent
`npm run build` path works too. Query flags: `?seed=<string>` for a reproducible run
(`src/prng.js` hashes it into the shared `mulberry32`, which drives the tick, animal
seeding, mutation, and recombination); `?mi=plane|torus|klein|rp2` opens on a surface
(a retired name such as `cylinder` or `mobius` falls back to the default);
`?view=<view mode>` opens on a view; `?canvas2d` forces the Canvas fallback.
`docs/sim-overhaul/check.mjs` screenshots the page headless and reports console errors,
overflow and frame rate.

```bash
node src/topology.test.mjs        # 2510 checks: gluing, χ, orientability, cone points
```

Run it after touching `topology.js`. It checks bounds, PLANE nulls, TORUS
translation round-trips, then treats each surface's slot table as a cell complex and
checks neighbor symmetry, χ, orientability, the cone points, six distinct neighbors on
the torus (and on the Klein bottle everywhere but its 240° cone point), the edge
isometries against the slot gluing, and the two-tilings lemma behind the Klein
construction (see Surfaces below).

HTML↔JS id contract (BSD/macOS-safe):

```bash
comm -3 \
  <(rg -No "(?:getElementById|\\$)\('([^']+)'\)" src main.js --replace '$1' | sed 's/.*://' | sort -u) \
  <(rg -No 'id="([^"]+)"' index.html --replace '$1' | sort -u)
```

The clean output is four lines: `brush-size-group` and `paint-mode-grid` (built by
`paint.js`) on the JS side, `canvas-controls` and `sim-container` (CSS hooks) on the
HTML side. Anything else is a broken lookup.

The dynamics modules import cleanly in Node for headless runs (`Grid` →
`initializeGrid` → `createRegistry(params)` → `tick`), but `strains.js` and `prng.js` call
the `/shared/utils.js` globals `gaussian` and `mulberry32`, so define those on
`globalThis` first. In the browser, `window.__miasma` exposes
`{ sim, params, toggles, history, tickOnce, iso, plate, strains, paint, PaintMode,
setPlaying, openScene, viewport }`.

## Layout

```
index.html               page shell, SEO/JSON-LD, edu content, colophon, plate figure, margin
main.js                  init, opening scene, rAF loop, DOM cache, reset/preset wiring, zoom/pan, shortcuts
colors.js                --epi-* compartment colors (the accent and inks) over the shared palette
styles.css               layout, hairline controls, census swatches drawn as the plate's marks
src/config.js            enums (Compartment, Status, Flag, Animal, Topology, ViewMode), DEFAULTS, HEX_DIRS
src/grid.js              Grid (structure-of-arrays cell state), axial ↔ pixel math
src/initialization.js    applyHexMask, fresh human and animal seeding
src/topology.js          the four surfaces as edge gluings: slot table, edge isometries, cone points
src/dynamics.js          tick(): steps 1–9, buffer swap, transition counters
src/dynamics-animal.js   step 10: reservoir demography, animal SIR, spillover
src/dynamics-scratch.js  next-state buffers recycled between ticks
src/default-params.js    DEFAULT_PARAMS (sim-wide knobs plus the seed genome)
src/default-toggles.js   DEFAULT_TOGGLES
src/strains.js           registry, GENOME_FIELDS, mutation, recombination, bloom filter, tombstones
src/strain-extinction.js periodic tombstone sweep
src/strain-style.js      each strain's ink and hatch angle (plate, phylogeny, strain list)
src/presets.js           ten presets, applyPreset, preset dropdown
src/params.js            Advanced-parameters sliders (sim-wide) and STRAIN_GENOME_LAYOUT
src/toggles.js           compartment, flag, and automatic-response toggles; animal-display group
src/paint.js             paint controller (pointer events, brush, undo/redo, paint keys), Paint tab
src/camera.js            zoom/pan over the fitted plate
src/isochrones.js        first-exposure day per cell, smoothed and contoured on the lattice
src/plate.js             the plate per frame: copies, edges, cone points, labels, title, cartouche, scale bar
src/gpu-plate.js         WebGPU: the lattice, its copies and isolines from a state texture
src/render.js            Canvas 2D fallback for the lattice (the same marks), plate geometry
src/histology.js         the oncoviral preset as an H&E-stained section (Canvas; GPU mirrors it)
src/caption.js           the live figure caption and the Reference cartouche rows
src/rose.js              Nightingale's rose (Counts tab)
src/stats.js             census and observed Re (Counts tab)
src/lineage.js           strain prevalence, Strains tab rows, time-scaled phylogeny, genome editor
src/history.js           transition-count ring buffer for observed Re
src/prng.js              ?seed= RNG
src/ui.js                surface picker (glyphs), map view, Settings assembly, about panel
src/topology.test.mjs    topology tests
tools/survey.mjs         headless preset survey: fates, strain composition, genome drift
tools/threshold.mjs      final-size sweep through the lattice epidemic threshold
docs/ROADMAP.md          the plan: 2.1 (antigenic immunity, six experiment presets), 3.0 (the game)
docs/VISION.md           ideation draft: strengths, gaps, directions, measured evidence
```

## How it works

### Grid and state

Storage is a 120×120 axial rhombus of hexes (pointy-top on screen: `x = √3·(q + r/2)`, `y = 1.5·r`), indexed `r * W + q`.
`applyHexMask` (`initialization.js`) carves out the inscribed regular hexagon (radius 59,
10,621 cells) and writes `grid.activeIndices`; cells outside it are permanent
`Compartment.EMPTY` / `Animal.VOID` padding. Hot loops iterate `activeIndices`, and
compartment counts over it always sum to `grid.activeCount`. `topology.hexBounds`
recomputes the same center and radius independently, so the two formulas must agree.

`Grid` holds parallel typed arrays: `compartment` (S E I R D V M Z, plus the EMPTY
sentinel), `status` (none / H / Q), `flags` (LATENT on E, CARRIER on R, F_CORPSE on D,
and AUTO_Q marking auto-set quarantine), `age`, `health`, four strain slots per cell
(`strain_ids`, `0xFFFF` = empty; `strain_loads`), a 64-bit bloom `strain_hist` of past
exposures, and the reservoir layer `animal` / `animal_age` / `animal_strain`. Active
loads (E, I, Z) sum to 1. Slot 0 doubles as strain memory with load 0 on M (inherited
from an R parent), R+CARRIER, and D+F_CORPSE cells, so their per-strain rates resolve
off the right strain.

### The tick

`tick()` uses simultaneous update: it reads the start-of-tick arrays, writes scratch
copies, and swaps them onto the grid at the end, recycling the old arrays as the next
scratch set (`dynamics-scratch.js`). A new per-cell field needs a scratch buffer, the
copy-in, and the swap.

Order (step numbers match the comments in `dynamics.js`): 1 age → 2 births →
3 within-host competition, pruning, recombination → 6 hospital allocation (a pre-pass)
→ 4+5 one pass of transmission and transitions → 7 health degradation → 7.5 vaccination
rollout → 7.6 auto-quarantine → 8 age mortality → 9 Z → 10 animals → swap → extinction
sweep. Later steps overwrite `next`: Z overwrites everything before it, step 8 skips
cells already D or EMPTY so an age-out is not double-counted, 7.5 and 7.6 read `next`
so a same-tick recovery is eligible, and animals run after Z so spillover respects Z
conversions.

Most rates are per strain. The 26 `GENOME_FIELDS` (β σ γ μ, the maternal and flag
rates, the Z rates, health impact, and animal β/γ/μ) live in registry arrays, and the
tick reads them off a cell's slot-0 strain through the `*Of(i)` resolvers, falling back
to `params` only when there is no strain. `createRegistry(params)` copies the current
params into strain α on every reset and preset apply. `z_exhaust_threshold` stays
sim-wide because it is an integer count.

### Transmission and transitions

`pickIncomingStrain(i)` computes infection for one target. Sources are I (weight 1),
R+CARRIER (`c_transmit_mult`), and D+F_CORPSE (`f_transmit_mult`), times
`q_transmit_mult` for quarantined sources. Each edge's β is the load-weighted sum of the
source's strain β, with each slot scaled by `1 − cross_immunity_mult` when the target's
bloom already holds that strain. The survival product gives pInf, which is then scaled
for target quarantine, R (`r_susceptibility_mult`), V (`1 − vax_efficacy`), and age. On
success a two-stage weighted pick (edge, then slot) chooses the strain, and a mutation
roll may register a mutant. The R and V multipliers sit after the per-slot bloom
scaling so prior immunity suppresses seen strains while novel ones still get through.

Targets are S → E, R → E (reinfection, when `r_susceptibility_mult > 0`), V → E (when
`t.V` and `vax_efficacy < 1`), and I cells that stay I, which roll coinfection: the new
strain enters at `coinfection_load_delta`, evicting the lowest load when all four slots
are full, and a bloom hit blocks it. Every →E counts in `sToE`, so observed Re includes
breakthroughs.

LATENT and CARRIER are set only on transitions: LATENT on any →E with the incoming
strain's `l_seed` (needs `t.L`), CARRIER on I → R with `c_seed` (needs `t.C`). Latent E
progresses at `l_reactivate` instead of σ. Without those rolls, `l_reactivate` and
`c_transmit_mult` do nothing.

I leaves at γ_eff + μ_eff, modified by H (`h_recover_mult`, `h_mortality_mult`), Q or
hospital overflow (`h_overflow_mortality_mult`, only while `t.auto_hospital`), age, and
health. Recovery sets bloom bits for every carried strain. A disease death gets F_CORPSE
when `t.F`; natural deaths, culls, and Z deaths never do. Plain D disposes to EMPTY at
`d_disposal`; F-corpses wait for F to decay first.

Births fill an EMPTY cell that has at least `birth_threshold` inhabited neighbors (not
D, Z, or EMPTY) with probability `1 − (1 − birth_rate)^k`. A uniformly picked parent
that is R, with `t.M` on, makes an M newborn carrying that parent's strain memory;
otherwise the newborn is S.

The hospital pre-pass (`t.auto_hospital`) assigns H row-major to non-Q I cells up to
`floor(h_capacity_frac · W · H)` beds. Turning it off strips every H and removes the
overflow penalty. Auto-quarantine (`t.auto_quarantine`) traces I cells and living
neighbors of I cells into Q at `quarantine_trace_rate`, tags them AUTO_Q, and releases
them once they are neither case nor contact; painted Q carries no AUTO_Q and is never
released. Because transitions overwrite `nextFlags`, a provenance-restore pass re-marks
AUTO_Q on cells still in Q; without it, an auto-quarantined contact that got infected
would stay quarantined forever. Vaccination rollout (`t.V && t.vax_rollout`) moves
S/E/R/M to V at `vax_rollout_rate`, clearing slots, flags, and status but keeping the
bloom; I and Z are not eligible.

### Z

Step 9 is gated wholesale on `t.Z` (off by default). Spawn pathways: D+F_CORPSE → Z
(`dz_dead`), I → Z (`dz_alive`), and latent E → Z (`l_transform`, also needs `t.L`). A
new Z carries its source strain at slot 0 with load 1, and every Z rate reads off that
strain. L → Z lives in step 9 rather than step 5 so the "Z wins" overwrite applies to it.

Each Z first rolls natural decay (`z_die_natural`), then exhaustion when at least
`z_exhaust_threshold` neighbors are Z (`z_exhaust`). Then, for each neighbor that is not
Z, EMPTY, or D, a single uniform roll falls into cumulative buckets: clean kill → kill
plus F-corpse (needs `t.F`; the corpse keeps the Z's strain memory) → expose (E carrying
the Z's strain, LATENT per that strain's `l_seed`) → convert; the remainder is no
effect. The four rates clamp at 0 and rescale when they sum past 1. They are mutually
exclusive buckets, not independent rolls, so one encounter has at most one outcome. An
independent `z_die_fighting` roll follows each encounter, and a Z that dies stops.
First-affect-wins: a target is rolled only while `next[ni] === compartment[ni]`, so k
zombies affect it with probability 1 − P(nothing)^k; scan order decides which Z gets
the credit.

The same state machine supports two readings, shipped as presets:
`zombie-apocalypse` (F-corpse spawn, high fight rates, finite lifespan) and
`oncoviral-transformation` (latent spawn, no fighting, immortal cells, clonal
conversion, crowding necrosis). It is parameterized rather than mode-switched because
the math is identical.

### Animal reservoir

`dynamics-animal.js` runs 10a aging, 10b births (a VOID cell with at least
`animal_birth_threshold` live animal neighbors becomes S), 10c SIR plus spillover, and
10d age-ramped mortality. Each sub-step reads the start-of-tick `animal`, so a 10b
newborn is inert in 10c and 10d, and a 10c death is not recounted in 10d. There is no
toggle: `animal_density: 0` seeds no animals and births never start. The default is
0.12; among presets only hantavirus, plague, and absurd keep a reservoir.

Animal β/γ/μ are per strain, looked up through `animal_strain`. Every animal S → I
write sets `animal_strain`, and recovery, death, disposal, and birth reset it to
`EMPTY_STRAIN`; otherwise the lookup silently falls back to `params`. Spillover is
co-located (same cell index): an infectious animal can expose a susceptible human with
its own strain (`spillover_rate`, blocked by a bloom hit), and an infectious human can
infect a susceptible animal with its slot-0 strain (`reverse_spillover_rate`).
Animal-to-animal spread runs over neighbors and reservoir-samples the source strain.

### Strains

The registry (`strains.js`) is append-only plain arrays. IDs are Uint16 (`MAX_STRAINS`
65535, `0xFFFF` reserved as empty); names run α…ω, then α1…ω1, and so on. α (id 0) is
the paint seed and the spillover fallback, and is never tombstoned. Mutation applies
multiplicative Gaussian noise per genome field and clamps to the field's range, so a
field at 0 stays 0 down the lineage; recombination (step 3, coinfected I cells)
averages two parents with range-scaled noise and records both (registry arrays `parent`
and `parents2`; `getStrain` exposes the second as `parent2`). Cross-immunity is exact
bloom membership (two hashes into 64 bits per cell, so occasional false positives), not
genome distance; `similarity()` is unused.

`runExtinctionSweep` runs every 30 ticks: strains absent from every human strain slot
(memory slots included) are tombstoned, and a tombstoned strain that reappears is
restored. IDs are never reused because blooms hash them. The sweep does not scan
`animal_strain`.

### Surfaces

`topology.js` glues the world hexagon's edges. Edges are numbered 0–5 by outward
normal (SE, S, SW, NW, N, NE on screen); the 12R + 6 boundary *slots* (cell-edges facing
out of the hexagon) are matched in pairs, so the neighbor relation is symmetric by
construction. A translation matches an edge's arc of 2R + 1 slots to its opposite in
reverse order; a twist matches in the same order, shifted one slot so the zigzags still
interlock. `buildComplex` returns the slot table (`nb`, `back`, `flip`), and
`getNeighborTable` maps it to grid indices for the dynamics. `edgeGluings` reads off,
for each glued edge, the lattice isometry `g(x) = M·x + v` that carries the world onto
the copy beyond it (used by the plate's faded copies and by picking); `wrap` maps a cell
in such a copy back to the world; `cornerCones` reports the cone points.

- Plane: no gluing (χ 1). Torus: three translations (χ 0, orientable, flat).
- Klein bottle: N/S translated, SE/NW and SW/NE twisted (χ 0, non-orientable). The
  plan's flat Klein bottle (glide reflections at the E and W corners) cannot exist on
  this lattice: the ring of cells around the hexagon can be covered by non-overlapping
  translates of it in exactly two ways, the lattice ⟨T1, T2⟩ and its mirror image, so
  every tiling by translates is one of the two, and every reflection of the cell lattice
  swaps them; a defect-free gluing therefore has only translations as deck
  transformations and is a torus. An exhaustive search over every edge pairing and
  every lattice isometry (4864 complete gluings at R = 59) agrees. Miasma's Klein bottle
  is the plan's fallback: flat except a 240° cone point (at the E and W corners; its two
  cells are neighbors twice) and a 480° one.
- RP²: three twists (χ 1, non-orientable). Its corner closing leaves cone points of
  120°, 240° (two) and 480°; at the 120° point a corner cell's two outer edges are glued
  to each other, so it lists itself as a neighbor twice.

The corner closings (`SPECS[...].close`) were found by exhaustive search over the
leftover slots; the tests re-check them. `Topology` is `{ PLANE, TORUS, KLEIN, RP2 }`
(0–3); `topoFromString` maps any other name to the default.

### Rendering: the plate

The scene is a plate in the line of John Snow's cholera map (PLAN.md, "Miasma: the
atlas"). The disease is the one red: infectious cells solid, exposed pale. Recovered
cells are stipple, vaccinated hatching (prussian), deaths small crosses (red for an
F-corpse), susceptible cells graphite dots, maternal-immune newborns small rings, Z
cross-hatching (sap); a latent E carries a dark dot, a carrier R a red one; H is a
plus and Q a cordon (hex outline, indigo). The strain view hatches each carrier at its
dominant strain's angle in its ink (`strain-style.js`, eight styles cycling by id); age,
health and susceptibility are single-ink ramps in eight steps; the status view mutes all
but H and Q. Animals are small triangles off the cell center. The oncoviral preset
(`sim.presetKey`) draws the lattice as an H&E section (`histology.js`).

Isochrones: `isochrones.js` stamps each cell's first E/I/Z tick, smooths the field by
neighbor averaging over the surface's own neighbor table (so it is continuous across
glued edges), and contours it every 8 days by marching triangles on the cell-center
lattice; segments feed the label placement and the Canvas renderer, and a padded copy
of the field (one cell past every edge, read through the gluing) feeds the GPU, which
draws the isolines per pixel with their analytic gradient.

Each frame `plate.js` composes: the lattice (WebGPU: `gpu-plate.js`, one full-screen
pass; each pixel finds its cell, through the inverse edge isometry on a faded copy, and
draws the marks procedurally in the world's frame, so hatching runs on unbroken and is
mirrored on a mirrored copy), then on the 2D canvas above it the edges (thin rule with
one, two or three chevrons per glued pair, agreeing for a translation and opposed for a
twist; a heavy rule with hachures for a shore), cone-point circles with their angles, the
title (top right; one plate numeral per view), the Reference cartouche (bottom left;
rows from `caption.js`), the scale bar (cells; µm on the slide) and the isochrone labels
(every 24 days, collision-checked against each other and the furniture). Without WebGPU
(or with `?canvas2d`), `render.js` draws the same marks into an offscreen tile once per
change and `plate.js` blits it, and its copies through `destination-in` fading. The
GPU state texel is `x` compartment, `y` flags | status << 4, `z` animal | (strain slot +
1) << 3, `w` the ramp value. Measured at the default grid mid-outbreak, the Canvas tile
costs 17–40 ms (a fill through thousands of adjacent hexes is superlinear in Skia);
the GPU path holds 60 fps at 4× on a 2× display.

Canvas text is Newsreader and waits on `_loadTextFonts()`; theme changes invalidate
`plateTheme()` (a `MutationObserver` on `data-theme`), and the colophon's theme
handler marks the tile, rose, strain and census panels dirty.

### UI

The colophon (`shared/colophon.js`) holds play, step, theme and help; the figure
caption under the plate is live (`caption.js`, through `_colophon.caption`, throttled,
and forced when the loop goes idle). The plate fills the left; the margin on the right
(under the plate below 760 px) holds the surface picker, whose glyphs are each
surface's fundamental polygon drawn from `SURFACES` and `cornerCones`, the run row
(speed, reset, undo, redo, map view, hide), and four tabs: Counts (Nightingale's rose,
census, observed Re, reservoir census), Strains (time-scaled phylogeny, top strains,
genome editor), Paint, and Settings (preset, map view, toggles, advanced parameters).
The zoom cluster sits at the plate's top left. `ui.js` assembles Settings and returns
`{ resetUI, showAbout, showPreset }`.

The page opens on a living frame: `openScene` applies `OPENING_PRESET` (SEIR vanilla on
the torus, or the `?mi=` surface), seeds two cases (one near a glued edge), warms up 96
days, and plays; under reduced motion it warms up 150 days and stays paused. Reset
restores the default params and toggles, wipes the grid and seeds the same two cases;
applying a preset seeds them too, so the plate is never empty.

Nightingale's rose (`rose.js`, behind the old chart's `initTimeseries` API) counts
exposures, recoveries and deaths per ten-day wedge from the tick's transition counts,
overlaid from the center; a rose is 120 days, and the previous 120 are a dashed
envelope at the same scale. The phylogeny (`lineage.js`) draws living strains and their
ancestors (at most 28 living, the rest counted) as branches over real time, joined to
their parent on their birth day (a dashed second connector for a recombinant), with a
living branch's weight its current prevalence and its tip the strain's swatch.

The loop in `main.js` runs `BASE_TICK_RATE` 10 × speed (0.25–4×) days per second, at
most 16 ticks per frame, and idle-stops when paused with nothing dirty. Each tick pushes
transition counts to `history` and the rose, computes stats once (`cachedStats`), stamps
isochrone arrivals, and clears paint undo/redo so a stroke can never rewind evolved
state.

`camera.getEffectiveViewport()` returns one shared object, mutated on every call; its
`frame` (the canvas below the colophon band) is measured on resize. The paint
controller hit-tests through `pickAt`, which the plate answers, so a stroke on a faded
copy lands on the world cell it shows. Pinch suppresses painting through
`setSuppressed`, and pan is unclamped (reset recovers).

The paint controller owns every canvas pointer event; its default is seed mode with
brush 0. Each stroke is one snapshot entry (undo/redo depth 20). `paint.js` handles 1–6,
`[`/`]`, and Ctrl/Cmd+Z/Y/Shift+Z itself; `main.js` registers the other shortcuts with
`initShortcuts` and lists the paint keys as documentation-only entries (`when: () =>
false`) so the about panel shows them without a second handler firing.

## Conventions

- At 4× the loop runs about 40 ticks per second, so tick-driven panel renders bail
  unless their host `.tab-panel` has `active`, checked with `classList` because
  `offsetParent` forces a layout flush. Visibility flips (tab click, menu, close) go
  through `wakeRenders()` in `main.js`, which marks panels dirty and re-measures the
  chart canvas (its backing store goes stale while `display: none`). A new gated panel
  needs the same wiring or it shows stale numbers while paused.
- Panels build their DOM once and cache value refs (`panelEl._statsRefs`,
  `panelEl._lineageRefs`); per-tick writes are guarded by text equality. Strain rows are
  pooled by id and reordered with `appendChild`. `document.startViewTransition` stays
  out of tick paths: its document snapshot was the main source of UI jank.
- `stats.js` `buildPanelSkeleton` rebuilds the Counts tab but preserves
  `#timeseries-panel` (the rose), whose canvas context `initTimeseries` captures once.
- The transition history (200 ticks) is a typed-array ring buffer.
- `#speed-btn` carries an inner `<span class="speed-label">` that `main.js` writes.
- Inside the scene, an effect ships only if it reads a quantity in the model, and every
  state is a pattern before it is a color (root AGENTS.md, "Inside the scene"). The red
  is the disease alone; interventions are inks.
- The plate never re-fits as text changes: the caption is a fixed three-line block
  (two on phones), and the frame is measured only on resize.
- Defaults are a showcase: `DEFAULT_PARAMS` avoids 0 and 1 so every mechanic is
  visible, and Z is off. `applyPreset` resets params and toggles to the defaults before
  merging, so a preset must set every key it needs at a textbook value; it also forces
  `vax_rollout` off when V is off. The only `_forms.bindDeps` dependency is V →
  auto-vaccinate rollout (`toggles.js`).
- Compartment availability is decided by toggles inside the tick, not hard-coded, and
  Z is an ordinary compartment behind a default-off toggle.
- The hex lattice is what gives clean isotropic wavefronts; shrink the grid rather than
  move to squares for speed.

## Open work

`docs/ROADMAP.md` is the plan. 2.1 brings immunity by antigenic distance and six
presets rebuilt as experiments; 3.0 is the game, a tactical reverse Plague Inc. When an
item lands, move it to the roadmap's Landed table and update this file.
`docs/VISION.md` holds the wider directions and the measurements behind them. The items
below are known gaps; 2.1 fixes the first four.

- Within-host competition is genome-blind: step 3's replicator update uses a strain's
  own load as its fitness (`src/dynamics.js:460`), so the incumbent always wins.
- Default-on `auto_quarantine` (instant, unlimited, omniscient tracing) makes the
  COVID-like and smallpox presets fizzle in 5 of 5 seeds (`tools/survey.mjs`).
- The rose counts E, R and D transitions only, so Z runs (oncoviral) leave it empty.
- A strain circulating only in animals is tombstoned until it spills back, because the
  extinction sweep skips `animal_strain`.
- `tick()` returns counters (`zFight*`, `animalBirths`, `autoQuarantined`, …) that
  nothing displays, and animal marks shade only by S/I/R/D.
- The plate's isochrone labels are upright; atlas labels often follow the line.
- Deferred ideas: per-strain vaccine efficacy or waning, M-cell breakthrough (would need
  its own efficacy parameter), a separate breakthrough count for Re, a barricade brush
  for the zombie reading, a cross-immunity matrix view.
