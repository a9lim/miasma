# Miasma

A stochastic spatial epidemic simulator on a hex grid. You seed patient zero, pick a topology, choose a preset or build your own pathogen, and watch the wavefront propagate. Compartmental SEIR with multi-strain evolution, cross-immunity, coinfection, recombination, age and health dynamics, intervention painting, and an optional zombie compartment.

**[Try it](https://a9l.im/miasma)** | Part of the [a9l.im](https://a9l.im) portfolio

## What it covers

Eight compartments: susceptible, exposed, infectious, recovered, deceased, vaccinated, maternal-immunity, and zombie (always-available toggle, default off). Orthogonal status layer (none, hospitalized, quarantined) modulates recovery rate, mortality, and transmission radius. Flags overlay extra states on existing compartments: latent infection on exposed cells, chronic-carrier on recovered, infectious-corpse on deceased.

Multi-strain registry with unlimited strain count and per-cell coinfection cap of four. Point mutation, recombination, and similarity-weighted cross-immunity. Population dynamics with age-stratified susceptibility, health degradation from prior infections, and repopulation of empty cells from neighbor density. Newborns enter with maternal antibodies that decay back to susceptible.

Six topologies on the hex grid: plane, cylinder, torus, möbius, klein, and RP². Isotropic six-neighbor diffusion. Topology switches re-route the wrap function without touching grid data.

Intervention paint with five modes: seed, vaccinate, quarantine, sanitize, cull. Adjustable brush radius. Touch support with pinch-zoom. Snapshot-based undo.

Presets: vanilla SEIR, COVID-19, Ebola, TB, Andes hantavirus (reservoir-driven), smallpox, plague with rat reservoir, and an absurd preset that turns every secondary mechanic on at once.

Six rendering modes for the canvas: compartment, strain hue, age heatmap, health heatmap, status overlay, and computed susceptibility view. Bottom time-series panel tracks all active compartments, switchable between stacked-area and line-overlay. Strain registry panel surfaces the top eight strains by prevalence with a clickable lineage tree.

## How to use it

Click a hex to seed an infectious cell. Pick a preset from the dropdown, or open the controls and dial in custom parameters. Toggle which compartments are active; flag overlays appear in the legend.

Choose a topology from the mode toggles. Play to start the simulation. Switch to a paint mode in the Interventions tab, then drag across the grid to apply it. The brush hover shows the radius and mode color before you commit.

Keyboard shortcuts: space (play / pause), `.` (step one tick), `1`-`6` (paint mode — none, seed, vaccinate, quarantine, sanitize, cull), `[` / `]` (brush size down / up), `ctrl+z` (undo last stroke), `?` (about panel).

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
  dynamics.js           Per-tick state transitions + animal SIR + spillover
  strains.js            Strain registry, similarity, point mutation, recombination
  render.js             Canvas drawing for all six view modes
  ui.js                 Sidebar wiring, preset / toggles / params panels
  paint.js              Paint controller, brush indicator, keyboard shortcuts
  timeseries.js         Bottom chart panel (stacked-area or line-overlay)
  lineage.js            Strain registry panel and lineage tree renderer
  presets.js            Eight calibrated preset configurations
  stats.js              Compartment census + rolling R_eff
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
