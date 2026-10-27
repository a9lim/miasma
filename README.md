# Miasma

A stochastic epidemic simulator on a hex grid. Run one of six experiments, each with
one knob and a number measured live, or seed your own outbreak, pick a surface, and
watch the wavefront spread, drift antigenically, and run into the interventions you
paint.

**[Open it](https://a9l.im/miasma)** · part of [a9l.im](https://a9l.im)

## What's in it

- **Compartments**: susceptible, exposed, infectious, recovered, deceased, vaccinated,
  maternal immunity, and an optional zombie compartment. A status layer (hospitalized,
  quarantined) changes recovery, mortality, and transmission. Flags mark latent
  infections, chronic carriers, and infectious corpses.
- **Automatic responses**: hospital beds with overflow mortality, contact-tracing
  quarantine, and a background vaccination rollout, each switchable.
- **Immunity by antigenic distance**: every strain carries its own genome of rates and
  a position on an antigenic torus. Strains mutate (stepping through antigenic space),
  coinfect (up to four per cell), and recombine; each cell remembers up to four antigens
  it met by infection or vaccine, and its protection against a strain falls off with
  distance from them. Reinfection and breakthrough therefore favor drifted strains,
  within-host competition favors strains that escape the host, and a vaccine matched to
  one strain loses ground as the virus drifts.
- **Population dynamics**: aging (a new world starts at the steady-state ages of its
  death rates), births into empty land (children of recovered parents start with
  maternal antibodies), health that degrades during infection, and age-driven
  mortality.
- **Animal reservoir**: its own births, aging, and per-strain SIR dynamics, passing
  infections to and from the human layer.
- **Zombies**: one state machine with two readings. It can run a zombie outbreak where
  humans fight back, or tumour growth from an oncovirus held back by immune
  surveillance.
- **Four surfaces**: the hexagonal world with its edges open (plane) or glued in
  pairs: torus, Klein bottle, and real projective plane. Faded copies of the world
  sit beyond each glued edge, and strokes on them land on the world.
- **Six experiments**: Threshold (the critical transmission rate, and the ragged front
  just above it), Herd immunity (about half coverage stops a wave on a lattice, not the
  textbook 82%), Antigenic drift (seasonal waves of drifting variants), Spillover (a
  rodent reservoir keeping subcritical human chains going), Immunoediting (surveillance
  eliminating, holding or losing a tumour), and Zombie apocalypse. They are the atlas's
  plates, listed in the Experiments tab; each has one knob under the plate, ticked
  where theory puts its threshold, and a measured number in the figure caption. The
  Sandbox has every mechanic at its default.
- **The atlas**: the map is a plate in the line of John Snow's 1854 cholera map:
  the disease in red, recovery as stipple, vaccination as hatching, deaths as
  crosses, and isochrones of the day each wave arrived, fading as they age. Views for
  compartment, strain (a strain's hatch angle and colour are its antigenic
  position), descent, age, health, status, and immunity to a chosen strain; the
  Immunoediting preset's state view is an H&E-stained section.
- **Who infected whom**: every infection keeps its source, and the Descent view draws
  the outbreak's tree on the plate, each infection a stroke from source to case as
  heavy as the infections descended through it, so a wave reads like a drainage map.
  The caption gives Re both by the ratio of infections to removals and by counting
  each closed case's children.
- **The margin**: Nightingale's rose, observed Re and Re by count sit in the Counts
  tab; the Strains tab has the antigenic map, a time-scaled phylogeny, the
  strains by prevalence, a vaccine-matching control and a per-strain genome editor.
- **The model as a figure**: the Model tab draws the compartment diagram of the model
  the plate runs, with each compartment's count and each arrow's daily flux; choosing a
  part of it shows that part's switches and rates.
- **Intervention painting**: seed, vaccinate, quarantine, sanitize, and cull, from the
  brush rail on the plate's left edge, with three brush sizes. Undo and redo work until
  the simulation advances.

## Controls

Click or drag on the map to paint; the default brush seeds an infection. Scroll or pinch
to zoom. Restart runs the model again on a fresh world, keeping any change made in the
Model tab; Restore puts back the experiment's own values.

| Key | Action |
|---|---|
| Space | Play / pause |
| `.` | Step one tick |
| `R` | Restart |
| `1`–`6` | Brush: look, seed, vaccinate, quarantine, sanitize, cull |
| `[` / `]` | Brush size down / up |
| Ctrl/⌘+Z | Undo stroke |
| Ctrl/⌘+Shift+Z, Ctrl/⌘+Y | Redo stroke |
| `=` / `-` / `0` | Zoom in / out / reset |
| `M` | Next map view |
| `S` | Show or hide the margin |
| `T` | Theme |
| `?` | About |

## Running locally

The project has no build step of its own; it loads the shared design system from
the parent site by absolute path. From a checkout of
[a9lim.github.io](https://github.com/a9lim/a9lim.github.io) with submodules:

    npm install && npm run build
    python3 -m http.server --directory dist 8000   # http://localhost:8000/miasma/

Add `?seed=<any text>` to the URL for a reproducible run, and `?r=<radius>` for a
world of that radius (Settings → World offers four sizes).

## How it's built

Vanilla JavaScript modules with no dependencies; the lattice draws in WebGPU (a
browser without it gets a notice, and the margin's figures still run), and the
isochrones build in a Web Worker. Cell state is a set of
typed arrays over an axial grid masked to a regular hexagon: 24,031 cells by default,
from 10,621 to 96,661. Each tick computes the next state of what neighbours read into scratch
buffers and swaps them in, so every cell updates simultaneously; the tick visits only
the cells that can act where it can, and draws rare per-cell events by skipping to the
next one. `src/dynamics.js` holds the per-tick model, `src/topology.js` the surface
identifications, `src/immunity.js` antigenic distance and immune memory, and
`src/strains.js` the strain registry, `src/descent.js` who infected whom;
`node src/topology.test.mjs`, `node src/immunity.test.mjs` and
`node src/descent.test.mjs` run the tests, and `node tools/bench.mjs` times the tick.
[AGENTS.md](AGENTS.md) has the detailed map.

## License

[AGPL-3.0](LICENSE)
