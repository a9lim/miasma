# Miasma

Stochastic spatial epidemic simulator on a hex grid, public at a9l.im/miasma: SEIRD
plus vaccinated, maternal-immunity, and zombie compartments, multi-strain evolution
with immunity by antigenic distance, an animal reservoir, painted interventions, and
four surfaces made by gluing the edges of a hexagonal world. It runs six presets, each
an experiment with one knob and a measured number. The map is drawn as a plate from an
epidemiological atlas.
Vanilla ES modules; the lattice renders in WebGPU only (a browser without it sees a
notice on the plate, and the margin's figures still run); no dependencies and no build
step of its own. It is a submodule of the a9l.im repository
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
`?view=<view mode>` opens on a view; `?r=<radius>` opens on a world of that radius
(16–239; the Experiments tab offers 59, 89, 119 and 179).
`docs/sim-overhaul/check.mjs` screenshots the page headless (Chrome for Testing with
WebGPU on) and reports console errors, overflow and frame rate.

```bash
node src/topology.test.mjs        # 2510 checks: gluing, χ, orientability, cone points
node src/immunity.test.mjs        # 72 checks: antigenic torus, memory, σ, within-host selection, reclamation, the coinfected host as a mixture and as drawn
```

Run the first after touching `topology.js` and the second after touching immunity,
strains, the sweep, the tick's infection rolls, or how an I cell reads its strains. The topology test checks bounds, PLANE nulls, TORUS
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

The clean output is two lines, both on the HTML side: `sim-container` (a CSS hook) and
`tab-experiments` (found by `shared/tabs.js` from its button's `data-tab`). Anything
else is a broken lookup.

The dynamics modules import cleanly in Node for headless runs (`Grid` →
`initializeGrid` → `createRegistry(params)` → `tick`), but `strains.js` and `prng.js` call
the `/shared/utils.js` globals `gaussian` and `mulberry32`, so define those on
`globalThis` first; `tools/*.mjs` show how. `tools/presets-survey.mjs` runs every
preset at its default knob across seeds (the facts under Presets below).
`tools/bench.mjs [presets] [radii] [ticks] [seed]` times the tick, the census, the
isochrone stamps and build per preset and radius, and prints a fingerprint of the
final state: a refactor meant to keep behavior keeps every fingerprint. In the browser,
`window.__miasma` exposes `{ sim, params, toggles, history, tickOnce, iso, plate,
strains, paint, PaintMode, setPlaying, openScene, applyScene, viewport }`;
`applyScene(presetObject)` applies any preset-shaped object, which is how a candidate
preset is screenshotted without editing `presets.js`.

## Layout

```
index.html               page shell, SEO/JSON-LD, edu content, colophon, plate figure and its tools, margin
main.js                  init, opening scene, rAF loop, DOM cache, reset/preset wiring, zoom/pan, shortcuts
colors.js                --epi-* compartment colors (the accent and inks) over the shared palette
styles.css               layout, hairline controls, census swatches drawn as the plate's marks
src/config.js            enums (Compartment, Status, Flag, Animal, Topology, ViewMode, MemoryKind), DEFAULTS, ANTIGENIC_SIZE, MEMORY_SLOTS, HEX_DIRS
src/grid.js              Grid (structure-of-arrays cell state), axial ↔ pixel math
src/initialization.js    applyHexMask; seedPopulation: steady-state ages for people and animals, the reservoir (animal_seed starts some infected)
src/topology.js          the four surfaces as edge gluings: slot table, edge isometries, cone points
src/dynamics.js          tick(): steps 1–9, buffer swap, transition counters
src/dynamics-animal.js   step 10: reservoir demography, animal SIR, spillover
src/dynamics-scratch.js  next-state buffers, stamps and index lists recycled between ticks
src/default-params.js    DEFAULT_PARAMS (sim-wide knobs plus the seed genome)
src/default-toggles.js   DEFAULT_TOGGLES
src/immunity.js          the antigenic torus (distance, midpoint) and per-cell memory: susceptibility, remember, forget
src/strains.js           registry (genome, antigen, lineage, generation), mutation, recombination, reclamation, a coinfected host as a mixture
src/strain-extinction.js periodic sweep: tombstone, reclaim dead branches, splice under pressure
src/strain-style.js      a strain's mark from its antigen (hatch angle × OKLCH hue), the marks a carrier's strains make
src/antigenic-map.js     Fig. 3, the antigenic map (Strains tab)
src/presets.js           six experiment presets, applyPreset, the theory their knobs are ticked with, the list of plates, the knob
src/params.js            the params object, STRAIN_GENOME_LAYOUT, the slider row (Model tab, genome editor)
src/model.js             the Model tab: Fig. 5, the compartment diagram, and each part's switches and sliders
src/toggles.js           the toggles object and the switch row
src/paint.js             paint controller (pointer events, brush, undo/redo, paint keys), the brush rail
src/camera.js            zoom/pan over the fitted plate
src/isochrones.js        latest-wave arrival day per cell, smoothed, contoured and faded on the lattice
src/isochrones-worker.js the isochrone build off the main thread
src/plate.js             the plate per frame: theme, fit, then over the lattice the edges, cone points, labels, title, cartouche, scale bar
src/gpu-plate.js         WebGPU: the lattice, its copies and isolines from a state texture, every mark
src/histology.js         the Immunoediting preset as an H&E-stained section: what its marks read, its Reference rows
src/caption.js           the live figure caption and the Reference cartouche rows
src/rose.js              Nightingale's rose (Counts tab)
src/stats.js             census and observed Re (Counts tab)
src/lineage.js           strain prevalence, Strains tab (figures, rows, vaccine match), phylogeny, genome editor
src/history.js           per-tick ring buffer: transitions, spillovers, the Z census
src/prng.js              ?seed= RNG; rare per-cell rolls by skipping
src/ui.js                wires the controls: view picker, surface glyphs, world, plates, knob, Model, rail, about
src/topology.test.mjs    topology tests
src/immunity.test.mjs    immunity, registry and sweep tests
tools/presets-survey.mjs the six presets at their default knobs across seeds
tools/bench.mjs          per-tick cost by preset and radius, with state fingerprints
tools/survey.mjs         headless long runs: fates, strain composition, genome drift
tools/threshold.mjs      final-size sweep through the lattice epidemic threshold
docs/ROADMAP.md          the plan: 2.1 (antigenic immunity, six experiment presets), 3.0 (the game)
docs/VISION.md           ideation draft: strengths, gaps, directions, measured evidence
```

## How it works

### Grid and state

Storage is a (2R + 2)-square axial rhombus of hexes (pointy-top on screen: `x = √3·(q + r/2)`, `y = 1.5·r`), indexed `r * W + q`.
`applyHexMask` (`initialization.js`) carves out the inscribed regular hexagon (radius R,
3R(R + 1) + 1 cells) and writes `grid.activeIndices`; cells outside it are permanent
`Compartment.EMPTY` / `Animal.VOID` padding. Hot loops iterate `activeIndices`, and
compartment counts over it always sum to `grid.activeCount`. `topology.hexBounds`
recomputes the same center and radius independently, so the two formulas must agree.
R is 89 by default (180×180 storage, 24,031 cells, `DEFAULTS.R`; 59 and 10,621 cells
until 2026-10-25); the Experiments tab's World row offers `WORLD_RADII` (59, 89, 119, 179: 10,621 to
96,661 cells) and `?r=` any radius in `WORLD_R_RANGE`. Everything sized by the world
reads `hexBounds`; the opening's seeds (`OPENING_SEEDS`) are offsets on the default
world and scale by R / `DEFAULTS.R` (on the 59 world they round to the old (30, −42) and
(−24, 10)), and the closest zoom shows a cell as large as the 59 world does at 3×,
whatever the world.

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

`tick()` uses simultaneous update for the fields a cell reads off its neighbours
(compartment, flags, status, the strain slots, the animal and its strain): it reads the
start-of-tick arrays, writes scratch copies, and swaps them onto the grid at the end,
recycling the old arrays as the next scratch set (`dynamics-scratch.js`). The fields
only a cell's own update reads (age, health, the immune memory, the animal's age) are
written in place after that read; age advances in the last pass. A new per-cell field
read by a neighbour needs a scratch buffer, the copy-in and the swap; one read only by
its own cell is written in place, after its last read.

