# Miasma: where it could go

A working draft from an ideation round on 2026-10-24, the day the atlas rebuild landed.
It is for a9 and whichever agent picks the work up next: what Miasma is strong at,
what it lacks, and directions that could take it many sessions to reach. Nothing here
is ratified. Claims carry a tag: **[standard]** for an established result,
**[synthesis]** for a connection drawn here, **[speculation]** for a guess still to
test. Codex checked every citation against a retrieved source (several claims were
corrected), Crossref confirmed every DOI, and Codex adversarially checked the
topology argument in G. Codex's ideation consult was cut off by its vendor's
biological-risk filter (a false positive on an educational lattice model). Its one
surviving paragraph independently matched the exact-id novelty finding and the
handedness point, and it caught the within-host competition bug.

## The thesis

Miasma is wide but shallow. It has eight compartments, three flags, a status layer, a
26-field genome, recombination, a reservoir, Z, and four surfaces. Few of those
mechanisms yet produce the phenomenon that makes them famous, and none is measured
against the theory it belongs to. Taken to its logical conclusion it becomes **a
working atlas of spatial epidemiology**. Each plate reproduces one canonical result
live on the lattice, measures it, and prints the measurement beside the theory's
prediction. The reader acts under the constraints real epidemiologists faced: partial
reports, finite doses, delay.

The name already points there. Miasma is the bad-air theory of cholera, and John
Snow's 1854 map, the style the plate is drawn in, is the evidence that overturned it.
The sim is named for the wrong hypothesis and drawn in the style of its refutation. A
plate where the reader plays Snow and tells miasma from water by the pattern of deaths
alone would close that loop (see Plate I below).

## What it is strong at

- **The plate.** The atlas medium works. Isochrones keep the outbreak's history on the
  map after the wave has passed. The glued-edge copies, drawn with the correct
  isometries and pickable, make the topology legible without any 3D. The H&E reskin
  (the same lattice read at the scale of cells) is the right instinct: one state
  machine, two scales.
- **Mathematical honesty about the surfaces.** It has 2,510 topology checks, an
  exhaustive search over 4,864 gluings, and a proof that the flat glide Klein bottle
  can't exist on this lattice. Few sims hold themselves to that.
- **Determinism and headless import.** `?seed=` and Node-importable dynamics made the
  survey below a 30-line script. Every direction that needs measurement builds on this.
- **Direct manipulation.** Painting interventions onto the map is the right interface.
  It needs constraints, not replacement.

## What the measurements say

Headless survey on 2026-10-24 (`node tools/survey.mjs`): seed 12345, two 7-cell seed
clusters at the opening offsets, 3,000 ticks per preset. T is the per-edge transmissibility,
`1 − q(1−β)/(1 − (1−q)(1−β))` with exit rate `q = γ + μ` (geometric infectious
period). The bond-percolation threshold of the triangular lattice, which is the
adjacency graph of hex cells, is `p_c = 2 sin(π/18) ≈ 0.347`. β_c solves T(β) = p_c.
This treats edges as independent, which overstates the precision: with random
infectious periods a cell's edges are correlated, so the true threshold sits somewhat
higher (Grassberger 1983 gives the percolation-type threshold **[standard]**). The
ordering still holds.

| Preset | T | β / β_c | Fate by day 3,000 |
|---|---|---|---|
| SEIR vanilla | 0.79 | 5.2 | one wave, extinct day 311 |
| COVID-like | 0.89 | 9.6 | extinct day 142, peak 31 |
| Ebola | 0.74 | 4.4 | flat endemic, ~520–700 active |
| TB | 0.93 | 21 | slow decay, 27 → 5 active |
| Andes hantavirus | 0.48 | 1.7 | flat endemic, ~840–880 |
| Smallpox | 0.93 | 12 | extinct day 227, peak 42 |
| Plague + rats | 0.82 | 6.2 | flat endemic, ~510–660 |
| Zombie apocalypse | 0.82 | 6.2 | zombies extinct day 1,346 |
| Oncoviral | 0.84 | 9.1 | 6,524 transformed from day ~200, static |
| Absurd | 0.89 | 8.0 | all zombie, then decays to 1 |
| Defaults (sandbox) | 0.79 | 5.2 | flat endemic, ~1,050–1,170 |

