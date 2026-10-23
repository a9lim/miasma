# Miasma

Stochastic spatial epidemic simulator on a hex grid, public at a9l.im/miasma: SEIRD
plus vaccinated, maternal-immunity, and zombie compartments, multi-strain evolution,
an animal reservoir, painted interventions, and six surface topologies. Vanilla ES
modules and Canvas 2D, no dependencies and no build step of its own.
It is a submodule of the a9l.im repository (`a9lim.github.io`, at `projects/miasma`); the
root `AGENTS.md` covers the shared layer, design system, build, and deployment.

## Running and checking

Preview from the parent root (`npm run build`, serve `dist/`, open `/miasma/`). Append
`?seed=<string>` for a reproducible run: `src/prng.js` hashes it into the shared
`mulberry32`, which then drives the tick, animal seeding, mutation, and recombination.

```bash
node src/topology.test.mjs        # 4963 checks on the hex-quotient wrap
```

Run it after touching `wrap`, `neighbors`, `hexBounds`, or `inHex`. It covers bounds,
PLANE nulls, TORUS/CYLINDER adjacency symmetry and round-trip, RP² boundary coverage,
and an in-domain smoke test for Möbius and Klein.

HTML↔JS id contract (BSD/macOS-safe):

```bash
comm -3 \
  <(rg -No "getElementById\('([^']+)'" src main.js --replace '$1' | sed 's/.*://' | sort -u) \
  <(rg -No 'id="([^"]+)"' index.html --replace '$1' | sort -u)
```

The clean output is five lines: `brush-size-group` and `paint-mode-grid` (built by
`paint.js`) on the JS side, `canvas-controls`, `sim-container`, and `top-bar` (CSS-only
hooks) on the HTML side. Anything else is a broken lookup.

The dynamics modules import cleanly in Node for headless runs (`Grid` →
`initializeGrid` → `createRegistry(params)` → `tick`), but `strains.js` and `prng.js` call
the `/shared/utils.js` globals `gaussian` and `mulberry32`, so define those on
`globalThis` first. In the browser, `window.__miasma` exposes
`{ sim, params, toggles, history, tickOnce, strains, paint, PaintMode }`.

## Layout

```
index.html               page shell, SEO/JSON-LD, edu content, toolbar and sidebar markup
main.js                  init, rAF loop, DOM cache, reset/preset wiring, zoom/pan input, shortcuts
colors.js                --epi-* compartment colors over the shared palette
styles.css               project styles
src/config.js            enums (Compartment, Status, Flag, Animal, Topology, ViewMode), DEFAULTS, HEX_DIRS
src/grid.js              Grid (structure-of-arrays cell state), axial ↔ pixel math
src/initialization.js    applyHexMask, fresh human and animal seeding
src/topology.js          hex-quotient wrap for six surfaces, cached neighbor tables
src/dynamics.js          tick(): steps 1–9, buffer swap, transition counters
src/dynamics-animal.js   step 10: reservoir demography, animal SIR, spillover
src/dynamics-scratch.js  next-state buffers recycled between ticks
src/default-params.js    DEFAULT_PARAMS (sim-wide knobs plus the seed genome)
src/default-toggles.js   DEFAULT_TOGGLES
src/strains.js           registry, GENOME_FIELDS, mutation, recombination, bloom filter, tombstones
src/strain-extinction.js periodic tombstone sweep
src/presets.js           ten presets, applyPreset, preset dropdown
src/params.js            Advanced-parameters sliders (sim-wide) and STRAIN_GENOME_LAYOUT
src/toggles.js           compartment, flag, and automatic-response toggles; animal-display group
src/paint.js             paint controller (pointer events, brush, undo/redo, paint keys), Paint tab
src/camera.js            zoom/pan over the fit-to-canvas viewport
src/render.js            map rendering for six view modes, overlays, brush footprint
src/stats.js             census and observed Re (Counts tab)
src/timeseries.js        stacked-area chart at the top of the Counts tab
src/lineage.js           strain prevalence, Strains tab rows, lineage forest, genome editor
src/history.js           transition-count ring buffer for observed Re
src/prng.js              ?seed= RNG
src/ui.js                Settings-tab assembly, mode groups, about panel
src/topology.test.mjs    topology tests
```

## How it works

### Grid and state

Storage is a 120×120 axial rhombus of flat-top hexes, indexed `r * W + q`.
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

