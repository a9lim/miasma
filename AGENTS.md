# AGENTS.md

Part of the **a9l.im** portfolio. See root `AGENTS.md` for the shared design system and shared code policy. Sibling projects: `geon`, `cyano`, `gerry`, `shoals`, `scripture`.

## Rules

- Always prefer shared modules over project-specific reimplementations. Check `shared-*.js` files before adding utility code.
- Hex coordinate math, brush hit-testing, and snapshot undo are shared concepts with `gerry`. Reuse those helpers rather than reimplementing.
- The topology toggle UI mirrors `geon`. Use the same `_forms.bindModeGroup` pattern and the same set of six topology keys (`plane`, `cylinder`, `torus`, `mobius`, `klein`, `rp2`).
- Compartment / flag toggles use the geon-style colored switch + shoals-style colored label text. Each row binds a per-key `tog-{key}` class (`tog-v`, `tog-m`, `tog-z`, `tog-e`, `tog-r`, `tog-d`) that sets `--tog-color`; the base `.tog` rules in `shared-base.css` pick it up for the on-state, and the row label inherits via `color: var(--tog-color)`. No swatch boxes.
- All parameter sliders live in a collapsible **"Advanced Parameters"** section (shoals pattern — `.advanced-toggle-btn` + `.advanced-section.hidden`, not `_settings.create()`). The Settings tab carries presets + surface/map-view controls + compartment/flag toggles + Display row + the Advanced toggle + Reset button. See `src/params.js` `buildAdvancedSection`. `CORE_LAYOUT` is intentionally empty — every slider goes in `ADVANCED_LAYOUT` with section headings. Phase 15 swap from the `_settings.create` floating dropdown to an inline collapsible: the dropdown didn't compose with the sidebar's `overflow: hidden` scroll container and felt foreign next to the inline toggle rows.
- The top bar carries `#speed-btn` (must have `.speed-btn` class **and** an inner `<span class="speed-label">` — `_toolbar.updateSpeedBtn` writes the multiplier into that span; without it the button renders blank) and `#viewmode-btn` (eye icon). The viewmode button is a jump handle to the Settings tab's map controls; it does not own mode selection.
- `#timeseries-panel` lives inline as the first child of `#tab-compartments` (the sidebar Compartments tab), above the compartment census — it is no longer a floating HUD (Phase 17). `stats.js` `buildPanelSkeleton` rebuilds that tab's contents on every render but explicitly preserves the `#timeseries-panel` node (its canvas context is captured once by `initTimeseries`). The chart is stacked-only — `renderLines` was removed in Phase 15.
- `Compartment.EMPTY` cells render fully transparent. `src/render.js` skips both fill and stroke for empty cells in the human-layer pass; the `animalDisplay === 'only'` branch likewise skips its old backdrop fill. Adding overlay code that iterates the full grid should explicitly handle EMPTY (don't assume a non-zero alpha is being painted underneath).
- Showcase defaults: `DEFAULT_PARAMS` has no value at 0 or 1, and `DEFAULT_TOGGLES` enables V/M + flags + `vax_rollout` while leaving Z off by default. Zombie/oncoviral presets opt Z back in. Presets reset to these defaults before merging, so canonical preset shapes (`seir-vanilla` etc) still produce textbook curves.

## Running Locally

```bash
cd path/to/a9lim.github.io && python -m http.server
```

Serve from root — shared files load via absolute paths. No build step, test suite, or linter.

Verify HTML-to-JS ID contract after restructuring (BSD/macOS-safe form):
```bash
comm -3 \
  <(rg -No "getElementById\('([^']+)'" src main.js --replace '$1' | sed 's/.*://' | sort -u) \
  <(rg -No 'id="([^"]+)"' index.html --replace '$1' | sort -u)
```

## Overview

Stochastic spatial epidemic simulator on a hex grid. Eight compartments (S, E, I, R, D, V, M, Z + `empty`), orthogonal status layer (none / H / Q), bit-flags for latent / chronic-carrier / infectious-corpse modifiers, multi-strain registry with mutation and recombination, population dynamics (age, health, births, deaths), an animal reservoir SIR layer with its own demography (births / aging / age-driven mortality) and per-strain transmission, gerry-style intervention paint, geon-style topology toggle (6 manifolds on a discrete hex lattice). Zero dependencies, vanilla ES6 modules.

## Architecture

**`main.js`**: entry point, `$` DOM cache, owns the rAF loop with timestep accumulator, constructs the paint controller (which owns canvas pointer events), wires preset/topology/viewmode callbacks via `setupUI`. Also owns the zoom/pan layer (see "Zoom + Pan" below).

**Color pipeline**: `_PALETTE` (shared-tokens.js) → compartment hue aliases (`colors.js`) → `--epi-*` CSS vars + `-tint` / `-wash` alpha variants. Light/dark D (deceased) hex flips between `light.text` and `dark.canvas` to keep contrast against the canvas. Z (zombie) is a derived OKLCH chartreuse intentionally distinct from R-green. Toggle rows reuse the same `--epi-*` vars via per-key `tog-{key}` classes that bind `--tog-color`.

**Data flow**: tick advances dynamics (per `src/dynamics.js` order: age, births, strain dynamics, transmission, state transitions, hospital allocation, health degradation, vaccination rollout, mortality, Z dynamics, animal dynamics delegated to `src/dynamics-animal.js` — itself ordered animal aging → animal births → animal SIR + spillover → animal mortality) → render reads grid arrays → time-series samples compartment counts → strain registry recomputes prevalence.

**Render signature**: `render(ctx, grid, mode, viewport, opts)` where `opts` carries cross-cutting toggles main.js owns:
- `animalDisplay: 'dots' | 'only' | 'off'` — three-way gate on the animal-layer overlay. `'only'` skips the human-compartment fill+overlay passes and draws only animal dots over an empty shell.
- `ageMax: number` — saturation ceiling for the AGE view ramp; pass `params.mortality_max_age` so it tracks the live slider.

## Per-Tick Hot Path

At 4× speed the loop fires ~40 ticks/sec. Anything that allocates or touches DOM each tick competes with the UI for main-thread time. The rules:

- **No `document.startViewTransition` in tick-driven render paths.** It snapshots the document and runs compositor work — multiple-ms cost. The strain panel used to wrap its row rebuild in startViewTransition and that was the dominant source of UI jank. If smooth row-reordering is wanted back, do FLIP-style CSS transforms on the row nodes, not view transitions.
- **Visibility-gated rendering.** `renderStatsPanel`, `renderStrainPanel`, `updateStrainPanel`, and `timeseries.render` all bail when their host tab panel isn't active. Use `classList.contains('active')` on the host `.tab-panel` — NOT `offsetParent`. `offsetParent` is a layout-dependent property and forces a sync layout flush when read after any DOM write. classList is a string compare with zero layout impact. `timeseries.render` resolves its host via `panelEl.closest('.tab-panel')` once at init (the chart now lives inside `#tab-compartments`, so it's gated on the Compartments tab being active).
- **wakeRenders().** When a tab/sidebar visibility flip happens (tab-btn click, menu-btn click), `main.js`'s `wakeRenders()` marks the panels dirty and calls `requestFrame()`. Without it, paused-state visibility flips would show stale data until the next tick. New panels with visibility skips need wiring through wakeRenders.
- **Row pool, not tear-and-rebuild.** The strain panel keeps a `Map<strainId, {row, swatch, name, prev, fill}>` on `panelEl._lineageRefs.rowPool`. Re-renders reuse the same DOM nodes, mutate text + bar width only when `(count, fraction)` differ from the cached `lastVals`, and call `listEl.appendChild(rec.row)` to reorder. The lineage forest is throttled separately from row updates. Don't add a path that rebuilds rows from scratch — that's what triggered the View Transitions cost.
- **Cache DOM refs at skeleton-build time.** Both `stats.js` and `lineage.js` cache value-element refs on `panelEl._statsRefs` / `panelEl._lineageRefs` during the first call. The per-tick render reads from these maps; it doesn't `querySelector`. Adding new stat rows means adding their ref to the cache too.
- **Text-equality guard before write.** All `textContent` writes in stats.js / lineage.js gate behind `if (el.textContent !== text)` so unchanged cells don't dirty the layout. textContent writes invalidate layout even when the new string matches.
- **History/time-series are typed-array ring buffers.** `main.js`'s `history` object backs four parallel `Uint32Array(200)` columns with a head pointer. API: `history.push(sToE, eToI, iToR, iToD)` (positional, no object alloc), `history.clear()`, `history.length`, `history.cap`. `stats.computeReff` reads the typed arrays directly and handles ring wrap-around. `timeseries.js` likewise stores fixed typed columns, not an array of sample objects. Don't go back to `history.push({...})` / `ring.push({...})` + `shift()`.
- **Position cache hash via numeric fields.** `render.js`'s `ensurePositionCache` compares `(grid, hexSize, originX, originY, W, H)` separately — no string concat for cache lookup. On a hit, zero allocations. Cache rebuilds iterate `grid.activeIndices` only. Don't add a stringified key.
- **Active-cell iteration.** `initialization.applyHexMask` writes `grid.activeIndices` / `grid.activeCount` for the inscribed hex. Dynamics, stats, prevalence, and render hot loops should iterate that list rather than the full W×H rhombus. Outside-mask cells are storage padding, not simulated population.

