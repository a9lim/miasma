# Miasma Roadmap

The one authoritative plan for Miasma. `AGENTS.md` describes Miasma as it is; this file
describes where it is going. When an item lands, move it to §5 with its commit and update
`AGENTS.md`. `docs/VISION.md` holds the wider ideation round and the measurements behind
it. Its directions are unslated until a version here names them.

Written on 2026-10-24 by Claude with a9, the day 2.0 (the atlas) landed, after the
ideation round in `VISION.md`. This file lives in `docs/` so the parent build's stager
never deploys it.

Tags: **[standard]** an established result · **[synthesis]** our own design applying
standard ideas · **[speculative]** needs prototyping before it's trusted. Sizes **S / M / L**
are relative. a9's calibration from Worldline: a milestone is one to three serial
sessions, and parallel lanes fit a whole version in one.

## 0. Decisions

### Decided

| Date | Decision |
|---|---|
| 2026-10-24 | **The versions:** 2.1 is immunity by antigenic distance and six presets that work (§2). 3.0 is the game, a tactical reverse Plague Inc (§3), not before next week's usage window. |
| 2026-10-24 | **Fewer, better presets** (Worldline's rule): a preset earns its place as an experiment with one knob, not as coverage. The cut presets' mechanics stay reachable from Settings. |
| 2026-10-24 | **Antigenic memory replaces the bloom filter outright.** Miasma persists no state, so there is nothing to migrate and no compatibility reader to keep. |
| 2026-10-24 | **2.0, the atlas:** the plate in the line of Snow's map, the inks, four surfaces that glue every edge or none (`58a3d09`). |
| 2026-10-24 | **2.1 is built now, in one session.** 3.0 waits until it can be done properly. |
| 2026-10-24 | **The opening preset is Threshold,** calibrated to the ragged regime (§2.3). |
| 2026-10-24 | **Antigenic space is a torus** (a9's call), 8 AU around, with shortest-way distance, so drift never runs off the map and can recycle old antigens. **Strain marks encode the position directly:** one axis is hatch angle (0–180°), the other hue (0–360°), on an OKLCH wheel fitted like the inks and squeezed near the accent (§2.2). |
| 2026-10-24 | **Isochrones fade** (a9's call): a cell's arrival is re-stamped when a new wave reaches it, contours fade with their age measured against the newest arrival, and contours never cross the cliff between waves (§2.2). |

### Open

1. **3.0's clock** (§3.1): weekly turns (recommended) or real time with pause. Left for
   3.0.
2. **3.0's mode:** the sandbox stays the default and the game is a mode (recommended), or
   the game becomes the front door. Left for 3.0.

## 1. Versions

| Version | Theme | Contents | Size |
|---|---|---|---|
| **2.0** | The atlas | done 2026-10-24 (§5) | — |
| **2.1** | Immunity by distance; presets that work | antigenic space (§2.1), seeing it (§2.2), six experiments (§2.3), the fixes that ride along (§2.4) | M–L |
| **3.0** | The game | a tactical reverse Plague Inc: reports instead of truth, costed orders, an evolving adversary, scored against the world you didn't touch (§3) | L |

Everything else in `VISION.md` is unslated (§4).

## 2. 2.1: immunity by distance, and presets that work

The evidence is in `VISION.md`, "What the measurements say". Immunity recognizes only
exact strain ids, so every mutant is fully novel to every host. The phylogeny stays a
broom, at most 5 generations from α by day 3,000. Within a host, the incumbent strain
always wins whatever its genome (`src/dynamics.js:460`). Every preset sits 4–21× above
the lattice threshold, and two never take off. 2.1 makes evolution consequential and
rebuilds the presets as experiments.

### 2.1 Antigenic space [synthesis]

**Strains get a position.** Each strain has an antigenic coordinate `(ag_x, ag_y)` in
antigenic units (AU), stored as two new registry arrays; α sits at the origin. One AU is
the distance at which cross-immunity falls by 1/e, so immunity has no width parameter of
its own; presets set the step size instead. Two dimensions follow Smith et al. 2004
(H3N2's antigenic evolution is mostly two-dimensional and clustered) **[standard]**. Bedford,
Rambaut & Pascual 2012 found the trajectory canalized, close to one-dimensional, which a
2D model should reproduce rather than assume **[standard]**.

- **Mutation.** Every mutation event also takes an antigenic step in a uniformly random
  direction. Its length is drawn with mean `ag_step` (sim-wide, AU), and with
  probability `ag_jump` it is a large jump of about 2 AU instead. Single substitutions near
  the receptor-binding site cause major antigenic change in influenza (Koel et al. 2013)
  **[standard]**. Coordinates take additive steps. The multiplicative genome noise would
  freeze a coordinate at 0, so the coordinate is not one of `GENOME_FIELDS`.
- **Recombination.** The recombinant takes its parents' midpoint, plus a small jitter.

**Cells remember positions, not ids.** `strain_hist` (the 64-bit bloom) is replaced by
K = 4 memory slots per cell: `mem_x`, `mem_y` (Float32, N·K), `mem_kind` (infection or
vaccine) and `mem_n` (fill count, ring overwrite of the oldest). With scratch copies that
is about 1 MB at the current grid.

- **Written on:** recovery (each carried strain, merging positions within 0.1 AU),
  vaccination (the current vaccine antigen, below), and the sanitize brush's I/E → R cure.
  Vaccination rollout keeps memory as it keeps the bloom today. The paint undo snapshot
  (`captureCellState`) captures memory.
- **Susceptibility** of a cell to strain s:
  `σ(s) = 1 − max_k c_k · exp(−|a_s − m_k|)`. Here `c_k` is `immunity_strength` for an
  infection memory and `vax_efficacy` for a vaccine memory. σ is 1 for an empty memory.
  Start with the exponential kernel and the max; prototype a Gaussian kernel and the
  product of escapes before M1 closes.
- **Where σ applies:** every infection roll whose target has memory. That covers R → E
  reinfection, V → E breakthrough, coinfection of an I cell (σ replaces today's bloom
  block), and animal-to-human spillover. R and V are ordinary targets scaled by σ.
  A strain matching a memory exactly meets `1 − c`, and a distant one meets almost a naive
  host.
- **Removed:** `strain_hist`, `bloomSet`, `bloomHas`, `bloomCount`,
  `cross_immunity_mult` and `r_susceptibility_mult`. Textbook SEIR without reinfection is
  `immunity_strength = 1` and `ag_step = 0`.

**Vaccines have an antigen.** A sim-wide `vax_antigen` (default α's position) is what the
vaccinate brush and the rollout write into memory. Vaccine mismatch then falls out of the
model: a drifted strain meets reduced vaccine efficacy, and the annual flu-shot decision
(which strain to match) becomes visible. In 2.1, a control in the Strains tab, "match
the vaccine to the selected strain", sets it at once. In 3.0 it costs time and money
(§3.3).

**Within-host selection reads the genome.** Step 3's update becomes replicator dynamics
on a fitness that depends on the strain and the host:
`f_i = β_i · σ_host(i)` and `x_i ← x_i · (1 + k (f_i − f̄) / f̄)`, then renormalized. A strain
escaping this host's memory, or simply more transmissible, gains load; the incumbent no
longer wins by default. **[synthesis]**

**The registry can reclaim ids.** Ids stayed unique only because blooms hashed them.
Once no cell remembers an id, a tombstoned strain with no living descendants, absent from
every human slot (memory slot 0 included) and every `animal_strain`, can be freed and its
id reused. Reclaim bottom-up, leaves of the extinct subtree first. The phylogeny draws only
living strains and their ancestors, so it never sees a reclaimed id. This removes the
65,535 cap that high-incidence runs reach (about 12,000 strains by day 600). The
extinction sweep starts scanning `animal_strain`, which closes the open bug where a
strain circulating only in animals is tombstoned.

### 2.2 Seeing it

- **Strain marks encode antigenic position.** Today a strain's ink and hatch angle cycle
  by id (`strain-style.js`), so neighbors in antigenic space look unrelated. The principle
  for 2.1: similar antigens look alike, drift reads as a gradual change, and a jump reads
  as a new ink. One candidate: an antigenic cluster is one ink (a strain founds a new
  cluster when it is more than 1 AU from its cluster's founder), and within a cluster the
  hatch angle turns with distance from the founder. Sketch it first (Open 2). On the GPU,
  the strain view carries its angle in the texel's `w`, which only the ramp views use
  today; the cluster ink takes the 3 slot bits in `z`.
- **The immunity view** replaces "susceptibility by prior exposure", which counts bloom
  bits. It shades each cell by σ to a chosen strain: by default the dominant one, or the
  strain selected in the Strains tab. It shows the immune landscape the virus is escaping.
- **The antigenic map,** a second figure in the Strains tab. Strains sit at their
  antigenic positions: living ones sized by prevalence in their ink and hatch, extinct ones
  as small graphite points. The trunk (the dominant strain's ancestry) is drawn as a line
  over a 1 AU grid. The vaccine antigen is a marked cross with its 1 AU circle. Clicking
  selects, as in the phylogeny. Smith's figure is a map, so it already belongs in an atlas.
- **The phylogeny** keeps its code. It should now show a trunk, and its tips take the new
  marks.
- **Recurring waves** (Open 3). First-arrival isochrones freeze after the first wave. If
  the drift plate needs more, contour each cell's first exposure to the current antigenic
  cluster, labeled by cluster.

### 2.3 Presets: six experiments

Each preset names one knob and what to look for, states a measured number live in the
caption, and gives the predicted number where theory supplies one. The knob appears as a
single slider beside the preset's name. Calibration standard: every preset is surveyed
with `tools/survey.mjs` across at least 10 seeds, and none fizzles unless fizzling is the
experiment. The plate reads well by day 100, and the run either keeps something to watch
past day 1,000 or reaches an end the caption names. Each preset sets every toggle it
relies on, because `applyPreset` resets to the defaults first, and leaves off what its
experiment doesn't use.

| Preset | From | Knob | Look for | Predicted | Measured |
|---|---|---|---|---|---|
| **Threshold** | SEIR vanilla | β | below β_c outbreaks stay finite clusters; near it the front is ragged and holed | β_c ≈ 0.061 with independent edges (`p_c = 2 sin(π/18)` on the triangular lattice); correlated edges push it up (Grassberger 1983) **[standard]** | final size; measured crossover β ≈ 0.067 at γ + μ = 0.123 (`tools/threshold.mjs`) |
| **Herd immunity** | Smallpox | random vaccine coverage | the wave stops at about half coverage, though each edge transmits with T = 0.93 | the triangular site-percolation threshold 1/2 as T → 1 **[standard]**; the mean-field 1 − 1/R0 ≈ 82% (taking R0 ≈ 6T) as the foil | final size among the unvaccinated; measured crossover 0.48–0.50 |
| **Antigenic drift** | new, influenza-like | `ag_step` | a trunk in the phylogeny and the antigenic map, recurring waves, the immunity view lagging the virus | canalized drift (Bedford et al. 2012) **[standard]**; wave interval against step size **[synthesis]**, to measure | AU per year; days between waves; lineage depth |
| **Spillover** | Andes hantavirus | spillover rate | human chains that can't sustain themselves and never end | human T below threshold (today's 0.48 is above it and must be recalibrated) | human-to-human Re against cases from spillover |
| **Immunoediting** | Oncoviral | immune surveillance (`z_die_fighting`) | elimination, equilibrium or escape (Dunn et al. 2002) **[standard]**, read on the H&E section | three regimes as the knob moves | transformed cells over time; tumor extent |
| **Zombie apocalypse** | as is | fight-back (`z_die_fighting`) | the humans win, coexist or are overrun | — | humans and zombies remaining |

- **Cut:** COVID-like, Ebola, TB, Plague and Absurd. Their mechanics stay reachable from
  Settings: infectious corpses run in Zombie apocalypse, latency in Immunoediting, chronic
  carriers and the reservoir in Spillover, vaccination in Herd immunity.
- **Herd immunity** is new evidence, measured on 2026-10-24: smallpox-like rates
  (β 0.55, σ 0.16, γ 0.07, μ 0.018) on the torus, random pre-vaccination at efficacy 1,
  one seed cell, eight seeds per coverage. Final size among the unvaccinated: 93% at
  coverage 0.42, 71% at 0.45, 25% at 0.48, 9% at 0.51, 1% at 0.55. The lesson is that
  contacts limited to neighbors make herd immunity far cheaper than the textbook formula
  says **[synthesis]**. The mixing dial in `VISION.md` (A) would move it back toward 82%.
- **Immunoediting** must stop saturating. Today 6,524 cells are transformed from day
  about 200 onward and the plate goes uniformly purple. Surveillance strong enough to
  reach elimination and equilibrium at the knob's low end, plus a necrotic core that
  keeps the section changing, is the calibration target.
- **The opening** (Open 1): Threshold at β of about 0.09–0.11 (T ≈ 0.55–0.6), so the
  front is ragged but still crosses a glued edge during the warm-up.

### 2.4 Fixes that ride along

- The rose counts Z transitions, with their own pattern (sap cross-hatching). Today Z
  runs leave it empty.
- Presets stop inheriting the default-on `auto_quarantine` (§2.3). Capacity for
  tracing waits for 3.0's budgets. The sandbox keeps tracing on.
- The strain view's cartouche lists vaccination hatching when V cells are on the plate.
- Hospital capacity counts active cells (10,621), not `W · H` (14,400).
- Isochrone labels are suppressed where the field is incoherent, as in spillover-driven
  runs that print "day 24" beside "day 192". Spillover needs this to read.
- The extinction sweep scans `animal_strain` (§2.1).

### 2.5 Receipts

- `src/immunity.test.mjs`. σ = 1 − c at distance 0, rises monotonically with distance,
  and tends to 1. Vaccine memory uses `vax_efficacy`. The memory ring keeps the newest K.
  In a primed host, the escaping strain gains load. Reclamation never frees a strain that
  is referenced or has living descendants. Memory arrays survive the scratch/swap round
  trip and paint undo.
- `tools/survey.mjs` gains a preset mode (each preset × 10 seeds: takeoff rate, peak,
  fate). Its table goes into `AGENTS.md`, like Worldline's preset facts.
- Screenshots for each preset in light, dark and phone widths, with no console errors
  (`docs/sim-overhaul/check.mjs` in the parent).
- Docs: `AGENTS.md`; `about.md` (the immunity paragraph, the preset list, a bumped
  `updated`); `index.html`'s educational text and JSON-LD (two FAQ answers describe the
  bloom filter and `r_susceptibility_mult`); `README.md`.

### 2.6 Order

| Milestone | Contents | Size | Depends on |
|---|---|---|---|
| **M1** | antigenic registry, memory, σ, vaccine antigen, within-host fitness, bloom removal, id reclamation, tests | M | — |
| **M2** | strain marks, immunity view, antigenic map, vaccine control | M | M1; Open 2 sketched |
| **M3** | the six presets calibrated, the knob slider, §2.4's fixes | M | M1 for Antigenic drift only; the other five can start at once |
| **M4** | docs and receipts | S | M2, M3 |

M1 and M3 (without Antigenic drift) can run as parallel lanes.

## 3. 3.0: the game (sketch)

**A tactical reverse Plague Inc.** In Plague Inc you evolve a pathogen to end the world.
Here the pathogen evolves on its own, through 2.1's machinery, and you contain it as the
world's Medical Officer of Health, seeing only what is reported, with finite doses and
staff, and nothing instant. It is a sketch for next week or later; each part names what it
needs.

### 3.1 The clock: the Weekly Return

The run proceeds in weeks. Each week you read the Weekly Return, issue orders on the
plate, and the world runs seven days. The Return is the diegetic interface, the way the
morning Brief is in Shoals: a plate of reported deaths and cases in Snow's manner, a
short table, a headline in the caption. It is historically exact: Snow noticed the table on
the South London water companies in the Registrar General's Weekly Return of
19 November 1853. Farr's Return of 14 October 1854 then summarized the registrars'
inquiry into each household's water supply **[standard]**. The alternative clock is real
time with pause (Open 4).

### 3.2 What you know: reports, not truth

Detection is a process. Deaths are reported, cases only sometimes and after a delay, and
tests (a budget) reveal the true state in an area. The plate shows reports. The truth view
is locked during a run and revealed in the epilogue, as Shoals reveals its hidden tracks.
Shoals' rule carries over: the reported path never reads hidden state except through
detection, and a test asserts it. This also retires the omniscient contact tracing that
kills two presets today.

### 3.3 What you can do: orders and budgets

A weekly budget of money and staff, and a dose supply that ramps with production. Every
order is painted on the plate, costs something and takes time:

- **Vaccinate:** spends doses; immunity begins after a delay; uses the current vaccine
  antigen.
- **Cordon** (quarantine): costs per cell-day; compliance fatigues, so a long cordon
  leaks.
- **Test:** reveals the true state under the brush.
- **Trace:** follows contacts of reported cases, up to tracer capacity.
- **Bury safely, cull, sanitize:** corpses and the reservoir.
- **Update the vaccine:** pick a strain to match. It takes weeks, and the virus keeps
  drifting meanwhile. This is the flu-shot decision, built on 2.1's `vax_antigen`.

### 3.4 The adversary

The pathogen is the evolving registry: it drifts away from your vaccine, and your orders
are its selective environment. The Strains tab's phylogeny and antigenic map become the
intelligence briefing. Whether cordons and tracing select for longer pre-symptomatic
spread, or longer latency, is a question the game can measure rather than assert
**[speculative]**.

### 3.5 Scoring: what your orders bought

When you issue an order, the untouched world runs alongside it as a counterfactual twin
with common random numbers: the same random draw for each cell and day, so the twins
differ only by your orders. The score is deaths averted against the twin per unit spent,
with a band from several twins. The epilogue plate overlays reported against true cases,
your cordons as hatching, and the twin's isochrones dashed. Endings: eradication (zero
cases through a certification window under active surveillance), an endemic
equilibrium, or collapse. The last Weekly Return is the epilogue.

### 3.6 Scenarios

2.1's presets supply the pathogens:

- **Broad Street,** the tutorial: find the pump from deaths alone. Needs the water route
  (`VISION.md`, Plate I).
- **The ring:** smallpox-like, few doses, reports only. Ring vaccination around reported
  cases against spreading the doses, as in Foege's Ogoja campaign of December 1966
  **[standard]**.
- **The season:** antigenic drift. Choose and update the vaccine antigen each year.
- **The reservoir:** spillover. The rodents can't be eradicated, only managed.
- **The cure:** oncolytic virotherapy, an epidemic you want to win (`VISION.md`, H).
- **Zombie defense:** for fun.
- **The daily plate:** one seeded scenario a day, the same for everyone, with a shareable
  link.

### 3.7 What it needs first

1. **A counter-based RNG**, `u = hash(seed, tick, cell, stream)`, in place of the
   sequential stream. It underlies the twins, replay and seeded scenarios (`VISION.md`,
   I1). S.
2. Checkpoints, replayable order logs and URL recipes. M.
3. The detection and report layer (§3.2). M.
4. Orders, budgets and delays (§3.3), and the weekly loop with the Return (§3.1). M–L.
5. Twins and scoring, and the epilogue plate (§3.5). M.
6. Per scenario: the water route for Broad Street, and the mixing kernel (`VISION.md`, A)
   if closing travel routes is to be an order.

The game stays inside the design system. The Weekly Return is editorial (Newsreader and
hairlines, no game chrome), the red remains the disease, and your orders are inks.

### 3.8 Open

Weekly turns or real time with pause (Open 4). One budget, or separate doses, staff and
money. How deep compliance goes. Deaths or life-years as the score. Whether the sandbox
stays the front door (Open 5).

## 4. Unslated

From `VISION.md`, not yet in a version: the mixing dial and the ghost of the ODE (A); waning,
seasonality, the year-long rose and activation maps (C); spirals and cone points on the
non-orientable surfaces (G); Broad Street as a plate outside the game; effective distance
(Plate X); oncolytic therapy as a plate (H); the WebGPU compute tick (I3). The
counter-based RNG (I1) is pulled into 3.0 (§3.7).

## 5. Landed

| Milestone | Date | Commits | What |
|---|---|---|---|
| 2.0 | 2026-10-24 | `59dfb32`, `58a3d09` | The atlas: the plate after Snow, isochrones, glued-edge copies, Nightingale's rose, the time-scaled phylogeny, the H&E section, the inks; Cylinder and Möbius removed, the Klein bottle's flat form proved impossible. |
| Vision | 2026-10-24 | `66be1bb` | `docs/VISION.md` and the headless surveys in `tools/`. |

## 6. Gotchas

- A new per-cell field needs a scratch buffer, the copy-in and the swap
  (`dynamics-scratch.js`). The memory arrays are per-cell fields.
- Paint snapshots per-cell state for undo (`captureCellState`). Anything per-cell that
  paint can change belongs in it.
- The GPU state texel is full: `z` packs the animal and `(strain slot + 1) << 3`, and `w`
  carries the ramp value. The strain view's new marks need `w`.
- `applyPreset` resets params and toggles to the defaults before merging, so a preset
  sets every key it needs.
- The extinction sweep must count every reference to a strain (active slots, memory slot
  0 on M, R+C and D+F, and `animal_strain`) before it tombstones or reclaims.
- Headless runs need `globalThis.mulberry32` and `gaussian`; `tools/*.mjs` show how.
- Citations here were verified against retrieved sources and Crossref. Verify any new one
  before it reaches `about.md` or JSON-LD.

## References

Also see `VISION.md` for the wider list.

- Bedford, T., Rambaut, A. & Pascual, M. (2012). Canalization of the evolutionary trajectory of the human influenza virus. *BMC Biology* 10, 38. doi:10.1186/1741-7007-10-38
- Dunn, G. P., Bruce, A. T., Ikeda, H., Old, L. J. & Schreiber, R. D. (2002). Cancer immunoediting: from immunosurveillance to tumor escape. *Nature Immunology* 3, 991–998. doi:10.1038/ni1102-991
- Grassberger, P. (1983). On the critical behavior of the general epidemic process and dynamical percolation. *Math. Biosci.* 63, 157–172. doi:10.1016/0025-5564(82)90036-0
- Koel, B. F. et al. (2013). Substitutions near the receptor binding site determine major antigenic change during influenza virus evolution. *Science* 342, 976–979. doi:10.1126/science.1244730
- Smith, D. J. et al. (2004). Mapping the antigenic and genetic evolution of influenza virus. *Science* 305, 371–376. doi:10.1126/science.1097211
- Snow, J. (1856). Cholera and the water supply in the south districts of London in 1854. *J. Public Health Sanit. Rev.* 2, 239–257. On the Weekly Returns of 19 November 1853 and 14 October 1854.
- Foege, W. H. and colleagues: surveillance-containment in eastern Nigeria from the December 1966 Ogoja outbreak; see `VISION.md`.