Order (step numbers match the comments in `dynamics.js`): Pass A, one sweep of the
start-of-tick state (transmitting cells stamp their neighbours in `near`, the I cells
are listed in row-major order, stale H is stripped, AUTO_Q cells are listed, animals
are counted) → 6 hospital allocation over the I list → Pass B, each cell's own update
in row-major order: 2 births into an EMPTY cell; for an I cell 3 within-host
competition, pruning and recombination, 5 leaving I or coinfection, 7 health; 4
transmission into S, R and V, only where `near` is stamped (a cell with no source beside
it would roll nothing); the rest of 5; then 7.6's provenance restore, and a cell whose
next compartment is I stamps itself and its neighbours as contacts → 7.5 vaccination
rollout → 7.6 auto-quarantine over the contacts and the AUTO_Q cells → 8 age mortality
→ 9 Z → 10 animals → 1 age, in place, counting Z (`zPop`) → swap → extinction sweep.
Later steps overwrite `next`: Z overwrites everything before it, step 8 skips cells
already D or EMPTY so an age-out is not double-counted, 7.5 and 7.6 read `next` so a
same-tick recovery is eligible, and animals run after Z so spillover respects Z
conversions.

A rare roll made at every cell (7.5's rollout, 8's mortality, the reservoir's
mortality) is drawn by skipping (`prng.js` `nextSuccess`): the gap to the next success
is geometric, and an age-dependent rate is thinned from the highest rate any age has,
so each cell keeps exactly its own chance at one draw per success. The single-pass
order (2026-10-25) draws the RNG in a different order than before, so a `?seed=` run
differs from one made earlier; 24 and 48 seeds per side against the old order found no
difference beyond noise.