## State Model

Single `grid` object in `src/grid.js`. Cell state is structure-of-arrays in typed arrays, indexed by `r * W + q`:

- `compartment: Uint8Array` — S=0, E=1, I=2, R=3, D=4, V=5, M=6, Z=7, empty=8
- `status: Uint8Array` — none=0, H=1, Q=2
- `flags: Uint8Array` — bitfield: latent=1, carrier=2, infectious-corpse=4
- `age: Uint16Array` — ticks since birth
- `health: Float32Array` — 0..1
- `strain_ids: Uint16Array[N*4]`, `strain_loads: Float32Array[N*4]`, `strain_hist: Uint8Array` (bloom-filter prior exposure)
- `animal: Uint8Array` — reservoir SIR layer, orthogonal to the human compartment: VOID=0, S=1, I=2, R=3, D=4
- `animal_age: Uint16Array` — ticks since the animal was born (drives age-ramped reservoir mortality)
- `animal_strain: Uint16Array` — strain id carried by an infectious animal (`0xFFFF` = none); per-strain `animal_beta`/`gamma`/`mu` are read off the registry by this id
- `activeIndices: Int32Array` — row-major in-world indices from the inscribed hex mask; hot loops use this instead of scanning all W×H storage cells

`MAX_ACTIVE = 4` (coinfection cap). Unlimited strains in registry; per-cell active load tracking is bounded.

