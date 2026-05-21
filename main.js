// main.js — miasma entry point.
//
// Phase 2: full rAF run loop with a tick accumulator. Per frame we advance
// simulated time by dt, drain accumulated time into `dynamics.tick()` calls
// (each call mutates the grid and returns transition counts), append those
// counts to a 200-entry rolling history, then render. Stats + observed Re recompute
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
import { tick } from './src/dynamics.js';
import { initializeGrid, initializeAnimals } from './src/initialization.js';
import { computeStats, computeReff, renderStatsPanel } from './src/stats.js';
import { makeParams } from './src/params.js';
import { makeToggles, DEFAULT_TOGGLES } from './src/toggles.js';
import { initTimeseries } from './src/timeseries.js';
import { createRegistry } from './src/strains.js';
import { computeStrainPrevalence, renderStrainPanel } from './src/lineage.js';
import { createPaintController, PaintMode } from './src/paint.js';
import { applyPreset, getPreset } from './src/presets.js';
import { createCamera, ZOOM_STEP_BTN, ZOOM_STEP_WHEEL } from './src/camera.js';
import { createTransitionHistory } from './src/history.js';
import { makeRngFromLocation } from './src/prng.js';

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
        viewModeBtn:      document.getElementById('viewmode-btn'),
        mapControls:      document.getElementById('map-controls-section'),
        statsPanel:       document.getElementById('tab-compartments'),
        settingsPanel:    document.getElementById('tab-settings'),
        dashboard:        document.getElementById('dashboard'),
        closeStats:       document.getElementById('close-stats'),
        timeseriesPanel:  document.getElementById('timeseries-panel'),
        timeseriesCanvas: document.getElementById('timeseries-canvas'),
        strainPanel:      document.getElementById('tab-strains'),
        interventionsPanel: document.getElementById('tab-interventions'),
        // Phase 15 zoom/pan controls. Buttons live in #canvas-controls;
        // the indicator <span> displays the current zoom as a percent.
        zoomInBtn:        document.getElementById('zoom-in-btn'),
        zoomOutBtn:       document.getElementById('zoom-out-btn'),
        zoomResetBtn:     document.getElementById('zoom-reset-btn'),
        zoomIndicator:    document.getElementById('zoom-indicator'),
        // Toolbar undo/redo (gerry parity). Buttons stay disabled until the
        // paint controller reports a non-empty undo/redo stack.
        undoBtn:          document.getElementById('undo-btn'),
        redoBtn:          document.getElementById('redo-btn')
    };
}

// ─── Run-loop constants ───
// Tick rate options (ticks per simulated second). Speed button cycles
// through these; `speed` is the multiplier shown in the toolbar label.
// Range mirrors cyano: a fractional low end lets the user slow ticks to
// watch a single transition wave step-by-step, and a 4× cap keeps the
// stochastic dynamics readable (8× was a blur in practice).
const SPEED_STEPS = [0.25, 0.5, 1, 2, 4];
const DEFAULT_SPEED_INDEX = 2; // 1× — the "natural" speed
const BASE_TICK_RATE = 10;     // ticks per simulated second at 1× speed
const HISTORY_CAP = 200;       // rolling per-tick transition history

/**
 * Initialize the miasma sim. Called from miasma/index.html.
 * @param {Object} [dom] — optional pre-built DOM cache
 */