Most rates are per strain. The 26 `GENOME_FIELDS` (β σ γ μ, the maternal and flag
rates, the Z rates, health impact, and animal β/γ/μ) live in registry arrays, and the
tick reads them off a cell's slot-0 strain through the `*Of(i)` resolvers, falling back
to `params` only when there is no strain. A coinfected I cell (two strains or more, or
its one strain outside slot 0: `isMixed`) is read instead as a mixture of its strains
(Coinfection below). `createRegistry(params)` copies the current
params into strain α on every reset and preset apply, so changing a genome field in
`params` alone does nothing mid-run; the knob and the Model tab write it onto every
strain (main.js `setGenome`). `z_exhaust_threshold` stays sim-wide because it is an integer
count. `season_amp` scales every human-to-human β by `1 + A·cos(2πt/365)`.

### Transmission and transitions

`pickIncomingStrain(i)` computes infection for one target and returns the picked strain,
or −1 when the roll fails; it memoizes the target's σ per strain for the call. Sources are I (weight 1),
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

I leaves at γ_eff + μ_eff (a coinfected cell's γ and μ are its mixture's), modified by H (`h_recover_mult`, `h_mortality_mult`), Q or
hospital overflow (`h_overflow_mortality_mult`, only while `t.auto_hospital`), age, and
health. Recovery remembers the antigen of every carried strain. A disease death gets F_CORPSE
when `t.F`; natural deaths, culls, and Z deaths never do. Plain D disposes to EMPTY at
`d_disposal`; F-corpses wait for F to decay first.

Births fill an EMPTY cell that has at least `birth_threshold` inhabited neighbors (not
D, Z, or EMPTY) with probability `1 − (1 − birth_rate)^k`. A uniformly picked parent
that is R, with `t.M` on, makes an M newborn carrying that parent's strain memory;
otherwise the newborn is S. A birth forgets the cell's memory.

