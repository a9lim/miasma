# AGENTS.md

Part of the **a9l.im** portfolio. See root `AGENTS.md` for the shared design system and shared code policy. Sibling projects: `geon`, `cyano`, `gerry`, `shoals`, `scripture`.

## Rules

- Always prefer shared modules over project-specific reimplementations. Check `shared-*.js` files before adding utility code.
- Hex coordinate math, brush hit-testing, and snapshot undo are shared concepts with `gerry`. Reuse those helpers rather than reimplementing.
- The topology toggle UI mirrors `geon`. Use the same `_forms.bindModeGroup` pattern and the same set of six topology keys (`plane`, `cylinder`, `torus`, `mobius`, `klein`, `rp2`).

## Running Locally

```bash
cd path/to/a9lim.github.io && python -m http.server
```

Serve from root — shared files load via absolute paths. No build step, test suite, or linter.

Verify HTML-to-JS ID contract after restructuring:
```bash
diff <(grep -rPoH "getElementById\('\K[^']*" src/ main.js | sed 's/.*://' | sort -u) \
     <(grep -oP 'id="[^"]*"' index.html | sed 's/id="//;s/"//' | sort -u)
```

## Overview

Stochastic spatial epidemic simulator on a hex grid. Eight compartments (S, E, I, R, D, V, M, Z + `empty`), orthogonal status layer (none / H / Q), bit-flags for latent / chronic-carrier / infectious-corpse modifiers, multi-strain registry with mutation and recombination, population dynamics (age, health, births, deaths), gerry-style intervention paint, geon-style topology toggle (6 manifolds on a discrete hex lattice). Zero dependencies, vanilla ES6 modules.

## Architecture

**`main.js`**: entry point, `$` DOM cache, owns the rAF loop with timestep accumulator, constructs the paint controller (which owns canvas pointer events), wires preset/topology/viewmode callbacks via `setupUI`.

**Color pipeline**: `_PALETTE` (shared-tokens.js) → compartment hue aliases (`colors.js`) → `--epi-*` CSS vars + `-tint` / `-wash` alpha variants. Light/dark D (deceased) hex flips between `light.text` and `dark.canvas` to keep contrast against the canvas. Z (zombie) is a derived OKLCH chartreuse intentionally distinct from R-green.

**Data flow**: tick advances dynamics (per `src/dynamics.js` order: age, births, strain dynamics, transmission, state transitions, hospital allocation, health degradation, mortality, Z dynamics) → render reads grid arrays → time-series samples compartment counts → strain registry recomputes prevalence.

## State Model

Single `grid` object in `src/grid.js`. Cell state is structure-of-arrays in typed arrays, indexed by `q * H + r`:

- `compartment: Uint8Array` — S=0, E=1, I=2, R=3, D=4, V=5, M=6, Z=7, empty=8
- `status: Uint8Array` — none=0, H=1, Q=2
- `flags: Uint8Array` — bitfield: latent=1, carrier=2, infectious-corpse=4
- `age: Uint16Array` — ticks since birth
- `health: Float32Array` — 0..1
- `strain_ids: Uint16Array[N*4]`, `strain_loads: Float32Array[N*4]`, `strain_hist: Uint8Array` (bloom-filter prior exposure)
- `vax_strains: Uint16Array[N*4]`, `vax_ages: Uint16Array[N*4]`

`MAX_ACTIVE = 4` (coinfection cap), `MAX_VAX = 4`. Unlimited strains in registry; per-cell load tracking is bounded.

## Key Conventions

### Topology Wrapping

All neighbor lookups go through `wrap(q, r, topology, W, H) → (q', r') | null` in `src/topology.js`. Identifications happen at the six hex edges of the **inscribed hex** carved out by `applyHexMask` — not at the rhombus edges. PLANE returns null outside; TORUS translates by the hex-tessellation lattice (T1, T2); CYLINDER identifies Pair 1 alone; MÖBIUS adds a vertical-flip twist; KLEIN combines the möbius twist with Pair 2 translation; RP² is antipodal identification through the hex center. Round-trip invariant: `wrap(neighbor(c, d), inverse(d)) === c` for any cell and direction. `src/topology.test.mjs` exercises this exhaustively on a 12×12 grid (~5000 checks) — run it after any change to the wrap function.

### Strain Registry

Strains are append-only. IDs are `Uint16` indices into a growing parameter table (β, σ, γ, μ, ADE flag, plus lineage parents). Names are auto-generated: Greek letter sequence, then Greek+numeral after exhaustion. Z is its own pseudo-strain at a fixed slot — doesn't participate in cross-immunity, doesn't recombine.

### Compartment Toggles + Dependencies