## Key Conventions

### Zoom + Pan

Lives in `src/camera.js`, with `main.js` wiring the controls. `sim.zoom` (clamped 0.5–3×) scales the camera's fit-to-canvas baseline; `sim.panX/panY` translate `originX/originY`. `camera.getEffectiveViewport()` mutates and returns a single shared object each call by composing base + zoom + pan; this is the value handed to both `render()` and the paint controller's `getViewport`. paint.js's `pixelToAxial` works unchanged because the effective viewport is what it sees. **Consumers MUST NOT retain the returned reference across an awaited boundary** — the next call mutates it in place. render() and paint.hitTest both consume synchronously, so this is fine today.

Wheel zoom is cursor-anchored (the math: `panX_new = sx - bv.originX - worldPx * zoom_new`). Pinch zoom follows gerry's `touchstart/touchmove/touchend` pattern: paint is suppressed for the duration via `paintController.setSuppressed(true/false)`, which also closes any active stroke on entry. Buttons `#zoom-in-btn` / `#zoom-out-btn` / `#zoom-reset-btn` are pivot-at-canvas-center; the `#zoom-indicator` text is updated via `updateZoomIndicator()`. Keyboard: `=` / `-` / `0`. Pan clamping is intentionally not implemented — reset is the recovery handle.

### Birth → M-from-R rule

Empty cells repopulate from inhabited neighbors; the newborn's compartment depends on the parent. Parent picked uniformly from the inhabited neighbors of the empty cell; if it's R (and `t.M` is on) the newborn enters as M (maternal antibodies), otherwise as S. The probabilistic-pick is equivalent to "spawn M with probability rCount/count" without allocating a parent-slot array. Don't unconditionally write M — the original Phase-5 behavior had every S parent producing M children, which broke the antibody-transfer semantics.

