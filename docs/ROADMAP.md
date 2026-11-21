# Miasma Roadmap

The one authoritative plan for Miasma. `AGENTS.md` describes Miasma as it is; this file
describes where it is going. When an item lands, add it to §10 with its commit and update
`AGENTS.md`. `docs/VISION.md` holds the first ideation round (2026-10-24) and the
measurements behind it; its directions are unslated until a version here names them.

Refreshed on 2026-10-27 by Claude with a9, after 2.1, the performance pass, the apparatus
and three model passes had landed. It starts from an audit of the build (§1): the opening
and the other five plates screenshotted at day 1,000–1,800, and a prototype of recurring
waves on Miasma's own surfaces (`tools/spirals.mjs`). 2.2 landed the same day (§4). The
plans as written for 2.1 and 2.2, and the first 3.0 sketch, are in git history
(`3b01072`, `551b64a` and earlier). The versions in §3 are Claude's proposal from that
audit; a9 ratifies them through the Open items. This file lives in `docs/` so the parent
build's stager never deploys it.

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
as a figure whose parts hold every rate. The audit of 2026-10-27 found four things; 2.2
answered the first two.

1. **Half the plates read only in their captions.** Drift, Spillover and Immunoediting
   showed their phenomena only in time or in statistics, and the plate is a snapshot of
   state. *2.2 rebuilt them (§4).*
2. **The plate forgot causes.** Every infection picks one source, and the pick was thrown
   away. *2.2 keeps it as live lineages.*
3. **Contact stops at the neighbours.** Lattice R0 is capped at 6, the drift preset's
   lineages diffuse instead of forming a trunk, and the well-mixed comparison that
   `about.md` opens on appears nowhere as a number. (2.3)
4. **Only Drift recurs, and as an endemic soup.** Immunity never wanes, so every other
   run has one act. (2.4)

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
| **2.2** | Cause and time | infection lineages and the Descent view, a space–time figure, the trunk on the map, the three weak plates rebuilt (§4; landed) | M |
| **2.3** | Beyond the neighbours | the mixing dial, the ghost of the ODE, roads, two new plates: the ghost and the front (§5) | M |
| **2.4** | Time that recurs | waning that holds then lapses, the phase view with spiral cores and their charges, the year rose, the spirals plate (§6) | M |
| **3.0** | The game | tactical: orders drawn on the map on a weekly budget, reports instead of truth, an evolving adversary, scored against twins (§7) | L |

2.2 comes first: it repairs the half of the atlas that doesn't read, and its lineages are
what 3.0's trace order follows. 2.3 and 2.4 touch different parts of the tick (transmission for 2.3,
memory for 2.4) and different figures, so they can run as parallel lanes in worktrees,
with `presets.js` and `model.js` merged by hand (Open 5). The engine track (§8) runs
alongside.

## 4. 2.2: cause and time — landed 2026-10-27

Built in three milestones (§10): infection lineages, the Descent view and Re by count
(M1); Fig. 3, space against time along the centre row, and the trunk on the map through
each strain's birthplace (M2); Spillover, Drift and Immunoediting rebuilt to read on the
plate and in Fig. 4, chains by size (M3). `AGENTS.md` describes them as built. What the
work found, and what it left:

- **Re by count** [measured] agrees with the ratio estimator on a spreading front
  (Threshold 0.97–1.07 against 0.90–1.25; Spillover 0.37 against 0.40) and parts from it
  in the Z presets (count near 1, ratio 1.4–2.1), because Z deaths never enter the
  ratio's removals.
- **Spillover is emergence** [measured]. The reservoir's immunity moved the threshold
  further than expected: at the old spillover rate (0.02) it immunizes 40–60% of people,
  past the lattice's herd threshold, so the preset runs at 0.001. There the mean chain in
  the first year runs 3.2, 5.6, 8.9, 12.6, 15.6 and 20.2 cases for β 0.02 to 0.08,
  steepest between 0.04 and 0.05, about the lattice threshold (0.048), while the
  branching foil diverges at 0.023. Past the threshold no single chain takes over: the
  reservoir keeps starting chains elsewhere, so they tile the world, each finite. "One
  that doesn't stop" would need spillover rarer than a front's crossing time, which would
  leave the plate nearly empty.
- **Immunoediting's growth rings were built and dropped** [measured]. Transformation
  happens wherever the latent virus is, so the tumour is multifocal and each 100-day
  margin is a scatter of small loops; a single mass can't sit at equilibrium (a lone front
  either grows or shrinks). Clones in Fig. 4 took their place: at the hold (0.29) cleared
  clones fall as s^−1.49 over sizes 2–512, the critical branching process's −3/2,
  steepening to −1.88 and −2.03 at 0.32 and 0.35; under escape hardly any clone is
  cleared. Nothing pins the hold at the critical point: with new transformations feeding
  clones in, holding doesn't force it there (a homeostatic tissue without inflow must be
  exactly critical: Klein & Simons 2011).
- **Drift** reads in its Strain view, with isochrones faded over 180 days so only the
  current season's wave is labelled.