Age counts days. Step 1 adds one to every cell occupied at the start of the tick and
still occupied; a cell that was or becomes EMPTY reads 0, so a newborn starts at 0. Three
things read it, all through `aN = min(1, age / mortality_max_age)` (old age, the Model
tab's "Old age, days"): step 8's natural death, linear from `mortality_baseline` at
birth to `mortality_age_max` at old age and flat after; susceptibility, × `1 +
(age_susceptibility_mult − 1)·aN` on every human-to-human roll (spillover ignores age);
and μ on leaving I, × `1 + (age_severity_mult − 1)·aN`. At the defaults old age (4,500
days) lies far past the mean life (1,030 days; 2 in 100,000 live to it), so across the
population the two multipliers average about 1.06–1.10 and 1.13–1.19, not 1.6 and 2.2.
A new world starts at the steady state of the natural-death rates (`initialization.js`
`steadyAge`: the share alive at age a is the chance of surviving to it), not as one
newborn cohort that would die off together around day 1,000. Where nothing dies there
is no steady state: everyone starts at 0 and no draw is made, so the four presets
without natural death keep their fingerprints. The reservoir does the same with its own
rates (10d).

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
new Z carries its source strain at slot 0 with load 1 (from a coinfected I cell, one
drawn by load × `dz_alive`), and every Z rate reads off that strain. L → Z lives in step 9 rather than step 5 so the "Z wins" overwrite applies to it.

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

`dynamics-animal.js` runs 10b births (a VOID cell with at least
`animal_birth_threshold` live animal neighbors becomes S) and 10c SIR plus spillover in
one pass, then 10d age-ramped mortality (by skipping), then 10a aging in place. A sweep
first scatters each living animal into its neighbours' counts for 10b and stamps the
neighbours of infectious animals, so a susceptible animal looks for a source only where
there is one. Each sub-step reads the start-of-tick `animal`, so a 10b newborn is inert
in 10c and 10d, and a 10c death is not recounted in 10d. There is no toggle:
`animal_density: 0` seeds no animals and births never start, and with no animal alive
(Pass A counts them) the step returns at once. The default is
0.12, with `animal_seed` (0.005) of them infected at the start; among presets only
Spillover keeps a reservoir, and seeds 5% infected so it starts where the disease
lives. A reservoir that burns through its animals dies out: a self-sustaining one needs
chronic animal infection and turnover (Spillover: recovery 0.01 a day, old age at 800
days, a mean life of about 415).

Animal β/γ/μ are per strain, looked up through `animal_strain`. Every animal S → I
write sets `animal_strain`, and recovery, death, disposal, and birth reset it to
`EMPTY_STRAIN`; otherwise the lookup silently falls back to `params`. Spillover is
co-located (same cell index): an infectious animal can expose a susceptible human with
its own strain (`spillover_rate`, scaled by the human's susceptibility to it), and an infectious human can
infect a susceptible animal with its strain, one drawn by load when it carries several
(`reverse_spillover_rate`).
Animal-to-animal spread runs over neighbors; on infection the strain comes from one of
the transmitting neighbours, uniformly.

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
efficacy. The Strains tab's "Match vaccine to …" sets it to the selected (or
dominant) strain's position.

### Coinfection

An I cell that stays I rolls for another strain through the same `pickIncomingStrain`
as a first infection. A strain it already carries is skipped; a new one takes an empty
slot, or evicts the lowest load, entering at `coinfection_load_delta` while the others
scale down to make room. Memory is written only on recovery, so the infection a host
carries gives it no cross-protection: only the same id is refused. Competition and
pruning are step 3 (Immunity above), recombination is under Strains.

Every other read of a coinfected I cell treats it as a load-weighted mixture of
single-strain hosts (`strains.js` `hostMean`, `hostPick`). Its γ, μ, health damage,
`c_seed` and `dz_alive` are its strains' means by load (the health multiplier by load ×
μ, `c_seed` by load × γ, so each outcome's chance is exactly the mixture's). An outcome
that keeps one strain credits it in proportion to load × the rate behind the outcome: an
F-corpse keeps a strain by μ × its health factor, a carrier by γ × `c_seed`, a new Z by
`dz_alive`, and an animal infected by reverse spillover by load alone. The pick reuses
the uniform that rolled the outcome (u / p), so a mixed cell draws no more often than a
single-strain one. Transmission and the prevalence census already weight by load, and the
strain view draws every strain by load (Rendering: the plate), so no read of an I cell
depends on the slot a strain sits in.

A cell whose one strain sits at slot 0 takes the slot-0 resolvers unchanged, and
`hostMean` returns a value its strains share exactly, so a run whose strains share one
genome reads as it did when only slot 0 counted: every preset keeps its
`tools/bench.mjs` fingerprints (five never mutate, and drift mutates only the antigen).
In the Sandbox, where mutation varies every rate, the mixture changes the run (a new
fingerprint) but not its statistics. Over 100 seeds of 3,000 days on the default world
(2026-10-27), no measure differed from reading slot 0 alone: peak, deaths, case
fatality, coinfections, carriers, F-corpses, living strains, and the carriers' mean β,
γ, μ and `c_seed` (every rank-sum p above 0.05). Coinfection is rare on the lattice,
under 1% of infected cell-days, because neighbours mostly carry the same lineage.

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
plus and Q a cordon (hex outline, indigo). The strain view hatches each carrier with the
mark of every strain it holds (`strain-style.js` `strainMarks`), each strain's tint and line
width its load's share of a whole carrier's, the lightest drawn first; under a device
pixel a line's width turns to opacity, two strains with the same mark merge, and two at
one angle interleave rather than overprint. A coinfected cell therefore carries no more
ink than a single-strain one, and since neighbours mostly carry one lineage, coinfected
cells draw the seams where lineages meet; the caption counts them and the cartouche
gains a row while there are any. A strain's mark is its antigen drawn directly (`strain-style.js`): `ag_x`
turns the hatching through 180° and `ag_y` walks the hue once around an OKLCH wheel, so
antigenically close strains look alike, drift reads as a turning hatch and a drifting
colour, and a jump as a new colour. The wheel is fitted like the inks (light L 0.525
C 0.08, dark L 0.62 C 0.10; every hue clears 4.5:1 on canvas and panel); α sits
opposite the accent's hue, and the wheel hurries through the accent with its chroma
dipping there, so no strain reads as the disease. Age, health and immunity are
single-ink ramps in eight steps; the immunity view shades each cell's protection
against the strain selected in the Strains tab (else the dominant one; main.js
`immunityTarget`). The status view mutes all but H and Q. Animals are small triangles
off the cell center. The Immunoediting preset (`sim.presetKey`) reads the lattice as
tissue: its State view is an H&E section (`histology.js`, main.js `histology()`), its
other views draw as everywhere, and its scale bar is in µm whatever the view (`tissue()`).

