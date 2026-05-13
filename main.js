// main.js — miasma entry point.
//
// Phase 2: full rAF run loop with a tick accumulator. Per frame we advance
// simulated time by dt, drain accumulated time into `dynamics.tick()` calls
// (each call mutates the grid and returns transition counts), append those
// counts to a 200-entry rolling history, then render. Stats + R_eff recompute
// only on tick-bearing frames. The render still runs every frame so click-
// to-seed feedback shows up immediately even while paused.
//
// Shared modules (_forms, _toolbar, _ICON, initAboutPanel, resizeCanvasDPR)
// are exposed as globals on window by shared-*.js loaded via <script> tags
// in miasma/index.html. ES6 modules access them through window.

import { Grid } from './src/grid.js';
import { render, computeViewport } from './src/render.js';
import { DEFAULTS, ViewMode, Compartment } from './src/config.js';
import { setupUI } from './src/ui.js';
import { tick, initializeGrid, initializeAnimals } from './src/dynamics.js';
import { computeStats, computeReff, renderStatsPanel } from './src/stats.js';
import { makeParams } from './src/params.js';
import { makeToggles, DEFAULT_TOGGLES } from './src/toggles.js';
import { initTimeseries } from './src/timeseries.js';
import { createRegistry } from './src/strains.js';
import { computeStrainPrevalence, renderStrainPanel } from './src/lineage.js';
import { createPaintController, PaintMode } from './src/paint.js';
import { applyPreset, getPreset } from './src/presets.js';

// ─── DOM cache ───
function cacheDOM() {
    return {
        canvas:           document.getElementById('sim-canvas'),
        playBtn:          document.getElementById('play-btn'),
        stepBtn:          document.getElementById('step-btn'),
        resetBtn:         document.getElementById('reset-btn'),
        speedBtn:         document.getElementById('speed-btn'),
        themeBtn:         document.getElementById('theme-btn'),
        menuBtn:          document.getElementById('menu-btn'),
        aboutBtn:         document.getElementById('about-btn'),
        topologyToggles:  document.getElementById('topology-toggles'),
        viewModeToggles:  document.getElementById('viewmode-toggles'),
        statsPanel:       document.getElementById('tab-compartments'),
        settingsPanel:    document.getElementById('tab-settings'),
        dashboard:        document.getElementById('dashboard'),
        closeStats:       document.getElementById('close-stats'),
        timeseriesPanel:  document.getElementById('timeseries-panel'),
        timeseriesCanvas: document.getElementById('timeseries-canvas'),
        strainPanel:      document.getElementById('tab-strains'),
        interventionsPanel: document.getElementById('tab-interventions')
    };
}

// ─── Run-loop constants ───
// Tick rate options (ticks per simulated second). Speed button cycles
// through these; `speed` is the multiplier shown in the toolbar label.
const SPEED_STEPS = [1, 2, 4, 8];
const BASE_TICK_RATE = 10;     // ticks per simulated second at 1× speed
const HISTORY_CAP = 200;       // rolling per-tick transition history