### Z mechanic — spawn pathways + encounter model (Phase 16)

Z is interpretation-agnostic. Same state machine reads as both macroscopic (zombie pandemic with humans fighting back) and microscopic (oncoviral cellular transformation with immune surveillance) depending on parameter values + which spawn pathway is active. Step 9 in `dynamics.tick` is the whole mechanic; gated wholesale on `t.Z`.

**Spawn pathways** (all gated on `t.Z`, plus their own flag gates):
- **F-corpse → Z** at `dz_dead`. Requires `flags[i] & Flag.F_CORPSE` on a D cell. F is set on I→D only when `t.F` is on, and natural-cause deaths (step 8 age-out) explicitly strip F. So D→Z only fires through the disease-death pipe; turning `t.F` off mechanically disables the pathway. Macro reading: infectious corpses reanimate.
- **I → Z** at `dz_alive`. Live infectious cells spontaneously zombify. No flag gate. Both readings.
- **E-with-L → Z** at `l_transform`. Requires `t.L && (flags[i] & Flag.LATENT)`. Micro reading: oncovirus integrated in host genome triggers malignant transformation. Competes with σ (E→I) and `l_reactivate`; Z wins the same-tick race because Step 9 overwrites Step 5's writes.

**Encounter model** (per Z, per non-Z non-EMPTY non-D neighbor):
- Single uniform `r()` roll bucketed across four cumulative thresholds: `[0, z_fight_kill)` → D, `[…, +z_fight_infect)` → D + F_CORPSE (F flag attaches only when `t.F` is on; falls back to clean kill otherwise), `[…, +z_fight_expose)` → E (with `l_seed`-gated optional LATENT, like step 5 S→E), `[…, +z_convert_unopposed)` → Z. Leftover = nothing happens. Rates are clamped to ≥ 0 and renormalized to sum ≤ 1 (so a user that dials all four to max doesn't break the bucket math).
- Separate independent roll for `z_die_fighting` (Z → D). A zombie can kill and die in the same encounter (mutual destruction); the break only fires after the target-outcome roll is resolved.
- **First-affect-wins** on the target side: an encounter only rolls the target-outcome if `next[ni] === compartment[ni]` (no earlier Z has affected this target this tick). Gives `P(target affected | k zombies) = 1 − P(nothing)^k`, which scales correctly with horde size. Without this, k zombies would have the same expected effect on a target as 1 zombie — last-write-wins under independent rolls.
- A zombie that dies (z_die_fighting fires) breaks out of its encounter loop — corpses don't keep biting.

**Z death pathways**:
- `z_die_natural` (per tick, before encounters) — finite lifespan. Macro: decomposition. Micro: zero by default since transformed cells are immortal.
- `z_exhaust` (gated on `zCount >= z_exhaust_threshold`) — crowding-driven Z → D. Maps onto tumor-core necrosis (hypoxia) in the micro reading, "zombies starving when concentrated" in the macro reading.
- `z_die_fighting` (per encounter) — humans / immune surveillance fighting back.

**Strain handling on conversion**: Z is a pseudo-strain at a fixed slot; `clearStrainSlot(idx)` wipes the cell's active strain ids + loads on any Z-related conversion. `strain_hist` (bloom-filter past exposures) is preserved — it's a record, not active state.

**Two presets ship the calibrated configurations**: `zombie-apocalypse` (F-spawn, high fight rates, finite lifespan, low conversion) and `oncoviral-transformation` (L-spawn, near-zero fight, immortal cells, high conversion, exhaust-by-crowding on). The default `DEFAULT_PARAMS` keeps Z rates live, but `DEFAULT_TOGGLES.Z` is false so Z is opt-in unless a preset enables it.

### Vaccination rollout

Step 7.5 in `dynamics.tick` sweeps S/E/R/M cells at `vax_rollout_rate` per tick when `t.V && t.vax_rollout` are both on. Reads `next[i]` so cells that recovered earlier in this same tick are immediately eligible. The toggle is wired via `_forms.bindDeps` (in `toggles.js`) so it auto-disables and force-unchecks when `t.V` is off.

### Animal reservoir — demography + per-strain SIR (Phase 17)

Step 10 in `dynamics.tick` is the whole reservoir mechanic, gated wholesale on the grid carrying an `animal` array (always true in production). It is a demographically-active SIR layer brought up to parity with the human compartment in Phase 17.

**Demography.** The reservoir has its own birth / aging / age-driven mortality, mirroring the human layer's `birth_rate` / mortality ramp:
- `animal_birth_rate` / `animal_birth_threshold` — a VOID cell with ≥ threshold inhabited (non-VOID, non-D) animal neighbors rolls `1-(1-rate)^count` → S animal. No maternal pathway — the newborn is always S.
- `animal_mortality_baseline` / `animal_mortality_age_max` / `animal_max_age` — age-ramped natural death of S/I/R animals → D, linear-interpolated baseline→max over `animal_max_age`. `animal_d_disposal` then clears D → VOID.
- `initializeAnimals` spreads seed-animal ages uniformly over `[0, animal_max_age)` so the reservoir starts with a stable age structure instead of one synchronized cohort.

**Per-strain SIR.** `animal_beta` / `animal_gamma` / `animal_mu` are per-strain genome fields (in `GENOME_FIELDS` / `STRAIN_GENOME_LAYOUT`'s "Reservoir (animal)" section), NOT live global params in normal operation. An infectious animal carries a strain id in `animal_strain`; Step 10 reads its rates off the registry by that id. They remain keys in `DEFAULT_PARAMS` so `createRegistry` seeds strain α's genome from them and as a defensive no-registry fallback. Their Advanced-parameters sliders moved into the per-strain genome editor.

**Spillover is strain-aware.** Forward spillover (animal I → human S→E) hands the animal's *own* `animal_strain` to the human (Phase 9 hardcoded strain α — that was a bug). Reverse spillover (human I → animal S→I) hands the human's slot-0 strain to the animal. Animal-to-animal transmission reservoir-samples the source strain uniformly among infectious neighbors (allocation-free).

The reservoir layer is NOT behind a toggle — `animal_density: 0` (set by all non-reservoir presets) leaves it empty, and with no seed animals births can never start, so it stays empty. Presets with a reservoir (hantavirus, plague, absurd) set a non-zero density.

### L / C flag set rolls

The L (latent E) and C (chronic carrier R) flags are set probabilistically on the relevant transitions, NOT on initial seeding:
- **L on S→E**: `t.L && r() < l_seed` at infection time (S transmission case in step 5). Sets `Flag.LATENT` on the new E cell so its E→I path goes through the slow `l_reactivate` rate instead of σ.
- **C on I→R**: `t.C && r() < c_seed` at recovery time (I→R branch in step 5). Sets `Flag.CARRIER` on the new R cell so it acts as a low-rate transmission source via `c_transmit_mult` in `pickIncomingStrain`.
- Defaults keep both seed probabilities live in the sandbox (`l_seed=0.15`, `c_seed=0.18`) while the compartment toggles decide whether the mechanics run. Presets like `tb` (`l_seed=0.9`) and `hantavirus` (`c_seed=0.4`) push them harder. Without the seed roll, `l_reactivate` and `c_transmit_mult` are inert — which was the bug that prompted phase 14.5.

### Reinfection and vaccine breakthrough

R and V cells are transmission targets when their respective compartment-level susceptibility is > 0:
- **R reinfection** (`r_susceptibility_mult`, default 0.15): the R case in the transmission switch calls `pickIncomingStrain`. Inside that helper, `pInf *= rSuscMult` for R targets after the Q/age multipliers. The bloom-filter cross-immunity scaling already softens previously-seen strains via `(1 - xImm)` per slot, so reinfections favor novel strains — the right shape (novel antigens slip past prior immunity at reduced rate). On breakthrough: R → E, picked strain at load 1, bloom history preserved (it's a record of past exposures, not a slate to wipe).
- **V breakthrough** (`vax_efficacy`, default 0.85): symmetrical with R, but `pInf *= (1 - vaxEff)`. Gated on both `t.V` and `vaxEff < 1` (early-out for perfect efficacy). Bloom history is preserved because the rollout step at 7.5 doesn't touch `nextStrainHist` and the paint controller's `clearStrainSlots` only clears slots, not the bloom.
- **Both count to `sToE`** so observed Re (which divides by recent recovery counts) reflects all new infection events, not just S-derived ones.
- **M cells aren't reinfectable** — they decay to S via `m_decay` and become normal targets after that. Adding M breakthrough would need a separate `m_efficacy`-style param; not implemented.

### Topology Wrapping

All neighbor lookups go through `wrap(q, r, topology, W, H) → (q', r') | null` in `src/topology.js`. Identifications happen at the six hex edges of the **inscribed hex** carved out by `applyHexMask` — not at the rhombus edges. PLANE returns null outside; TORUS translates by the hex-tessellation lattice (T1, T2); CYLINDER identifies Pair 1 alone; MÖBIUS adds a vertical-flip twist; KLEIN combines the möbius twist with Pair 2 translation; RP² is antipodal identification through the hex center. Round-trip invariant: `wrap(neighbor(c, d), inverse(d)) === c` for any cell and direction. `src/topology.test.mjs` exercises this exhaustively on a 12×12 grid (~5000 checks) — run it after any change to the wrap function.

### Strain Registry

Strains are append-only. IDs are `Uint16` indices into a growing parameter table (β, σ, γ, μ, ADE flag, plus lineage parents). Names are auto-generated: Greek letter sequence, then Greek+numeral after exhaustion. Z is its own pseudo-strain at a fixed slot — doesn't participate in cross-immunity, doesn't recombine.

### Compartment Toggles + Dependencies

Use `_forms.bindDeps` to declare which compartments enable which. Example: V (vaccinated) requires the vaccinate intervention to be unlocked; M (maternal) requires births to be enabled; Z (zombie) is always available and never gated. Bind these in `src/ui.js`, not scattered across modules.

### Theme

Two-state toggle (light / dark). Canvas reads `document.documentElement.dataset.theme` directly. D (deceased) hex color flips with theme so it stays readable against the canvas.

### Paint controller

`src/paint.js` exports `createPaintController({ canvas, getGrid, getToggles, getViewport, onMutate })`. The controller owns ALL canvas pointer events — there is no separate click-to-seed handler. Default mode is `SEED` with brush size 0, which preserves the single-tap-to-seed UX from earlier phases. Other modes: `VACCINATE`, `QUARANTINE`, `SANITIZE`, `CULL`, `NONE`. Brush size 0/1/2 → 1/7/19 hex. Strokes push to a per-stroke undo stack (depth 20); pointerdown opens a snapshot map, pointerup pushes it. `main.js` clears undo/redo on every tick advance so paint history cannot rewind evolved disease state. Keyboard shortcuts (`1`-`6` for modes, `[`/`]` for brush size, `ctrl+z` for undo) are wired by the controller itself.

The brush hover indicator is a DOM div appended to `<body>` by the controller, repositioned on each pointermove. Per-mode accent color comes from a CSS custom property `--brush-accent` that paint.js sets inline.

`setSuppressed(bool)` lets main.js's pinch-zoom bracket a gesture: while suppressed, pointerdown/pointermove early-exit and any active stroke is cleanly closed (snapshot still lands on the undo stack so cmd+Z is recoverable). Re-enabling resumes normal behavior on the next pointerdown.

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
- **Three intents: textbook + dual-Z + absurd.** SEIR-vanilla preset must produce the canonical Kermack-McKendrick curve on a torus with no other mechanics active. Zombie-apocalypse and oncoviral-transformation presets must show the macro and micro readings of the same Z state machine — same code, different parameter regions. Absurd preset turns everything on at once. All three must work without code changes.
- **Z is structurally normal.** Z is just another compartment with its own transition rules. Don't put Z behind a feature flag in the build; put it behind a UI toggle that defaults to off.

## Don't Break

- **Per-tick update order in `dynamics.js`** — age, births, strain dynamics, transmission, state transitions, hospital allocation, health degradation, vaccination rollout (7.5), mortality, Z dynamics, animal dynamics. Reordering breaks conservation properties (newborns shouldn't be aged, dead cells shouldn't transmit, vax should land after I→R/I→D so a same-tick recoveree gets eligible, etc.). Step 10 lives in `dynamics-animal.js` and has its own internal order — 10a aging, 10b births, 10c SIR + spillover, 10d age-mortality — mirroring the human age→births→…→mortality ordering for the same reason: a 10b newborn must be inert through 10c/10d, and a 10c disease-death must not be re-counted as a 10d age-out.
- **Conserved quantities** — compartment counts over in-world cells must sum to `grid.activeCount` / `grid.activeIndices.length`. The W×H rhombus includes outside-mask storage padding that should stay `Compartment.EMPTY` but is not part of the simulated population.
- **`wrap()` round-trip invariant** — if it fails on any topology, the infection front becomes path-dependent and torus tests fail silently.
- **Typed-array layout** — `compartment[i]` and `status[i]` and `flags[i]` for the same `i` refer to the same cell. Don't reorder.
- **Strain ID is `Uint16`** — caps strain count at 65k. Don't widen without auditing every typed-array allocation.
- **F_CORPSE / D→Z coupling** — D→Z reads `flags[i] & Flag.F_CORPSE`; I→D sets F_CORPSE only when `t.F`. Removing either side disconnects the chain and the F-corpse-reanimation pathway stops. (The I→Z spontaneous path via `dz_alive` and the L→Z transform path via `l_transform` are unaffected — each has its own gate.)
- **Z encounter model: cumulative buckets + first-affect-wins** — the four target-outcome rates (`z_fight_kill`/`z_fight_infect`/`z_fight_expose`/`z_convert_unopposed`) must be treated as mutually-exclusive buckets of a single uniform roll, not as independent Bernoullis. Switching to independent rolls allows multiple outcomes per encounter (e.g., target both killed AND converted) and breaks the cumulative-threshold semantics. The renormalization clamps the four rates to sum ≤ 1; the leftover region is "nothing happens." First-affect-wins (`next[ni] === compartment[ni]` check before rolling) is what makes horde size matter — without it, k zombies have the same expected effect as 1 zombie on shared targets.
- **L→Z is in Step 9, not Step 5** — all Z-related transitions live in Step 9 so the "Z wins" overwrite semantics apply consistently. Adding L→Z to Step 5 (alongside L→I) would mean Z conversion could be overwritten by a same-tick Step 9 outcome, breaking the invariant.
- **L / C flag set sites** — `Flag.LATENT` is set ONLY in the S→E transmission branch under `t.L && r() < lSeed`; `Flag.CARRIER` is set ONLY in the I→R recovery branch under `t.C && r() < cSeed`. Removing either roll re-creates the original phase-14 bug where `l_reactivate` and `c_transmit_mult` are inert because no flags ever land. Render and check sites in `dynamics.js` / `render.js` are downstream of these rolls — don't add new check sites without ensuring the set roll fires.
- **R and V are transmission targets** — when `r_susceptibility_mult > 0` and `vax_efficacy < 1` respectively. The compartment-level multiplier is applied inside `pickIncomingStrain` after the Q/age multipliers (so it composes correctly with status and age effects). Both branches feed `sToE` to keep observed Re honest. Don't move the multiplier outside the helper — the per-slot bloom-filter cross-immunity needs to scale strain contributions before the compartment-level pInf scaling, otherwise novel-strain reinfection rates collapse to zero.
- **Animal SIR rates are per-strain** — `animal_beta` / `animal_gamma` / `animal_mu` live in `GENOME_FIELDS` (registry parallel arrays), not as live global params in normal operation. Step 10 reads them off `strainRegistry` by the infectious animal's `animal_strain` id, with `DEFAULT_PARAMS` only seeding strain α and serving as defensive no-registry fallback. Every animal S→I write MUST also set `animal_strain` (reverse spillover → human slot-0 strain; animal-to-animal → sampled neighbor strain) or the next tick's γ/μ lookup falls back to defaults. Any animal transition out of I, plus disposal and births, must reset `animal_strain` to `EMPTY_STRAIN`.
- **Effective viewport is what paint sees** — `camera.getEffectiveViewport()` MUST be what `getViewport` returns to the paint controller. If `getViewport` ever returns the base viewport directly, click-to-cell math breaks at any zoom ≠ 1. The returned object is shared and mutated each call — consumers must read fields immediately and not retain the reference.
- **History ring buffer shape** — `main.js`'s `history` is `{ cap, sToE, eToI, iToR, iToD: Uint32Array, head, length, push(s,e,r,d), clear() }`. `stats.computeReff` reads typed arrays directly with wrap-around. Don't replace with an array-of-objects — the per-tick alloc + `shift()` was a measurable cost.
- **Tab-panel visibility gating** — render functions in `stats.js` / `lineage.js` / `timeseries.js` bail when their host's classList doesn't have `active` (or has `hidden`). `wakeRenders()` in main.js MUST get called on every visibility flip (tab click, sidebar open) so stale numbers aren't left visible on re-show during pause. New tab panels with renders need wiring through wakeRenders too.

## Gotchas

- **`data-theme` is on `<html>`** — `document.documentElement.dataset.theme`
- **Shared CSS at domain root** — `/shared-base.css` absolute path requires serving from parent directory
- **Sidebar uses `.sidebar-tabs` in `.stats-header`** — no separate `<h2 class="stats-title">` and `.tab-bar`. New layout pattern site-wide
- **Canvas DPR** — always go through `resizeCanvasDPR` from `shared-utils.js`. Manual `canvas.width = innerWidth` produces blurry rendering on hi-DPI
- **Time-series ring buffer** — fixed-size, drops oldest sample. Resizing requires reallocation; don't do it on every theme toggle. The transition-counts ring in `main.js` (`history`) uses a different shape — typed-array columns, see Per-Tick Hot Path
- **Don't read `offsetParent` in tick-driven render paths** — it's a layout-dependent property that triggers sync layout flush after any DOM write. Use `classList.contains('active')` / `'hidden'` for visibility checks instead
- **Status overlays render in COMPARTMENT and STATUS views.** The H "+" badge and Q ring originally rendered only in COMPARTMENT view, leaving STATUS view without its titular glyphs. Both render passes now run when `mode === STATUS` too — don't re-gate them.
- **`toggles.animalDisplay` is a string, not a boolean** — the three-way `'dots' | 'only' | 'off'` lives on the same `toggles` object as the boolean compartment/flag keys. `DEFAULT_TOGGLES.animalDisplay = 'dots'` keeps prior render behavior. The mode-group control in the Display section binds it.
- **`toggles.vax_rollout` defaults on** (Phase 15 showcase). The canonical V flow is still paint-driven; rollout layers over it. `bindDeps` cascades-uncheck the rollout toggle when `t.V` is unchecked. Presets that want the prior off-by-default behavior set it explicitly.
- **`syncSliders` is single-tier post-Phase-15** — every slider lives inline under `#advanced-section`, so `panelEl.querySelector('[data-param=...]')` finds them all. `panelEl.__advancedRefs` is kept as a defensive fallback but unused in the current code path.
- **Speed button needs both `.speed-btn` class and inner `.speed-label` span** — `_toolbar.updateSpeedBtn` writes into the span. Missing span = blank button.
- **`#timeseries-panel` is inline in the Compartments tab** — it's the first child of `#tab-compartments`, a plain full-width block with `aspect-ratio: 16/9` and a `--bg-base` fill (Phase 17; it was a floating HUD through Phase 16). `stats.js` `buildPanelSkeleton` must keep preserving that node when it rebuilds the tab — the renderer skips any child whose `id === 'timeseries-panel'`.
- **Stacked-only timeseries** — `renderLines` and `setMode` were removed from `src/timeseries.js` in Phase 15. The `mode: 'stacked'` opts arg still gets passed from main.js (no-op) for forward-compatibility but the chart has no other mode.
- **EMPTY cells render transparent** — `src/render.js` skips fill+stroke for `Compartment.EMPTY`. Don't assume any backdrop is painted under animal dots in `animalDisplay === 'only'` mode either; the inscribed-region backdrop fill was removed in Phase 15.
- **Extinct strain sweep** — `renderStrainPanel` walks `rowPool` against a `Set<aliveId>` built from `prevalence` and detaches/deletes entries whose ids are missing. Depends on `computeStrainPrevalence` excluding zero-count strains (it does — `if (c === 0) continue` at the top). Loosening that filter re-introduces stale row-pool entries.
