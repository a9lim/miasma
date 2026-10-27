# Miasma Roadmap

The one authoritative plan for Miasma. `AGENTS.md` describes Miasma as it is; this file
describes where it is going. When an item lands, move it to §10 with its commit and update
`AGENTS.md`. `docs/VISION.md` holds the first ideation round (2026-10-24) and the
measurements behind it; its directions are unslated until a version here names them.

Refreshed on 2026-10-27 by Claude with a9, after 2.1, the performance pass, the apparatus
and three model passes had landed. It starts from an audit of the build (§1): the opening
and the other five plates screenshotted at day 1,000–1,800, and a prototype of recurring
waves on Miasma's own surfaces (`tools/spirals.mjs`). The 2.1 plan as written, and the first 3.0 sketch,
are in git history (`3b01072` and earlier). The versions in §3 are Claude's proposal from
that audit; a9 ratifies them through the Open items. This file lives in `docs/` so the
parent build's stager never deploys it.

Tags: **[standard]** an established result · **[synthesis]** our own design applying
standard ideas · **[measured]** found by a script in `tools/`, reproducible ·
**[speculative]** needs prototyping before it's trusted. Sizes **S / M / L** are relative.
a9's calibration from Worldline: a milestone is one to three serial sessions, and
parallel lanes fit a whole version in one.

## 0. Decisions

### Decided

