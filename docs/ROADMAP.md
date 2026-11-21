# Miasma roadmap

What's next, in order. `AGENTS.md` describes Miasma as it is. 2.3 and 2.4 touch
different parts of the tick (transmission, memory) and can run as parallel lanes.

## 2.3 Beyond the neighbours

Lattice R0 is capped at 6, and the well-mixed comparison `about.md` opens on appears
nowhere as a number.

- **The mixing dial.** A fraction ε of each source's transmission goes to a cell drawn
  from a kernel (exponential with length ℓ, power law, or uniform), local edges scaled
  by 1 − ε so ε alone moves the world from lattice to mass action. Push sampling:
  Poisson(ε·6β) long-range attempts per transmitting cell per tick against start-of-tick
  state, O(#I). A jump is a vector in the universal cover wrapped back with `wrap` (lost
  at a shore), so it crosses and mirrors through the gluing; Descent draws it as a long
  stroke.
- **The ghost of the ODE.** The mean-field SEIR(D) with the same daily rates, integrated
  beside the lattice, drawn dashed on the rose, with Kermack–McKendrick's final size in
  the caption. At ε = 1 with a uniform kernel the lattice must match it: a test.
- **Two plates:** the ghost (knob ε, against the ODE) and the front (knob the kernel's
  tail, Fig. 3's slope against Fisher–KPP; heavy tails accelerate it, Mollison 1977).
- **Roads** (open question 2): a painted long-range edge, drawn as a double hairline;
  isochrones bend along it (an effective-distance plate, Brockmann & Helbing 2013).
- To measure: does mixing canalize Drift into a trunk, and move the herd threshold from
  50% toward 1 − 1/R0?

## 2.4 Time that recurs

Immunity never wanes, so every run but Drift has one act.

- **Waning that holds, then lapses.** `tools/spirals.mjs` showed that memoryless or
  smooth waning gives noise and only a hold followed by a lapse gives spirals (with a
  40-day cycle: 30-day hold ragged, 36 clean). So waning goes into the memory: each slot
  gains its tick (`mem_t`, own-cell, written in place) and protection becomes
  `c_k · h(age)`, 1 before `immunity_hold`, then `exp(−(age − hold)/immunity_fade)`.
  Waning composes with antigenic distance.
- **The phase view:** days since the last arrival, with spiral cores marked by their
  turning. The detector must follow cores through the gluing (today's misses those on
  the rim), and they need their own texture, since the state texel is full.
- **The spirals plate.** Counted in the hexagon's own orientation, total charge is 0 on
  the torus and even on the Klein bottle and RP² (a punctured non-orientable surface has
  `a₁²⋯a_g² c₁⋯c_n = 1`, so the puncture windings sum to an even number): two
  same-handed spirals are allowed on the non-orientable surfaces and forbidden on the
  torus. The event to watch is a core carried across a twisted seam, its turning
  reversed. Knob: the hold. Whether spirals pin to the cone points or flee them is a
  question the literature can't answer and the plate can.
- **The year rose.** Twelve thirty-day wedges, last year dashed.

## 3.0 The game

Tactical (a9's call): you direct measures on the map itself against a pathogen that
evolves on its own, seeing only what is reported. Not points spent on policies over a
background simulation.

- **The week:** read the Weekly Return (reported deaths and cases in Snow's manner),
  issue orders, run seven days.
- **Orders are shapes** on a weekly budget, each costed and delayed: ring (vaccinate
  around a case), belt (a vaccinated firebreak), cordon (lasso into quarantine,
  compliance fatigues), test (reveal true state), trace (reveal a reported case's parent
  and children from the lineages), sample (reveal a strain's mark), close a pump or
  road, bury, cull, sanitize, update the vaccine antigen (takes weeks). Brushes stay for
  fine work.
- **Reports, not truth:** deaths reported, cases sometimes and late; a test asserts the
  reported path reads hidden state only through detection. This retires the omniscient
  `auto_quarantine`.
- **Scoring by twins.** The untouched world runs alongside; deaths averted per unit
  spent, with a band from several twins. Needs a counter-based RNG,
  `u = hash(seed, tick, cell, stream)`, so twins share draws; it changes every seeded
  run, so the presets are re-surveyed. The epilogue overlays reported against true cases
  and draws the true tree.
- **Cases:** Broad Street (a water route; find the pump from the deaths), the ring, the
  season, the reservoir, the unknown country (read the hidden gluing from where the wave
  comes back), the cure (oncolytic virotherapy on the H&E section), zombie defense.
- **Order:** the RNG, the tick in a worker, reports, orders and the week, then twins.
  The Return is editorial, the red stays the disease, and orders are inks.

## Engine

- **The tick in a worker:** the site is cross-origin isolated, so the grid can live in
  SharedArrayBuffers. It frees the main thread past ~100,000 cells and is 3.0's
  prerequisite.
- **A WebGPU compute tick** at about 10⁶ cells, once size is the bottleneck.

## Unslated

- A transmission–virulence trade-off (β tied to μ; Rand, Keeling & Wilson 1995), which
  would give within-host fitness a virulence term. Waves from towns; a firebreak belt.
- Descent strokes in each strain's mark: needs a strain per edge in the texel and a
  strain id per event, which the sweep would then have to count.
- The offspring distribution (superspreading k) is logged per case but not drawn.
- Small: counters nothing shows (`zFight*`, `animalBirths`, `autoQuarantined`), labels
  that follow their lines, per-strain vaccine efficacy, M-cell breakthrough, a
  breakthrough count for Re, a barricade brush, a cross-immunity matrix view.

## Open questions

Each has a recommendation; a9 decides.

1. **3.0's orders:** shapes as the main verbs with brushes for fine work (recommended),
   or brushes alone.
2. **Geography:** a road brush in 2.3 (recommended), or a bare hexagon.
3. **3.0's clock:** weekly turns (recommended) or real time with pause.
4. **3.0's mode:** the sandbox and plates stay the front door and the game is a mode
   (recommended), or the game becomes the front door.
5. Within 3.0: one budget or separate doses, staff and money; how deep compliance goes;
   deaths or life-years as the score.