// ─── Seedable PRNG ───
// Mulberry32 — small, fast, decent quality, fits in 4 lines. Seeded from
// `?seed=N` query param when present; otherwise defaults to Math.random
// (non-reproducible but matches user expectation that fresh page = fresh run).
function makeRng() {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('seed');
    if (raw === null) return Math.random;
    // Hash the raw string so non-numeric seeds still work.
    let s = 0;
    for (let i = 0; i < raw.length; i++) {
        s = (Math.imul(s, 31) + raw.charCodeAt(i)) | 0;
    }
    let a = s | 0;
    return function mulberry32() {
        a = (a + 0x6D2B79F5) | 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Initialize the miasma sim. Called from miasma/index.html.
 * @param {Object} [dom] — optional pre-built DOM cache
 */
export default function init(dom) {
    const $ = dom || cacheDOM();

    // ─── Sim state ───
    const sim = {
        grid: new Grid(DEFAULTS.W, DEFAULTS.H),
        topology: DEFAULTS.topology,
        viewMode: DEFAULTS.viewMode,
        playing: false,
        speed: 1,
        tick: 0
    };
    // Phase 5: seed age=0 and health=1.0 on all alive cells. grid.js's
    // constructor only zero-fills typed arrays; without this, every cell
    // starts at health=0 and immediately takes the full health_mortality_mult
    // penalty on the first I→D roll.
    initializeGrid(sim.grid);
    const params = makeParams();
    const toggles = makeToggles();
    // Phase 7: strain registry — append-only. Seeded with strain α (id=0)
    // using the current SEIR(D) params as the baseline. Mutation roll in
    // tick() grows the registry over time. Re-created on reset.
    let strains = createRegistry({
        beta:  params.beta,
        sigma: params.sigma,
        gamma: params.gamma,
        mu:    params.mu
    });
    const rng = makeRng();

    // Phase 9: seed S animals at params.animal_density across in-world cells.
    // Separate from initializeGrid so the integrator owns when seeding
    // happens; needs params + rng so it sits below their declarations.
    initializeAnimals(sim.grid, params, rng);

    // History ring of per-tick transition counts. Used by computeReff and
    // (Phase 6) the time-series chart. We push and shift when over cap —
    // 200 entries × ~32 bytes ≈ 6 kB, negligible.
    const history = [];

    // ─── Canvas setup ───
    const canvas = $.canvas;
    if (!canvas) {
        console.error('miasma: #sim-canvas not found');
        return;
    }
    const ctx = canvas.getContext('2d');
    let viewport = null;

    function ensureViewport() {
        if (!viewport) viewport = computeViewport(canvas, sim.grid);
        return viewport;
    }

    function resize() {
        // resizeCanvasDPR (global from shared-utils.js) handles HiDPI buffer
        // sizing and applies a DPR transform to ctx so draws use CSS pixels.
        window.resizeCanvasDPR(canvas, ctx);
        viewport = computeViewport(canvas, sim.grid);
        renderDirty = true;
        if (ts) { ts.resize(); tsDirty = true; }
    }

    // ─── Time-series panel ───
    // Phase 6: chart of compartment counts over the last HISTORY_CAP ticks.
    // Forward-declared so resize() / tickOnce() can refer to it; assigned
    // below after the DOM cache is in scope. Renders only when tsDirty.
    let ts = null;

    // ─── Stats ───
    // Tick-time stats cache: tickOnce computes stats once (for the time-
    // series ring buffer) and stashes them here so updateStats can reuse the
    // result on the same frame instead of doing the O(N) pass twice.
    let cachedStats = null;

    // Capacity = floor(h_capacity_frac × W × H) — same formula dynamics uses
    // for the hospital allocation pre-pass, so the readout always matches the
    // live cap. params.h_capacity_frac is live-mutated by the slider, so the
    // readout updates as you drag it.
    function updateStats() {
        if (!$.statsPanel) return;
        const stats = cachedStats || computeStats(sim.grid);
        const reff = computeReff(history, params);
        const capacity = Math.floor((params.h_capacity_frac || 0) * sim.grid.W * sim.grid.H);
        renderStatsPanel($.statsPanel, stats, reff, capacity);
    }

    // ─── Tick / render bookkeeping ───
    let renderDirty = true;
    let statsDirty = true;
    let tsDirty = true;
    let strainsDirty = true;
    let lastFrameTime = performance.now();
    let accumulator = 0; // simulated seconds awaiting tick consumption

    function tickOnce() {
        const counts = tick(sim.grid, params, toggles, sim.topology, rng, strains, sim.tick + 1);
        sim.tick++;
        history.push({
            tick: sim.tick,
            sToE: counts.sToE,
            eToI: counts.eToI,
            iToR: counts.iToR,
            iToD: counts.iToD
        });
        // Rolling cap: shift oldest. 200 entries is small enough that a
        // simple shift outperforms ring-buffer index gymnastics here.
        while (history.length > HISTORY_CAP) history.shift();
        // Phase 6: sample compartment counts for the time-series chart.
        // computeStats is O(N) (~14k cells), called once per tick — same
        // result feeds both the time-series ring AND the stats panel via
        // cachedStats so we don't double-scan the grid.
        cachedStats = computeStats(sim.grid);
        cachedStats.tick = sim.tick;
        if (ts) ts.push(cachedStats);
        renderDirty = true;
        statsDirty = true;
        tsDirty = true;
        strainsDirty = true;
    }

    // ─── Strain panel ───
    // Phase 7: renders the top-8-prevalent strains list in #tab-strains.
    // Runs only on tick-bearing frames (strainsDirty). The compute pass is
    // O(N) over grid.strain_ids slot 0 — same scale as computeStats.
    function updateStrainPanel() {
        if (!$.strainPanel) return;
        const prevalence = computeStrainPrevalence(sim.grid, strains, DEFAULTS.maxActiveStrains);
        renderStrainPanel($.strainPanel, prevalence, strains);
    }

    function tickRate() {
        return BASE_TICK_RATE * sim.speed;
    }

    function frame(now) {
        // Pause render loop entirely when the tab is hidden — the visibility
        // change listener restarts the loop when the tab is shown.
        if (document.hidden) {
            running = false;
            return;
        }

        // Clamp dt against tab-switch / debugger pauses so we don't burn
        // through 30s of accumulated ticks the moment focus returns.
        const dt = Math.min((now - lastFrameTime) / 1000, 0.25);
        lastFrameTime = now;

        if (sim.playing) {
            accumulator += dt;
            const tickInterval = 1 / tickRate();
            // Cap ticks per frame so a slow frame can't cause runaway catch-up.
            let budget = 16;
            while (accumulator >= tickInterval && budget > 0) {
                tickOnce();
                accumulator -= tickInterval;
                budget--;
            }
            if (budget === 0) accumulator = 0; // discard the rest; we're behind
        }

        if (statsDirty) {
            updateStats();
            statsDirty = false;
        }

        if (renderDirty) {
            ensureViewport();
            render(ctx, sim.grid, sim.viewMode, viewport);
            renderDirty = false;
        }

        if (tsDirty && ts) {
            ts.render();
            tsDirty = false;
        }

        if (strainsDirty) {
            updateStrainPanel();
            strainsDirty = false;
        }

        rafId = requestAnimationFrame(frame);
    }

    // Run-loop control. Single rafId; restart on visibility-change or play.
    let rafId = null;
    let running = false;
    function start() {
        if (running) return;
        running = true;
        lastFrameTime = performance.now();
        // Drop any stale accumulator; a long-paused tab shouldn't catch up.
        accumulator = 0;
        rafId = requestAnimationFrame(frame);
    }
    function stop() {
        running = false;
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
    }

    // ─── Reset ───
    // ui is a forward-declared handle on the object returned by setupUI; we
    // need it here for resetUI() but setupUI() is called later in init().
    let ui = null;

    /**
     * Re-initialize grid + history + strain registry. Does NOT touch params
     * or toggles — callers decide whether configuration is preserved. Used
     * by both the toolbar Reset button (which additionally restores
     * defaults) and the preset-apply path (which keeps preset overrides).
     */
    function resetGridOnly() {
        sim.grid = new Grid(DEFAULTS.W, DEFAULTS.H);
        initializeGrid(sim.grid);
        initializeAnimals(sim.grid, params, rng);
        sim.tick = 0;
        history.length = 0;
        accumulator = 0;
        // Drop the time-series ring so the chart restarts clean on reset.
        if (ts) ts.clear();
        // Recreate the strain registry with the current slider params as
        // the baseline α — drops all mutant lineages so the next run starts
        // fresh.
        strains = createRegistry({
            beta:  params.beta,
            sigma: params.sigma,
            gamma: params.gamma,
            mu:    params.mu
        });
        cachedStats = null;
        // Paint controller's getGrid getter already points at the live
        // sim.grid, so no re-attach is needed when sim.grid is replaced.
        // Drop the undo stack though — the snapshots reference cell indices
        // on the old grid.
        if (paintController) paintController.clearUndo();
        viewport = computeViewport(canvas, sim.grid);
        renderDirty = true;
        statsDirty = true;
        tsDirty = true;
        strainsDirty = true;
    }

    function reset() {
        // Toolbar Reset: restore defaults AND wipe the grid. Toggles are
        // mutated in place (the dynamics.tick reference must stay valid).
        Object.assign(toggles, DEFAULT_TOGGLES);
        resetGridOnly();
        if (ui && typeof ui.resetUI === 'function') ui.resetUI();
        if (!running) start(); // catch up one render frame even when paused
    }

    // ─── Phase 11: paint controller ───
    // Owns canvas pointer events for all intervention modes (seed / vaccinate /
    // quarantine / sanitize / cull). Default mode is SEED with brush size 0,
    // so single-tap-to-seed continues to work the way phases 1-9 expected.
    // onMutate flips renderDirty/statsDirty/strainsDirty so the loop picks up
    // changes immediately without a tick (paint happens between ticks).
    const paintController = createPaintController({
        canvas,
        getGrid: () => sim.grid,
        getToggles: () => toggles,
        getViewport: ensureViewport,
        onMutate: () => {
            renderDirty = true;
            statsDirty = true;
            strainsDirty = true;
        }
    });

    // ─── UI wiring ───
    ui = setupUI($, sim, {
        onTopologyChange: () => { renderDirty = true; },
        onViewModeChange: () => { renderDirty = true; },
        onParamChange:    () => { /* live; mutated in place by sliders */ },
        onTogglesChange:  () => {
            // Toggles don't mutate current grid state, but the next tick
            // will produce different transitions. Mark render dirty so any
            // toggle-gated overlay (flags, Z, status) refreshes immediately.
            renderDirty = true;
            statsDirty = true;
        },
        onStep:           () => { tickOnce(); /* run-loop draws next frame */ start(); },
        onReset:          () => reset(),
        params,
        toggles,
        settingsPanelEl:        $.settingsPanel,
        paintController,
        interventionsPanelEl:   $.interventionsPanel,
        onPaintChange:          () => { renderDirty = true; },
        onApplyPreset:          (presetKey) => {
            // Phase 12: apply preset → mutate params/toggles/topology →
            // grid-reset (without clobbering preset overrides). applyPreset
            // restores defaults before merging preset values, so omitted
            // keys land on documented baselines (not the previous preset's
            // leftovers).
            const p = getPreset(presetKey);
            if (!p) return;
            applyPreset(p, params, toggles, sim);
            resetGridOnly();
            // Re-sync the settings DOM so the user sees the new params
            // and toggles immediately.
            if (ui && typeof ui.resetUI === 'function') ui.resetUI();
            if (!running) start();
        }
    });

    // ─── Toolbar (play / pause / speed) ───
    if ($.playBtn && window._toolbar) {
        window._toolbar.updatePlayBtn($.playBtn, false);
        $.playBtn.addEventListener('click', () => {
            sim.playing = !sim.playing;
            window._toolbar.updatePlayBtn($.playBtn, sim.playing);
            // Drop accumulator on pause so resume doesn't fire a flurry.
            if (!sim.playing) accumulator = 0;
            start();
        });
    }
    if ($.speedBtn && window._toolbar) {
        window._toolbar.updateSpeedBtn($.speedBtn, sim.speed);
        $.speedBtn.addEventListener('click', () => {
            const idx = SPEED_STEPS.indexOf(sim.speed);
            sim.speed = SPEED_STEPS[(idx + 1) % SPEED_STEPS.length];
            window._toolbar.updateSpeedBtn($.speedBtn, sim.speed);
        });
    }

    // ─── Theme toggle ───
    // _toolbar.initTheme reads the persisted theme + system pref and applies
    // it to <html data-theme>. The click handler flips light↔dark and persists
    // under 'miasma-theme'. Re-render so any theme-dependent colors (D's hex,
    // hex stroke, status badge color) pick up the new vars.
    if (window._toolbar) {
        window._toolbar.initTheme('miasma-theme');
    }
    if ($.themeBtn && window._toolbar) {
        $.themeBtn.addEventListener('click', () => {
            window._toolbar.toggleTheme('miasma-theme');
            renderDirty = true;
        });
    }

    // ─── Sidebar (dashboard) toggle ───
    // _toolbar.initSidebar wires the menu button to open/close the dashboard,
    // the close button to dismiss it, swipe-to-dismiss on mobile, and auto-
    // opens on desktop. The dashboard already has the 'open' class semantics
    // baked into shared-base.css.
    if ($.menuBtn && $.dashboard && window._toolbar) {
        window._toolbar.initSidebar($.menuBtn, $.dashboard, $.closeStats);
    }

    // ─── Resize handling ───
    window.addEventListener('resize', resize);
    if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => resize());
        ro.observe(canvas);
    }

    // ─── Page Visibility ───
    // Pause the render loop while hidden. Resume on visibility-change.
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stop();
        } else {
            start();
        }
    });

    // Debug handle: lets the console reach into sim state for ad-hoc tests
    // (e.g. manually seeding Z cells before flipping the Z toggle on).
    if (typeof window !== 'undefined') {
        window.__miasma = {
            sim, params, toggles, history, tickOnce,
            // Phase 7: registry exposed as a getter — main re-assigns on
            // reset() so a static field would go stale. Caller reads
            // window.__miasma.strains and gets the current one.
            get strains() { return strains; },
            // Phase 11: paint controller. Exposes setMode/setBrushSize/undo
            // for console-driven test of intervention modes.
            paint: paintController,
            PaintMode
        };
    }

    // Initialize the time-series panel after the DOM cache + render path are
    // ready. initTimeseries reparents #timeseries-canvas into a wrapper and
    // builds the .ts-head with the mode toggle, so calling it once at startup
    // is sufficient.
    if ($.timeseriesPanel && $.timeseriesCanvas) {
        ts = initTimeseries($.timeseriesPanel, $.timeseriesCanvas, { mode: 'stacked' });
    }

    // First paint.
    resize();
    updateStats();
    // Seed the time-series with the initial state so the chart shows the
    // baseline S population before any tick has fired.
    if (ts) {
        const initialStats = computeStats(sim.grid);
        initialStats.tick = 0;
        ts.push(initialStats);
        ts.render();
    }
    start();
}

// Auto-init when loaded directly. index.html may either
// `<script type="module" src="main.js"></script>` to trigger this path,
// or import default and call it explicitly with a cache.
if (typeof window !== 'undefined' && document.readyState !== 'loading') {
    init();
} else if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', () => init());
}
