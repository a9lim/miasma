// main.js — miasma entry point.
//
// The run loop advances simulated time by dt each frame, drains the
// accumulator into dynamics.tick() calls, pushes each tick's transition
// counts to the observed-Re history and the rose, stamps arrivals for
// the isochrones, then draws the plate. The plate's state texture is
// re-packed only when something it shows changed (a tick, paint, the brush,
// the view, the theme); otherwise a frame is one WebGPU pass and the 2D
// furniture. The loop idle-stops when paused with nothing dirty.
//
// The page opens on a living frame: an outbreak already under way on the
// torus, its isochrones laid down by a short warm-up, and the clock running.
// Under reduced motion it opens paused on a longer warm-up, a still and
// complete plate.
//
// Shared globals (from <script> tags in index.html): _colophon, _forms,
// initShortcuts, initAboutPanel, resizeCanvasDPR, showToast,
// _haptics, _loadTextFonts, _themePalette, _FONT.

import { Grid } from './src/grid.js';
import { createPlate, computeViewport } from './src/plate.js';
import { DEFAULTS, ViewMode, Compartment, MemoryKind, Topology, topoFromString, WORLD_R_RANGE, OPENING_SEEDS } from './src/config.js';
import { setupUI } from './src/ui.js';
import { tick } from './src/dynamics.js';
import { initializeGrid, seedPopulation } from './src/initialization.js';
import { computeStats, computeReff, renderStatsPanel } from './src/stats.js';
import { makeParams } from './src/params.js';
import { DEFAULT_PARAMS } from './src/default-params.js';
import { memoryOf, remember } from './src/immunity.js';
import { makeToggles, DEFAULT_TOGGLES } from './src/toggles.js';
import { initTimeseries, ROSE_PERIOD } from './src/rose.js';
import { createSpacetime } from './src/spacetime.js';
import { createRegistry, getStrain, GENOME_FIELDS } from './src/strains.js';
import { computeStrainPrevalence, renderStrainPanel } from './src/lineage.js';
import { createPaintController, PaintMode } from './src/paint.js';
import { FLUX_KEYS } from './src/model.js';
import { applyPreset, getPreset } from './src/presets.js';
import { createCamera, ZOOM_STEP_BTN, ZOOM_STEP_WHEEL } from './src/camera.js';
import { createTransitionHistory } from './src/history.js';
import { makeRngFromLocation } from './src/prng.js';
import { createIsochrones } from './src/isochrones.js';
import { plateCaption, plateLegend } from './src/caption.js';
import { hexBounds } from './src/topology.js';

function cacheDOM() {
    const $ = (id) => document.getElementById(id);
    return {
        canvas: $('sim-canvas'), gpuCanvas: $('plate-gpu'), noGpu: $('plate-nogpu'), playBtn: $('play-btn'), stepBtn: $('step-btn'), resetBtn: $('reset-btn'),
        speedBtn: $('speed-btn'), themeBtn: $('theme-btn'), menuBtn: $('menu-btn'), marginOpen: $('margin-open'),
        aboutBtn: $('about-btn'), topologyToggles: $('topology-toggles'),
        worldPicker: $('world-picker'), viewModeToggles: $('viewmode-toggles'), experimentList: $('experiment-list'),
        knob: $('knob'), brushRail: $('brush-rail'), zoom: $('canvas-controls'), stage: document.querySelector('.plate-stage'),
        plateHead: document.querySelector('.plate-head'), statsPanel: $('tab-compartments'), modelPanel: $('tab-model'),
        dashboard: $('margin'), atlas: document.querySelector('.atlas'),
        timeseriesPanel: $('timeseries-panel'), timeseriesCanvas: $('timeseries-canvas'), roseCaption: $('rose-caption'),
        spacetimePanel: $('spacetime-panel'), spacetimeCanvas: $('spacetime-canvas'), spacetimeCaption: $('spacetime-caption'),
        strainPanel: $('tab-strains'), caption: $('plate-caption'),
        zoomInBtn: $('zoom-in-btn'), zoomOutBtn: $('zoom-out-btn'), zoomResetBtn: $('zoom-reset-btn'),
        zoomIndicator: $('zoom-indicator'), undoBtn: $('undo-btn'), redoBtn: $('redo-btn')
    };
}