export default function init(dom) {
    const $ = dom || cacheDOM();

    // ─── Sim state ───
    // Zoom/pan live on `sim` so they get debug-logged + survive across the
    // run-loop without module-scope state. `zoom` scales the base viewport's
    // hexSize; `panX`/`panY` add a CSS-pixel offset to originX/originY. The
    // BASE viewport (zoom = 1, pan = 0) is cached separately so a zoom change
    // doesn't force a recomputeViewport(canvas, grid) every frame.
    const sim = {
        grid: new Grid(DEFAULTS.W, DEFAULTS.H),
        topology: DEFAULTS.topology,
        viewMode: DEFAULTS.viewMode,
        playing: false,
        speed: SPEED_STEPS[DEFAULT_SPEED_INDEX],
        tick: 0,
        zoom: 1,
        panX: 0,
        panY: 0
    };
    // Phase 5: seed age=0 and health=1.0 on all alive cells. grid.js's
    // constructor only zero-fills typed arrays; without this, every cell
    // starts at health=0 and immediately takes the full health_mortality_mult
    // penalty on the first I→D roll.
    initializeGrid(sim.grid);
    const params = makeParams();
    const toggles = makeToggles();
    // Phase 7: strain registry — append-only. Seeded with strain α (id=0)
    // using the current params snapshot as the baseline genome. Mutation
    // roll in tick() grows the registry over time. Re-created on reset.
    // Phase A: the seed genome is the *full* params object — registerStrain
    // picks out the per-strain fields it needs via GENOME_FIELDS.
    let strains = createRegistry(params);
    const rng = makeRngFromLocation(window.location);

    // Phase 9: seed S animals at params.animal_density across in-world cells.
    // Separate from initializeGrid so the integrator owns when seeding
    // happens; needs params + rng so it sits below their declarations.
    initializeAnimals(sim.grid, params, rng);

    // History ring of per-tick transition counts. Used by computeReff. Backed
    // by parallel Uint32Arrays + a head pointer so a push at 80 Hz (max speed)
    // doesn't allocate a fresh object per tick or pay O(n) on shift(). Older
    // code used `history.push({tick, sToE, eToI, iToR, iToD})` + `shift()`;
    // that allocated ~80 short-lived objects per second.
    const history = createTransitionHistory(HISTORY_CAP);

    // ─── Canvas setup ───
    const canvas = $.canvas;
    if (!canvas) {
        console.error('miasma: #sim-canvas not found');
        return;
    }
    const ctx = canvas.getContext('2d');
    const camera = createCamera({
        canvas,
        ctx,
        sim,
        getGrid: () => sim.grid,
        computeViewport,
        resizeCanvasDPR: window.resizeCanvasDPR,
        onChange: () => {
            updateZoomIndicator();
            renderDirty = true;
            requestFrame();
        }
    });

    function getEffectiveViewport() {
        return camera.getEffectiveViewport();
    }

    function resize() {
        camera.resize();
        if (ts) { ts.resize(); tsDirty = true; }
        requestFrame();
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

    function invalidateDerived(opts) {
        opts = opts || {};
        if (opts.gridMutated) cachedStats = null;
        if (opts.render !== false) renderDirty = true;
        if (opts.stats !== false) statsDirty = true;
        if (opts.timeseries) tsDirty = true;
        if (opts.strains !== false) strainsDirty = true;
        requestFrame();
    }

    function tickOnce() {
        if (paintController) paintController.clearUndo();
        const counts = tick(sim.grid, params, toggles, sim.topology, rng, strains, sim.tick + 1);
        sim.tick++;
        history.push(counts.sToE, counts.eToI, counts.iToR, counts.iToD);
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
        // Skip the O(N) prevalence sweep when the panel is hidden — wakeRenders
        // marks strainsDirty on tab switch so the next frame catches up.
        // classList beats offsetParent here (no layout flush).
        if (!$.strainPanel.classList.contains('active')) return;
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
            // Pass the effective viewport so render() draws at the current
            // zoom and pan. paint.js's hitTest pulls the same effective
            // viewport via getViewport, keeping click → cell math consistent.
            const effective = getEffectiveViewport();
            render(ctx, sim.grid, sim.viewMode, effective, {
                animalDisplay: toggles.animalDisplay || 'dots',
                ageMax: params.mortality_max_age || 5000,
                paintOverlay: paintController.getHoverFootprint()
            });
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

        // Idle-stop: if paused and nothing dirty, halt the rAF loop. User
        // input (paint, theme, slider, toggle, play, zoom, …) flips a dirty
        // flag and calls requestFrame(), which restarts the loop. Saves a
        // continuous 60Hz wake-up that was making UI interaction laggy.
        if (!sim.playing && !renderDirty && !statsDirty && !tsDirty && !strainsDirty) {
            running = false;
            rafId = null;
            return;
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
    /**
     * Schedule one frame's worth of work. Used by event handlers (paint,
     * zoom, slider, toggle, etc.) to nudge the loop back to life after it
     * idle-stopped. Cheap when the loop is already running.
     */
    function requestFrame() {
        if (!running) start();
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
        history.clear();
        accumulator = 0;
        // Drop the time-series ring so the chart restarts clean on reset.
        if (ts) ts.clear();
        // Recreate the strain registry with the current params snapshot as
        // the baseline α — drops all mutant lineages so the next run starts
        // fresh. Phase A: registerStrain reads per-strain fields from the
        // full params object via GENOME_FIELDS.
        strains = createRegistry(params);
        cachedStats = null;
        // Paint controller's getGrid getter already points at the live
        // sim.grid, so no re-attach is needed when sim.grid is replaced.
        // Drop the undo stack though — the snapshots reference cell indices
        // on the old grid.
        if (paintController) paintController.clearUndo();
        camera.refreshBaseViewport();
        // Reset zoom/pan to fit-to-canvas on grid reset — a brand-new sim
        // shouldn't inherit a stale camera.
        camera.reset();
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
        if (typeof showToast === 'function') showToast('Simulation reset');
        if (typeof _haptics !== 'undefined') _haptics.trigger('warning');
    }

    // ─── Phase 11: paint controller ───
    // Owns canvas pointer events for all intervention modes (seed / vaccinate /
    // quarantine / sanitize / cull). Default mode is SEED with brush size 0,
    // so single-tap-to-seed continues to work the way phases 1-9 expected.
    // onMutate flips renderDirty/statsDirty/strainsDirty so the loop picks up
    // changes immediately without a tick (paint happens between ticks).
    function syncUndoRedoBtns() {
        if ($.undoBtn) $.undoBtn.disabled = !(paintController && paintController.canUndo());
        if ($.redoBtn) $.redoBtn.disabled = !(paintController && paintController.canRedo());
    }

    const paintController = createPaintController({
        canvas,
        getGrid: () => sim.grid,
        getToggles: () => toggles,
        // Paint's hitTest reads originX/originY/hexSize from this. Feeding it
        // the EFFECTIVE viewport (zoom + pan applied) is what keeps clicks
        // landing on the right cell regardless of camera state — no inverse-
        // transform math needed in paint.js itself.
        getViewport: getEffectiveViewport,
        onMutate: () => {
            invalidateDerived({ gridMutated: true });
        },
        // The hover footprint is what render() now draws as the brush
        // indicator. Flip renderDirty when it changes so the next frame
        // shows the new selection. Cheap — onHover only fires on cell
        // transitions, not at 60 Hz cursor velocity.
        onHover: () => {
            renderDirty = true;
            requestFrame();
        },
        onHistoryChange: syncUndoRedoBtns
    });

    // ─── Keyboard shortcuts (unified via initShortcuts) ───
    // Sister sims use shared-shortcuts.js for the global shortcut registry;
    // doing the same here gives uniform Ctrl/Meta + modifier handling and
    // input-focus suppression. Paint-specific keys (1..6 for mode, [/] for
    // brush size, Ctrl+Z/Y/Shift+Z for undo/redo) remain inside paint.js so
    // they keep direct access to setMode/setBrushSize/undo/redo and to the
    // sync helpers that update the UI buttons. The Ctrl+Z entry below is a
    // documentation-only entry: paint.js's listener already covers it, and
    // we route through the toolbar button via .click() so toast + haptic +
    // disabled-state sync all flow through the same code path. Constructed
    // here, BEFORE setupUI, so the About panel built inside setupUI can
    // read sim._shortcuts for its shortcut-table.
    function zoomAtCanvasCenter(direction) {
        camera.zoomAtCenter(direction);
    }
    const shortcuts = [
        { key: 'space', group: 'Simulation', label: 'Play / pause',
          action: () => { if ($.playBtn) $.playBtn.click(); } },
        { key: '.', group: 'Simulation', label: 'Step one tick',
          action: () => { if ($.stepBtn) $.stepBtn.click(); } },
        { key: 'r', group: 'Simulation', label: 'Reset simulation',
          action: () => { if ($.resetBtn) $.resetBtn.click(); } },
        { key: '?', group: 'View', label: 'Toggle About panel',
          action: () => { if ($.aboutBtn) $.aboutBtn.click(); } },
        { key: 'm', group: 'View', label: 'Show map controls',
          action: () => { if ($.viewModeBtn) $.viewModeBtn.click(); } },
        { key: 't', group: 'View', label: 'Toggle theme',
          action: () => { if ($.themeBtn) $.themeBtn.click(); } },
        { key: 's', group: 'View', label: 'Toggle sidebar',
          action: () => { if ($.menuBtn) $.menuBtn.click(); } },
        { key: '=', group: 'View', label: 'Zoom in',
          action: () => zoomAtCanvasCenter(1) },
        { key: '+', group: 'View', label: 'Zoom in',
          action: () => zoomAtCanvasCenter(1) },
        { key: '-', group: 'View', label: 'Zoom out',
          action: () => zoomAtCanvasCenter(-1) },
        { key: '_', group: 'View', label: 'Zoom out',
          action: () => zoomAtCanvasCenter(-1) },
        { key: '0', group: 'View', label: 'Reset zoom',
          action: () => zoomReset() },
        // Documentation-only history entries. paint.js owns the actual
        // Ctrl/Cmd+Z/Y handlers so a single shortcut cannot double-apply.
        { key: 'Ctrl+Z', group: 'History', label: 'Undo last stroke',
          when: () => false, action: () => {} },
        { key: 'Ctrl+Y', group: 'History', label: 'Redo last stroke',
          when: () => false, action: () => {} },
        { key: 'Ctrl+Shift+Z', group: 'History', label: 'Redo last stroke',
          when: () => false, action: () => {} }
    ];
    // Documentation-only entries for the paint shortcuts — paint.js owns
    // the actual key handling. We include them in the About-panel list for
    // discoverability via `when: () => false` so initShortcuts records the
    // entry but never invokes the (no-op) action.
    const paintDocsEntries = [
        { key: '1', group: 'Paint', label: 'Paint mode: none', when: () => false, action: () => {} },
        { key: '2', group: 'Paint', label: 'Paint mode: seed', when: () => false, action: () => {} },
        { key: '3', group: 'Paint', label: 'Paint mode: vaccinate', when: () => false, action: () => {} },
        { key: '4', group: 'Paint', label: 'Paint mode: quarantine', when: () => false, action: () => {} },
        { key: '5', group: 'Paint', label: 'Paint mode: sanitize', when: () => false, action: () => {} },
        { key: '6', group: 'Paint', label: 'Paint mode: cull', when: () => false, action: () => {} },
        { key: '[', group: 'Paint', label: 'Brush size down', when: () => false, action: () => {} },
        { key: ']', group: 'Paint', label: 'Brush size up',   when: () => false, action: () => {} }
    ];
    sim._shortcuts = shortcuts.concat(paintDocsEntries);
    if (typeof initShortcuts === 'function') {
        initShortcuts(shortcuts);
    }

    // ─── UI wiring ───
    ui = setupUI($, sim, {
        onTopologyChange: () => { renderDirty = true; requestFrame(); },
        onViewModeChange: () => { renderDirty = true; requestFrame(); },
        onParamChange:    () => {
            // Params are live-mutated by sliders and some of them affect the
            // paused frame immediately (AGE view color scale, hospital cap).
            invalidateDerived({ stats: true, strains: true });
        },
        onTogglesChange:  () => {
            // Toggles don't mutate current grid state, but the next tick
            // will produce different transitions. Mark render dirty so any
            // toggle-gated overlay (flags, Z, status) refreshes immediately.
            renderDirty = true;
            statsDirty = true;
            requestFrame();
        },
        onStep:           () => { tickOnce(); /* run-loop draws next frame */ start(); },
        onReset:          () => reset(),
        params,
        toggles,
        settingsPanelEl:        $.settingsPanel,
        paintController,
        interventionsPanelEl:   $.interventionsPanel,
        onPaintChange:          (kind, value) => {
            renderDirty = true;
            requestFrame();
            // Surface lightweight feedback so the user sees the mode flip
            // even when their attention is on the canvas. Matches gerry's
            // toast cadence for tool changes.
            if (typeof showToast === 'function') {
                if (kind === 'mode') {
                    const labels = {
                        none: 'Pointer (no paint)',
                        seed: 'Seed brush',
                        vaccinate: 'Vaccinate brush',
                        quarantine: 'Quarantine brush',
                        sanitize: 'Sanitize brush',
                        cull: 'Cull brush'
                    };
                    showToast(labels[value] || ('Mode: ' + value));
                } else if (kind === 'brush') {
                    const counts = ['1 hex', '7 hexes', '19 hexes'];
                    showToast('Brush: ' + (counts[value] || (value + ' hexes')));
                }
            }
            if (typeof _haptics !== 'undefined') _haptics.trigger('selection');
        },
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
            if (typeof showToast === 'function') showToast('Preset: ' + (p.label || presetKey));
            if (typeof _haptics !== 'undefined') _haptics.trigger('medium');
        }
    });

    // ─── Phase 15: zoom + pan ───
    // The render path consumes the EFFECTIVE viewport (base × zoom + pan).
    // Wheel: zoom around the cursor so the point under the cursor stays
    // pinned. Pinch: scale by the inter-finger distance ratio and pan by the
    // midpoint delta — gerry/src/touch.js is the pattern source. Buttons
    // step multiplicatively so each click is a visible change at any zoom
    // level. Pinch flips paintController.setSuppressed so two-finger
    // gestures don't trigger paint strokes (and any active stroke ends
    // cleanly).

    // Update the indicator <span> with the rounded percent. Cheap enough to
    // call on every zoom change; the value-set is no-op when unchanged so
    // there's no reflow churn.
    function updateZoomIndicator() {
        if (!$.zoomIndicator) return;
        $.zoomIndicator.textContent = Math.round(sim.zoom * 100) + '%';
    }

    function zoomTo(newZoom, anchorX, anchorY) {
        camera.zoomTo(newZoom, anchorX, anchorY);
    }

    function zoomReset() {
        camera.reset();
    }

    // Pan in CSS pixels. No clamping yet — at extreme zoom the user can
    // shove the grid off-screen; reset button is the recovery handle.
    function panBy(dx, dy) {
        camera.panBy(dx, dy);
    }

    // Mouse wheel → zoom centered on the cursor. passive:false so we can
    // preventDefault (otherwise the page scrolls behind the canvas).
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const ax = e.clientX - rect.left;
        const ay = e.clientY - rect.top;
        // deltaY > 0 = scroll down = zoom out. Use a per-event factor so
        // trackpad pinch-equivalents feel smooth (each event is tiny).
        const factor = e.deltaY < 0 ? ZOOM_STEP_WHEEL : 1 / ZOOM_STEP_WHEEL;
        zoomTo(sim.zoom * factor, ax, ay);
    }, { passive: false });

    // ─── Pinch (two-finger touch) ───
    // gerry/src/touch.js owns input via SVG event delegation; we own canvas
    // pointer events via the paint controller and add TouchEvent listeners
    // here for the multi-touch case. paint.js's Pointer Events still fire
    // alongside touch events — preventDefault on multi-touch + the
    // setSuppressed handle keeps them from competing.
    let pinchActive = false;
    let lastPinchDist = 0;
    let lastPinchMid = null;

    function midpointAndDist(t1, t2) {
        return {
            dist: Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY),
            mid: {
                x: (t1.clientX + t2.clientX) / 2,
                y: (t1.clientY + t2.clientY) / 2
            }
        };
    }

    canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            e.preventDefault();
            const { dist, mid } = midpointAndDist(e.touches[0], e.touches[1]);
            lastPinchDist = dist;
            lastPinchMid = mid;
            pinchActive = true;
            // Tell paint to ignore its in-flight stroke (if any) and any
            // pointerdowns that fire from the second finger landing.
            if (paintController && paintController.setSuppressed) {
                paintController.setSuppressed(true);
            }
        }
        // Single-touch falls through to paint.js's pointerdown — don't
        // preventDefault here or we'd block the stroke.
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
        if (!pinchActive || e.touches.length !== 2) return;
        e.preventDefault();
        const { dist, mid } = midpointAndDist(e.touches[0], e.touches[1]);
        if (lastPinchDist > 0) {
            const rect = canvas.getBoundingClientRect();
            const ax = mid.x - rect.left;
            const ay = mid.y - rect.top;
            zoomTo(sim.zoom * (dist / lastPinchDist), ax, ay);
            if (lastPinchMid) {
                panBy(mid.x - lastPinchMid.x, mid.y - lastPinchMid.y);
            }
        }
        lastPinchDist = dist;
        lastPinchMid = mid;
    }, { passive: false });

    function endPinch() {
        if (!pinchActive) return;
        pinchActive = false;
        lastPinchDist = 0;
        lastPinchMid = null;
        if (paintController && paintController.setSuppressed) {
            paintController.setSuppressed(false);
        }
    }

    // Both touchend (finger lifted) and touchcancel (gesture interrupted)
    // close out the pinch. touches.length drops to 0 or 1 — either way we
    // want pinch state gone. A subsequent single-tap should paint, which is
    // why we only release suppression here, not on touchmove.
    canvas.addEventListener('touchend',    () => { endPinch(); });
    canvas.addEventListener('touchcancel', () => { endPinch(); });

    // ─── Zoom buttons ───
    if ($.zoomInBtn) {
        $.zoomInBtn.addEventListener('click', () => {
            // Anchor to canvas center on button-click — no cursor to track.
            const rect = canvas.getBoundingClientRect();
            zoomTo(sim.zoom * ZOOM_STEP_BTN, rect.width / 2, rect.height / 2);
        });
    }
    if ($.zoomOutBtn) {
        $.zoomOutBtn.addEventListener('click', () => {
            const rect = canvas.getBoundingClientRect();
            zoomTo(sim.zoom / ZOOM_STEP_BTN, rect.width / 2, rect.height / 2);
        });
    }
    if ($.zoomResetBtn) {
        $.zoomResetBtn.addEventListener('click', () => zoomReset());
    }
    updateZoomIndicator();

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
            if (typeof showToast === 'function') showToast('Speed ' + sim.speed + 'x');
            if (typeof _haptics !== 'undefined') _haptics.trigger('selection');
        });
    }

    // ─── Undo / redo (toolbar) ───
    // The paint controller owns the actual stacks; the toolbar buttons are
    // a discoverable affordance for users who don't know the keyboard
    // shortcut. Disabled state is kept in sync via onHistoryChange.
    if ($.undoBtn) {
        $.undoBtn.addEventListener('click', () => {
            if (!paintController.canUndo()) return;
            paintController.undo();
            if (typeof showToast === 'function') showToast('Undo');
            if (typeof _haptics !== 'undefined') _haptics.trigger('light');
        });
    }
    if ($.redoBtn) {
        $.redoBtn.addEventListener('click', () => {
            if (!paintController.canRedo()) return;
            paintController.redo();
            if (typeof showToast === 'function') showToast('Redo');
            if (typeof _haptics !== 'undefined') _haptics.trigger('light');
        });
    }
    syncUndoRedoBtns();

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
            requestFrame();
        });
    }

    // ─── Sidebar (dashboard) toggle ───
    // _toolbar.initSidebar wires the menu button to open/close the dashboard,
    // the close button to dismiss it, swipe-to-dismiss on mobile, and auto-
    // opens on desktop. The dashboard already has the 'open' class semantics
    // baked into shared-base.css.
    //
    // shiftForSidebar (gerry parity): animate the canvas pan left by
    // (panel-w / 2) when the sidebar opens so the visible content re-
    // centers in the residual canvas area, and snap it back when it closes.
    // Skips the shift on mobile (panel becomes a bottom sheet there).
    //
    // We rAF-tween panX over the same window as the sidebar slide so the
    // canvas re-center reads as a single coordinated motion instead of an
    // instant snap. Cancels any in-flight shift on a fresh toggle so rapid
    // open/close clicks don't accumulate fractional offsets.
    let sidebarShiftRaf = null;
    function shiftForSidebar(opening) {
        if (window.innerWidth <= 900) return;
        const panelW = parseInt(
            getComputedStyle(document.documentElement).getPropertyValue('--panel-w'),
            10
        ) || 360;
        // Half the panel width plus margin — matches gerry's heuristic.
        // Negative shift pulls the world to the left so the inscribed hex
        // sits in the visible window minus the panel.
        const shift = (panelW + 24) / 2;
        const dx = opening ? -shift : shift;
        const startPan = sim.panX;
        const targetPan = startPan + dx;
        const duration = 450;
        const startTime = performance.now();
        if (sidebarShiftRaf !== null) cancelAnimationFrame(sidebarShiftRaf);
        function step(now) {
            const t = Math.min(1, (now - startTime) / duration);
            // ease-out cubic to match the sidebar's spring-out feel
            const eased = 1 - Math.pow(1 - t, 3);
            sim.panX = startPan + (targetPan - startPan) * eased;
            renderDirty = true;
            requestFrame();
            if (t < 1) {
                sidebarShiftRaf = requestAnimationFrame(step);
            } else {
                sidebarShiftRaf = null;
            }
        }
        sidebarShiftRaf = requestAnimationFrame(step);
    }
    if ($.menuBtn && $.dashboard && window._toolbar) {
        window._toolbar.initSidebar($.menuBtn, $.dashboard, $.closeStats, {
            onToggle: shiftForSidebar
        });
    }

    // ─── Visibility-driven repaint wake-up ───
    // The stats / strain / timeseries renders bail when their host element
    // is hidden (display:none on inactive tab panels, .hidden / closed
    // dashboard). When the sim is paused those panels can become visible
    // without any tick firing, so we'd see stale numbers until the next
    // tick. Hook tab clicks + sidebar toggle so visibility changes mark the
    // panels dirty and nudge the rAF loop back to life.
    function wakeRenders() {
        statsDirty = true;
        strainsDirty = true;
        tsDirty = true;
        // The time-series canvas lives inside the Compartments tab panel, so
        // it's display:none whenever another tab is up. A window resize while
        // it's hidden leaves its backing store at a stale (often zero) size;
        // re-measure on every visibility flip so it's correct the moment the
        // tab is shown again.
        if (ts) ts.resize();
        requestFrame();
    }
    if ($.dashboard) {
        // Tab buttons inside the dashboard. shared-tabs.js owns the .active
        // swap; we only need to listen so we can re-render the newly-shown
        // panel. Delegate at the dashboard level so we don't have to know
        // the button count.
        $.dashboard.addEventListener('click', (e) => {
            if (e.target && e.target.classList && e.target.classList.contains('tab-btn')) {
                wakeRenders();
            }
        });
    }
    if ($.menuBtn) {
        $.menuBtn.addEventListener('click', wakeRenders);
    }
    if ($.closeStats) {
        // Closing doesn't need a repaint, but keep symmetry for swipe-close.
        $.closeStats.addEventListener('click', wakeRenders);
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
    // ready. The chart is canvas-only (no wrap, no caption) — initTimeseries
    // just attaches the 2D context and exposes push/render/resize/clear.
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
