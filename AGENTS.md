# Miasma

Stochastic spatial epidemic simulator on a hex grid, public at a9l.im/miasma: SEIRD
plus vaccinated, maternal-immunity, and zombie compartments, multi-strain evolution
with immunity by antigenic distance, an animal reservoir, painted interventions, and
four surfaces made by gluing the edges of a hexagonal world. It runs six presets, each
an experiment with one knob and a measured number. The map is drawn as a plate from an
epidemiological atlas.
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
node src/immunity.test.mjs        # 45 checks: antigenic torus, memory, σ, within-host selection, reclamation
```

Run the first after touching `topology.js` and the second after touching immunity,
strains, the sweep, or the tick's infection rolls. The topology test checks bounds, PLANE nulls, TORUS
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
`globalThis` first; `tools/*.mjs` show how. `tools/presets-survey.mjs` runs every
preset at its default knob across seeds (the facts under Presets below). In the browser,
`window.__miasma` exposes `{ sim, params, toggles, history, tickOnce, iso, plate,
strains, paint, PaintMode, setPlaying, openScene, applyScene, viewport }`;
`applyScene(presetObject)` applies any preset-shaped object, which is how a candidate
preset is screenshotted without editing `presets.js`.

## Layout

```
index.html               page shell, SEO/JSON-LD, edu content, colophon, plate figure, margin
main.js                  init, opening scene, rAF loop, DOM cache, reset/preset wiring, zoom/pan, shortcuts
colors.js                --epi-* compartment colors (the accent and inks) over the shared palette
styles.css               layout, hairline controls, census swatches drawn as the plate's marks
src/config.js            enums (Compartment, Status, Flag, Animal, Topology, ViewMode, MemoryKind), DEFAULTS, ANTIGENIC_SIZE, MEMORY_SLOTS, HEX_DIRS
src/grid.js              Grid (structure-of-arrays cell state), axial ↔ pixel math
src/initialization.js    applyHexMask, fresh human and animal seeding (animal_seed starts some infected)
src/topology.js          the four surfaces as edge gluings: slot table, edge isometries, cone points
src/dynamics.js          tick(): steps 1–9, buffer swap, transition counters
src/dynamics-animal.js   step 10: reservoir demography, animal SIR, spillover
src/dynamics-scratch.js  next-state buffers recycled between ticks
src/default-params.js    DEFAULT_PARAMS (sim-wide knobs plus the seed genome)
src/default-toggles.js   DEFAULT_TOGGLES
src/immunity.js          the antigenic torus (distance, midpoint) and per-cell memory: susceptibility, remember, forget
src/strains.js           registry (genome, antigen, lineage, generation), mutation, recombination, reclamation
src/strain-extinction.js periodic sweep: tombstone, reclaim dead branches, splice under pressure
src/strain-style.js      a strain's mark from its antigen: hatch angle × OKLCH hue
src/antigenic-map.js     Fig. 3, the antigenic map (Strains tab)
src/presets.js           six experiment presets, applyPreset, the experiment strip
src/params.js            Advanced-parameters sliders (sim-wide) and STRAIN_GENOME_LAYOUT
src/toggles.js           compartment, flag, and automatic-response toggles; animal-display group
src/paint.js             paint controller (pointer events, brush, undo/redo, paint keys), Paint tab
src/camera.js            zoom/pan over the fitted plate
src/isochrones.js        latest-wave arrival day per cell, smoothed, contoured and faded on the lattice
src/plate.js             the plate per frame: copies, edges, cone points, labels, title, cartouche, scale bar
src/gpu-plate.js         WebGPU: the lattice, its copies and isolines from a state texture
src/render.js            Canvas 2D fallback for the lattice (the same marks), plate geometry
src/histology.js         the Immunoediting preset as an H&E-stained section (Canvas; GPU mirrors it)
src/caption.js           the live figure caption and the Reference cartouche rows
src/rose.js              Nightingale's rose (Counts tab)
src/stats.js             census and observed Re (Counts tab)
src/lineage.js           strain prevalence, Strains tab (figures, rows, vaccine match), phylogeny, genome editor
src/history.js           per-tick ring buffer: transitions, spillovers, the Z census
src/prng.js              ?seed= RNG
src/ui.js                surface picker (glyphs), map view, Settings assembly, about panel
src/topology.test.mjs    topology tests
src/immunity.test.mjs    immunity, registry and sweep tests
tools/presets-survey.mjs the six presets at their default knobs across seeds
tools/survey.mjs         headless long runs: fates, strain composition, genome drift
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
(`strain_ids`, `0xFFFF` = empty; `strain_loads`), the immune memory (`mem_x`, `mem_y`,
`mem_kind`: up to `MEMORY_SLOTS` = 4 remembered antigens, oldest first, `mem_n` filled;
see Immunity below), and the reservoir layer `animal` / `animal_age` /
`animal_strain`. Active
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
params into strain α on every reset and preset apply, so changing a genome field in
`params` mid-run does nothing; the experiment strip's knob writes it onto every strain
(main.js `onKnob`). `z_exhaust_threshold` stays sim-wide because it is an integer
count. `season_amp` scales every human-to-human β by `1 + A·cos(2πt/365)`.

### Transmission and transitions

`pickIncomingStrain(i)` computes infection for one target. Sources are I (weight 1),
R+CARRIER (`c_transmit_mult`), and D+F_CORPSE (`f_transmit_mult`), times
`q_transmit_mult` for quarantined sources. Each edge's β is the load-weighted sum of the
source's strain β, each slot scaled by the target's susceptibility to that strain
(`suscTo`: its antigenic distance from what the target remembers; 1 for an empty
memory). The survival product gives pInf, which is then scaled for target quarantine and
age. On success a two-stage weighted pick (edge, then slot, both σ-weighted) chooses the
strain, and a mutation roll may register a mutant. R and V need no compartment
multiplier: their memory does the work, so an identical strain meets `1 − c` and a
drifted one almost a naive host.

Targets are S → E, R → E (reinfection), V → E (breakthrough, when `t.V`), and I cells
that stay I, which roll coinfection: the new strain enters at
`coinfection_load_delta`, evicting the lowest load when all four slots are full; a
strain already carried is skipped. Every →E counts in `sToE`, so observed Re includes
breakthroughs.

LATENT and CARRIER are set only on transitions: LATENT on any →E with the incoming
strain's `l_seed` (needs `t.L`), CARRIER on I → R with `c_seed` (needs `t.C`). Latent E
progresses at `l_reactivate` instead of σ. Without those rolls, `l_reactivate` and
`c_transmit_mult` do nothing.

I leaves at γ_eff + μ_eff, modified by H (`h_recover_mult`, `h_mortality_mult`), Q or
hospital overflow (`h_overflow_mortality_mult`, only while `t.auto_hospital`), age, and
health. Recovery remembers the antigen of every carried strain. A disease death gets F_CORPSE
when `t.F`; natural deaths, culls, and Z deaths never do. Plain D disposes to EMPTY at
`d_disposal`; F-corpses wait for F to decay first.

Births fill an EMPTY cell that has at least `birth_threshold` inhabited neighbors (not
D, Z, or EMPTY) with probability `1 − (1 − birth_rate)^k`. A uniformly picked parent
that is R, with `t.M` on, makes an M newborn carrying that parent's strain memory;
otherwise the newborn is S. A birth forgets the cell's memory.

The hospital pre-pass (`t.auto_hospital`) assigns H row-major to non-Q I cells up to
`floor(h_capacity_frac · active cells)` beds. Turning it off strips every H and removes the
overflow penalty. Auto-quarantine (`t.auto_quarantine`) traces I cells and living
neighbors of I cells into Q at `quarantine_trace_rate`, tags them AUTO_Q, and releases
them once they are neither case nor contact; painted Q carries no AUTO_Q and is never
released. Because transitions overwrite `nextFlags`, a provenance-restore pass re-marks
AUTO_Q on cells still in Q; without it, an auto-quarantined contact that got infected
would stay quarantined forever. Vaccination rollout (`t.V && t.vax_rollout`) moves
S/E/R/M to V at `vax_rollout_rate`, clearing slots, flags, and status, remembering the
vaccine's antigen (`vax_ag_x`, `vax_ag_y`) and keeping the rest of the memory; I and Z
are not eligible. `vax_coverage` is separate: random coverage given when the world is
built (main.js `applyCoverage`, before the opening's seeds).

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

The same state machine supports two readings, shipped as presets: `zombie-apocalypse`
(F-corpse spawn, fighting, finite lifespan, the living breeding back) and
`immunoediting` (latent spawn, no fighting outcomes, immortal transformed cells, clonal
conversion, crowding necrosis, tissue regrowing into cleared cells). It is
parameterized rather than mode-switched because the math is identical. Note that
`z_die_fighting` rolls per encounter with a living neighbor, so only a tumour's rim is
surveilled and its interior is shielded.

### Animal reservoir

`dynamics-animal.js` runs 10a aging, 10b births (a VOID cell with at least
`animal_birth_threshold` live animal neighbors becomes S), 10c SIR plus spillover, and
10d age-ramped mortality. Each sub-step reads the start-of-tick `animal`, so a 10b
newborn is inert in 10c and 10d, and a 10c death is not recounted in 10d. There is no
toggle: `animal_density: 0` seeds no animals and births never start. The default is
0.12, with `animal_seed` (0.005) of them infected at the start; among presets only
Spillover keeps a reservoir, and seeds 5% infected so it starts where the disease
lives. A reservoir that burns through its animals dies out: a self-sustaining one needs
chronic animal infection and turnover (Spillover: recovery 0.01 a day, lifespan about
800 days).

Animal β/γ/μ are per strain, looked up through `animal_strain`. Every animal S → I
write sets `animal_strain`, and recovery, death, disposal, and birth reset it to
`EMPTY_STRAIN`; otherwise the lookup silently falls back to `params`. Spillover is
co-located (same cell index): an infectious animal can expose a susceptible human with
its own strain (`spillover_rate`, scaled by the human's susceptibility to it), and an infectious human can
infect a susceptible animal with its slot-0 strain (`reverse_spillover_rate`).
Animal-to-animal spread runs over neighbors and reservoir-samples the source strain.

### Immunity

Every strain has an antigenic position (`ag_x`, `ag_y`) on a square torus
`ANTIGENIC_SIZE` = 8 antigenic units (AU) around (`immunity.js`); distance is the
shortest way round, so drift never runs off the map and can come back to old antigens.
One AU is the distance at which cross-immunity falls by 1/e. A cell remembers up to four
antigens (by infection or vaccine; a new one within 0.1 AU of a remembered one of the
same kind refreshes it, and when full the oldest is dropped). Its susceptibility to a
strain is `σ = 1 − max_k c_k · exp(−d_k)`, with `c` = `immunity_strength` for an
infection memory and `vax_efficacy` for a vaccine memory. σ scales every infection roll
on a target with memory (reinfection, breakthrough, coinfection, spillover). Textbook
SEIR without reinfection is `immunity_strength: 1` and `ag_step: 0`.

Within a coinfected host (step 3), load follows replicator dynamics on fitness
`f = β · σ_host`: a more transmissible strain, or one escaping what this host
remembers, gains load, and at equal fitness nothing changes (no incumbent advantage).

The vaccine has an antigen (`vax_ag_x`, `vax_ag_y`, α's by default) that the vaccinate
brush and the rollout write into memory, so a drifted strain meets reduced vaccine
efficacy. The Strains tab's "Match the vaccine to …" sets it to the selected (or
dominant) strain's position.

### Strains

The registry (`strains.js`) is plain arrays. IDs are Uint16 (`MAX_STRAINS` 65535,
`0xFFFF` reserved as empty). Names follow a monotone birth serial (α…ω, then α1…ω1), so a
reused id never repeats an old name; `gen` counts generations from α (a recombinant
takes its deeper parent's) and survives splicing. α (id 0) is the paint seed and the
spillover fallback, and is never tombstoned. Mutation applies multiplicative Gaussian
noise (`mutation_strength`; 0 means none) per genome field, clamped to the field's
range, so a field at 0 stays 0 down the lineage, and takes an antigenic step in a
uniformly random direction: length exponential with mean `ag_step` AU, or a 2 AU jump
with chance `ag_jump`. Recombination (step 3, coinfected I cells) averages two parents
with range-scaled noise, puts the antigen at their short-way midpoint, and records both
(`parent`, `parents2`; `getStrain` exposes the second as `parent2`). Recombination's
noise lets selection inflate β, which is why the drift preset turns it off.

`runExtinctionSweep` runs every 30 ticks: strains absent from every human strain slot
(memory slot 0 included) and every `animal_strain` are tombstoned, and a tombstoned
strain that reappears is restored. A tombstoned strain that no living strain descends
from (through either parent) is then reclaimed and its id reused; cells remember
antigens, not ids, so nothing points at it. Above `SPLICE_ABOVE` (16,384) slots the sweep
also splices dead single-line ancestors out of `parent`, keeping about three slots per
living strain however long the run; below it the whole descent is kept, so the antigenic
map can draw the trunk's path.

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
plus and Q a cordon (hex outline, indigo). The strain view hatches each carrier with its
dominant strain's mark, which is its antigen drawn directly (`strain-style.js`): `ag_x`
turns the hatching through 180° and `ag_y` walks the hue once around an OKLCH wheel, so
antigenically close strains look alike, drift reads as a turning hatch and a drifting
colour, and a jump as a new colour. The wheel is fitted like the inks (light L 0.525
C 0.08, dark L 0.62 C 0.10; every hue clears 4.5:1 on canvas and panel); α sits
opposite the accent's hue, and the wheel hurries through the accent with its chroma
dipping there, so no strain reads as the disease. Age, health and immunity are
single-ink ramps in eight steps; the immunity view shades each cell's protection
against the strain selected in the Strains tab (else the dominant one; main.js
`immunityTarget`). The status view mutes all but H and Q. Animals are small triangles
off the cell center. The Immunoediting preset (`sim.presetKey`) draws the lattice as an
H&E section (`histology.js`).

Isochrones: `isochrones.js` stamps each cell with the tick it last became E, I or Z. A
cell that was not E/I/Z at the previous `record` and is now is stamped if it never was or
its stamp is at least `REARRIVE_GAP` (32 days) old, so a cell exposed again by a later
wave takes that wave's day, while one still passing through the same wave keeps its own
(`was` tracks the previous record). `latest` is the newest stamp, and cells the wave has
not reached read `latest + 6`. `build` smooths the field by neighbor averaging over the
surface's own neighbor table (so it is continuous across glued edges), mixing only
neighbors within `CLIFF` (24 days) of a cell's own value so an old wave's stamps and a new
wave's stay sharp, and contours it every 8 days by marching triangles on the cell-center
lattice. A triangle whose corners span more than `CLIFF_SPAN` (32 days) is skipped: where
a new wave meets old stamps the field jumps by hundreds of days, and contouring it would
stack a line for every level. A contour is drawn at its base opacity times
`isoFade(latest − level)`, a quadratic ramp from 1 down to `FADE_FLOOR` (0.12) over
`FADE_DAYS` (420), so the plate keeps the newest waves and lets old ones go. The clock is
`latest`, not the tick: once an outbreak ends nothing fades further. The fade and the
cliff rule run per pixel on the GPU (uniform 43; the shader tests the same triangle span
the CPU does) and per level in `drawContours`, so the two paths agree. Segments feed the
label placement and the Canvas renderer, and a padded copy of the field (one cell past
every edge, read through the gluing) feeds the GPU, which draws the isolines per pixel
with their analytic gradient. On each labeled level `runLen[k]` is the length in cells of
the connected line segment `k` belongs to (endpoints joined by union-find).

Each frame `plate.js` composes: the lattice (WebGPU: `gpu-plate.js`, one full-screen
pass; each pixel finds its cell, through the inverse edge isometry on a faded copy, and
draws the marks procedurally in the world's frame, so hatching runs on unbroken and is
mirrored on a mirrored copy), then on the 2D canvas above it the edges (thin rule with
one, two or three chevrons per glued pair, agreeing for a translation and opposed for a
twist; a heavy rule with hachures for a shore), cone-point circles with their angles, the
title (top right; one plate numeral per view), the Reference cartouche (bottom left;
rows from `caption.js`), the scale bar (cells; µm on the slide) and the isochrone labels
(every 24 days, only while the level's fade is at least 0.5 and on lines at least 6 cells
long, so a spillover-driven run's small loops carry no number; the text is drawn at the
fade, and labels are collision-checked against each other and the furniture). Without WebGPU
(or with `?canvas2d`), `render.js` draws the same marks into an offscreen tile once per
change and `plate.js` blits it, and its copies through `destination-in` fading. The
GPU state texel is `x` compartment, `y` flags | status << 4, `z` animal | (hatch angle
code + 1) << 3 (31 angles), `w` the ramp value or, in the strain view, the hue byte; the
shader computes the same OKLCH wheel from `wheelParams()` (uniforms 21–22). The Canvas
path bins marks to 31 angles × 32 hues and hatches each bin within its bounds. Measured at the default grid mid-outbreak, the Canvas tile
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
(speed, reset, undo, redo, map view, hide), the experiment strip (`presets.js`
`buildExperimentStrip`: the preset picker, which applies on choice, with Sandbox for the
defaults; the preset's one knob; its line of description), and four tabs: Counts
(Nightingale's rose, census, observed Re, reservoir census), Strains (Fig. 3 the
antigenic map with "Match the vaccine to …", Fig. 4 the phylogeny, top strains, genome
editor), Paint, and Settings (map view, toggles, advanced parameters). The zoom cluster
sits at the plate's top left. `ui.js` assembles the strip and Settings and returns
`{ resetUI, showAbout, showPreset }`.

The page opens on a living frame: `openScene` applies `OPENING_PRESET` (Threshold on
the torus, or the `?mi=` surface), seeds two cases (one near a glued edge), warms up for
the preset's `warmup` (200 days), and plays; under reduced motion it warms up 120 days
longer and stays paused. Applying a preset (`applyScene`) rebuilds the world, gives
`vax_coverage`, and seeds the same two cases, so the plate is never empty. Reset
restarts the running experiment with its knob where it is; in the Sandbox it restores
every default. A knob on a genome field writes that rate onto every strain live; a knob
marked `reset` (coverage) re-applies the preset.

The figure caption carries the running preset's measured sentence (`caption.js`
`presetMeasure`, from `measureCtx()` in main.js) in place of the surface note.

The antigenic map (`antigenic-map.js`) draws the torus as a square centred on α, its
glued edges marked like the plate's (one chevron left and right, two top and bottom,
pointing the same way), its ground the key of marks (each place hatched and tinted as a
strain there would be), the 1 AU graticule, living strains as hatched hexagons sized by
prevalence, the ancestors the registry keeps as dots, the dominant strain's descent as
the trunk (segments drawn the short way round), and the vaccine's antigen as a cross
ringed at 1 AU. It redraws at most every 250 ms unless its signature changes.

Nightingale's rose (`rose.js`, behind the old chart's `initTimeseries` API) counts
exposures, recoveries and deaths per ten-day wedge from the tick's transition counts,
overlaid from the center, plus arrivals in Z (`dToZ + iToZ + lToZ + zInfect`) in the
plate's sap, wide cross-hatching over a tint, when the current rose holds any (the
caption then names them); a rose is 120 days, and the previous 120 are a dashed
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
- The history (200 ticks) is a typed-array ring buffer of transitions, spillovers and
  the Z census, with `sum(key, n)` and `ago(key, n)`.
- `#speed-btn` carries an inner `<span class="speed-label">` that `main.js` writes.
- Inside the scene, an effect ships only if it reads a quantity in the model, and every
  state is a pattern before it is a color (root AGENTS.md, "Inside the scene"). The red
  is the disease alone; interventions are inks.
- The plate never re-fits as text changes: the caption is a fixed three-line block
  (two on phones), and the frame is measured only on resize.
- Defaults are a showcase (the Sandbox): `DEFAULT_PARAMS` avoids 0 and 1 so every
  mechanic is visible, and Z is off. `applyPreset` resets params and toggles to the
  defaults before merging, so a preset must set every key it needs and turn off what its
  experiment doesn't use (`QUIET_TOGGLES`, `NO_ANIMALS`, `NO_DEMOGRAPHY`, `NO_EVOLUTION`
  in `presets.js`); it also forces `vax_rollout` off when V is off. The only
  `_forms.bindDeps` dependency is V → auto-vaccinate rollout (`toggles.js`).
- A preset earns its place as an experiment: one knob, a phenomenon to look for, a
  measured number in the caption, a predicted number where theory gives one, and a
  survey across at least ten seeds before it ships (`docs/ROADMAP.md` §2.3).
- Compartment availability is decided by toggles inside the tick, not hard-coded, and
  Z is an ordinary compartment behind a default-off toggle.
- The hex lattice is what gives clean isotropic wavefronts; shrink the grid rather than
  move to squares for speed.

## Presets

Six experiments (`presets.js`); each preset's comment records the calibration behind
its values. `tools/presets-survey.mjs` reproduces the facts below (ten seeds, 3,000 days,
the default knob, the opening's two seeds).

| Preset | Knob (default) | Measured in the caption | Ten seeds, 3,000 days |
|---|---|---|---|
| Threshold (opening) | β (0.11, 1.8× critical) | β against the critical β (≈ 0.061, independent edges); share of cells reached | takes off 10/10, peak 501 E+I, ends by day 575, reaches 97% |
| Herd immunity | coverage (0.48, reset) | coverage against the lattice threshold (near 50%) and 1 − 1/R₀ (82%); share of the unvaccinated reached | peak 157, ends by day 1,167, reaches 73% of the unvaccinated |
| Antigenic drift | antigenic step (1.2 AU) | the leading strain's distance from α along its descent, per year; carriers' mean generation | never ends (0/20 in calibration), peak 2,071, 64 living strains at the end, waves locked to the season |
| Spillover | spillover rate (0.02) | human-to-human Re over 30 days; reservoir share of human cases | never ends, human Re 0.38, 62% of human cases from the reservoir |
| Immunoediting | surveillance (0.29) | transformed-cell trend over 100 days | 401 transformed cells at day 1,000, 668 at the end; escape at ≤ 0.25, elimination at ≥ 0.35 |
| Zombie apocalypse | fight-back (0.06) | zombie trend over 100 days against the living | 1,395 zombies at day 1,000, 1,195 at the end; burns out in 3/10 |

## Open work

`docs/ROADMAP.md` is the plan; 2.1 landed on 2026-10-24 and 3.0 is the game, a tactical
reverse Plague Inc. When an item lands, move it to the roadmap's Landed table and update
this file. `docs/VISION.md` holds the wider directions and the measurements behind them.

- The default-on `auto_quarantine` is instant, unlimited and omniscient (it sees every
  true case); the presets turn it off, and 3.0's budgets and reports replace it.
- The drift preset's lineages diffuse from α in every direction rather than along a
  canalized trunk: on a nearest-neighbour lattice competition is local, so lineages in
  different regions coexist. Long-range mixing (`docs/VISION.md`, A) would globalize it.
- `tick()` returns counters (`zFight*`, `animalBirths`, `autoQuarantined`, …) that
  nothing displays, and animal marks shade only by S/I/R/D.
- The plate's isochrone labels are upright; atlas labels often follow the line.
- Deferred ideas: per-strain vaccine efficacy or waning, M-cell breakthrough (would need
  its own efficacy parameter), a separate breakthrough count for Re, a barricade brush
  for the zombie reading, a cross-immunity matrix view.