Isochrones: `isochrones.js` stamps each cell with the tick it last became E, I or Z. A
cell that was not E/I/Z at the previous `record` and is now is stamped if it never was or
its stamp is at least `REARRIVE_GAP` (32 days) old, so a cell exposed again by a later
wave takes that wave's day, while one still passing through the same wave keeps its own
(`was` tracks the previous record). `latest` is the newest stamp, and cells the wave has
not reached read `latest + 6`. `build` smooths the field by neighbor averaging over the
surface's own neighbor table (so it is continuous across glued edges), mixing only
neighbors within `CLIFF` (24 days) of a cell's own value so an old wave's stamps and a new
wave's stay sharp, and contours the levels a label can sit on (below) by marching
triangles on the cell-center lattice; the shader draws a line every 8 days from the field
itself. A triangle whose corners span more than `CLIFF_SPAN` (32 days) is skipped: where
a new wave meets old stamps the field jumps by hundreds of days, and contouring it would
stack a line for every level. A contour is drawn at its base opacity times
`isoFade(latest − level)`, a quadratic ramp from 1 down to `FADE_FLOOR` (0.12) over
`FADE_DAYS` (420), so the plate keeps the newest waves and lets old ones go. The clock is
`latest`, not the tick: once an outbreak ends nothing fades further. The build
(`buildContours`) is pure and runs in `isochrones-worker.js`: main.js keeps `record`
(O(cells) per tick) and, when a build is due (every four ticks while the field
changes), posts the arrival field and the compartments, one build at a time; the
result (the padded field and the segments, transferred) lands a frame or two later and
redraws the plate, and one from before a reset is dropped. Without a module worker
(Node, the tools) it runs in place. The fade and the cliff rule run per pixel on the
GPU (uniform 43; the shader tests the same triangle span the CPU does), and the labels
take the same fade. A padded copy of the field (one cell past every edge, read through
the gluing) feeds the GPU, which draws the isolines per pixel with their analytic
gradient; the segments feed only the label placement, and `runLen[k]` is the length in
cells of the connected line segment `k` belongs to (endpoints joined by union-find).

