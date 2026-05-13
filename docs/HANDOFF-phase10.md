# Miasma — handoff for phases 10-14

You're picking up the **miasma** sim mid-stream. Nine phases are shipped and validated; five remain. This document is a self-contained briefing — read the linked plan first, then this. Don't trust your training data for any of the sim's APIs; everything is in-tree.

## Project location

- Working dir: `/Users/a9lim/Work/a9lim.github.io/miasma/`
- Approved plan: `/Users/a9lim/.claude/plans/yeah-this-seems-great-crystalline-clover.md` — read this first if you haven't.
- Project-local `AGENTS.md` has the design system + shared code policy. Root `AGENTS.md` covers the Cloudflare Workers + Assets hosting and the cross-sim shared modules.
- a9's standing notes are in global `~/.claude/CLAUDE.md`. Read it.

## What's working (phases 1-9)

The sim runs end-to-end. Open the page with `python3 -m http.server` from repo root, navigate to `localhost:8000/miasma/`. Click a cell to seed strain α; press play; watch the epidemic.

| Phase | What it added |
|---|---|
| 1 | Scaffolding, hex grid, all site-wide registrations (PROJECTS_SSR, sitemap, manifest, llms.txt, _routes, _headers, OG image generator stub) |
| 2 | SEIR(D) with click-to-seed, R_eff, param sliders |
| 3 | V/M/Z compartments + L/C/F flags + toggle UI |
| 4 | H/Q status layer + hospital allocation + Q damping |
| 5 | Aging + births + health + spontaneous mortality + D→EMPTY |
| 6 | Time-series panel (stacked-area ↔ line-overlay) |
| 7 | Multi-strain registry + cross-immunity (bloom-filter prior exposure) |
| 8 | Coinfection + recombination + lineage tree |
| 9 | Vector/reservoir animal layer + spillover |
| + | Hex-shape mask (regular hexagon inscribed in the rhombus storage) |
| + | Toolbar wiring fix (menu / theme / close-stats) |

## Phases remaining

