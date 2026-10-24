# Miasma

A stochastic epidemic simulator on a hex grid. Seed an outbreak, pick a surface and a
preset or tune your own pathogen, and watch the wavefront spread, mutate, and run into
the interventions you paint.

**[Open it](https://a9l.im/miasma)** · part of [a9l.im](https://a9l.im)

## What's in it

- **Compartments**: susceptible, exposed, infectious, recovered, deceased, vaccinated,
  maternal immunity, and an optional zombie compartment. A status layer (hospitalized,
  quarantined) changes recovery, mortality, and transmission. Flags mark latent
  infections, chronic carriers, and infectious corpses.
- **Automatic responses**: hospital beds with overflow mortality, contact-tracing
  quarantine, and a background vaccination rollout, each switchable.
- **Multi-strain evolution**: every strain carries its own genome of rates. Strains
  mutate, coinfect (up to four per cell), and recombine, and each cell keeps a record
  of past exposures that gives cross-immunity. Reinfection and vaccine breakthrough
  therefore favor strains a cell hasn't seen.
- **Population dynamics**: aging, births into empty land (children of recovered parents
  start with maternal antibodies), health that degrades during infection, and
  age-driven mortality.
- **Animal reservoir**: its own births, aging, and per-strain SIR dynamics, passing
  infections to and from the human layer.
- **Zombies**: one state machine with two readings. It can run a zombie outbreak where
  humans fight back, or oncoviral cell transformation held back by immune surveillance.
- **Four surfaces**: the hexagonal world with its edges open (plane) or glued in
  pairs: torus, Klein bottle, and real projective plane. Faded copies of the world
  sit beyond each glued edge, and strokes on them land on the world.
- **Ten presets**: SEIR vanilla, COVID-like, Ebola, tuberculosis, Andes hantavirus,
  smallpox, plague with rats, zombie apocalypse, oncoviral transformation, and absurd
  mode.
- **The atlas**: the map is a plate in the line of John Snow's 1854 cholera map:
  the disease in red, recovery as stipple, vaccination as hatching, deaths as
  crosses, and isochrones of the day the wave arrived. Views for compartment,
  strain (one hatch angle per strain), age, health, status, and susceptibility;
  the oncoviral preset becomes an H&E-stained section. Nightingale's rose and
  observed Re sit in the Counts tab; the Strains tab ranks strains by prevalence
  and has a time-scaled phylogeny and a per-strain genome editor.
- **Intervention painting**: seed, vaccinate, quarantine, sanitize, and cull, with three
  brush sizes. Undo and redo work until the simulation advances.

## Controls

Click or drag on the map to paint; the default brush seeds an infection. Scroll or pinch
to zoom.

| Key | Action |
|---|---|
| Space | Play / pause |
| `.` | Step one tick |
| `R` | Reset |
| `1`–`6` | Paint mode: none, seed, vaccinate, quarantine, sanitize, cull |
| `[` / `]` | Brush size down / up |
| Ctrl/⌘+Z | Undo stroke |
| Ctrl/⌘+Shift+Z, Ctrl/⌘+Y | Redo stroke |
| `=` / `-` / `0` | Zoom in / out / reset |
| `M` | Map controls |
| `S` | Sidebar |
| `T` | Theme |
| `?` | About |

## Running locally

The project has no build step of its own; it loads the shared design system from
the parent site by absolute path. From a checkout of
[a9lim.github.io](https://github.com/a9lim/a9lim.github.io) with submodules:

    npm install && npm run build
    python3 -m http.server --directory dist 8000   # http://localhost:8000/miasma/

Add `?seed=<any text>` to the URL for a reproducible run.

## How it's built

Vanilla JavaScript modules with no dependencies, drawn with Canvas 2D. Cell state is a
set of typed arrays over a 120×120 axial grid masked to a hexagon of 10,621 cells. Each
tick computes the next state into scratch buffers and swaps them in, so every cell
updates simultaneously. `src/dynamics.js` holds the per-tick model, `src/topology.js`
the surface identifications, and `src/strains.js` the strain registry;
`node src/topology.test.mjs` runs the topology tests. [AGENTS.md](AGENTS.md) has the
detailed map.

## License

[AGPL-3.0](LICENSE)