Each frame `plate.js` composes: the lattice (WebGPU: `gpu-plate.js`, one full-screen
pass; each pixel finds its cell, through the inverse edge isometry on a faded copy, and
draws the marks procedurally in the world's frame, so hatching runs on unbroken and is
mirrored on a mirrored copy), then on the 2D canvas above it the edges (thin rule with
one, two or three chevrons per glued pair, agreeing for a translation and opposed for a
twist; a heavy rule with hachures for a shore), cone-point circles with their angles, the
title (top right; the experiment's plate numeral and name, and H&E on the slide, from
`plateTitle`; "Sandbox" when none; the surface and the view are left to their own
controls), the Reference cartouche (bottom left;
rows from `caption.js`), the scale bar (cells; µm on the slide) and the isochrone labels
(every 24 days, only while the level's fade is at least 0.5 and on lines at least 6 cells
long, so a spillover-driven run's small loops carry no number; the text is drawn at the
fade, and labels are collision-checked against each other and the furniture). Until
WebGPU has started, or where it cannot, the 2D canvas shows only the paper and
`#plate-nogpu` says why; a lost device is replaced on the next frame. The state texture
is re-packed only when the world, the view, the brush or the theme changed (main.js
`markState`); otherwise a frame is one pass. The
GPU state texel is `x` compartment, `y` flags | status << 4, `z` animal | (hatch angle
code + 1) << 3 (31 angles), `w` the ramp value or, in the strain view, the hue byte (both
the heaviest strain's). In the strain view a second, `rgba16uint` texture carries every
strain, one channel each, heaviest first: angle code + 1, the hue byte's top seven bits
<< 5, and the load in 15 levels (`loadLevel`) << 12. The shader computes the same OKLCH
wheel from `wheelParams()` (uniforms 21–22). The plate holds 60 fps at 4× on a 2×
display; see Performance below. The Reference cartouche draws its swatches with the
same marks in 2D (`plate.js` `swatch`, `histology.js` `HISTOLOGY_ROWS`), so a change to
a mark in the shader needs its swatch changed too.

Canvas text is Newsreader and waits on `_loadTextFonts()`; theme changes invalidate
`plateTheme()` (a `MutationObserver` on `data-theme`), and the colophon's theme
handler marks the plate, rose, strain and census panels dirty.

### UI

What acts on the plate sits on it; the margin holds the atlas's apparatus.

- **Over the plate** (`.plate-head`): the view picker (State, Strain, Age, Health,
  Status, Immunity; `M` cycles it) and the run tools: speed, Restart, and Controls,
  which shows the margin again once it is hidden. The colophon (`shared/colophon.js`)
  holds play, step, theme and help.
- **On the plate**: the brush rail down the left edge (`paint.js` `buildBrushRail`):
  Look and the five brushes, each swatch the mark the brush leaves, the three footprint
  sizes drawn as the 1, 7 and 19 hexes they cover, and undo and redo. The zoom sits
  beside the scale bar it changes. Labels avoid the rail, the zoom and the view picker
  (main.js `overlayRects`, passed to the plate as `avoid`), and the world is fitted
  clear of the rail (`--plate-left`, `computeViewport`).
- **Under the plate** (`.figure-bar`): the live figure caption (`caption.js`, through
  `_colophon.caption`, throttled, and forced when the loop goes idle) and beside it the
  experiment's one knob (`presets.js` `buildKnob`), a ruler ticked where theory puts its
  threshold (critical β, the lattice and mean-field herd thresholds, 1 AU) or, for the
  Z presets, the regimes the survey found (each preset's `marks`). The knob is hidden in
  the sandbox.
- **The margin** (under the plate below 760 px), four tabs: **Experiments** (the
  default): the list of plates (`buildExperimentList`: the six experiments by plate
  numeral, then the Sandbox, titles only; choosing one applies it, and a changed model
  shows a Restore button under it), the surface picker (each surface's fundamental
  polygon drawn from `SURFACES` and `cornerCones`) and the World row. **Counts**: Nightingale's rose, the census (S, E, I, R and D always,
  the rest only while they have cells), the figures (population, observed Re, beds,
  quarantine, mean age and health) and the reservoir while it has animals. **Strains**:
  Fig. 3 the antigenic map with "Match vaccine to …", Fig. 4 the phylogeny, top
  strains, genome editor. **Model** (`model.js`): Fig. 5, the model as a compartment
  diagram. The chain S → E → I → R runs down the left, V, Z and D beside it, births,
  the reservoir and cleared cells round the edges; each node is a chip with the plate's
  mark and its count, each arrow's weight its flux (main.js `flux`, ten-day smoothing of
  the tick's counters, `FLUX_KEYS`), the core rates are written on their arrows, and a
  part that is switched off or at rate zero fades. Choosing a node, an arrow, or one of
  the topics under the figure (Hospital and quarantine, Evolution) shows that part's
  switches and sliders (`PARTS`); a row with `needs` dims while its switch is off.

`ui.js` wires all of it and returns `{ model, resetUI, showAbout, showPreset }`. World
sets the radius: a new size rebuilds the world with the params and toggles as they are,
gives the coverage, and seeds the opening's two cases (main.js `setWorld`).

The page opens on a living frame: `openScene` applies `OPENING_PRESET` (Threshold on
the torus, or the `?mi=` surface), seeds two cases (one near a glued edge), warms up for
the preset's `warmup` (300 days, when the wave has reached about 30% of the default
world and crossed a glued edge), and plays; under reduced motion it warms up 120 days
longer and stays paused. Applying a preset (`applyScene`) puts its params, toggles and
surface in place, rebuilds the world, gives `vax_coverage`, and seeds the same two
cases, so the plate is never empty. **Restart** (`restart`) runs the model as it stands
(the experiment, its knob and whatever the Model tab changed) again on a fresh world;
**Restore** (Model tab, or the note in the list) re-applies the experiment's own values,
or the defaults in the sandbox (`modelChanged` decides whether the note shows; it leaves
out the knob and the vaccine's antigen). A knob on a genome field writes that rate onto
every strain live; a knob marked `reset` (coverage) restarts with its value. A Model
row for a value given at the start (coverage, the reservoir's density and seed) takes
effect on the next Restart.

The figure caption (`caption.js` `plateCaption`) is the day and the view's live values,
`·`-separated, and nothing else: what a mark means, how a control works and what a
surface's gluing does live in the about panel (root AGENTS.md, "Show, don't tell"). In
the State view it ends with the running preset's measured values (`presetMeasure`, from
`measureCtx()` in main.js); a phone drops recovered, dead and Re to make room for them.
The margin's figure captions are a name and, where there is one, a live value (Fig. 3's
leading strain and its distances); the rose's day span is drawn on the rose itself.

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
plate's sap, wide cross-hatching over a tint, when the current rose holds any; a rose
is 120 days, and the previous 120 are a dashed envelope at the same scale. The census
below keys its marks, and the rose labels its own days. The phylogeny (`lineage.js`) draws living strains and their
ancestors (at most 28 living, the rest counted) as branches over real time, joined to
their parent on their birth day (a dashed second connector for a recombinant), with a
living branch's weight its current prevalence and its tip the strain's swatch.