const SPEED_STEPS = [0.25, 0.5, 1, 2, 4];
const DEFAULT_SPEED_INDEX = 2;
const BASE_TICK_RATE = 10;     // ticks (days) per second at 1×
const HISTORY_CAP = 200;
// The opening outbreak: its preset, seeded with OPENING_SEEDS (config.js).
const OPENING_PRESET = 'threshold';
// Days the opening runs before it is shown: the preset's own warm-up, and
// longer under reduced motion, which opens on a still plate.
const OPENING_WARMUP = 96, OPENING_STILL_EXTRA = 120;

export default function init(dom) {
    const $ = dom || cacheDOM();
    const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const sim = {
        grid: null,
        topology: DEFAULTS.topology,
        viewMode: DEFAULTS.viewMode,
        playing: false,
        speed: SPEED_STEPS[DEFAULT_SPEED_INDEX],
        tick: 0,
        zoom: 1, panX: 0, panY: 0,
        presetKey: null
    };
    // ?mi=<plane|torus|klein|rp2> opens on that surface; a retired name
    // (cylinder, mobius) falls back to the default like any unknown value.
    const qs = new URLSearchParams(window.location.search);
    if (qs.has('mi')) sim.topology = topoFromString(qs.get('mi'));
    if (qs.has('view') && Object.values(ViewMode).includes(qs.get('view'))) sim.viewMode = qs.get('view');
    // ?r=<radius> opens on a world of that radius (Settings offers WORLD_RADII).
    setWorldRadius(qs.has('r') ? parseInt(qs.get('r'), 10) : DEFAULTS.R);
    sim.grid = new Grid(sim.W, sim.H);

    initializeGrid(sim.grid);
    const params = makeParams();
    const toggles = makeToggles();
    let strains = createRegistry(params);
    const rng = makeRngFromLocation(window.location);
    seedPopulation(sim.grid, params, rng);
    const history = createTransitionHistory(HISTORY_CAP);
    // the isochrones build in a worker; a result redraws the plate
    const iso = createIsochrones({ worker: true, onBuilt: () => markState() });

    const canvas = $.canvas;
    if (!canvas) { console.error('miasma: #sim-canvas not found'); return; }
    const ctx = canvas.getContext('2d');
    // The lattice draws only in WebGPU; without it the plate says so, and
    // the margin's figures run on.
    const plate = createPlate(canvas, $.gpuCanvas, (ok) => {
        document.body.classList.toggle('gpu', ok);
        if ($.noGpu) $.noGpu.hidden = ok;
        markState();
    });

    // The plate frame: the canvas below the band over it (the colophon and
    // the view picker) and above the phone's brush rail; `padL` is the brush
    // rail's width, which the world keeps clear of. Measured on resize, with
    // the rectangles of the controls over the plate, which labels avoid.
    let frameCache = null, overlayRects = [];
    function plateFrame() {
        const r = canvas.getBoundingClientRect();
        const cs = getComputedStyle($.stage || document.body);
        const top = parseFloat(cs.getPropertyValue('--plate-top')) || 58;
        const bottom = parseFloat(cs.getPropertyValue('--plate-bottom')) || 0;
        const padL = parseFloat(cs.getPropertyValue('--plate-left')) || 0;
        frameCache = { x: 0, y: top, w: r.width, h: Math.max(80, r.height - top - bottom), padL };
        overlayRects = [$.brushRail, $.zoom, $.plateHead].filter(Boolean).map((e) => {
            const b = e.getBoundingClientRect();
            return b.width ? [b.left - r.left - 6, b.top - r.top - 6, b.right - r.left + 6, b.bottom - r.top + 6] : null;
        }).filter(Boolean);
        return frameCache;
    }
    const camera = createCamera({
        canvas, ctx, sim,
        getGrid: () => sim.grid,
        computeViewport: (cv, grid) => computeViewport(cv, grid, plateFrame()),
        resizeCanvasDPR: window.resizeCanvasDPR,
        onChange: () => { updateZoomIndicator(); markState(); }
    });
    const getEffectiveViewport = () => {
        const vp = camera.getEffectiveViewport();
        vp.frame = frameCache || plateFrame();
        return vp;
    };

    let ts = null, spacetime = null;
    let cachedStats = null, cachedPrev = null;
    let lastCounts = null;
    // The census and the strain prevalence, each an O(cells) sweep. A paint
    // stroke or a new world drops them; a tick only marks them stale, and
    // while the clock runs a stale one is recounted at most every PANEL_MS.
    let statsStale = false, prevStale = false, statsAt = 0, prevAt = 0;
    const fresh = (stale, at) => !stale || (sim.playing && performance.now() - at < PANEL_MS);
    function stats() {
        if (!cachedStats || !fresh(statsStale, statsAt)) {
            cachedStats = computeStats(sim.grid); statsStale = false; statsAt = performance.now();
        }
        return cachedStats;
    }
    function prevalence() {
        if (!cachedPrev || !fresh(prevStale, prevAt)) {
            cachedPrev = computeStrainPrevalence(sim.grid, strains, DEFAULTS.maxActiveStrains); prevStale = false; prevAt = performance.now();
        }
        return cachedPrev;
    }

    function updateStats() {
        if (!$.statsPanel) return;
        const reff = computeReff(history, params);
        // beds exist only while hospitals admit
        const capacity = toggles.auto_hospital ? Math.floor((params.h_capacity_frac || 0) * sim.grid.activeIndices.length) : undefined;
        renderStatsPanel($.statsPanel, stats(), reff, capacity, sim.grid.descent.reCounted());
    }

    let renderDirty = true, stateDirty = true, statsDirty = true, tsDirty = true, strainsDirty = true;
    let lastFrameTime = performance.now();
    let accumulator = 0;

    function markState() { stateDirty = true; renderDirty = true; legendDirty = true; requestFrame(); }

    // While the clock runs the plate redraws every frame something changed,
    // but the text around it need not: the Counts, Strains and rose panels
    // redraw at most every PANEL_MS, and the caption and the cartouche's rows
    // every CAPTION_MS (the caption setter's own interval). Paused, they
    // catch up at once.
    const PANEL_MS = 100, CAPTION_MS = 250;
    let lastPanels = -Infinity, lastCaptionAt = -Infinity, lastLegendAt = -Infinity;
    let captionStale = false, legend = null, legendDirty = true;

    function invalidateDerived(opts) {
        opts = opts || {};
        if (opts.gridMutated) { cachedStats = cachedPrev = null; iso.record(sim.grid, sim.tick); }
        if (opts.render !== false) { renderDirty = true; stateDirty = true; }
        if (opts.stats !== false) statsDirty = true;
        if (opts.timeseries) tsDirty = true;
        if (opts.strains !== false) strainsDirty = true;
        requestFrame();
    }

    // Transitions a day along each of the model figure's arrows, smoothed over
    // about ten days.
    const flux = Object.fromEntries(FLUX_KEYS.map((k) => [k, 0]));

    function tickOnce() {
        if (paintController) paintController.clearUndo();
        const counts = tick(sim.grid, params, toggles, sim.topology, rng, strains, sim.tick + 1);
        sim.tick++;
        lastCounts = counts;
        for (const k of FLUX_KEYS) flux[k] += 0.1 * ((counts[k] || 0) - flux[k]);
        statsStale = prevStale = true;
        history.push(counts.sToE, counts.eToI, counts.iToR, counts.iToD, counts.spillovers, counts.zPop);
        if (ts) ts.push(sim.tick, counts);
        if (spacetime) spacetime.record(sim.grid, strains, sim.tick);
        iso.record(sim.grid, sim.tick);
        renderDirty = stateDirty = statsDirty = tsDirty = strainsDirty = true;
    }

    function updateStrainPanel() {
        if (!$.strainPanel || !$.strainPanel.classList.contains('active')) return;
        renderStrainPanel($.strainPanel, prevalence(), strains, (id) => {
            sim.selectedStrain = id;
            if (sim.viewMode === ViewMode.IMMUNITY || sim.viewMode === ViewMode.STRAIN) markState();
        }, sim.tick, {
            vax: { x: params.vax_ag_x || 0, y: params.vax_ag_y || 0 },
            onMatchVaccine: (id) => {
                if (id == null || !getStrain(strains, id)) return;
                params.vax_ag_x = strains.ag_x[id];
                params.vax_ag_y = strains.ag_y[id];
                strainsDirty = true;
                requestFrame();
                if (typeof showToast === 'function') showToast('Vaccine matched to ' + strains.names[id]);
            }
        });
    }

    const setCaption = window._colophon ? window._colophon.caption($.caption, 250) : () => {};
    // The Immunoediting preset reads the lattice as tissue: its scale is in
    // µm, and its State view is an H&E-stained section (the other views draw
    // as they do everywhere).
    const tissue = () => sim.presetKey === 'immunoediting';
    const histology = () => tissue() && sim.viewMode === ViewMode.COMPARTMENT;

    function drawPlate() {
        const vp = getEffectiveViewport();
        if (stateDirty) {
            iso.build(sim.grid, sim.topology, sim.tick, 4);
            plate.markState();
            stateDirty = false;
        }
        const now = performance.now();
        if (legendDirty || !legend || now - lastLegendAt >= CAPTION_MS) {
            const strainView = sim.viewMode === ViewMode.STRAIN;
            legend = plateLegend(sim, stats(), toggles, histology(),
                strainView ? prevalence() : null, strains, strainView ? focusStrain() : null);
            lastLegendAt = now; legendDirty = false;
        }
        sim.immunity = sim.viewMode === ViewMode.IMMUNITY ? immunityTarget() : null;
        plate.draw({
            grid: sim.grid, vp, topology: sim.topology, mode: sim.viewMode,
            dpr: canvas.width / Math.max(1, vp.cssWidth),
            contours: iso.contours, field: iso, histology: histology(),
            legend, avoid: overlayRects, presetKey: sim.presetKey,
            trunk: sim.viewMode === ViewMode.STRAIN ? { reg: strains, id: focusStrain() } : null,
            scaleUnit: tissue() ? { per: 12, name: 'µm' } : null,
            stateOpts: {
                mode: sim.viewMode,
                topology: sim.topology,
                animalDisplay: toggles.animalDisplay || 'dots',
                immunity: sim.immunity,
                strains,
                paintOverlay: paintController.getHoverFootprint()
            }
        });
        if (now - lastCaptionAt >= CAPTION_MS) {
            lastCaption = captionText(vp);
            setCaption(lastCaption);
            lastCaptionAt = now; captionStale = false;
        } else captionStale = true;
    }
    let lastCaption = '';
    function captionText(vp) {
        return plateCaption(sim, stats(), computeReff(history, params), histology(), vp.frame.w < 600, measureCtx());
    }

    // What presetMeasure reads: the params, the history, how many cells the
    // wave has reached (the isochrones' stamps), the strain registry.
    function measureCtx() {
        return {
            params, history, strains, reached: iso.reached, descent: sim.grid.descent,
            active: sim.grid.activeIndices.length, unvax0: sim.unvax0 || 0,
            prevalence
        };
    }

    // The strain the immunity view shades against and the Strain view's trunk
    // follows: the one selected in the Strains tab while it lives, else the
    // most prevalent, else α.
    function focusStrain() {
        const id = sim.selectedStrain;
        if (id != null && getStrain(strains, id) && !strains.extinct[id]) return id;
        const prev = prevalence();
        return prev.length ? prev[0].id : 0;
    }
    function immunityTarget() {
        const id = focusStrain();
        return {
            id, name: strains.names[id], ax: strains.ag_x[id], ay: strains.ag_y[id],
            cInf: params.immunity_strength, cVax: params.vax_efficacy
        };
    }

    function frame(now) {
        if (document.hidden) { running = false; return; }
        const dt = Math.min((now - lastFrameTime) / 1000, 0.25);
        lastFrameTime = now;
        if (sim.playing) {
            accumulator += dt;
            const tickInterval = 1 / (BASE_TICK_RATE * sim.speed);
            let budget = 16;
            while (accumulator >= tickInterval && budget > 0) { tickOnce(); accumulator -= tickInterval; budget--; }
            if (budget === 0) accumulator = 0;
        }
        if ((statsDirty || tsDirty || strainsDirty) && (!sim.playing || now - lastPanels >= PANEL_MS)) {
            lastPanels = now;
            if (statsDirty) { updateStats(); if (ui) ui.model.update(stats(), flux); statsDirty = false; }
            if (tsDirty && ts) { ts.render(); if (spacetime) spacetime.render(sim.viewMode === ViewMode.STRAIN); tsDirty = false; }
            if (strainsDirty) { updateStrainPanel(); strainsDirty = false; }
        }
        if (renderDirty) { drawPlate(); renderDirty = false; }
        if (!sim.playing && !renderDirty && !statsDirty && !tsDirty && !strainsDirty) {
            // the caption is throttled; going idle, write the latest one for sure
            if (captionStale) { lastCaption = captionText(getEffectiveViewport()); captionStale = false; }
            setCaption(lastCaption, true);
            running = false; rafId = null; return;
        }
        rafId = requestAnimationFrame(frame);
    }

    let rafId = null, running = false;
    function start() {
        if (running) return;
        running = true;
        lastFrameTime = performance.now();
        accumulator = 0;
        rafId = requestAnimationFrame(frame);
    }
    function requestFrame() { if (!running) start(); }
    function stop() { running = false; if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; } }

    let ui = null;

    /** Re-initialize grid, history, isochrones and the strain registry; params and toggles stay. */
    function resetGridOnly() {
        sim.grid = new Grid(sim.W, sim.H);
        initializeGrid(sim.grid);
        seedPopulation(sim.grid, params, rng);
        sim.tick = 0;
        history.clear();
        iso.clear();
        accumulator = 0;
        if (ts) ts.clear();
        if (spacetime) spacetime.clear();
        for (const k of FLUX_KEYS) flux[k] = 0;
        strains = createRegistry(params);
        sim.selectedStrain = null;
        cachedStats = cachedPrev = null;
        if (paintController) paintController.clearUndo();
        camera.refreshBaseViewport();
        camera.reset();
        renderDirty = stateDirty = statsDirty = tsDirty = strainsDirty = true;
    }

    // Seed strain α at axial offsets from the world center (and a ring of
    // neighbors, so the case doesn't fizzle at tick 1), through the paint path.
    function seedOpening(offsets) {
        const { cq, cr, R } = hexBounds(sim.grid.W, sim.grid.H);
        const mode = paintController.getMode(), size = paintController.getBrushSize();
        paintController.setMode(PaintMode.SEED);
        paintController.setBrushSize(1);
        // the offsets are for the default world; another scales them
        const k = R / DEFAULTS.R;
        for (const [dq, dr] of offsets) paintController.applyAtHex(cq + Math.round(dq * k), cr + Math.round(dr * k));
        paintController.setMode(mode);
        paintController.setBrushSize(size);
        paintController.clearUndo();
        iso.record(sim.grid, sim.tick);
    }

    // The opening frame: seeds, then a warm-up so the plate already carries
    // isochrones. Called at boot and by reset.
    function openScene(still) {
        const p = getPreset(OPENING_PRESET);
        applyScene(p, qs.has('mi') ? topoFromString(qs.get('mi')) : null);
        const n = (p.warmup || OPENING_WARMUP) + (still ? OPENING_STILL_EXTRA : 0);
        for (let k = 0; k < n; k++) tickOnce();
    }

    // Random vaccine coverage given when the world is built (vax_coverage):
    // each S cell becomes V with that chance, remembering the vaccine's
    // antigen. Records how many living cells were left unvaccinated.
    function applyCoverage() {
        const g = sim.grid, cov = params.vax_coverage || 0;
        let unvax = 0;
        const mem = memoryOf(g);
        for (const i of g.activeIndices) {
            const c = g.compartment[i];
            if (c === Compartment.EMPTY || c === Compartment.D) continue;
            if (toggles.V && cov > 0 && c === Compartment.S && rng() < cov) {
                g.compartment[i] = Compartment.V;
                remember(mem, i, params.vax_ag_x || 0, params.vax_ag_y || 0, MemoryKind.VACCINE);
            } else unvax++;
        }
        sim.unvax0 = unvax;
    }

    // The world's radius; the grid is rebuilt by the caller.
    function setWorldRadius(R) {
        const [lo, hi] = WORLD_R_RANGE;
        sim.R = Number.isFinite(R) ? Math.max(lo, Math.min(hi, R)) : DEFAULTS.R;
        sim.W = sim.H = 2 * sim.R + 2;
    }

    // A new world size rebuilds the world and starts the run again, keeping
    // the params and toggles as they are.
    function setWorld(R) {
        setWorldRadius(R);
        resetGridOnly();
        applyCoverage();
        seedOpening(OPENING_SEEDS);
        requestFrame();
    }

    // Restart runs the model as it stands (the experiment, its knob and any
    // change made in the Model tab) again on a fresh world: its coverage and
    // the opening's two cases. Restore, in the Model tab, puts back the
    // experiment's own values.
    function restart() {
        resetGridOnly();
        applyCoverage();
        seedOpening(OPENING_SEEDS);
        requestFrame();
    }
    function reset() {
        restart();
        if (typeof showToast === 'function') showToast('Restarted');
        if (typeof _haptics !== 'undefined') _haptics.trigger('warning');
    }
    function restore() {
        const p = getPreset(sim.presetKey);
        if (p) applyScene(p);
        else applySandbox();
        if (typeof showToast === 'function') showToast('Restored');
    }

    function applySandbox() {
        Object.assign(params, DEFAULT_PARAMS);
        Object.assign(toggles, DEFAULT_TOGGLES);
        sim.presetKey = null;
        resetGridOnly();
        applyCoverage();
        if (ui && typeof ui.resetUI === 'function') ui.resetUI();
        if (ui && ui.showPreset) ui.showPreset(null);
        seedOpening(OPENING_SEEDS);
        requestFrame();
    }

    function syncUndoRedoBtns() {
        if ($.undoBtn) $.undoBtn.disabled = !(paintController && paintController.canUndo());
        if ($.redoBtn) $.redoBtn.disabled = !(paintController && paintController.canRedo());
    }

    const paintController = createPaintController({
        canvas,
        getGrid: () => sim.grid,
        getToggles: () => toggles,
        getParams: () => params,
        getStrains: () => strains,
        getViewport: getEffectiveViewport,
        // Hit-testing goes through the plate, so a stroke on a faded copy lands
        // on the world cell it is a copy of.
        pickAt: (x, y) => plate.pick(sim.grid, getEffectiveViewport(), sim.topology, x, y),
        onMutate: () => invalidateDerived({ gridMutated: true }),
        onHover: () => markState(),
        onHistoryChange: syncUndoRedoBtns
    });

    const shortcuts = [
        { key: 'space', group: 'Simulation', label: 'Play / pause', action: () => togglePlay() },
        { key: '.', group: 'Simulation', label: 'Step one day', action: () => stepOnce() },
        { key: 'r', group: 'Simulation', label: 'Restart on a fresh world', action: () => { if ($.resetBtn) $.resetBtn.click(); } },
        // about.js binds ? and the help button itself; listed here for the panel
        { key: '?', group: 'View', label: 'Toggle about panel', when: () => false, action: () => {} },
        { key: 'm', group: 'View', label: 'Next map view', action: () => cycleView() },
        { key: 't', group: 'View', label: 'Toggle theme', action: () => { if ($.themeBtn) $.themeBtn.click(); } },
        { key: 's', group: 'View', label: 'Show or hide the margin', action: () => toggleMargin() },
        { key: '=', group: 'View', label: 'Zoom in', action: () => camera.zoomAtCenter(1) },
        { key: '+', group: 'View', label: 'Zoom in', action: () => camera.zoomAtCenter(1) },
        { key: '-', group: 'View', label: 'Zoom out', action: () => camera.zoomAtCenter(-1) },
        { key: '_', group: 'View', label: 'Zoom out', action: () => camera.zoomAtCenter(-1) },
        { key: '0', group: 'View', label: 'Fit the plate', action: () => camera.reset() },
        { key: 'Ctrl+Z', group: 'History', label: 'Undo last stroke', when: () => false, action: () => {} },
        { key: 'Ctrl+Y', group: 'History', label: 'Redo last stroke', when: () => false, action: () => {} },
        { key: 'Ctrl+Shift+Z', group: 'History', label: 'Redo last stroke', when: () => false, action: () => {} }
    ];
    const paintDocsEntries = [
        ['1', 'look'], ['2', 'seed'], ['3', 'vaccinate'], ['4', 'quarantine'], ['5', 'sanitize'], ['6', 'cull']
    ].map(([key, m]) => ({ key, group: 'Paint', label: 'Brush: ' + m, when: () => false, action: () => {} }))
        .concat([
            { key: '[', group: 'Paint', label: 'Brush size down', when: () => false, action: () => {} },
            { key: ']', group: 'Paint', label: 'Brush size up', when: () => false, action: () => {} }
        ]);
    sim._shortcuts = shortcuts.concat(paintDocsEntries);
    if (typeof initShortcuts === 'function') initShortcuts(shortcuts);

    ui = setupUI($, sim, {
        onTopologyChange: () => { iso.markDirty(); markState(); },
        onWorldChange: (R) => setWorld(R),
        onViewModeChange: () => { markState(); tsDirty = true; },
        // A slider in the Model tab has set params[key]. A genome field lives
        // on every strain, so it is written onto all of them; the knob and
        // its marks follow.
        onParam: (key) => { setGenome(key, params[key]); if (ui) ui.showPreset(sim.presetKey); invalidateDerived({ stats: true, strains: true }); },
        onTogglesChange: () => { if (ui) ui.showPreset(sim.presetKey); markState(); statsDirty = true; },
        onReset: () => reset(),
        onRestore: () => restore(),
        params, toggles,
        paintController,
        onPaintChange: () => {
            markState();
            if (typeof _haptics !== 'undefined') _haptics.trigger('selection');
        },
        onApplyPreset: (presetKey) => {
            const p = getPreset(presetKey);
            if (p) applyScene(p);
            else applySandbox();
            if (typeof _haptics !== 'undefined') _haptics.trigger('medium');
        },
        // The knob acts live, or (coverage) restarts the run with its value.
        onKnob: (key, value, knob) => {
            params[key] = value;
            if (ui) ui.model.refresh();
            if (knob.reset) { restart(); return; }
            setGenome(key, value);
            invalidateDerived({ stats: true, strains: true });
        }
    });

    // Write a genome field's value onto every strain (a no-op for a sim-wide key).
    function setGenome(key, value) {
        const field = GENOME_FIELDS.find(f => f.key === key);
        if (!field) return;
        const v = Math.min(field.max, Math.max(field.min, value));
        for (let id = 0; id < strains.ids.length; id++) strains[key][id] = v;
    }

    const VIEWS = [ViewMode.COMPARTMENT, ViewMode.STRAIN, ViewMode.DESCENT, ViewMode.AGE, ViewMode.HEALTH, ViewMode.STATUS, ViewMode.IMMUNITY];
    function cycleView() {
        const next = VIEWS[(VIEWS.indexOf(sim.viewMode) + 1) % VIEWS.length];
        const b = $.viewModeToggles && $.viewModeToggles.querySelector(`[data-viewmode="${next}"]`);
        if (b) b.click();
    }

    // Apply a preset object: params, toggles and surface (or `topology`), a
    // fresh world, its coverage, and the opening's two cases.
    function applyScene(p, topology) {
        applyPreset(p, params, toggles, sim);
        if (topology != null) sim.topology = topology;
        sim.presetKey = p.key || null;
        resetGridOnly();
        applyCoverage();
        if (ui && typeof ui.resetUI === 'function') ui.resetUI();
        if (ui && ui.showPreset) ui.showPreset(sim.presetKey);
        seedOpening(OPENING_SEEDS);
        requestFrame();
    }

    // ─── Zoom and pan ───
    function updateZoomIndicator() {
        if ($.zoomIndicator) $.zoomIndicator.textContent = Math.round(sim.zoom * 100) + '%';
    }
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const factor = e.deltaY < 0 ? ZOOM_STEP_WHEEL : 1 / ZOOM_STEP_WHEEL;
        camera.zoomTo(sim.zoom * factor, e.clientX - rect.left, e.clientY - rect.top);
    }, { passive: false });

    // Two-finger pinch zooms and pans; paint is suppressed while it lasts.
    let pinchActive = false, lastPinchDist = 0, lastPinchMid = null;
    const midDist = (a, b) => ({ dist: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY), mid: { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 } });
    canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 2) return;
        e.preventDefault();
        const { dist, mid } = midDist(e.touches[0], e.touches[1]);
        lastPinchDist = dist; lastPinchMid = mid; pinchActive = true;
        paintController.setSuppressed(true);
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
        if (!pinchActive || e.touches.length !== 2) return;
        e.preventDefault();
        const { dist, mid } = midDist(e.touches[0], e.touches[1]);
        const rect = canvas.getBoundingClientRect();
        if (lastPinchDist > 0) {
            camera.zoomTo(sim.zoom * (dist / lastPinchDist), mid.x - rect.left, mid.y - rect.top);
            if (lastPinchMid) camera.panBy(mid.x - lastPinchMid.x, mid.y - lastPinchMid.y);
        }
        lastPinchDist = dist; lastPinchMid = mid;
    }, { passive: false });
    const endPinch = () => {
        if (!pinchActive) return;
        pinchActive = false; lastPinchDist = 0; lastPinchMid = null;
        paintController.setSuppressed(false);
    };
    canvas.addEventListener('touchend', endPinch);
    canvas.addEventListener('touchcancel', endPinch);
    const zoomBtn = (btn, f) => btn && btn.addEventListener('click', () => {
        const r = canvas.getBoundingClientRect();
        camera.zoomTo(sim.zoom * f, r.width / 2, r.height / 2);
    });
    zoomBtn($.zoomInBtn, ZOOM_STEP_BTN);
    zoomBtn($.zoomOutBtn, 1 / ZOOM_STEP_BTN);
    if ($.zoomResetBtn) $.zoomResetBtn.addEventListener('click', () => camera.reset());
    updateZoomIndicator();

    // ─── Colophon: play, step, theme, help ───
    let colophon = null;
    function setPlaying(p) {
        sim.playing = p;
        if (!p) accumulator = 0;
        if (colophon) colophon.setPlaying(p);
        start();
    }
    function togglePlay() { setPlaying(!sim.playing); }
    function stepOnce() { if (sim.playing) setPlaying(false); tickOnce(); start(); }
    if (window._colophon) {
        colophon = window._colophon.mount({
            themeKey: 'miasma-theme',
            playing: false,
            onPlay: () => { setPlaying(!sim.playing); return sim.playing; },
            onStep: () => stepOnce(),
            onTheme: () => { markState(); tsDirty = true; strainsDirty = true; statsDirty = true; requestFrame(); },
            onHelp: () => {}   // the about panel binds #about-btn itself
        });
    }

    function syncSpeedBtn() {
        if (!$.speedBtn) return;
        const label = $.speedBtn.querySelector('.speed-label');
        const txt = (sim.speed < 1 ? String(sim.speed).replace(/^0/, '') : String(sim.speed)) + '×';
        if (label) label.textContent = txt;
    }
    if ($.speedBtn) {
        syncSpeedBtn();
        $.speedBtn.addEventListener('click', () => {
            const idx = SPEED_STEPS.indexOf(sim.speed);
            sim.speed = SPEED_STEPS[(idx + 1) % SPEED_STEPS.length];
            syncSpeedBtn();
            if (typeof _haptics !== 'undefined') _haptics.trigger('selection');
        });
    }
    const historyBtn = (btn, can, act, msg) => btn && btn.addEventListener('click', () => {
        if (!can()) return;
        act();
        if (typeof showToast === 'function') showToast(msg);
        if (typeof _haptics !== 'undefined') _haptics.trigger('light');
    });
    historyBtn($.undoBtn, () => paintController.canUndo(), () => paintController.undo(), 'Undo');
    historyBtn($.redoBtn, () => paintController.canRedo(), () => paintController.redo(), 'Redo');
    syncUndoRedoBtns();

    // ─── The margin: shown or hidden; the plate re-fits either way ───
    function toggleMargin(force) {
        const open = force !== undefined ? force : $.atlas.classList.contains('margin-closed');
        $.atlas.classList.toggle('margin-closed', !open);
        if ($.menuBtn) $.menuBtn.setAttribute('aria-expanded', String(open));
        const had = document.activeElement;
        if ($.marginOpen) { $.marginOpen.hidden = open; $.marginOpen.setAttribute('aria-expanded', String(open)); }
        requestAnimationFrame(() => { resize(); wakeRenders(); });
        // a button that hides itself hands the focus to its counterpart
        if (!open && had === $.menuBtn && $.marginOpen) $.marginOpen.focus();
        if (open && had === $.marginOpen && $.menuBtn) $.menuBtn.focus();
    }
    if ($.menuBtn) $.menuBtn.addEventListener('click', () => toggleMargin(false));
    if ($.marginOpen) $.marginOpen.addEventListener('click', () => toggleMargin(true));

    // Panels render only while visible; a visibility flip re-renders them.
    function wakeRenders() {
        statsDirty = strainsDirty = tsDirty = true;
        if (ts) ts.resize();
        if (spacetime) spacetime.resize();
        requestFrame();
    }
    if ($.dashboard) {
        $.dashboard.addEventListener('click', (e) => {
            if (e.target && e.target.classList && e.target.classList.contains('tab-btn')) wakeRenders();
        });
    }

    function resize() {
        camera.resize();
        if (ts) { ts.resize(); tsDirty = true; }
        if (spacetime) spacetime.resize();
        markState();
    }
    window.addEventListener('resize', resize);
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => resize()).observe(canvas);
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else start(); });

    // Canvas text is Newsreader; redraw once the face has loaded.
    if (typeof _loadTextFonts === 'function') _loadTextFonts().then(() => { markState(); tsDirty = true; requestFrame(); });

    window.__miasma = {
        sim, params, toggles, history, tickOnce, iso, plate,
        get strains() { return strains; },
        paint: paintController, PaintMode,
        setPlaying, openScene, applyScene, Topology, Compartment,
        viewport: () => getEffectiveViewport()
    };

    if ($.timeseriesPanel && $.timeseriesCanvas) ts = initTimeseries($.timeseriesPanel, $.timeseriesCanvas);
    if ($.roseCaption) $.roseCaption.textContent = `Rose · ${ROSE_PERIOD}-day wedges`;
    if ($.spacetimePanel && $.spacetimeCanvas) spacetime = createSpacetime($.spacetimePanel, $.spacetimeCanvas);
    if ($.spacetimeCaption) $.spacetimeCaption.textContent = 'Space against time · the centre row, A to A′';

    resize();
    openScene(reducedMotion);
    updateStats();
    if (ui && ui.resetUI) ui.resetUI();
    camera.refreshBaseViewport();
    setPlaying(!reducedMotion);
}

if (typeof window !== 'undefined' && document.readyState !== 'loading') init();
else if (typeof window !== 'undefined') window.addEventListener('DOMContentLoaded', () => init());