Use `_forms.bindDeps` to declare which compartments enable which. Example: V (vaccinated) requires the vaccinate intervention to be unlocked; M (maternal) requires births to be enabled; Z (zombie) is always available and never gated. Bind these in `src/ui.js`, not scattered across modules.

### Theme

Two-state toggle (light / dark). Canvas reads `document.documentElement.dataset.theme` directly. D (deceased) hex color flips with theme so it stays readable against the canvas.

### Paint controller

`src/paint.js` exports `createPaintController({ canvas, getGrid, getToggles, getViewport, onMutate })`. The controller owns ALL canvas pointer events — there is no separate click-to-seed handler. Default mode is `SEED` with brush size 0, which preserves the single-tap-to-seed UX from earlier phases. Other modes: `VACCINATE`, `QUARANTINE`, `SANITIZE`, `CULL`, `NONE`. Brush size 0/1/2 → 1/7/19 hex. Strokes push to a per-stroke undo stack (depth 20); pointerdown opens a snapshot map, pointerup pushes it. Keyboard shortcuts (`1`-`6` for modes, `[`/`]` for brush size, `ctrl+z` for undo) are wired by the controller itself.

The brush hover indicator is a DOM div appended to `<body>` by the controller, repositioned on each pointermove. Per-mode accent color comes from a CSS custom property `--brush-accent` that paint.js sets inline.

## Key Reusable Bits

| What | Where | Use for |
|---|---|---|
| Hex axial coords + helpers | `gerry/src/hex-math.js` (mirrored in `grid.js`) | Cell coordinate math |
| Cube-rounding pixel → axial | `grid.js` `pixelToAxial` | Paint cursor hit-testing |
| `_forms.bindModeGroup` | `shared-forms.js` | Topology + viewmode mode-groups |
| `_forms.bindDeps` | `shared-forms.js` | Compartment toggle dependencies (Phase 14 wiring) |
| `_settings.create` | `shared-settings.js` | Settings dropdown for rare controls |
| `_toolbar` (play/pause/speed) | `shared-toolbar.js` | Standard sim toolbar |
| `initAboutPanel(config)` | `shared-about.js` | About modal |
| `_dropdown.enhance` | `shared-dropdown.js` | Preset select |
| `resizeCanvasDPR` | `shared-utils.js` | Hi-DPI canvas |
| Topology glide-reflection concept | `geon/src/topology.js` | Reference only — discrete hex-quotient is project-specific |

## Design Intent

- **Hex isotropy is load-bearing.** Six-neighbor diffusion eliminates the rook-vs-bishop asymmetry of square grids and produces visually clean wavefronts. Do not migrate to a square grid for performance — pick a smaller grid size instead.
- **Compartmental model is configurable, not fixed.** Every compartment, flag, and status state has a toggle in the UI. Presets configure these toggles; users can also toggle individually. Do not hard-code compartment availability in `dynamics.js` — gate transitions on the toggle state.
- **Two intents: textbook + absurd.** SEIR-vanilla preset must produce the canonical Kermack-McKendrick curve on a torus with no other mechanics active. Absurd preset turns everything on at once. Both must work without code changes.
- **Z is structurally normal.** Z is just another compartment with its own transition rules. Don't put Z behind a feature flag in the build; put it behind a UI toggle that defaults to off.

## Don't Break

- **Per-tick update order in `dynamics.js`** — age, births, strain dynamics, transmission, state transitions, hospital allocation, health degradation, mortality, Z dynamics. Reordering breaks conservation properties (newborns shouldn't be aged, dead cells shouldn't transmit, etc.).
- **Conserved quantities** — compartment counts must sum to `W * H` (including `empty`). Add a debug assertion in dev builds.
- **`wrap()` round-trip invariant** — if it fails on any topology, the infection front becomes path-dependent and torus tests fail silently.
- **Typed-array layout** — `compartment[i]` and `status[i]` and `flags[i]` for the same `i` refer to the same cell. Don't reorder.
- **Strain ID is `Uint16`** — caps strain count at 65k. Don't widen without auditing every typed-array allocation.

## Gotchas

- **`data-theme` is on `<html>`** — `document.documentElement.dataset.theme`
- **Shared CSS at domain root** — `/shared-base.css` absolute path requires serving from parent directory
- **Sidebar uses `.sidebar-tabs` in `.stats-header`** — no separate `<h2 class="stats-title">` and `.tab-bar`. New layout pattern site-wide
- **Canvas DPR** — always go through `resizeCanvasDPR` from `shared-utils.js`. Manual `canvas.width = innerWidth` produces blurry rendering on hi-DPI
- **Time-series ring buffer** — fixed-size, drops oldest sample. Resizing requires reallocation; don't do it on every theme toggle