### UI and rendering

Sidebar tabs: Counts (`#tab-compartments`: chart, census, observed Re, animal census),
Strains, Paint (`#tab-interventions`), and Settings. `ui.js` assembles Settings as
presets, the Surface/Map view block (`#map-controls-section`), toggles, the
Advanced-parameters collapsible, and reset. The top-bar eye (`#viewmode-btn`) opens
Settings and scrolls to the map controls; it holds no state. Advanced parameters lists
only sim-wide knobs. Per-strain fields are edited in the Strains tab detail block
(`STRAIN_GENOME_LAYOUT`), which writes registry arrays directly, so edits to α are lost
when a reset or preset reseeds the registry from `params`.

`render(ctx, grid, mode, viewport, opts)` draws one fused fill-and-stroke pass over
`activeIndices`; its color cache rebuilds when `<html data-theme>` changes. EMPTY cells
draw nothing, so the page ground shows through and overlays cannot assume a backdrop.
Flag overlays appear only in compartment view; H and Q badges appear in compartment and
status views. `toggles.animalDisplay` is a string (`'dots' | 'only' | 'off'`) on the
otherwise boolean toggles object. The brush footprint is drawn on the canvas from
`paintController.getHoverFootprint()`, tinted with the target compartment's color
(`PAINT_ACCENT_VARS`).

In `colors.js`, D is `light.text` on the light theme and `dark.canvas` on the dark one
(a hole in the map), so anything using D as a foreground (stat row, toggle, cull brush
and button) swaps to `--text` in dark mode. I is a derived scarlet
(`_PALETTE.infected`) rather than `extended.red`, which sits within ΔE 2 of the dark
accent; data red and UI accent must not read as one color.

The loop in `main.js` runs `BASE_TICK_RATE` 10 × speed (0.25–4×), at most 16 ticks per
frame, and idle-stops when paused with nothing dirty; event handlers restart it with
`requestFrame()`. Each tick pushes transition counts to `history`, computes stats once
(`cachedStats` feeds both the census and the chart), and clears paint undo/redo so a
stroke can never rewind evolved state.

`camera.getEffectiveViewport()` returns one shared object, mutated on every call, that
both `render` and the paint controller's `getViewport` read; consumers read it
immediately and never retain it, and paint must get the effective viewport or clicks
miss at any zoom other than 1. Pinch suppresses painting through `setSuppressed`, pan
is unclamped (reset recovers), and opening the sidebar tweens `panX` above 900 px.

The paint controller owns every canvas pointer event; its default is seed mode with
brush 0, so a single tap seeds α. Each stroke is one snapshot entry (undo/redo depth
20). `paint.js` handles 1–6, `[`/`]`, and Ctrl/Cmd+Z/Y/Shift+Z itself; `main.js`
registers the other shortcuts with `initShortcuts` and lists the paint keys as
documentation-only entries (`when: () => false`) so the about panel shows them without
a second handler firing.

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
  `#timeseries-panel`, whose canvas context `initTimeseries` captures once.
- The transition history (200 ticks) and the chart (500 samples) are typed-array ring
  buffers, avoiding per-tick allocation and `shift()`.
- `#speed-btn` needs the `.speed-btn` class and an inner `<span class="speed-label">`;
  `_toolbar.updateSpeedBtn` writes the multiplier into that span.
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

- Möbius and Klein neighbor relations are not symmetric across the twisted edge pair
  (118 one-way edges at 120×120). Under RP², the 12 cells at the middle of the six hex
  edges each list one neighbor twice, and 6 of them list themselves. The tests only
  smoke-test these surfaces.
  `translateToHex` tries 9 lattice candidates, enough only for ±1 offsets.
- A strain circulating only in animals is tombstoned until it spills back, because the
  extinction sweep skips `animal_strain`.
- The theme toggle marks only the map dirty, so a paused chart keeps the old theme's
  colors until the next tick or tab switch.
- `tick()` returns counters (`zFight*`, `animalBirths`, `autoQuarantined`, …) that
  nothing displays, and animal dots color only by S/I/R/D.
- Deferred ideas: per-strain vaccine efficacy or waning, M-cell breakthrough (would need
  its own efficacy parameter), a separate breakthrough count for Re, a barricade brush
  for the zombie reading, a cross-immunity matrix view.