What follows from it:

1. **Every preset is far supercritical, and the interesting regime is a sliver of the
   β slider.** A sweep of SEIR vanilla on the plane (one seed cell at the center,
   eight seeds per β, final size as a fraction of the 10,621 cells):

   | β | 0.045 | 0.055 | 0.060 | 0.065 | 0.070 | 0.080 | 0.110 | 0.150 | 0.32 (preset) |
   |---|---|---|---|---|---|---|---|---|---|
   | mean final size | 0.1% | 0.4% | 1.2% | 7% | 27% | 64% | 84% | 99% | 100% |
   | runs above 10% | 0/8 | 0/8 | 0/8 | 2/8 | 5/8 | 7/8 | 7/8 | 8/8 | 8/8 |

   The crossover sits near β ≈ 0.067, just above the independent-edge prediction of
   0.061, in the direction correlated edges should push it. Everything between
   "fizzles" and "fills the world" happens for β in 0.055–0.09. With T between 0.74
   and 0.93, the wave
   fills nearly everything it touches, so every outbreak looks like the same solid
   ring at a different speed. The "holes in the wavefront" that `about.md` celebrates
   belong to the near-threshold regime (T ≈ 0.35–0.5), where the outbreak is a fractal
   cluster and chance decides the shape. Only hantavirus, propped up by its
   reservoir, gets close.
2. **COVID-like and smallpox never spread.** They died in 5 of 5 seeds with the
   default-on contact tracing. With `auto_quarantine` off they peaked at 4.6–5.0k and
   2.7–3.0k active in all five. Tracing is instant, unlimited and omniscient: it sees
   every true case at rate 0.5 a day.
3. **There is one act.** Each run ends in extinction, a flat plateau, or saturation.
   Nothing oscillates: there is no R → S waning (only partial reinfection through
   `r_susceptibility_mult`) and no seasonality, so nothing recurs. After the first
   wave there is nothing to watch.
4. **Evolution is cosmetic.** Thousands of strains are born (Ebola 1,585, plague
   2,222), and the carriers' mean β drifts up a little (Ebola 0.220 → 0.234, plague
   0.340 → 0.370). Lineages stay shallow, though: mean depth 0.5–1.8 and at most 5
   generations from α by day 3,000. The phylogeny is a broom, not a tree. The cause
   is structural. Cross-immunity is exact membership of a strain id in the bloom
   filter, so every mutant, however small the change, is completely novel to every
   host. Escape is binary and costs nothing, so no lineage holds an antigenic
   advantage long enough to build a trunk. Within a host, selection ignores the
   genome too: the incumbent strain always wins (see B). Without tracing, COVID-like registers
   about 12,000 strains by day 600 (2,400 living), so a long run at high incidence
   would reach the 65,535 cap.
5. **"Observed Re ≈ 1" while the outbreak grows.** The opening plate reads Re 0.86
   with the wave still advancing. That isn't a bug. On a lattice, incidence grows with
   the front's circumference, roughly linearly, not exponentially, so the ratio
   estimator hovers near 1 **[standard]**. It is the most important thing the lattice
   teaches, and the plate never says so.

## What it lacks

- **The comparison it was built for.** `about.md` opens on the contrast with the
  well-mixed ODE, but the ODE appears nowhere, and no number is measured against a
  theory.
- **Any mixing beyond nearest neighbors.** It has no travel, no dispersal kernel, and
  no long-range jumps. Lattice R0 is capped at 6 by geometry, so a measles-like
  pathogen (R0 12–18) can't be calibrated.
- **Recurrence.** Waning immunity, seasonal forcing, and the cycles and spirals they
  produce are all missing.
- **Antigenic structure.** Immunity can't depend on how different two strains are.
- **An observer.** The plate shows the truth, which no epidemiologist ever sees.
- **Constraint.** Interventions are free and instant, and tracing is omniscient.
- **Topology that matters to a phenomenon.** On a scalar contact process, the surface
  only changes which cells neighbor which. Non-orientability can't show until
  something in the scene has a handedness.