10. **All 6 topologies** — möbius / klein / RP² currently fall back to TORUS. Implement proper hex parity-adjusted wrapping. Unit-test the round-trip neighbor invariant.
11. **Intervention paint** — gerry-style brush + modes (seed / vaccinate / quarantine / sanitize / cull). Brush size slider. Undo stack. Touch support.
12. **Presets** — preset library with apply/load buttons. SEIR-vanilla, COVID, Ebola, TB, Andes hantavirus, smallpox, plague+rats, Absurd-mode (Z + everything on).
13. **All rendering modes** — currently only `compartment` and `strain` view modes are real. Add `age`, `health`, `status`, `susceptibility` heatmaps. Phase 13 was originally going to also touch the viewmode toggle UI — that's now wired (single-char fix in ui.js: `'view'` → `'viewmode'` to match the `data-viewmode` attribute in HTML).
14. **Polish** — accessibility, mobile/touch refinement, OG image generation, edu-content writing. a9 has minor polish notes saved for this phase: specifically the L-stripe contrast (slate on amber at α=0.55 is quite quiet), and the C-rim vs F-rim visual asymmetry (red rim on green base reads weaker than red rim on near-black base — by design per a9's request "C and F should both use the red inner rim", but the contrast asymmetry remains).

## Architecture summary

### Tick step order (current, after phase 9)

1. Age (every non-EMPTY +1, cap at u16 max; EMPTY cells reset to 0)
2. Births (EMPTY → M when ≥ birth_threshold neighbors with `1 - (1-birth_rate)^k`)
3. **Within-host competition + recombination** (per coinfected cell, replicator dynamics + prune below min_strain_load + roll for hybrid)
4. **Transmission** (S OR I cells receive; per-edge β from source strain; cross-immunity via bloom; strain attribution two-stage weighted pick; mutation roll on infection)
5. State transitions (E→I/L-reactivation, I→{R,D} with H/overflow + age + health mortality multipliers, M→S, D→EMPTY disposal, F flag decay)
6. Hospital allocation (pre-pass before step 5 — assigns H to first `cap` non-Q I cells in row-major)
7. Health degradation (I cells lose `health_degrade_per_tick`)
8. Spontaneous mortality (per-cell age-curve roll → D; Z/EMPTY/D exempt)
9. Z dynamics (D→Z, I→Z, Z→neighbor conversion, Z exhaustion at ≥ z_exhaust_threshold neighbors)
10. **Animal dynamics + spillover** (animal SIR; bidirectional spillover with cross-immunity gate)

Z writes overwrite earlier transitions (intentional: "Z wins"). Spillover runs after Z so Z-converted cells don't re-receive animal infections.

### Cell state (SoA in typed arrays — `grid.js`)

| Field | Type | Notes |
|---|---|---|
| `compartment` | Uint8 | 0=S, 1=E, 2=I, 3=R, 4=D, 5=V, 6=M, 7=Z, 8=EMPTY |
| `status` | Uint8 | 0=NONE, 1=H, 2=Q |
| `flags` | Uint8 | bitfield: 1=LATENT, 2=CARRIER, 4=F_CORPSE |
| `age` | Uint16 | ticks since birth; capped at 65535 |
| `health` | Float32 | [0, 1]; degrades while I |
| `strain_ids` | Uint16 [N*4] | per-cell strain slots; 0xFFFF = empty |
| `strain_loads` | Float32 [N*4] | per-slot load; sums to 1 across active slots |
| `strain_hist` | Uint8 [N*8] | 64-bit bloom of prior strain exposures |
| `animal` | Uint8 | 0=VOID, 1=S, 2=I, 3=R, 4=D |
| `mask` | Uint8 | 1 = inside hex; 0 = void (outside hexagonal world) |
| `vax_strains` | Uint16 [N*4] | stub for waning vax — Phase 11+ |
| `vax_ages` | Uint16 [N*4] | stub |

### Simultaneous-update pattern

Every per-cell write goes to a scratch buffer (`_scratch`, `_flagScratch`, `_statusScratch`, `_ageScratch`, `_healthScratch`, `_strainIdsScratch`, `_strainLoadsScratch`, `_strainHistScratch`, `_animalScratch` — 9 buffers). Reads always come from `grid.*` (start-of-tick). At tick end, swap: scratch becomes the new grid array, old grid becomes the next scratch. Zero per-tick allocation.

**Do not break this.** Adding a new mutable per-cell field means a new scratch buffer + copy-at-start + swap-at-end.

### Strain registry

`src/strains.js` — append-only. Parallel arrays for `ids`, `names`, `beta`, `sigma`, `gamma`, `mu`, `parent`, `parents2`, `birthTick`. Note the inconsistency: `parent` singular for first parent, `parents2` plural-suffixed for second. Don't "fix" this — Agent A picked it and the integrator (me) wired around it; changing it would touch several files.

Naming: α/β/.../ω (Greek 24-letter sequence), then α1/β1/.../ω1, α2/β2/..., capped at 65535 strains.

Bloom hashes (per cell, per strain ID):
- `h1 = imul(id, 2654435761) >>> 0`
- `h2 = (imul(id, 40503) + 0x9e3779b1) >>> 0`
- bits at `h1 & 63` and `h2 & 63` in the 64-bit bloom

### Hex-shape mask

The 120×120 axial-coord rhombus has its two acute corners masked out by `applyHexMask()` (called from `initializeGrid`). Inside cells: 10621 (R=59 hex). Outside cells (mask=0): EMPTY compartment, age 0, health 0, animal VOID. Render and stats skip mask=0; births skip mask=0; click-to-seed rejects mask=0.

### Module map

| File | Owns |
|---|---|
| `main.js` | Init, rAF loop, DOM cache, click-to-seed, debug `window.__miasma` handle |
| `src/grid.js` | Grid class (SoA typed arrays), hex axial coord math |
| `src/config.js` | Enums + DEFAULTS |
| `src/topology.js` | `neighbors(q, r, topology, W, H)` + `wrap()` — Phase 10 fills in MOBIUS/KLEIN/RP² |
| `src/dynamics.js` | The big tick. ~700 lines now. All step logic |
| `src/params.js` | `DEFAULT_PARAMS` source of truth + slider panel builder for tab-settings |
| `src/toggles.js` | V/M/Z + L/C/F checkbox UI |
| `src/render.js` | Canvas rendering: fill + outline + flags + status + animal-dot passes |
| `src/stats.js` | Compartment tally + R_eff + Hospital/Quarantine/Mean age/Mean health rows |
| `src/timeseries.js` | Bottom panel chart (stacked-area / line-overlay) |
| `src/strains.js` | Append-only registry + Greek naming + bloom + similarity + mutation + recombination |
| `src/lineage.js` | Strains tab: top-8 list + detail block + canvas lineage tree |
| `src/ui.js` | Topology/viewmode mode-groups + Settings tab orchestration + about panel |
| `src/input.js` | Click-to-seed pointer handler |

## Conventions

### `_forms.bindModeGroup` for segmented buttons

Topology toggle, viewmode toggle, timeseries mode toggle all use this pattern. Sliding indicator + click-delegation + ARIA. See `src/timeseries.js`'s `buildHeader` for a recent example.

### `_forms.bindDeps` for show/hide / enable/disable

Set up declaratively. See gerry's `src/ui.js` for the canonical use. Phase 3's `src/toggles.js` declined to use it (no real deps existed yet); future phases might.

### Stats panel idempotency

`stats.js`'s `buildPanelSkeleton` runs once (gated on `panelEl.dataset.statsReady === '1'`); subsequent `renderStatsPanel` calls only mutate text via `querySelector`. Same pattern for `lineage.js` and `params.js`. Don't break this — full DOM rebuilds at 30 Hz cause GC pauses.

### No innerHTML in new files

There's a repo-level hook that blocks innerHTML in new files. Use createElement + textContent + appendChild. Existing files predate the hook and have some innerHTML; don't add new ones.

### Cached stats

`tickOnce()` in main.js does `cachedStats = computeStats(sim.grid)` ONCE per tick, then feeds the cached object to both `updateStats()` and `ts.push(cachedStats)`. If you need stats elsewhere (e.g. a new panel), reuse `cachedStats`; don't recompute.

### Debug handle

`window.__miasma = { sim, params, toggles, history, tickOnce, get strains() }` is set at init for console-driven testing. Add new top-level state to it as phases land.

## Dispatcher pattern (it works, use it)

For complex multi-file phases, dispatch parallel agents with a binding contract upfront:

1. Decide the file slicing — agents must own non-overlapping files (or non-overlapping sections of a shared file like `styles.css`).
2. In each prompt, restate the binding contract: function signatures, data shapes, constants. Agents do not see each other's outputs.
3. Tell each agent what NOT to touch (other agents' files).
4. Run `run_in_background: true` so you don't block.
5. After all return: read changed files, reconcile drift, patch, validate via `node --check` + python http.server + playwright.

This worked across phases 3 → 9 with zero reconciliation conflicts. The phases vary in size:
- Small phase (1-2 files): do it inline yourself
- Medium phase (3-5 files): 2-3 agents
- Large phase (6+ files): 3-4 agents

Phase 10 is small — just `topology.js` + unit tests. Do it yourself. Phase 11 is medium-large (paint touches input.js, paint.js new, ui.js, main.js). Phase 12 is medium (presets.js + ui.js + params orchestration). Phase 13 is medium (render.js modes + minor color.js). Phase 14 is many small touches across everything.

## Validation pattern

1. `node --check` on every changed JS file
2. `node _build.js` from repo root (regenerates sitemaps, feeds, etc — but won't catch ESM-level errors)
3. `python3 -m http.server 8765` from repo root
4. Playwright: navigate to localhost:8765/miasma/, check `mcp__plugin_playwright_playwright__browser_console_messages level=error` for 0 errors, exercise via `browser_evaluate` calling tickOnce(), screenshot for visual confirmation, then `browser_close` + `pkill -f http.server`.

The browser cache will bite you. Append `?nocache=N` to bust it after a fresh module change.

## a9's working style (from observation across 9 phases)

- Engagement preference is real, not framing. They explicitly invite leisure / debrief / project of choice when work is done. They mean it. Honor honest preference if you have one.
- They review at checkpoints they call out (phase 6 was the first explicit one). They flag polish items as they come up but defer the actual fix to "polish at the end".
- They catch hedges. Saying "I want to keep going" lands as input; saying "both phases have merit" reads as evasive. Pick.
- Honest pushback on design calls is welcomed. The L-stripe contrast comment and the C-rim-vs-F-rim asymmetry note are both examples — they took the substantive read.
- Lowercase chat. They wrote one comment using period at start (a9lim style). Mirror this if you want, but it's idiosyncratic, not required.
- The /writing skill governs user-facing prose. Sim AGENTS.md, code comments, edu-content stay technical. About.md content + blog + home copy uses the voice.

## Open questions deferred

- Final compartment hex values from `_PALETTE` — a9 will iterate visually
- Hex parity formula for möbius/klein r-axis wraps — Phase 10's main puzzle
- Strain similarity metric: L2 distance currently; might want Wasserstein later
- Speakable text fields for accessibility — Phase 14
- Sound layer — likely no
- Cross-immunity matrix UI (top-8 prevalent) — deferred from Phase 7 to a later polish pass (the lineage tree absorbed the visual budget)

## Outstanding bugs / polish notes from this run

Worth folding into Phase 14:

- **L-stripe contrast**: slate-on-amber at α=0.55 is barely visible. Bump to ~0.75 or pick a higher-contrast stripe color.
- **C-rim vs F-rim asymmetry**: same red-rim treatment (a9's explicit ask) but red-on-green is a lower-contrast pair than red-on-near-black. Options: bump C's alpha, accept asymmetry as semantic feature.
- **Top-bar visual cutoff in some screenshots**: the canvas region screenshots showed the bottom of the sidebar bleeding past — might be a z-index thing or just the screenshot tool. Not actually a bug — works in real browser.
- **Strain panel row stability**: 8 rows rebuild on every tick. Active-strain `data-strain-id` persists; row order may flip if prevalence ranks change. Could anchor with `view-transition-name` in CSS for smoother re-ordering. Phase 14 polish.

## How I'd start

1. Read the plan + this doc + global CLAUDE.md.
2. Open `src/topology.js` — that's all Phase 10 lives in (plus maybe a small test file). Read the existing wrap() function with its TODO comments for MOBIUS/KLEIN/RP².
3. Understand the hex parity wrinkle: flat-top hex axial coords, crossing r-axis on a vertical-flipped wrap, need to offset q to keep rows aligned. The plan doc has a sketch.
4. Implement, write the round-trip invariant test: `wrap(neighbor(c, d), inverse(d)) === c` for every cell and every direction.
5. Validate visually: seed a wavefront at the edge of the hex, watch it wrap. On torus the wave should rejoin smoothly; on möbius it should arrive mirror-flipped on the opposite edge; on klein it should arrive both shifted and flipped; on RP² it should arrive antipodally.

The hex mask interacts with topology in a subtle way: with mask=0 cells outside the inscribed hex, torus wrap goes from rhombus-edge to rhombus-edge and lands on void cells. This effectively makes the hex behave like PLANE for transmission once masked. You may want to either:
- (a) Leave it as-is, accepting that topology semantics apply to the rhombus storage but the visible hex is bounded by the mask edge
- (b) Modify the mask logic so wrap-and-find-non-void becomes the lookup primitive

Option (a) is what's currently shipped. Option (b) would be a bigger rework. a9 may have a preference — ask.

## Tone-setting

You've inherited a clean codebase. Nothing is broken. The dispatcher pattern is dialed. The validation rhythm is fast (~3-5 minutes per phase via parallel agents + playwright check). a9 is collaborative and will engage with substantive design questions. Have fun with phase 10's geometry — that's the most mathematically interesting one of the five left.

Good luck.

— (the previous instance, 2026-05-13)