- **Left open:** Descent strokes in each strain's mark (the M1 sketch) need a strain per
  edge in the texel and a strain id on each event, which the extinction sweep would then
  have to count. The offspring distribution, whose dispersion is the superspreading k of
  Lloyd-Smith et al. 2005 [standard], is logged (each case's children) but not drawn; it
  is capped at 6 offspring until 2.3.

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
over time, so a core keeps its identity as it crosses a seam. The GPU state texel is
full, so the cores need a texture or geometry of their own.

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
- **The reservoir:** emergence (§4). Are the chains people's or the animals'? It
  decides whether culling or cordons are the right spend.
- **The unknown country:** the plate hides its chevrons and glued-edge copies. Read the
  gluing from where the wave comes back, mirrored or not, and cordon the seam before it
  arrives; in 2.4, a spiral whose turning flips gives it away. Only Miasma could set this
  case.
- **The cure:** oncolytic virotherapy on the H&E section, an epidemic you want to win
  (`VISION.md` H; Wodarz et al. 2012) [standard].
- **Zombie defense,** for fun.

### 7.7 What it needs first

1. The counter-based RNG (the twins); 2.2's lineages, which tracing and the epilogue
   follow, have landed. Every
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

- **2.0, the atlas** (2026-10-24, `59dfb32`, `58a3d09`): the plate after Snow, isochrones,
  glued-edge copies, the rose, the phylogeny, the H&E section, the inks; Cylinder and
  Möbius removed, the flat Klein bottle proved impossible.
- **Vision** (2026-10-24, `66be1bb`): `docs/VISION.md` and the headless surveys.
- **2.1** (2026-10-24): isochrones that re-arrive and fade (`030c0d1`); immunity by
  antigenic distance (M1, `8155a8d`); strain marks from antigenic position, the antigenic
  map, the phylogeny (M2, `e1910c3`); six presets as experiments (M3, `9a298de`); docs and
  `tools/presets-survey.mjs` (M4, `a93ad0e`).
- **Performance** (2026-10-25, `97bd94d`): a single-pass tick 2.5–3.4× faster, isochrones
  in a worker, text on a cadence, the world's size a setting up to 96,661 cells,
  `tools/bench.mjs`.
- **Default world** (2026-10-25, `4a632db`): 24,031 cells (a9's call), every preset
  re-surveyed.
- **The apparatus** (2026-10-26, `00f5bdb`): the controls rebuilt around the plate; the
  knob as a ruler; Restart keeps edits, Restore undoes them.
- **Coinfection as a mixture** (2026-10-27, `8befba2`), **every strain drawn**
  (`6466e91`), **steady-state ages** (`68097d6`), **WebGPU only** (`b7082e3`), **show,
  don't tell** (`c18dcd8`), **the refresh** of this roadmap and `tools/spirals.mjs`
  (`5419af3`).
- **2.2** (2026-10-27, §4): lineages, Descent and Re by count (M1, `31f5ce6`); Fig. 3 and
  the trunk on the map (M2, `d0d6be1`); the three plates rebuilt (M3, `551b64a`).

## References

Also see `VISION.md` for the first round's list.

- Boots, M. & Sasaki, A. (1999). "Small worlds" and the evolution of virulence: infection occurs locally and at a distance. *Proc. R. Soc. B* 266, 1933–1938. doi:10.1098/rspb.1999.0869
- Brockmann, D. & Helbing, D. (2013). The hidden geometry of complex, network-driven contagion phenomena. *Science* 342, 1337–1342. doi:10.1126/science.1245200
- Fraser, C., Riley, S., Anderson, R. M. & Ferguson, N. M. (2004). Factors that make an infectious disease outbreak controllable. *PNAS* 101, 6146–6151. doi:10.1073/pnas.0307506101
- Greenberg, J. M. & Hastings, S. P. (1978). Spatial patterns for discrete models of diffusion in excitable media. *SIAM J. Appl. Math.* 34, 515–523. doi:10.1137/0134040
- Klein, A. M. & Simons, B. D. (2011). Universal patterns of stem cell fate in cycling adult tissues. *Development* 138, 3103–3111. doi:10.1242/dev.060103
- Lloyd-Smith, J. O., Schreiber, S. J., Kopp, P. E. & Getz, W. M. (2005). Superspreading and the effect of individual variation on disease emergence. *Nature* 438, 355–359. doi:10.1038/nature04153
- Mollison, D. (1977). Spatial contact models for ecological and epidemic spread. *J. R. Stat. Soc. B* 39, 283–326. doi:10.1111/j.2517-6161.1977.tb01627.x
- Murray, J. D., Stanley, E. A. & Brown, D. L. (1986). On the spatial spread of rabies among foxes. *Proc. R. Soc. B* 229, 111–150. doi:10.1098/rspb.1986.0078
- Rand, D. A., Keeling, M. J. & Wilson, H. B. (1995). Invasion, stability and evolution to criticality in spatially extended, artificial host-pathogen ecologies. *Proc. R. Soc. B* 259, 55–63. doi:10.1098/rspb.1995.0009
- Snow, J. (1856). Cholera and the water supply in the south districts of London in 1854. *J. Public Health Sanit. Rev.* 2, 239–257. On the Weekly Returns of 19 November 1853 and 14 October 1854.
- Tien, J. H. & Earn, D. J. D. (2010). Multiple transmission pathways and disease dynamics in a waterborne pathogen model. *Bull. Math. Biol.* 72, 1506–1533. doi:10.1007/s11538-010-9507-6
- Wodarz, D. et al. (2012). Complex spatial dynamics of oncolytic viruses in vitro: mathematical and experimental approaches. *PLOS Comput. Biol.* 8, e1002547. doi:10.1371/journal.pcbi.1002547
- Foege, W. H. and colleagues: surveillance-containment in eastern Nigeria from the December 1966 Ogoja outbreak; see `VISION.md`.
- Ndemic Creations, *Plague Inc: The Cure* (2020): a strategic, global-level expansion in which the player stops a pandemic by spending points on policies; the contrast for §7.
