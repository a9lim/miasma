# Miasma

A stochastic spatial epidemic simulator on a hex grid. You seed patient zero, pick a topology, choose a preset or build your own pathogen, and watch the wavefront propagate. Compartmental SEIR with multi-strain evolution, cross-immunity, coinfection, recombination, age and health dynamics, intervention painting, and an optional zombie compartment.

**[Try it](https://a9l.im/miasma)** | Part of the [a9l.im](https://a9l.im) portfolio

## What it covers

Eight compartments: susceptible, exposed, infectious, recovered, deceased, vaccinated, maternal-immunity, and zombie (always available, off by default outside the Z presets). Orthogonal status layer (none, hospitalized, quarantined) modulates recovery rate, mortality, and source/target transmission probabilities. Flags overlay extra states on existing compartments: latent infection on exposed cells, chronic-carrier on recovered, infectious-corpse on deceased. Latent and chronic-carrier flags get set probabilistically on the relevant transitions (S→E and I→R), with per-preset seeding rates so TB latency and hantavirus chronic carriage are first-class mechanics rather than dead branches.

Multi-strain registry with append-only Uint16 strain IDs and per-cell coinfection cap of four. Point mutation, recombination, load-weighted strain prevalence, and bloom-filter cross-immunity from prior exposure. Population dynamics with age-stratified susceptibility, infection-driven health degradation, and repopulation of empty cells from neighbor density. Newborns enter with maternal antibodies that decay back to susceptible. Recovered cells can be reinfected when the per-cell susceptibility multiplier is positive; vaccinated cells admit breakthrough infections at the residual rate when efficacy is below one. Per-strain bloom-filter cross-immunity composes correctly with both, so reinfection and breakthrough favor novel strains.

Six topologies on the hex grid: plane, cylinder, torus, möbius, klein, and RP². Isotropic six-neighbor diffusion. Topology switches re-route the wrap function without touching grid data.

Intervention paint with five modes: seed, vaccinate, quarantine, sanitize, cull. Adjustable brush radius. Touch support with pinch-zoom. Snapshot-based undo. An auto-vaccinate rollout converts S/E/R/M cells to V at a configurable rate per tick when enabled, layered over the paint-driven flow.

Zoom and pan: wheel zooms toward the cursor (clamped 0.5–3×), two-finger pinch on touch devices, dedicated +/−/reset buttons in the canvas controls strip, keyboard `=` / `-` / `0`.

Presets: vanilla SEIR, COVID-19, Ebola, TB, Andes hantavirus (reservoir-driven), smallpox, plague with rat reservoir, zombie apocalypse, oncoviral transformation, and an absurd preset that turns every secondary mechanic on at once.

Six rendering modes for the canvas: compartment, strain hue, age heatmap, health heatmap, status overlay, and computed susceptibility view. Status view shows the hospitalized "+" badge and quarantine ring overlays as well as the fill recoloring. The animal layer renders as a three-way toggle: with dots (overlay on the human compartment), animal-only (the wavefront-on-reservoir view), or off. The time-series panel sits at the top of the Compartments tab as a stacked-area chart. Strain registry panel surfaces the top strains by prevalence with a throttled clickable lineage forest.

## How to use it

Click a hex to seed an infectious cell. Pick a preset from the dropdown, or open the controls and dial in custom parameters. Toggle which compartments are active; flag overlays appear in the legend.

Choose a topology and map view from the Settings tab. Play to start the simulation. Switch to a paint mode in the Interventions tab, then drag across the grid to apply it. The brush hover shows the radius and mode color before you commit.

Keyboard shortcuts: space (play / pause), `.` (step one tick), `1`-`6` (paint mode — none, seed, vaccinate, quarantine, sanitize, cull), `[` / `]` (brush size down / up), `ctrl+z` (undo last stroke), `=` / `-` / `0` (zoom in / out / reset), `?` (about panel).

## Running locally

```bash
cd path/to/a9lim.github.io && python -m http.server
```

There's no build step and no dependencies. Shared design system files load from the root site via absolute paths, so please serve from the parent directory.

## Architecture

Vanilla JavaScript with no dependencies. ES6 modules loaded via `<script type="module">`. Canvas 2D rendering with `requestAnimationFrame`. Cell state stored as structure-of-arrays in typed arrays for cache locality.

```
main.js                 Entry point, render loop, $ DOM cache
colors.js               Compartment color palette extending shared tokens
src/
  grid.js               Hex axial coords, typed-array cell storage (SoA)
  topology.js           Hex-quotient neighbor wrapping for all 6 manifolds
  topology.test.mjs     Round-trip invariant + adjacency-symmetry tests
  dynamics.js           Per-tick state-transition orchestrator
  dynamics-animal.js    Reservoir demography, animal SIR, and spillover
  dynamics-scratch.js   Reusable typed-array tick buffers
  strains.js            Strain registry, similarity, point mutation, recombination
  default-params.js     Shared baseline parameter set
  default-toggles.js    Shared baseline toggle set
  initialization.js     Hex mask + fresh human/animal seeding
  strain-extinction.js  Registry tombstone sweep
  camera.js             Zoom/pan viewport composition
  history.js            Transition-count ring buffer
  prng.js               Seeded PRNG helper
  render.js             Canvas drawing for all six view modes
  ui.js                 Sidebar wiring, preset / toggles / params panels
  paint.js              Paint controller, brush indicator, keyboard shortcuts
  timeseries.js         Stacked chart in the Compartments tab
  lineage.js            Strain registry panel and lineage forest renderer
  presets.js            Ten calibrated preset configurations
  stats.js              Compartment census + rolling observed Re
  toggles.js            Compartment / flag toggle panel
  params.js             Slider panel for all dynamics parameters
  config.js             Compartment, topology, mode enums plus defaults
```

## Sibling projects

- [Geon](https://github.com/a9lim/geon) ([a9l.im/geon](https://a9l.im/geon))
- [Cyano](https://github.com/a9lim/cyano) ([a9l.im/cyano](https://a9l.im/cyano))
- [Gerry](https://github.com/a9lim/gerry) ([a9l.im/gerry](https://a9l.im/gerry))
- [Shoals](https://github.com/a9lim/shoals) ([a9l.im/shoals](https://a9l.im/shoals))
- [Scripture](https://github.com/a9lim/scripture) ([a9l.im/scripture](https://a9l.im/scripture))

## License

[AGPL-3.0](LICENSE)