- **A plate for Z's own story.** The oncoviral run saturates into a uniform purple
  section, and its rose stays empty because the rose counts only E, R and D
  transitions.

## Directions

Each direction names the phenomenon it should make visible and what it depends on.

### A. The instrument: lattice to mean field

Add a dispersal kernel: a fraction ε of contacts goes to a cell drawn from a kernel
(exponential with length ℓ, a power law, or uniform). ε = 0 is today's lattice. ε = 1
with a uniform kernel is mass action, where the lattice must reproduce the ODE. Run the
mean-field SEIR(D) with the same per-tick rates beside the lattice, and draw it as a
ghost: a dashed envelope on the rose, plus a line in the caption giving
Kermack–McKendrick's final size against the lattice's.

- Implementation: push sampling. Each infectious source makes Poisson(ε·λ)
  long-range attempts per tick, resolved against start-of-tick state. Cost is O(#I).
  The jump is a straight segment in the universal cover, wrapped back through the
  gluing with `wrap` (or absorbed at a shore), so long jumps cross the surface
  correctly.
- Unlocks: tails heavier than exponential give accelerating fronts in deterministic
  models (Mollison 1977) **[standard]**, so the isochrones visibly spread apart.
  Long-range transmission selects for higher virulence than local transmission does
  (Boots & Sasaki 1999, within their model) **[standard]**, which pairs with B. It also
  enables the effective-distance plate (X) and calibrating R0 beyond 6.
- This is the most on-mission single addition, and it is medium-sized.

### B. Antigenic space: evolution that matters

Give each strain an antigenic coordinate in ℝ². Mutation moves it by a small Gaussian
step, and recombination takes the midpoint. Replace exact-id cross-immunity with
distance-based immunity: each cell remembers its last K (2–4) antigenic positions and
the tick of each, and its susceptibility to strain s falls off with the distance from
s to the nearest memory. Storage is about 340 KB at K = 4.

- Expected: a trunk-and-twig phylogeny in place of today's broom, antigenic clusters,
  and strain replacement arriving as waves across the plate **[synthesis]**: the
  influenza pattern (Smith et al. 2004 on clustered H3N2 antigenic evolution; the
  phylodynamic frame in Grenfell et al. 2004) on a lattice.
- Depiction: the hatch angle becomes the antigenic direction, so related strains
  hatch alike, and a sweep reads as hatching rotating across the plate (depict, don't
  decorate). The Strains tab gains an antigenic map: strains as points sized by
  prevalence, with the trunk as a trail. Smith's figure is a map, so it already
  belongs in an atlas.
- Optional transmission–virulence trade-off (β tied to μ). On a lattice with host
  regrowth, spatial models evolve toward the *upper* persistence boundary, where a
  more transmissible pathogen burns out its local hosts and dies out (Rand, Keeling &
  Wilson 1995) **[standard]**. Every preset already sits in that over-exploiting
  regime, so this plate is closer than it looks.
- Fix first: within-host selection ignores the genome. Step 3 updates each slot as
  `old · (1 + k·(old − 1/n))` (`src/dynamics.js:460`), so a strain's fitness is its
  own current load. The incumbent always grows, and a coinfecting strain that enters
  at `coinfection_load_delta` = 0.35 always loses, whatever its genome. That is
  frequency-dependent positive feedback, not replicator dynamics. Fitness should come
  from a genome field, such as a within-host replication rate, which is also where a
  nested within-host/between-host trade-off would live. (Codex spotted it; confirmed
  here.)

### C. Time that recurs

Add R → S and V → S waning as genome fields, and seasonal forcing
β(t) = β₀(1 + A cos 2πt/365).

- Expected: damped oscillations toward endemicity. With births and forcing,
  transitions among annual, biennial and irregular cycles (Earn et al. 2000, a
  term-time-forced SEIR with susceptible recruitment) **[standard]**. Spatially,
  recurring waves and, with temporary resistance, spirals (van Ballegooijen &
  Boerlijst 2004) **[standard]**. Their model uses fixed infection and resistance
  periods, so memoryless (geometric) durations may give only noisy patterns.
  Erlang-distributed durations, a per-cell time-in-state counter, would sharpen
  them **[speculation]**.
- The rose becomes a year: twelve thirty-day wedges, last year dashed. Nightingale's
  1858 diagrams were exactly that, two polar-area diagrams of twelve monthly sectors
  each (April 1854–March 1855 and April 1855–March 1856), so seasonality then shows as
  a lopsided rose.
- Isochrones generalize to activation maps: contour the days since the last arrival
  (or the phase of the current cycle), the way cardiac electrophysiology draws
  isochronal activation maps. Phase singularities, the spiral cores, get small
  circled marks, like the cone points.

### D. The observer

Make detection a process: each I and D is reported with some probability after a
delay, testing capacity is finite, and tracing acts only on reported cases. The
default plate shows what was reported. Snow mapped deaths, not infections. The truth
is a separate view, or an epilogue revealed at the end, the way Shoals reveals its
hidden tracks. Adopt Shoals' rule: the reported path never reads hidden state except
through detection.

- It fixes the omniscient tracing that kills COVID-like and smallpox, and it makes
  "a week too late" a matter of information rather than reflexes.
- Observed Re from reports, with its bias against true Re drawn beside it. Later, a
  nowcast band for the true front **[speculation]**.

### E. The response

Budgets (doses a day, beds, tracers a day) spent by painting. Vaccine immunity starts
after a delay. Then the experiments the budget makes meaningful:

- **Ring vaccination.** Surveillance-containment, applied by Foege and colleagues from
  the December 1966 Ogoja outbreak amid vaccine and transport shortages (the approach
  was already outlined in the 1966 programme documents) **[standard]**. Limited doses,
  reported cases only: does a ring around each report beat spreading them evenly?
- **The firebreak.** Murray, Stanley & Brown 1986 estimated the minimum width of a
  vaccinated break that stops the fox-rabies front (about 15 km for their English
  parameterization) **[standard]**. Run the wave in the reservoir layer, paint a
  vaccinated belt, and have the plate report whether it held. On the lattice the
  critical width depends on T **[synthesis]**.
- **Counterfactual twins.** At the moment of an intervention, fork the world and run
  the untouched copy alongside (or N copies, for a band). Draw the counterfactual's
  isochrones dashed and print what the intervention bought. This is the line in
  `about.md` about the late campaign looking like the on-time one "until it suddenly
  doesn't", made into an instrument. It needs I1.
- **Rewind and branch.** Keyframes plus a replayable intervention log: rewind seven
  days and paint again. Put the seed, preset and log in the URL and a plate becomes
  shareable.

### F. Plates as experiments

Presets stay as pathogens. Plates become phenomena, each with a question, a setup, a
live measurement and the theory's number. A first list:

| Plate | Question | Theory | Needs |
|---|---|---|---|
| I. Broad Street | Miasma or water? Find the pump from the deaths | Snow 1855 | water route (below) |
| II. The ghost of the ODE | How does space change an epidemic? | Kermack–McKendrick | A |
| III. The threshold | Below which β does an outbreak stay finite? | percolation-type threshold (Grassberger 1983) | final-size readout, β_c mark; possible now |
| IV. The front | How fast does a plague travel? | Fisher–KPP speed; Noble 1974 modeled the Black Death's spread | front-speed measurement |
| V. The firebreak | How wide must the belt be? | Murray, Stanley & Brown 1986 | reservoir wave, belt test |
| VI. The ring | Ring or mass vaccination, with few doses? | Foege, Ogoja 1966 | D, E |
| VII. The section | (exists) H&E reading of Z | | |
| VIII. Drift | Why does flu come back every winter? | Smith et al. 2004 | B, C |
| IX. From the cities | Do epidemics radiate from big towns? | Grenfell, Bjørnstad & Kappey 2001 | towns, C |
| X. Effective distance | Can a tangled map be made concentric? | Brockmann & Helbing 2013 | A with routes |
| XI. The edge of extinction | Where does evolution take β? | Rand, Keeling & Wilson 1995 | B trade-off, births |
| XII. Spirals on a cross-cap | Can two spirals turn the same way? | G below | C |
| XIII. The cure | An epidemic you want to win | Wodarz et al. 2012 | H |

**Plate I, Broad Street.** Add an environmental route: water sources are point cells,
each inhabited cell draws from its nearest source by lattice distance, and an infected
source infects its drinkers (the SIWR shape of Tien & Earn 2010 **[standard]**). Snow's
1855 parish-report map drew the boundary of equal distance by nearest road between the
Broad Street pump and its neighbors, an early network-distance Voronoi boundary
**[standard]**. The plate draws the same boundary on the lattice, through the gluing on
the closed surfaces. The reader sees deaths only and must decide between air (a ring
of crosses that diffuses outward) and water (crosses clustered in one pump's cell, with
sharp edges at the boundary), then remove the handle. It is the plate the name asks
for.

**Plate X, effective distance.** Brockmann & Helbing 2013 showed that arrival time is
roughly linear in an effective distance derived from the air-traffic network, so
complex spread becomes concentric again **[standard]**. Here, towns linked by routes
(A) scramble the isochrones, and a toggle redraws the plate in effective distance from
the source until the same isochrones become rings. It is a signature view the atlas
medium is uniquely suited to.

Each plate's measurement doubles as a regression test (for example, "Plate III: the
measured β_c lies within 10% of the corrected threshold").

### G. Topology that matters

The surfaces only change the contact graph, so the dynamics can't tell a mirrored copy
from an unmirrored one until something in the scene turns. A rotating wave does (C),
and then:

- **Same-handed spirals.** Count the winding number (charge) of each spiral core in
  the orientation of the world hexagon, a disk. The total charge equals the phase's
  winding around the hexagon's boundary. A translated edge pair reverses the induced
  boundary orientations, so its two edges cancel, and on the torus the total is zero.
  A twisted pair preserves them, so its two edges add. On the Klein bottle and RP²
  the only constraint is that the total charge is even. (Proof: a punctured
  non-orientable genus-g surface has the presentation `a₁²⋯a_g² c₁⋯c_n = 1`, so the
  puncture windings satisfy `2ΣA_j + ΣC_i = 0`, which is solvable exactly when ΣC_i
  is even.) **[synthesis, checked by Codex]** Consequences:
  - Exactly two unit spirals turning the same way are allowed on Klein and RP² and
    forbidden on the torus. Codex's explicit Klein phase field on
    `(x, y) ~ (x + 2π, y)`, `(x, y + 2π) ~ (−x, y)` is
    `F = cos x + i sin x cos(y/2)`: two +1 zeros, at (π/2, π) and (3π/2, π). Seeing
    two same-handed spirals alone doesn't rule out the torus, since compensating cores
    may sit elsewhere; the claim is about the complete set of cores.
  - A lone charge-2 core (a two-armed spiral) is topologically allowed on Klein and
    RP² and forbidden on the torus. Whether the medium sustains one is a dynamical
    question.
  - The cleanest thing to watch is one core carried across a twisted seam: its charge
    in screen orientation reverses, and the total in the hexagon jumps by 2. The
    mirrored copies already draw the far side of the seam.
  - Cone points add no constraint. A cone neighborhood is still a disk, and a core can
    sit at any cone point, even the 120° one, with any integer charge.
  - "Possible" means a compatible phase field exists. Whether the automaton reaches and
    sustains that configuration is for the sim to show.
- **Cone points as curvature.** On curved surfaces spirals drift with the gradient of
  Gaussian curvature (Davydov & Zykov 1991), toward maximal or minimal curvature
  depending on parameters (Dierckx et al. 2013) **[standard]**. The 240° cone points
  are concentrated positive curvature and the 480° ones negative. Do spirals pin to
  them or flee them? **[speculation]** Neither paper gives a law for cone points:
  curvature concentrated at an apex has no smooth gradient to feed a drift formula.
  The core's finite size, its interaction with the apex, and the lattice can still
  pin a spiral or repel it, so the direction and strength need model-specific
  evidence. That makes it a question the sim can answer and the literature can't.
- Smaller: Plate I's pump boundaries and A's long jumps both run through the gluing,
  mirrored across a twist.

### H. The other scale

The oncoviral reading ends static. The rose should count transformations, and the
model wants a necrotic core and an immune-infiltration front so the section keeps
changing. Its logical conclusion is **oncolytic virotherapy**: a strain whose tropism
is transformed (Z) cells, seeded into the tumor by the reader. The epidemic machinery
becomes the treatment. Wodarz et al. 2012 observed and modeled hollow rings, filled
rings and dispersed patterns of oncolytic adenovirus spread in 2D cultures of human
293 cells **[standard]**, all patterns the H&E plate can draw. The sim's last plate is
an epidemic you want to win.

### I. The engine

1. **Counter-based RNG**: u = hash(seed, tick, cell, stream) in place of the
   sequential `mulberry32` stream. Coupled twins then share their random draws cell
   by cell (common random numbers), so a twin differs only by the intervention. Replay
   can start from any keyframe, and a GPU tick can match the CPU one. It is small and
   unlocks E and the measurement harness.
2. **A measurement harness** in `tools/` (staged-out). `tools/survey.mjs` and
   `tools/threshold.mjs` reproduce every number in this document. The harness proper
   promotes them to scripted experiments, one per plate.
3. **A WebGPU compute tick** at about 10⁶ cells (R ≈ 577). It makes threshold and
   front-roughness measurements clean and makes the plate atlas-dense. The CPU path
   stays at today's size. The strain registry becomes a storage buffer with atomic
   append. Large; worth it once size is the bottleneck.

## Found in passing

1. Default-on `auto_quarantine` makes COVID-like and smallpox fizzle in 5 of 5 seeds
   (above). Either those presets turn it off, or tracing gets capacity and detection
   (D).
2. The rose counts E, R and D transitions only, so the oncoviral rose stays empty
   while 6,500 cells transform.
3. In the strain view, vaccination hatching (prussian) is drawn but missing from the
   cartouche, so at a glance it reads as a strain.
4. Under spillover-driven regimes (plague), isochrone labels land like "day 24" beside
   "day 192". The contours are honest, but the labels are noise. Suppress labels where
   the local field is incoherent, or switch to days since last arrival (C).
5. Strain-registry growth: see "Evolution is cosmetic" above.
6. Hospital capacity is `h_capacity_frac · W · H` (14,400 cells) rather than the
   active count (10,621), so the stated fraction is off by 36%. It is documented, but
   probably not intended.
7. Within-host competition is genome-blind, and the incumbent always wins
   (`src/dynamics.js:460`; see B).

## A possible order

1. I1 counter-based RNG and I2 the harness. Small, and they make everything after
   them measurable.
2. A, the mixing dial and the ODE ghost. Foundational and on-mission. Plates II and
   III follow almost for free.
3. Plate I, Broad Street (the water route plus the death-only view). It is the
   thematic keystone, and it's medium-sized.
4. C, recurrence (waning, seasonality, the year-long rose, activation maps). It ends
   the one-act problem and sets up G.
5. B, antigenic space. Plates VIII and XI.
6. D and E, the observer and the response, with twins. Large; plates VI and V.
7. G, H, and I3 as the earlier work lands.

## Open questions for a9

- Is "an atlas of plates, each an experiment" the right top-level frame? It turns the
  preset dropdown into an atlas index, with pathogens as a second axis.
- How much game? Shoals has a full game layer. Should Miasma score interventions
  (deaths averted per dose), or stay an instrument?
- Abstract world or geography? Towns, rivers and roads (needed for IX and X) against
  the purity of the hexagonal world.
- Real disease names: keep "COVID-like" hand-tuned, or calibrate to published R0 and
  serial intervals once A makes R0 > 6 reachable?

## References

- Boots, M. & Sasaki, A. (1999). "Small worlds" and the evolution of virulence: infection occurs locally and at a distance. *Proc. R. Soc. B* 266, 1933–1938. doi:10.1098/rspb.1999.0869
- Brockmann, D. & Helbing, D. (2013). The hidden geometry of complex, network-driven contagion phenomena. *Science* 342, 1337–1342. doi:10.1126/science.1245200
- Davydov, V. A. & Zykov, V. S. (1991). Kinematics of spiral waves on nonuniformly curved surfaces. *Physica D* 49, 71–74. doi:10.1016/0167-2789(91)90195-F
- Dierckx, H., Brisard, E., Verschelde, H. & Panfilov, A. V. (2013). Drift laws for spiral waves on curved anisotropic surfaces. *Phys. Rev. E* 88, 012908. doi:10.1103/PhysRevE.88.012908
- Earn, D. J. D., Rohani, P., Bolker, B. M. & Grenfell, B. T. (2000). A simple model for complex dynamical transitions in epidemics. *Science* 287, 667–670. doi:10.1126/science.287.5453.667
- Foege, W. H. and colleagues: surveillance-containment in eastern Nigeria from the December 1966 Ogoja outbreak; see Foege's retrospective in the *Bulletin of the WHO* and Henderson's WHO interview on the 1966 programme documents.
- Grassberger, P. (1983). On the critical behavior of the general epidemic process and dynamical percolation. *Math. Biosci.* 63, 157–172. doi:10.1016/0025-5564(82)90036-0
- Grenfell, B. T., Bjørnstad, O. N. & Kappey, J. (2001). Travelling waves and spatial hierarchies in measles epidemics. *Nature* 414, 716–723. doi:10.1038/414716a
- Grenfell, B. T. et al. (2004). Unifying the epidemiological and evolutionary dynamics of pathogens. *Science* 303, 327–332. doi:10.1126/science.1090727
- Mollison, D. (1977). Spatial contact models for ecological and epidemic spread. *J. R. Stat. Soc. B* 39, 283–326 (with discussion). doi:10.1111/j.2517-6161.1977.tb01627.x
- Murray, J. D., Stanley, E. A. & Brown, D. L. (1986). On the spatial spread of rabies among foxes. *Proc. R. Soc. B* 229, 111–150. doi:10.1098/rspb.1986.0078
- Nightingale, F. (1858). Diagram of the causes of mortality in the army in the East. In *Notes on Matters Affecting the Health, Efficiency, and Hospital Administration of the British Army*.
- Noble, J. V. (1974). Geographic and temporal development of plagues. *Nature* 250, 726–729. doi:10.1038/250726a0. Whether it quantitatively fits a Fisher wave is unconfirmed; it develops a spatial model applied to the Black Death.
- Rand, D. A., Keeling, M. J. & Wilson, H. B. (1995). Invasion, stability and evolution to criticality in spatially extended, artificial host-pathogen ecologies. *Proc. R. Soc. B* 259, 55–63. doi:10.1098/rspb.1995.0009
- Smith, D. J. et al. (2004). Mapping the antigenic and genetic evolution of influenza virus. *Science* 305, 371–376. doi:10.1126/science.1097211
- Snow, J. (1855). Dr. Snow's Report. In *Report on the Cholera Outbreak in the Parish of St. James, Westminster* (Cholera Inquiry Committee).
- Tien, J. H. & Earn, D. J. D. (2010). Multiple transmission pathways and disease dynamics in a waterborne pathogen model. *Bull. Math. Biol.* 72, 1506–1533. doi:10.1007/s11538-010-9507-6
- van Ballegooijen, W. M. & Boerlijst, M. C. (2004). Emergent trade-offs and selection for outbreak frequency in spatial epidemics. *PNAS* 101, 18246–18250. doi:10.1073/pnas.0405682101
- Wodarz, D. et al. (2012). Complex spatial dynamics of oncolytic viruses in vitro: mathematical and experimental approaches. *PLOS Comput. Biol.* 8, e1002547. doi:10.1371/journal.pcbi.1002547