The loop in `main.js` runs `BASE_TICK_RATE` 10 × speed (0.25–4×) days per second, at
most 16 ticks per frame, and idle-stops when paused with nothing dirty. Each tick pushes
transition counts and its Z census to `history` and the rose, stamps isochrone
arrivals, and clears paint undo/redo so a stroke can never rewind evolved state. The
census (`stats()`) and strain prevalence (`prevalence()`) are O(cells) sweeps made on
demand: a paint stroke or a new world drops them, and a tick only marks them stale, so
while the clock runs they are recounted at most every `PANEL_MS` (100 ms). The Counts,
Strains and rose panels redraw at most every `PANEL_MS` and the caption and the
cartouche's rows every `CAPTION_MS` (250 ms); paused, everything catches up at once.

`camera.getEffectiveViewport()` returns one shared object, mutated on every call; its
`frame` (the canvas below `--plate-top`, above `--plate-bottom`, with the rail's
`--plate-left`, all read off `.plate-stage`) is measured on resize. A plate narrower
than 860 px (a container query) moves the view picker under the run tools and deepens
`--plate-top`; on phones the rail runs along the plate's foot (`--plate-bottom`) and
the view picker gets a row of its own. The paint
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
- The plate redraws every frame something changed, but text does not: a new
  tick-driven panel or caption goes through the same `PANEL_MS` / `CAPTION_MS` cadence
  and the stale census rather than computing per tick.
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
- The plate never re-fits as text changes: the caption is a fixed two-line block whose
  values fill one line at desktop widths and wrap rather than clip, and the frame is
  measured only on resize.
- Defaults are a showcase (the Sandbox): `DEFAULT_PARAMS` avoids 0 and 1 so every
  mechanic is visible, and Z is off. `applyPreset` resets params and toggles to the
  defaults before merging, so a preset must set every key it needs and turn off what its
  experiment doesn't use (`QUIET_TOGGLES`, `NO_ANIMALS`, `NO_DEMOGRAPHY`, `NO_EVOLUTION`
  in `presets.js`); it also forces `vax_rollout` off when V is off, and so does the
  Model tab's V switch. Dependencies between controls are the Model rows' `needs`.
- A preset earns its place as an experiment: one knob, a phenomenon to look for, a
  measured number in the caption, a predicted number where theory gives one, and a
  survey across at least ten seeds before it ships (`docs/ROADMAP.md` §2.3).
- Compartment availability is decided by toggles inside the tick, not hard-coded, and
  Z is an ordinary compartment behind a default-off toggle.
- The hex lattice is what gives clean isotropic wavefronts; shrink the grid rather than
  move to squares for speed.
- Per-cell work scales with the world, so a new O(cells) pass in the tick or the frame
  is a cost at 96,661 cells: fold it into a pass that already visits every cell, or
  visit only the cells that can act (the `near` and contact stamps, the I and AUTO_Q
  lists), and check `tools/bench.mjs` before and after.

## Performance

Measured 2026-10-25 on an M5 Max, Chrome with WebGPU at a 2× pixel ratio, the opening
(Threshold on the torus) at 4×, and with 4× CPU throttling as a stand-in for a
typical laptop (`Emulation.setCPUThrottlingRate`):