| Date | Decision |
|---|---|
| 2026-10-24 | **The versions:** 2.1 is immunity by antigenic distance and six presets that work. 3.0 is the game, not before the following week's usage window. |
| 2026-10-24 | **Fewer, better presets** (Worldline's rule): a preset earns its place as an experiment with one knob, not as coverage. The cut presets' mechanics stay reachable from the Model tab. |
| 2026-10-24 | **Antigenic memory replaces the bloom filter outright.** Miasma persists no state, so there is nothing to migrate and no compatibility reader to keep. |
| 2026-10-24 | **2.0, the atlas:** the plate in the line of Snow's map, the inks, four surfaces that glue every edge or none (`58a3d09`). |
| 2026-10-24 | **The opening preset is Threshold,** calibrated to the ragged regime. |
| 2026-10-24 | **Antigenic space is a torus** (a9's call), 8 AU around, with shortest-way distance. **Strain marks encode the position directly:** one axis is hatch angle, the other hue on an OKLCH wheel fitted like the inks and squeezed near the accent. |
| 2026-10-24 | **Isochrones fade** (a9's call): re-stamped when a new wave arrives, faded by age against the newest arrival, never contoured across the cliff between waves. |
| 2026-10-25 | **The world's size is a setting** (Experiments → World, `?r=`): 10,621 to 96,661 cells. **The default is 24,031** (a9's call). |
| 2026-10-26 | **The controls are rebuilt around the plate** (a9 asked for the rework; Claude's design): what acts on the plate sits on it, and the margin is the atlas's apparatus. **Restart keeps the model as edited; Restore puts back the experiment's values.** |
| 2026-10-27 | **WebGPU is the one plate renderer** (`b7082e3`); a browser without it sees a notice while the margin runs. |
| 2026-10-27 | **3.0 is tactical** (a9's call, against a proposal to reframe it as an inference game): you direct measures on the map itself, drawing where the doses go, cordoning, tracing a case's contacts, sampling strains. It is not points spent on abstract policies over a background simulation, as in strategic, global-level games like *Plague Inc: The Cure*. Claude's follow-on: inference pays through where the orders land, so there is no separate findings layer (§7.3). |
| 2026-10-27 | **Spillover is emergence** (Open 2, in the 2.2 sketch a9 approved): human β is the knob, chains by size the measure; built in 2.2 M3. |
| 2026-10-27 | **Descent is a seventh view** (Open 3, in the 2.2 sketch a9 approved), not a layer over the State view; built in 2.2 M1. |
| 2026-10-27 | **Lineages, not records** (a9's call): 2.2 tracks infection lineages because the live sim draws, measures and traces them, and builds no checkpoints, replay or recipe links. Miasma is a live, causal, observational sandbox; record artifacts kept for their own sake distract from it, and sharing runs isn't worth the work. The counter-based RNG moves to 3.0, where the twins need it. |

Rows that only scheduled 2.1 (built in one session; 3.0 to wait until it could be done
properly) are in git history.

### Open

Each has a recommendation; a9 decides.

1. **3.0's orders** (§7.2): shapes as the main verbs (a ring around a case, a belt drawn
   as a line, a lassoed cordon, trace and sample by click), with the brushes for fine work
   (recommended), or the sandbox's brushes alone.
2. *(Decided above: Spillover is emergence.)*
3. *(Decided above: Descent is a seventh view.)*
4. **Geography** (§5.4): a road brush in 2.3, painted routes that carry long-range
   contact (recommended), or the world stays a bare hexagon.
5. **Order after 2.2:** 2.3 and 2.4 as parallel lanes (recommended), or one after the
   other.
6. **3.0's clock:** weekly turns around the Weekly Return (recommended) or real time with
   pause.
7. **3.0's mode:** the sandbox and the plates stay the front door and the game is a mode
   (recommended), or the game becomes the front door.

## 1. Where Miasma stands

2.x made Miasma an atlas of experiments: six numbered plates, each with one knob, a number
measured live in the caption and, where theory gives one, a predicted number ticked on the
knob's ruler. The plate is drawn after Snow on four glued surfaces up to 96,661 cells at
60 fps; immunity works by antigenic distance; the Model tab draws the whole state machine
as a figure whose parts hold every rate. The audit of 2026-10-27 found four things.

1. **Half the plates read only in their captions.** Threshold, Herd immunity and Zombie
   apocalypse show their phenomenon on the plate: a ragged front; one pale channel the
   wave threaded through the vaccinated hatching (faint, at 13% of the unvaccinated by
   day 1,000); a red front with green behind it. The other three don't. Antigenic
   drift at day 1,800 is faint hatching under isochrones labelled anywhere from day 1,560
   to 1,776; Spillover is an even speckle; Immunoediting is a pink field with glass
   holes. Their phenomena live in time (seasons, sweeps, the three regimes) or in
   statistics (chain sizes), and the plate is a snapshot of state.
2. **The plate forgets causes.** Every infection picks one source (`pickIncomingStrain`
   chooses an edge, then a strain), and the pick is thrown away. Who infected whom is the
   richest record an outbreak has. It gives Re by counting rather than by ratio, chain
   sizes, the offspring distribution, and the contact tracing a game needs.
3. **Contact stops at the neighbours.** Lattice R0 is capped at 6, the drift preset's
   lineages diffuse instead of forming a trunk, and the well-mixed comparison that
   `about.md` opens on appears nowhere as a number.
4. **Only Drift recurs, and as an endemic soup.** Immunity never wanes, so every other
   run has one act.

## 2. The thesis

The next step gives the plate **cause and time**: who infected whom, drawn on the map, and
what happened where, drawn against time. Then it widens what the plate can show (contact
beyond the neighbours, waves that come back). Last, 3.0 hands the reader the map itself:
a tactical game in which you direct measures on the plate against a pathogen that evolves
on its own, seeing only what is reported, with the truth revealed at the end.

The thread through all of it is one new piece of live state. Once each infection keeps its
source, the
Descent view draws the outbreak's tree, the caption counts Re instead of estimating it,
Spillover measures stuttering chains, a trace order in 3.0 follows real edges, and the
epilogue reveals the true tree under the reported plate.

## 3. Versions

| Version | Theme | Contents | Size |
|---|---|---|---|
| **2.2** | Cause and time | infection lineages and the Descent view, a space–time figure, the trunk on the map, the three weak plates rebuilt (§4) | M |
| **2.3** | Beyond the neighbours | the mixing dial, the ghost of the ODE, roads, two new plates: the ghost and the front (§5) | M |
| **2.4** | Time that recurs | waning that holds then lapses, the phase view with spiral cores and their charges, the year rose, the spirals plate (§6) | M |
| **3.0** | The game | tactical: orders drawn on the map on a weekly budget, reports instead of truth, an evolving adversary, scored against twins (§7) | L |

2.2 comes first: it repairs the half of the atlas that doesn't read, and its lineages are
what 3.0's trace order follows. 2.3 and 2.4 touch different parts of the tick (transmission for 2.3,
memory for 2.4) and different figures, so they can run as parallel lanes in worktrees,
with `presets.js` and `model.js` merged by hand (Open 5). The engine track (§8) runs
alongside.

## 4. 2.2: cause and time

### 4.1 Infection lineages [synthesis] — landed in M1

*As built (`src/descent.js`, `AGENTS.md` Lineages): the sketch below held, with five
changes. Each cell keeps only `evt`, the serial of its current infection's event; the
source and tick live in the event. A new infection reads its source's `evt`, so it is a
field a neighbour reads, and its writes are deferred to a `settle` after the swap
rather than written in place. Paint and the opening's seeds share one code (the seeds go
through the seed brush). A coinfection is not an event: it adds a strain to a case that
already has one. Descendants are counted when the view draws them, by one sweep from
the newest event back, not O(depth) per infection, so the tick pays 2–9% and no RNG
draw (every fingerprint unchanged). And the event keeps no strain id, since the sweep
reuses ids. Re by count agrees with the ratio on a spreading front (Threshold
0.97–1.07 against 0.90–1.25; Spillover 0.37 against 0.40) and parts from it in the Z
presets (count near 1, ratio 1.4–2.1: Z deaths never enter the ratio's removals). The
offspring distribution and closed trees' sizes are kept for M3; nothing draws them yet.*

Every →E keeps its source. `pickIncomingStrain` already picks the edge, so the cost is the
write. The lineages are live state, kept only as long as the plate draws them and the
caption measures from them, on the same fading clock as the isochrones; they are not an
archive, and nothing is exported or replayed.

- **Per cell:** `src` (Int32: the source cell; a distinct code for paint, the opening's
  seeds and spillover from the cell's animal) and `t_inf` (the tick). Nothing a neighbour
  reads, so both are written in place (§11). Paint can set them, so
  `captureCellState` snapshots them.
- **The event log:** a typed ring of infections `(cell, src, tick, strain)` over a
  window (the isochrones' 420 days is the natural one), each event pointing at its
  parent's event. Each new event adds one to the descendant count of every ancestor still
  in the window: O(depth) per infection, bounded by the window. `tools/bench.mjs` before
  and after.
- **Re by counting:** the mean number of children of the cases whose infectious period
  ended in the last 30 days. The caption prints it beside today's ratio estimator. On a
  growing lattice front both sit near 1, because incidence grows with the front's
  circumference rather than exponentially; now the plate can show that the count agrees.
  Wallinga & Teunis 2004 reconstruct the tree's likelihood from case dates to estimate
  Re [standard]; here the tree is known exactly.
- **Distributions:** the size of each tree when it closes (Spillover, §4.5), and the
  offspring distribution, whose dispersion is the superspreading parameter k of
  Lloyd-Smith et al. 2005 [standard] (capped at 6 offspring until 2.3).

### 4.2 Descent, a view [synthesis] — landed in M1

*As built: per pixel rather than instanced segments. Each stroke is two halves, each
from a cell's centre to the edge the two cells share, packed per cell into one
rgba32uint texel (six edges and a root mark), so the gluing, the copies and mirroring
come from the plate's own cell lookup. Weight is log₂ descendants and sets both width
and tone, so trunks read at 1×; strokes into live cases are red at full tone, into live
zombies sap. The view drops the isochrones (the strokes' fade carries time) and mutes
the State marks. Strain-marked strokes in the Strain view wait: they need a strain per
edge. Packing costs 1.6 ms for Drift on the default world and 7 ms on the largest (59
fps at 4×).*

The plate draws the tree. Each infection is a stroke from its source's centre to its own,
weighted by the number of infections that descend through it, so an outbreak reads like a
drainage map: trunks where the wave ran through, twigs at the front, lone twigs where a
chain stuttered. Line weight is a quantity in the model (descendants), so it passes
"depict, don't decorate". Strokes cross glued edges through the edge isometry, like the
isochrones, and fade with the same clock. The live tips (I cells) stay red; closed strokes
are graphite; in the Strain view each stroke takes its strain's mark. At 24,031 cells a
wave lays at most about 24,000 strokes: instanced segments in `gpu-plate.js`.

What each plate gains: Threshold near β_c draws a fractal tree; above it, long trunks run
from the two seeds and across glued edges. Spillover becomes a forest of small trees rooted
at animals. Drift lays a new forest each season. Zombie apocalypse draws the conversion
trees.

### 4.3 Space–time, a figure [synthesis] — landed in M2

*As built (`src/spacetime.js`, Fig. 3 in the Counts tab; the antigenic map, the phylogeny
and the model became Figs. 4–6): incidence is read from the lineage log's new events, not
a pass over cells, in a band of R/16 rows each side of the centre row (6 at the default
world); cells outside the hexagon don't contribute, so the band thins at the corners
rather than reading through the gluing. A ring of 730 days by 2R + 1 columns on the CPU,
drawn to a 2D canvas with the rose's cadence, not a texture. Ink is the square root of
incidence, full at the 95th percentile; in the Strain view each place takes the hatched
mark of the strain with the most infections there. The plate marks the row's ends A and
A′. Threshold's front reads as a Λ; Drift's seasons as bands whose marks change. 1.5–3 ms
a render on the largest world, about 0.02 ms a tick to record.*

A Hovmöller diagram (Hovmöller 1949, the meteorologists' trough-and-ridge diagram)
[standard]: position along a transect against time, inked by incidence. The transect is
the world's centre row, averaged over a band of rows and read through the gluing; time
runs down the figure over the last two years. A travelling front is a V whose slope is its
speed (Threshold, and 2.3's front plate); seasons are horizontal bands (Drift); in the
Strain view, sweeps are bands where the mark changes. Cummings et al. 2004 found dengue
waves radiating from Bangkok in this kind of view [standard]. One row of W values per tick
into a ring texture: O(W), drawn as a figure in the Counts tab beside the rose.

### 4.4 The trunk on the map [synthesis] — landed in M2

*As built (`strains.js` `bornAt`, `plate.js` `drawTrunk`): the route follows the focus
strain, the one selected in the Strains tab while it lives, else the dominant one (the
immunity view's), so a reader can trace any lineage. A leg that is shorter through a glued
edge is drawn as two segments through the edge isometry; one through a cone point takes
one edge, not the corner. α has no birthplace, so the route starts at its first mutant.*

Each strain records its birth cell (`born_at`, Int32 in the registry; a recombinant takes
its host's cell). The Strain view draws the dominant strain's ancestry as a route through
its ancestors' birthplaces, each leg the short way round through the gluing, with a dot at
each birth. That is where the lineage has been, the way Nextstrain draws a phylogeny on a
map (Hadfield et al. 2018) [standard]. Fig. 4 shows where the trunk went in antigenic
space; this shows where it went on the world. S.

### 4.5 The three plates rebuilt — landed in M3

*As built, and what the surveys found (`presets.js` comments, `AGENTS.md` Presets):*

- *Spillover [measured]: emergence, as sketched, with no case placed by hand (the
  reservoir starts every chain) and the plate drawn in the Descent view. The reservoir's
  immunity moved the threshold further than expected: at the old spillover rate (0.02)
  it immunizes 40–60% of people, past the lattice's herd threshold, and no β up to 0.1
  (T ≈ 0.54) lets chains average more than 2.4 cases. At 0.001 the transition shows:
  the mean chain in the first year runs 3.2, 5.6, 8.9, 12.6, 15.6 and 20.2 cases for β
  0.02 to 0.08, steepest between 0.04 and 0.05, about the lattice threshold (0.048),
  while the branching foil diverges at 0.023. Past the threshold no single chain takes
  over: the reservoir keeps starting chains elsewhere, so they tile the world, each
  finite (none reached 1,000 cases in any run). "One that doesn't stop" needs spillover
  rarer than a front's crossing time, which would leave the plate nearly empty. The
  measure is Fig. 4 (chains by size, log–log, a −3/2 guide), the caption's mean chain,
  largest growing and reservoir share.*
- *Drift: the Strain view (strain marks and the trunk) is its plate, and its isochrones
  fade over 180 days (`fadeDays`), so only the current season's wave is labelled.*
- *Immunoediting [measured]: growth rings were built and dropped. Transformation happens
  wherever the latent virus is, so the tumour is multifocal: each 100-day margin is a
  scatter of small loops, and even the last three margins show lesions appearing and
  vanishing in place, not growing or shrinking; under escape the transformed cells are
  diffuse. Equilibrium here is many foci born and killed, so a single mass cannot sit in
  it (a lone front either grows or shrinks). In their place, a transformation founds a
  tree (a clone) in the lineage log, and Fig. 4 shows clone sizes: at equilibrium (0.29)
  cleared clones fall as s^−1.49 over sizes 2–512, the critical branching process's
  −3/2; at 0.32 and 0.35 the slope steepens to −1.88 and −2.03; under escape hardly any
  clone is cleared. The setting where the tumour holds sits near the critical point; with
  new transformations feeding clones in, holding doesn't force it there (a homeostatic
  tissue without inflow must be exactly critical: Klein & Simons 2011). The caption adds the
  cleared clones' mean size and the largest clone's living cells (361, 120, 15, 8 across
  the regimes).*
- *The trees themselves moved off the event ring: a tree's size and open cases, and each
  cell's tree and generation, are kept apart from the 420-day window, which had dropped
  immortal clones and long chains from the count.*

- **Spillover becomes emergence** (Open 2). The knob is human transmissibility (β), not
  the spillover rate. The phenomenon: stuttering chains rooted at animals that lengthen
  as β rises, until one doesn't stop. The measure: the mean chain size and its
  distribution (a figure on log axes). Two predictions sit on the ruler. The branching
  process's mean, 1/(1 − R) with R the early offspring mean (about 5T on the lattice),
  diverges at T = 0.2: the mean-field foil. On the lattice a chain in fresh hosts is a
  bond-percolation cluster, finite until T ≈ 0.347, the threshold Plate I marks
  [synthesis, to measure; the reservoir's accumulated immunity will move it]. The
  current preset already sits in the gap: T ≈ 0.25 per edge, so 5T ≈ 1.2, yet its
  measured human Re is 0.38. Blumberg & Lloyd-Smith 2013 estimate R from exactly this
  distribution [standard]; Lloyd-Smith et al. 2009 frame the human–animal interface
  around it [standard].
- **Antigenic drift** gains the space–time figure (seasons as bands, sweeps as changing
  marks) and the trunk on the map. Its isochrones keep the current season's wave
  and drop older labels, which today scatter across the plate. S.
- **Immunoediting** gains growth rings: the margin of the transformed region (a contour
  of smoothed transformed-cell density at ½) every 100 days, faded with age. Escape reads
  as rings spreading apart, equilibrium as rings piling onto one another, elimination as
  rings that shrink and stop. The isochrone builder's marching triangles run on a
  different field. M.

Each rebuilt plate is re-surveyed across ten seeds (`tools/presets-survey.mjs`) before it
ships.

### 4.6 Order and receipts

| Milestone | Contents | Size | Depends on |
|---|---|---|---|
| **M1** | infection lineages, Descent, Re by counting (landed 2026-10-27) | M | — |
| **M2** | the space–time figure, the trunk on the map (landed 2026-10-27) | S–M | — |
| **M3** | the three plates rebuilt, surveyed (landed 2026-10-27) | M | M1 (Spillover), M2 (Drift) |

M1 and M2 can run as parallel lanes. Receipts: tests that every event's source was a
transmitter at the start of its tick and that descendant counts equal subtree sizes;
`tools/bench.mjs` per milestone; screenshots in light, dark and phone widths; docs
(`AGENTS.md`, `about.md` with a bumped `updated`, `index.html`'s text).

## 5. 2.3: beyond the neighbours

### 5.1 The mixing dial [synthesis]

A fraction ε of each source's transmission goes to a cell drawn from a kernel:
exponential with length ℓ, a power law, or uniform (`VISION.md`, A). Local edges are
scaled by 1 − ε, so the total contact rate is fixed and ε alone moves the world from
lattice (0) to mass action (1, uniform). Push sampling: each transmitting cell makes
Poisson(ε · 6β) long-range attempts per tick, resolved against start-of-tick state, at
O(#I). A jump is a vector in the universal cover, wrapped back through the gluing with
`wrap` (lost at a shore), so long jumps cross the surface correctly and mirror across a
twist. The Descent view draws them as long strokes.

### 5.2 The ghost of the ODE [standard]

The mean-field SEIR(D) with the same per-day rates, integrated beside the lattice and
drawn as a dashed envelope on the rose. The caption gives Kermack–McKendrick's final size
against the lattice's. At ε = 1 with a uniform kernel the lattice must match it; that is
a regression test.

### 5.3 Two plates

- **The ghost.** Knob: ε. Measured: final size and peak day against the ODE's. The
  lattice's slow, low, long epidemic rises into the ghost as ε grows.
- **The front.** Knob: the kernel's tail. Measured: front speed (the space–time
  figure's slope) against Fisher–KPP for thin tails; heavy tails accelerate the front
  (Mollison 1977) [standard], so the isochrones visibly spread apart.

### 5.4 Roads (Open 4) [synthesis]

A road brush paints a route between two cells: a long-range edge carrying contact,
drawn as a double hairline in the manner of a period map. Isochrones bend along roads,
which sets up the effective-distance plate (Brockmann & Helbing 2013, `VISION.md` X) and
gives 3.0 an order: close a road. It is the least geography that does the job; the
hexagon stays abstract otherwise.

### 5.5 Questions it can answer

- Does long-range mixing canalize the drift preset into a trunk? [speculative] Measure
  lineage depth and the trunk's straightness in Fig. 4 against ε.
- Herd immunity's threshold should move from the lattice's 50% toward 1 − 1/R0 as ε
  grows [synthesis]. The ghost plate can show it with the coverage set by hand.
- Long-range transmission selects for higher virulence (Boots & Sasaki 1999) [standard];
  a plate needs a transmission–virulence trade-off first (§9).

## 6. 2.4: time that recurs

### 6.1 Waning that holds, then lapses [measured]

`tools/spirals.mjs` runs a stripped S → I → R → S medium on Miasma's own gluing, at
R 89 over 1,500 days, and tried three waning rules. A memoryless R → S, and susceptibility
that fades smoothly from recovery, both melt into noise: recovered cells become partly
susceptible right behind the front, so a wave has no refractory wake. Protection that
holds and then lapses gives spirals. With a 40-day cycle, a 20-day hold is noise, 30
gives ragged spirals and 36 gives clean ones, forming on their own from a random start.
The infectious period can stay geometric; only the refractory needs to hold. The
deterministic limit is Greenberg & Hastings's 1978 excitable medium [standard].

So waning goes into the memory, not the compartments. Each memory slot gains its tick
(`mem_t`, one own-cell Float32 per slot, written in place), and protection becomes
`c_k · h(age)`, with `h = 1` for `age < hold`, then `exp(−(age − hold)/fade)`. Two new
rates, `immunity_hold` and `immunity_fade`; `fade = ∞` is today's lasting immunity.
Waning and antigenic distance compose: a remembered antigen protects less both as it
ages and as the strain drifts from it.

### 6.2 The phase view [synthesis]

A view of where each cell is in its cycle, drawn as an activation map: contours of days
since the last arrival, the way cardiac electrophysiology draws isochronal activation
maps. Phase singularities, the spiral cores, get small circled marks with their turning
(⟲ or ⟳), like the cone points. The core detector needs work: today's counter misses
cores whose triangles straddle the rim. It should follow cores through the gluing and
over time, so a core keeps its identity as it crosses a seam.

### 6.3 The spirals plate [synthesis, checked by Codex for the static case]

The question from `VISION.md` G: can two spirals turning the same way share a surface?
Counted in the world hexagon's own orientation, the total charge is 0 on the torus and
even on the Klein bottle and RP²: two same-handed unit spirals are allowed on the
non-orientable surfaces and forbidden on the torus. The cleanest event to watch is one
core carried across a twisted seam, whose turning reverses in screen orientation while
the total jumps by 2; the mirrored copies already draw the far side. The prototype shows
spirals forming and running across the gluing on all three closed surfaces. With the
crude counter, seeds 1–6 at a 36-day hold gave net charges 0 0 1 0 0 0 (torus),
0 −2 −1 1 0 0 (Klein) and 0 0 2 1 0 0 (RP²). The noisy rules also net ±2 on the torus,
so that is not yet evidence: the detector (§6.2) comes first. Knob: the hold.
Measured: the net charge and the cores' turnings. Whether spirals pin to the cone points
or flee them is a question the literature can't answer and the plate can [speculative].

### 6.4 The year rose [standard]

Once runs recur, the rose becomes Nightingale's own form: twelve thirty-day wedges, with
last year dashed, so a seasonal plate draws a lopsided rose. S.

## 7. 3.0: the game

A tactical epidemic game on the plate (a9's sketch, 2026-10-24). The pathogen evolves on
its own through 2.1's machinery, and you contain it as the world's Medical Officer of
Health by directing measures on the map itself: drawing where the doses go, cordoning,
tracing a case's contacts, sampling strains. You see only what is reported, doses and
staff are finite, and nothing is instant. Every order is a place on the lattice, and the
lattice is the world it acts on; that is what sets it apart from strategic, global-level
games such as *Plague Inc: The Cure*, where points buy policies applied to a background
simulation of countries.

### 7.1 The week

The run proceeds in weeks around the Weekly Return (Open 6): a plate of reported deaths
and notified cases in Snow's manner, a short table, a headline in the caption. It is
historically exact: Snow noticed the table on the South London water companies in the
Registrar General's Weekly Return of 19 November 1853, and Farr's Return of 14 October
1854 summarized the registrars' inquiry into each household's water supply [standard].
Each week you read the Return, issue orders on the plate, and the world runs seven days.

### 7.2 Orders are shapes on the map [synthesis] (Open 1)

A weekly budget of money and staff, and a dose supply that ramps with production. Every
order is placed on the plate, costs something and takes time:

- **Ring:** click a case and drag the radius to vaccinate around it. It spends doses;
  immunity begins after a delay and uses the current vaccine antigen.
- **Belt:** draw a line for a vaccinated firebreak of a chosen width. Murray, Stanley &
  Brown 1986 estimated the width that stops a fox-rabies front [standard].
- **Cordon:** lasso a region into quarantine, costed per cell-day. Compliance fatigues,
  so a long cordon leaks.
- **Test:** brush an area to reveal its true state today.
- **Trace:** click a reported case to reveal its parent and children in the true
  transmission tree (2.2's lineages), one generation per order, up to tracer capacity.
- **Sample:** click a case to reveal its strain's mark and antigenic position. During a
  game, Fig. 4 and Fig. 5 show only sampled strains, so the phylogeny is the surveillance
  you paid for.
- **Close** a pump or a road (§5.4). **Bury safely, cull, sanitize:** corpses and the
  reservoir.
- **Update the vaccine** to match a sampled strain. It takes weeks, and the virus keeps
  drifting meanwhile: the flu-shot decision, built on 2.1's vaccine antigen.

The brushes stay for fine work. Shapes keep a week to a handful of decisions on a
24,000-cell world, which is the density a tactical turn wants.

### 7.3 Reports, not truth

Detection is a process. Deaths are reported, cases only sometimes and after a delay, and
tests reveal the truth where they are spent. Shoals' rule carries over: the reported path
never reads hidden state except through detection, and a test asserts it. This retires
the omniscient auto-quarantine the sandbox still runs.

Inference pays through where the orders land. Knowing the cause matters because it says
where to draw: the pump to close, the seam the wave will come back through, the strain to
match. A separate layer of declared findings was considered on 2026-10-27 and dropped; on
top of placed orders it would be the game telling rather than showing.

### 7.4 The adversary

The pathogen is the evolving registry: it drifts away from your vaccine, and your orders
are its selective environment. Whether cordons and tracing select for longer latency is
a question the game can measure rather than assert [speculative]. Fraser et al. 2004 show
that whether isolation and tracing can control an outbreak depends on how much
transmission happens before symptoms [standard], which latency (the L flag) models.

### 7.5 Scoring

When you issue an order, the untouched world runs alongside as a twin. A counter-based
RNG, `u = hash(seed, tick, cell, stream)` in place of the sequential `mulberry32` stream
(`VISION.md`, I1), gives the twins common random numbers, so they differ only by your
orders; without it the same band needs more twins. The score is deaths averted
against the twins per unit spent, with a band from several twins. On a stochastic world the
twins are also what make tactics legible: an order's effect is the gap between your world
and its twin. The epilogue overlays reported against true cases, draws the true tree in
Descent, hatches your cordons, and dashes the twin's isochrones. Endings: eradication (no
cases through a certification window under active surveillance), an endemic equilibrium,
or collapse. The last Weekly Return is the epilogue.

### 7.6 Cases

- **Broad Street**, the first case: deaths only; air or water? The water route is new:
  point sources, each cell drinking from its nearest by lattice distance, an infected
  source infecting its drinkers (Tien & Earn 2010's SIWR shape) [standard]. Snow's 1855
  map drew the boundary of equal walking distance around the pump [standard]; the plate
  draws the same boundaries, through the gluing on the closed surfaces. Removing the
  handle is the inference: the wrong pump costs a week.
- **The ring:** few doses, reports only. A ring around each report or doses spread
  evenly, as in Foege's surveillance-containment from the December 1966 Ogoja outbreak
  [standard].
- **The season:** drift. Sample, choose the vaccine antigen each year, and live with the
  months it takes.
- **The reservoir:** emergence (§4.5). Are the chains people's or the animals'? It
  decides whether culling or cordons are the right spend.
- **The unknown country:** the plate hides its chevrons and glued-edge copies. Read the
  gluing from where the wave comes back, mirrored or not, and cordon the seam before it
  arrives; in 2.4, a spiral whose turning flips gives it away. Only Miasma could set this
  case.
- **The cure:** oncolytic virotherapy on the H&E section, an epidemic you want to win
  (`VISION.md` H; Wodarz et al. 2012) [standard].
- **Zombie defense,** for fun.

### 7.7 What it needs first

1. 2.2's lineages (tracing, the epilogue) and the counter-based RNG (the twins). Every
   `?seed=` run and bench fingerprint changes with the RNG, so the presets are re-surveyed.
   S–M.
2. The tick in a worker (§8): twins multiply the tick's cost.
3. The detection and report layer (§7.3). M.
4. Orders as shapes, budgets and delays (§7.2), and the weekly loop with the Return. M–L.
5. Twins, scoring and the epilogue. M.
6. Per case: the water route for Broad Street, roads (§5.4) if closing them is an order.

The game stays inside the design system: the Return is editorial (Newsreader and
hairlines, no game chrome), the red stays the disease, and your orders are inks.

### 7.8 Open within 3.0

One budget, or separate doses, staff and money. How deep compliance goes. Deaths or
life-years as the score.

## 8. Engine

- **The tick in a worker.** The site is cross-origin isolated, so the grid can live in
  SharedArrayBuffers, with paint, presets and the registry's panels crossing as messages.
  It frees the main thread at the largest worlds and is 3.0's prerequisite, since twins
  run several ticks per day. M.
- **A WebGPU compute tick** at about 10⁶ cells (R ≈ 577), with the registry as a storage
  buffer with atomic append (`VISION.md`, I3). Worth it once size is the bottleneck; it
  isn't yet. L, unslated.

## 9. Unslated

- **Evolution to the edge of extinction:** a transmission–virulence trade-off (β tied to
  μ), under which spatial models evolve toward the upper persistence boundary (Rand,
  Keeling & Wilson 1995) [standard]. It also gives within-host fitness a virulence term.
- **Effective distance** (Brockmann & Helbing 2013): after roads.
- **Waves from the cities** (Grenfell, Bjørnstad & Kappey 2001): needs towns.
- **The firebreak** (Murray, Stanley & Brown 1986): the rabies front in the reservoir
  layer against a painted belt.
- **Small things:** the tick's counters nothing displays (`zFight*`, `animalBirths`,
  `autoQuarantined`) could weight the Model figure's arrows; isochrone labels could follow
  their lines; animal marks shade only by S/I/R/D.
- **Deferred:** per-strain vaccine efficacy or waning, M-cell breakthrough (its own
  efficacy parameter), a separate breakthrough count for Re, a barricade brush for the
  zombie reading, a cross-immunity matrix view.

## 10. Landed

| Milestone | Date | Commits | What |
|---|---|---|---|
| 2.0 | 2026-10-24 | `59dfb32`, `58a3d09` | The atlas: the plate after Snow, isochrones, glued-edge copies, Nightingale's rose, the time-scaled phylogeny, the H&E section, the inks; Cylinder and Möbius removed, the Klein bottle's flat form proved impossible. |
| Vision | 2026-10-24 | `66be1bb` | `docs/VISION.md` and the headless surveys in `tools/`. |
| 2.1 isochrones | 2026-10-24 | `030c0d1` | Isochrones re-arrive, fade with age, skip cliffs between waves; labels on fresh long lines; the rose counts Z. |
| 2.1 M1 | 2026-10-24 | `8155a8d` | Immunity by antigenic distance: the antigenic torus, per-cell memory in place of the bloom filter, σ on every infection roll, vaccine antigen, genome-aware within-host fitness, id reclamation, the immunity view, `season_amp`, 44 tests. |
| 2.1 M2 | 2026-10-24 | `e1910c3` | Strain marks from antigenic position (angle × OKLCH hue, GPU and Canvas), Fig. 3 the antigenic map with vaccine matching, Fig. 4 the captioned phylogeny. |
| 2.1 M3 | 2026-10-24 | `9a298de` | Six presets as experiments with knobs and measured captions, the experiment strip, `vax_coverage`, `animal_seed`, adaptive splicing. |
| 2.1 M4 | 2026-10-24 | `a93ad0e` | Docs (`AGENTS.md`, `about.md`, `README.md`, `index.html` text and JSON-LD), `tools/presets-survey.mjs`. |
| Performance | 2026-10-25 | `97bd94d` | A single-pass tick with source stamps, skipped rare rolls and in-place own-cell fields (2.5–3.4× faster); the isochrones in a Web Worker; census and text on a cadence; the Canvas fallback batched (Chrome's quadratic path build); the world's size a setting up to 96,661 cells; `tools/bench.mjs`. |
| Default world | 2026-10-25 | `4a632db` | 24,031 cells by default (a9's call), the opening warmed up 300 days, every preset re-surveyed at that size with knob sweeps; `tools/presets-survey.mjs` takes a radius and knob values. |
| The apparatus | 2026-10-26 | `00f5bdb` | The controls rebuilt around the plate: the view picker over it, the brush rail on it, the knob as a ruler ticked at the theory's threshold beside the caption, the experiments as numbered plates, Fig. 5 the model as a compartment diagram holding every switch and rate; Restart keeps edits, Restore undoes them. |
| Coinfection as a mixture | 2026-10-27 | `8befba2` | A coinfected host's rates are its strains' load-weighted means, and a kept strain (carrier, F-corpse, new Z, reverse spillover) is credited by load × the rate behind it; slot order no longer matters, closing the case where a pruned slot 0 dropped a host to the sim-wide rates. Presets bit-identical; the Sandbox unchanged over 100 seeds. |
| Every strain drawn | 2026-10-27 | `6466e91` | The Strain view hatches a carrier with every strain it holds, each as heavy as its load (opacity under a device pixel; one mark merges, one angle interleaves), so coinfection shows as the seams where lineages meet; a second GPU texture in the strain view, Canvas bins by weight and phase, the caption and cartouche count coinfected carriers. |
| Steady-state ages | 2026-10-27 | `68097d6` | A new world starts at the ages its natural-death rates settle into, for people and animals, instead of one newborn cohort that died off together around day 1,000; presets without natural death bit-identical, Drift and Spillover re-surveyed. "Lifespan" renamed "Old age": the age where death and the age effects stop rising, far past the mean life. |
| WebGPU only | 2026-10-27 | `b7082e3` | The Canvas 2D fallback removed (`render.js`, `?canvas2d`, every-level contouring); a browser without WebGPU sees a notice on the plate while the margin runs, and a lost device is replaced. |
| Show, don't tell | 2026-10-27 | `c18dcd8` | Captions are the day and the view's live values; the margin names without explaining. |
| The refresh | 2026-10-27 | `5419af3` | This roadmap, rewritten from the audit; `tools/spirals.mjs`, the recurring-wave prototype on the real gluing. |
| 2.2 M1 | 2026-10-27 | `31f5ce6` | Infection lineages (`src/descent.js`): every infection's source, edge and parent case, open and closed cases, trees, Re by count beside observed Re; the Descent view, a drainage map of who infected whom drawn through the gluing; 101 lineage tests; every fingerprint unchanged. |
| 2.2 M2 | 2026-10-27 | `d0d6be1` | Fig. 3, space against time along the centre row A–A′ from the lineage log (a Λ for Threshold's front, bands for Drift's seasons, strain marks in the Strain view); every strain's birthplace, and the trunk on the map through them in the Strain view; the antigenic map, phylogeny and model renumbered Figs. 4–6. |
| 2.2 M3 | 2026-10-27 | `551b64a` | Spillover as emergence (human β the knob, the reservoir starting every chain, chains lengthening through the lattice threshold, none taking over); Fig. 4 chains by size with a −3/2 guide; a transformation founds a clone, and Immunoediting's equilibrium is critical (cleared clones as s^−1.49); growth rings tried and dropped (multifocal); Drift in its Strain view with a season-long fade; trees kept per cell past the window; each plate opens in its view. |

## 11. Gotchas

- A new per-cell field that a neighbour reads needs a scratch buffer, the copy-in and
  the swap (`dynamics-scratch.js`); one that only its own cell reads (age, health, the
  memory arrays, the animal's age, 2.4's `mem_t`) is written in place, after its last
  read in the tick. A field a neighbour reads but only rare events write, like the
  lineages' `evt`, can defer its writes past the swap instead (`descent.js` `settle`).
- A pass over every cell costs about 1 ms per 100,000 cells at full speed; the tick and
  the frame visit only the cells that can act where they can (`AGENTS.md`, Performance).
  The event log and the space–time row must not add one.
- Paint snapshots per-cell state for undo (`captureCellState`). Anything per-cell that
  paint can change belongs in it.
- The GPU state texel is full, the strain view's second texture carries every strain,
  and the Descent view's third carries six half-strokes per cell. The phase view's
  cores need a texture or geometry of their own.
- `applyPreset` resets params and toggles to the defaults before merging, so a preset
  sets every key it needs, and a new mechanic's params need a quiet default in
  `presets.js` (like `NO_EVOLUTION`) so the six plates keep their fingerprints.
- Every param a mechanic reads needs a row in a Model part (`model.js` `PARTS`), or it
  can't be set outside a preset; a genome field also needs its row in
  `STRAIN_GENOME_LAYOUT`. A new transition counter the figure should weigh goes in
  `FLUX_KEYS` and on its arrow.
- The extinction sweep must count every reference to a strain (active slots, memory slot
  0 on M, R+C and D+F, `animal_strain`) before it tombstones or reclaims. The lineages'
  events keep no strain id for that reason; strain-marked strokes would need one, and
  the sweep would have to count it.
- 3.0's counter-based RNG changes every seeded run: re-survey the presets and re-record
  the bench fingerprints in the same commit.
- Calibration and model ideation for Miasma trip vendor biology filters on Sonnet lanes
  and Codex; keep them in the main loop. Rendering, UI and pure-math lanes delegate fine.
- Headless runs need `globalThis.mulberry32` and `gaussian`; `tools/*.mjs` show how.
- Citations here were verified against Crossref on 2026-10-24 and 2026-10-27. Verify any
  new one, and any date stated in prose, before it reaches `about.md` or JSON-LD.

## References

Also see `VISION.md` for the first round's list.

- Blumberg, S. & Lloyd-Smith, J. O. (2013). Inference of R0 and transmission heterogeneity from the size distribution of stuttering chains. *PLOS Comput. Biol.* 9, e1002993. doi:10.1371/journal.pcbi.1002993
- Boots, M. & Sasaki, A. (1999). "Small worlds" and the evolution of virulence: infection occurs locally and at a distance. *Proc. R. Soc. B* 266, 1933–1938. doi:10.1098/rspb.1999.0869
- Brockmann, D. & Helbing, D. (2013). The hidden geometry of complex, network-driven contagion phenomena. *Science* 342, 1337–1342. doi:10.1126/science.1245200
- Cummings, D. A. T. et al. (2004). Travelling waves in the occurrence of dengue haemorrhagic fever in Thailand. *Nature* 427, 344–347. doi:10.1038/nature02225
- Fraser, C., Riley, S., Anderson, R. M. & Ferguson, N. M. (2004). Factors that make an infectious disease outbreak controllable. *PNAS* 101, 6146–6151. doi:10.1073/pnas.0307506101
- Greenberg, J. M. & Hastings, S. P. (1978). Spatial patterns for discrete models of diffusion in excitable media. *SIAM J. Appl. Math.* 34, 515–523. doi:10.1137/0134040
- Hadfield, J. et al. (2018). Nextstrain: real-time tracking of pathogen evolution. *Bioinformatics* 34, 4121–4123. doi:10.1093/bioinformatics/bty407
- Hovmöller, E. (1949). The trough-and-ridge diagram. *Tellus* 1, 62–66. doi:10.3402/tellusa.v1i2.8498
- Klein, A. M. & Simons, B. D. (2011). Universal patterns of stem cell fate in cycling adult tissues. *Development* 138, 3103–3111. doi:10.1242/dev.060103
- Lloyd-Smith, J. O., Schreiber, S. J., Kopp, P. E. & Getz, W. M. (2005). Superspreading and the effect of individual variation on disease emergence. *Nature* 438, 355–359. doi:10.1038/nature04153
- Lloyd-Smith, J. O. et al. (2009). Epidemic dynamics at the human-animal interface. *Science* 326, 1362–1367. doi:10.1126/science.1177345
- Mollison, D. (1977). Spatial contact models for ecological and epidemic spread. *J. R. Stat. Soc. B* 39, 283–326. doi:10.1111/j.2517-6161.1977.tb01627.x
- Murray, J. D., Stanley, E. A. & Brown, D. L. (1986). On the spatial spread of rabies among foxes. *Proc. R. Soc. B* 229, 111–150. doi:10.1098/rspb.1986.0078
- Rand, D. A., Keeling, M. J. & Wilson, H. B. (1995). Invasion, stability and evolution to criticality in spatially extended, artificial host-pathogen ecologies. *Proc. R. Soc. B* 259, 55–63. doi:10.1098/rspb.1995.0009
- Smith, D. J. et al. (2004). Mapping the antigenic and genetic evolution of influenza virus. *Science* 305, 371–376. doi:10.1126/science.1097211
- Snow, J. (1856). Cholera and the water supply in the south districts of London in 1854. *J. Public Health Sanit. Rev.* 2, 239–257. On the Weekly Returns of 19 November 1853 and 14 October 1854.
- Tien, J. H. & Earn, D. J. D. (2010). Multiple transmission pathways and disease dynamics in a waterborne pathogen model. *Bull. Math. Biol.* 72, 1506–1533. doi:10.1007/s11538-010-9507-6
- Wallinga, J. & Teunis, P. (2004). Different epidemic curves for severe acute respiratory syndrome reveal similar impacts of control measures. *Am. J. Epidemiol.* 160, 509–516. doi:10.1093/aje/kwh255
- Wodarz, D. et al. (2012). Complex spatial dynamics of oncolytic viruses in vitro: mathematical and experimental approaches. *PLOS Comput. Biol.* 8, e1002547. doi:10.1371/journal.pcbi.1002547
- Foege, W. H. and colleagues: surveillance-containment in eastern Nigeria from the December 1966 Ogoja outbreak; see `VISION.md`.
- Ndemic Creations, *Plague Inc: The Cure* (2020): a strategic, global-level expansion in which the player stops a pandemic by spending points on policies; the contrast for §7.
