# Miasma

A stochastic epidemic simulator on a hex grid. Run one of six experiments, each with one
knob and a number measured live, or seed your own outbreak, pick a surface, and watch the
wavefront spread, drift antigenically, and run into the interventions you paint.

**[Open it](https://a9l.im/miasma)** · part of [a9l.im](https://a9l.im)

## What's in it

- **The model**: SEIRD plus vaccinated, maternal-immunity and zombie compartments,
  hospitals and quarantine, an animal reservoir, aging and births.
- **Evolving strains**: each with its own genome of rates and a position on an
  antigenic torus; cells remember the antigens they met, so drifted strains reinfect and
  a matched vaccine loses ground as the virus drifts.
- **Four surfaces**: the hexagonal world open (plane) or glued into a torus, Klein
  bottle or real projective plane, with faded copies beyond each glued edge.
- **Six experiments**: Threshold, Herd immunity, Antigenic drift, Spillover,
  Immunoediting and Zombie apocalypse, each with a knob ticked where theory puts its
  threshold and a measured number in the caption.
- **The atlas**: the map drawn after John Snow's 1854 cholera map, with fading
  isochrones; views for strain, descent (who infected whom), age, health, status and
  immunity; the margin's rose, space–time figure, chains of infection, antigenic map,
  phylogeny, and the model as a compartment diagram holding every rate.
- **Intervention painting**: seed, vaccinate, quarantine, sanitize and cull.

Press `?` in the sim for the controls and the full about panel ([about.md](about.md)).

## Running locally

The project has no build step of its own; it loads the shared design system from the
parent site by absolute path. From a checkout of
[a9lim.github.io](https://github.com/a9lim/a9lim.github.io) with submodules:

    npm install && npm run build
    python3 -m http.server --directory dist 8000   # http://localhost:8000/miasma/

Add `?seed=<any text>` for a reproducible run. Vanilla JavaScript modules with no
dependencies; the lattice draws in WebGPU. `node --test 'tests/*.test.mjs'` runs the
tests, and [AGENTS.md](AGENTS.md) has the map for contributors.

## License

[AGPL-3.0](LICENSE)