| World | Tick (Node, Threshold / Sandbox) | Page idle, throttled 4× | Before the pass |
|---|---|---|---|
| 10,621 cells (R 59) | 0.21 / 0.57 ms | 84%, 60 fps | 58% |
| 24,031 cells (R 89, the default) | 0.58 / 1.36 ms* | 72%, 60 fps* | — |
| 42,841 cells (R 119) | 0.67 / 1.7 ms | 66%, 60 fps | 5%, frames to 50 ms |
| 96,661 cells (R 179) | 1.3 / 3.2 ms | 48%, 60 fps | — |

*Measured while other sessions loaded the machine; in the same run the 10,621-cell
tick came out 0.25 / 0.82 ms, so these read high. The tick was 0.72 / 1.43 ms at
10,621 cells before. Startup to a running opening is 0.15, 0.28, 0.28 and 0.44 s at the
four sizes (0.6, 1.0, 1.1 and 1.8 s throttled; the default's opening warms up 300 days,
the others' here 200); before, the first Canvas frame alone took 4 s at R 119 and 19 s
at R 179 (the quadratic path build). What is left on the main thread at large sizes: the tick's three full passes
and its copy-in of the double-buffered fields, packing and uploading the state texture
(W·H·4 bytes a tick, and in the strain view the strain texture's W·H·8 more; the strain
view held 60 fps at 96,661 cells in drift, unthrottled, on 2026-10-27), and `record`.

## Presets

Six experiments (`presets.js`); each preset's comment records the calibration behind
its values. `tools/presets-survey.mjs` reproduces the facts below (ten seeds, 3,000 days,
the default knob, the opening's two seeds, the default 24,031-cell world; surveyed
2026-10-25, when the default grew from 10,621 cells, and Drift and Spillover again on
2026-10-27, when worlds began starting at steady-state ages). Its fifth argument sweeps a
preset's knob, as the presets' comments record.

| Preset | Knob (default) | Measured in the caption | Ten seeds, 3,000 days |
|---|---|---|---|
| Threshold (opening) | β (0.11, 1.8× critical) | β against the critical β (≈ 0.061, independent edges); share of cells reached | takes off 10/10, reaches the edge by day 193, peak 782 E+I, ends by day 840, reaches 97% (30% by day 300, the opening) |
| Herd immunity | coverage (0.48, reset) | coverage against the lattice threshold (near 50%) and 1 − 1/R₀ (82%); share of the unvaccinated reached | peak 179, ends by day 1,874, reaches 66% of the unvaccinated (10% at 0.50) |
| Antigenic drift | antigenic step (1.2 AU) | the leading strain's distance from α along its descent, per year; carriers' mean generation | never ends, peak 4,620, 154 living strains at the end, waves locked to the season |
| Spillover | spillover rate (0.02) | human-to-human Re over 30 days; reservoir share of human cases | never ends, human Re 0.38, 62% of human cases from the reservoir (the same at any size) |
| Immunoediting | surveillance (0.29) | transformed-cell trend over 100 days | 843 transformed cells at day 1,000, 1,693 at the end; escape at 0.25 (6,782), shrinking from 0.32 |
| Zombie apocalypse | fight-back (0.06) | zombie trend over 100 days against the living | 3,327 zombies at day 1,000, 3,238 at the end, against 1,809 and 1,617 living; burns out in 0/10 (5/10 at 0.03) |

## Open work

`docs/ROADMAP.md` is the plan; 2.1 landed on 2026-10-24 and 3.0 is the game, a tactical
reverse Plague Inc. When an item lands, move it to the roadmap's Landed table and update
this file. `docs/VISION.md` holds the wider directions and the measurements behind them.

- The default-on `auto_quarantine` is instant, unlimited and omniscient (it sees every
  true case); the presets turn it off, and 3.0's budgets and reports replace it.
- The tick runs on the main thread. Moving it to a worker is the next lever for worlds
  past ~100,000 cells: the site is cross-origin isolated (COOP same-origin, COEP
  credentialless), so the grid could live in SharedArrayBuffers, with paint, presets
  and the registry's panels crossing as messages.
- The drift preset's lineages diffuse from α in every direction rather than along a
  canalized trunk: on a nearest-neighbour lattice competition is local, so lineages in
  different regions coexist. Long-range mixing (`docs/VISION.md`, A) would globalize it.
- `tick()` returns counters (`zFight*`, `animalBirths`, `autoQuarantined`, …) that
  nothing displays, and animal marks shade only by S/I/R/D.
- The plate's isochrone labels are upright; atlas labels often follow the line.
- Deferred ideas: per-strain vaccine efficacy or waning, M-cell breakthrough (would need
  its own efficacy parameter), a separate breakthrough count for Re, a barricade brush
  for the zombie reading, a cross-immunity matrix view.
