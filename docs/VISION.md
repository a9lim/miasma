# Miasma: where it could go

A working draft from an ideation round on 2026-10-24, the day the atlas rebuild landed:
what Miasma was strong at, what it lacked, and directions that could take it many
sessions to reach. Nothing here is ratified; what a9 slated from it lives in
`ROADMAP.md`. B (antigenic space) and the preset rework became 2.1 and landed on
2026-10-24, with seasonality from C and the round's "found in passing" fixes. The
2026-10-27 refresh proposed A as 2.3, C and G as 2.4, and D, E, Plate I and H as the
core and cases of 3.0, the tactical game. Rewind, replay and shareable runs (E, and I1
except for 3.0's twins) were set aside that day (a9's call): Miasma is a live, causal,
observational sandbox, not a record.

Claims carry a tag: **[standard]** for an established result, **[synthesis]** for a
connection drawn here, **[speculation]** for a guess still to test. Codex checked every
citation against a retrieved source, Crossref confirmed every DOI, and Codex
adversarially checked the topology argument in G. Codex's ideation consult was cut off
by its vendor's biological-risk filter (a false positive on an educational lattice
model).

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

## What it was strong at

- **The plate.** Isochrones keep the outbreak's history on the map after the wave has
  passed; the glued-edge copies, drawn with the correct isometries and pickable, make
  the topology legible without 3D; the H&E reskin reads one state machine at two scales.
- **Mathematical honesty about the surfaces:** an exhaustive search over 4,864 gluings
  and a proof that the flat glide Klein bottle can't exist on this lattice.
- **Determinism and headless import,** which every direction that needs measurement
  builds on.
- **Direct manipulation.** Painting interventions onto the map is the right interface.
  It needs constraints, not replacement.

## What the measurements said

