# Miasma — handoff after phase 14 (build complete)

> Historical phase-closeout snapshot from 2026-05-13. Later phases 14.5-17 changed the current mechanics and UI; use `../AGENTS.md` and `../README.md` for the maintained contract.

Phase 14 shipped on 2026-05-13. All 14 phases complete. This file closes the
build log — `HANDOFF-phase10.md` and `HANDOFF-phase11.md` (also in this
folder) document the prior handoffs.

## What phases 11-14 shipped (in one session)

**Phase 11 — Intervention paint.** `src/paint.js` exports
`createPaintController` which owns all canvas pointer events and drives five
paint modes (seed / vaccinate / quarantine / sanitize / cull), brush radius
0/1/2 → 1/7/19 hex, and a per-stroke snapshot undo stack (depth 20). The
controller renders a 3×2 button grid inside the Interventions tab plus a
hover brush indicator on the canvas with per-mode accent colors. Default
mode is `SEED` with brush size 0, which preserves the single-tap-to-seed
UX from earlier phases. Touch support comes for free via Pointer Events.

**Phase 12 — Preset library.** `src/presets.js` ships eight calibrated
configs: SEIR-vanilla, COVID-like, Ebola, Tuberculosis, Andes hantavirus,
Smallpox, Plague+rats, Absurd mode. Each preset merges over DEFAULT_PARAMS
+ DEFAULT_TOGGLES and sets a topology. The Settings tab grew a third
sub-section (preset chooser) at the top, above the toggles and slider
panels. `applyPreset` restores defaults first so omitted keys land on
documented baselines, not the previous preset's leftovers. `resetGridOnly`
was extracted from `reset()` so preset apply can re-init the grid without
clobbering the freshly-applied preset overrides.

**Phase 13 — Render modes.** Four new heatmap projections in
`src/render.js`: age (green→amber→near-black on cell age), health
(red→amber→green on per-cell health), status (faded slate base with H
cyan + Q amber highlights), and susceptibility (red→green using 64-bit
bloom popcount as exposure proxy). Endpoint colors are pre-parsed once
per render so the per-cell loop only calls a cheap lerp. Compartment and
strain modes from phase 7-8 are unchanged.

**Phase 14 — Polish.**
- L-stripe contrast bumped from α=0.55 to α=0.78 + lineWidth 1.0→1.2
  (a9's flagged item — slate-on-amber at 0.55 was barely visible).
- C-rim alpha bumped from 0.5 to 0.75 to compensate for the red-on-green
  vs red-on-near-black contrast asymmetry (a9's other flagged item).
- **All 6 topologies real**: CYLINDER (Pair 1 translate, others PLANE),
  MÖBIUS (vertical-flip twist on Pair 1), KLEIN (möbius twist + Pair 2
  translate), RP² (antipodal identification through the hex center).
  Phase 10's deferred work — implemented per the sketches in
  `HANDOFF-phase11.md` section "Phase 14 sketch". `src/topology.test.mjs`
  grew to 4963 checks (was 2294), all green.
- Brush hover indicator on the canvas. Per-mode accent color injected as
  CSS custom property `--brush-accent`.
- View Transitions API on strain panel — rows now cross-fade across
  re-order instead of flashing on every stats tick. Each row carries a
  stable `view-transition-name: strain-row-<id>`.
- Keyboard shortcuts: `1`-`6` for paint modes (none / seed / vaccinate /
  quarantine / sanitize / cull), `[` / `]` for brush size, `ctrl+z` for
  undo. About panel shortcut list updated.
- Edu-content in `index.html` updated with paint modes, the eight
  presets, and all six view modes. `dateModified` bumped to 2026-05-13.
- OG image regenerated. Sitemap, llms-full, home-data, feed.xml/atom all
  re-built.
- Removed unused stub files: `src/vectors.js` (Phase 9 work was inlined
  into `dynamics.js`) and `src/input.js` (`attachClickToSeed` superseded
  by the paint controller).

## Repo layout (post-cleanup)

```
miasma/
  index.html
  main.js
  colors.js
  styles.css
  README.md
  about.md
  AGENTS.md         → re-export from CLAUDE.md
  CLAUDE.md         → @AGENTS.md
  LICENSE           (AGPL-3.0)
  og-image.webp
  src/
    config.js       enums + DEFAULTS
    grid.js         hex axial coords + typed-array cell storage
    topology.js     6-topology hex-quotient wrap
    topology.test.mjs   round-trip + adjacency-symmetry tests
    dynamics.js     per-tick state transitions + animal SIR + spillover
    strains.js      registry + similarity + mutation + recombination
    render.js       canvas drawing for all 6 view modes
    ui.js           sidebar wiring (presets + toggles + params)
    paint.js        paint controller + brush indicator + shortcuts
    timeseries.js   bottom chart panel
    lineage.js      strain panel + lineage tree
    presets.js      8 calibrated configs
    stats.js        compartment census + R_eff
    toggles.js      compartment + flag toggle panel
    params.js       slider panel
  docs/
    HANDOFF-phase10.md   phases 1-9 architecture summary
    HANDOFF-phase11.md   phase 10 close-out + phase 14 sketches
    HANDOFF-phase14.md   this file
```

## What's not in scope

These didn't ship and aren't planned without a fresh ask from a9:
- Vaccine waning (the `vax_strains` / `vax_ages` slots in `Grid` are
  reserved but untouched — Phase 7+ would have wired them).
- Cross-immunity matrix UI for the top-K prevalent strains.
- Wasserstein strain similarity (currently L2 in param space).
- Sound layer.
- Per-strain export / lineage download.
- A "compare two topologies side-by-side" view.

## Test invariants worth preserving

- `node src/topology.test.mjs` → 4963 passes, 0 failures. Re-run after
  any change to `wrap`, `neighbors`, `hexBounds`, or `inHex`.
- `node --check` on every JS file before deploy.
- ID contract between `index.html` and source — checked by:
  ```bash
  diff <(grep -rPoH "getElementById\('\K[^']*" src/ main.js | sed 's/.*://' | sort -u) \
       <(grep -oP 'id="[^"]*"' index.html | sed 's/id="//;s/"//' | sort -u)
  ```
- Per-tick step order in `dynamics.js` (documented at the top of the
  file). Reordering breaks conservation properties.
- Conserved quantity: compartment counts sum to `W * H` (including
  `empty`).

— (the integrating instance, 2026-05-13)