A headless survey of the pre-2.1 presets (seed 12345, 3,000 ticks each; the presets and
their tables are in git history). T is the per-edge transmissibility,
`1 − q(1−β)/(1 − (1−q)(1−β))` with exit rate `q = γ + μ`; the bond-percolation
threshold of the triangular lattice (the hex cells' adjacency graph) is
`p_c = 2 sin(π/18) ≈ 0.347`, and β_c solves T(β) = p_c. Independent edges overstate the
precision: with random infectious periods a cell's edges are correlated, so the true
threshold sits somewhat higher (Grassberger 1983) **[standard]**.

1. **Every preset was far supercritical** (T 0.74–0.93), so every outbreak looked like
   the same solid ring at a different speed. A final-size sweep on the plane put the
   crossover near β ≈ 0.067, just above the independent-edge 0.061, in the direction
   correlated edges should push it; everything between "fizzles" and "fills the world"
   happened for β in 0.055–0.09. The holes in the wavefront belong to the
   near-threshold regime (T ≈ 0.35–0.5). *Became the Threshold plate.*
2. **Tracing is omniscient.** Default-on `auto_quarantine` is instant, unlimited and sees
   every true case; it killed COVID-like and smallpox in 5 of 5 seeds. *The presets turn
   it off; 3.0's reports replace it.*
3. **There is one act.** Nothing waned and nothing was forced, so nothing recurred.
   *Seasonality landed in 2.1; waning is 2.4.*
4. **Evolution was cosmetic.** Cross-immunity was exact id membership, so every mutant
   was fully novel to every host, lineages stayed shallow (a broom, not a tree), and
   within-host selection let the incumbent win whatever its genome. *Antigenic space
   (2.1) fixed both.*
5. **"Observed Re ≈ 1" while the outbreak grows.** On a lattice, incidence grows with the
   front's circumference, roughly linearly, so the ratio estimator hovers near 1
   **[standard]**. It is the most important thing the lattice teaches. *Re by count
   (2.2) now stands beside it.*

## What it lacked

The comparison with the well-mixed ODE that `about.md` opens on (A); any mixing beyond
nearest neighbours, so lattice R0 is capped at 6 (A); recurrence (C); antigenic
structure (B, landed); an observer, since the plate shows the truth no epidemiologist
sees (D); constraint, since interventions are free and instant (E); topology that
matters to a phenomenon, since a scalar contact process can't show non-orientability
until something in the scene has a handedness (G); and a plate for Z's own story (H;
2.2's clones gave Immunoediting one).

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

Landed in 2.1 (antigenic torus, per-cell memory, distance-based immunity, strain marks
from antigenic position, the antigenic map; `AGENTS.md`). Still ahead from it:

- Optional transmission–virulence trade-off (β tied to μ). On a lattice with host
  regrowth, spatial models evolve toward the *upper* persistence boundary, where a
  more transmissible pathogen burns out its local hosts and dies out (Rand, Keeling &
  Wilson 1995) **[standard]**. Every pre-2.1 preset sat in that over-exploiting
  regime, so this plate is closer than it looks.
- Within-host fitness (β × the host's susceptibility since 2.1) has no term tied to
  virulence: a within-host replication rate that raised both β and μ is where a nested
  within-host/between-host trade-off would live.

### C. Time that recurs

Add R → S and V → S waning as genome fields, and seasonal forcing
β(t) = β₀(1 + A cos 2πt/365) (landed in 2.1 as `season_amp`). Roadmap §6.1 found that
waning must hold and then lapse to give spirals.

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
  shareable. *Set aside (a9, 2026-10-27): lineages, not records.*

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

Built since: III as Threshold, VII as Immunoediting, VIII as Antigenic drift. Each
plate's measurement is surveyed across seeds (`tools/presets-survey.mjs`) before it
ships.

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
2. **A measurement harness** in `tools/` (staged-out). Landed as
   `tools/presets-survey.mjs`, which surveys every plate across seeds and sweeps its
   knob.
3. **A WebGPU compute tick** at about 10⁶ cells (R ≈ 577). It makes threshold and
   front-roughness measurements clean and makes the plate atlas-dense. The CPU path
   stays at today's size. The strain registry becomes a storage buffer with atomic
   append. Large; worth it once size is the bottleneck.

## Open questions for a9

- Is "an atlas of plates, each an experiment" the right top-level frame? *Yes: 2.1
  built it, with fewer, better presets (a9's rule).*
- How much game? *A tactical game, 3.0 (a9's call, 2026-10-27).*
- Abstract world or geography? Towns, rivers and roads (needed for IX and X) against
  the purity of the hexagonal world. *Open: roadmap Open 4 proposes roads alone.*

## References

- Boots, M. & Sasaki, A. (1999). "Small worlds" and the evolution of virulence: infection occurs locally and at a distance. *Proc. R. Soc. B* 266, 1933–1938. doi:10.1098/rspb.1999.0869
- Brockmann, D. & Helbing, D. (2013). The hidden geometry of complex, network-driven contagion phenomena. *Science* 342, 1337–1342. doi:10.1126/science.1245200
- Davydov, V. A. & Zykov, V. S. (1991). Kinematics of spiral waves on nonuniformly curved surfaces. *Physica D* 49, 71–74. doi:10.1016/0167-2789(91)90195-F
- Dierckx, H., Brisard, E., Verschelde, H. & Panfilov, A. V. (2013). Drift laws for spiral waves on curved anisotropic surfaces. *Phys. Rev. E* 88, 012908. doi:10.1103/PhysRevE.88.012908
- Earn, D. J. D., Rohani, P., Bolker, B. M. & Grenfell, B. T. (2000). A simple model for complex dynamical transitions in epidemics. *Science* 287, 667–670. doi:10.1126/science.287.5453.667
- Foege, W. H. and colleagues: surveillance-containment in eastern Nigeria from the December 1966 Ogoja outbreak; see Foege's retrospective in the *Bulletin of the WHO* and Henderson's WHO interview on the 1966 programme documents.
- Grassberger, P. (1983). On the critical behavior of the general epidemic process and dynamical percolation. *Math. Biosci.* 63, 157–172. doi:10.1016/0025-5564(82)90036-0
- Grenfell, B. T., Bjørnstad, O. N. & Kappey, J. (2001). Travelling waves and spatial hierarchies in measles epidemics. *Nature* 414, 716–723. doi:10.1038/414716a
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
