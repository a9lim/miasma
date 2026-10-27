// ui.js — wires the controls around the plate and in its margin.
//
// On the plate: the view picker and the run tools over it, the brush rail on
// its left (paint.js), the zoom beside the scale bar (main.js), and under it
// the experiment's knob beside the caption (presets.js). In the margin:
// Experiments (the list of plates, the surface, the world), Counts, Strains
// and Model (model.js).
//
// The surface picker draws each surface as a topology textbook draws a
// fundamental polygon: the world hexagon with chevrons on glued edges
// (one, two or three per pair; agreeing for a translation, opposed for a
// twist), hachured shores on open ones and circles at cone points, from the
// same tables the plate uses.

import { topoFromString, topoToString, ViewMode, WORLD_RADII, worldCells } from './config.js';
import { SURFACES, cornerCones } from './topology.js';
import { buildBrushRail } from './paint.js';
import { buildExperimentList, buildKnob, modelChanged } from './presets.js';
import { buildModel } from './model.js';

const SVGNS = 'http://www.w3.org/2000/svg';

/** SVG glyph of a surface's gluing. */
export function surfaceGlyph(topology) {
    const S = SURFACES[topology], R = 16;
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '-23 -20 46 40');
    svg.setAttribute('aria-hidden', 'true');
    const el = (name, attrs) => {
        const e = document.createElementNS(SVGNS, name);
        for (const k in attrs) e.setAttribute(k, attrs[k]);
        svg.appendChild(e);
        return e;
    };
    const pt = (k) => [R * Math.cos(k * Math.PI / 3), R * Math.sin(k * Math.PI / 3)];
    const pairOf = new Array(6).fill(null);
    S.pairs.forEach(([e, f, kind], n) => { pairOf[e] = { n: n + 1, kind, first: true }; pairOf[f] = { n: n + 1, kind, first: false }; });
    for (let k = 0; k < 6; k++) {
        const [x0, y0] = pt(k), [x1, y1] = pt(k + 1), p = pairOf[k];
        const nx = Math.cos((60 * k + 30) * Math.PI / 180), ny = Math.sin((60 * k + 30) * Math.PI / 180);
        if (!p) {
            el('line', { x1: x0, y1: y0, x2: x1, y2: y1, stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round' });
            let d = '';
            for (const u of [0.25, 0.5, 0.75]) {
                const x = x0 + (x1 - x0) * u, y = y0 + (y1 - y0) * u;
                d += `M${(x + nx * 1.6).toFixed(2)} ${(y + ny * 1.6).toFixed(2)}L${(x + nx * 4.2).toFixed(2)} ${(y + ny * 4.2).toFixed(2)}`;
            }
            el('path', { d, stroke: 'currentColor', 'stroke-width': 0.9, opacity: 0.6 });
            continue;
        }
        el('line', { x1: x0, y1: y0, x2: x1, y2: y1, stroke: 'currentColor', 'stroke-width': 0.8, opacity: 0.55 });
        let tx = x1 - x0, ty = y1 - y0;
        const L = Math.hypot(tx, ty); tx /= L; ty /= L;
        if (!p.first && p.kind === 'translate') { tx = -tx; ty = -ty; }
        const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
        let d = '';
        for (let i = 0; i < p.n; i++) {
            const o = (i - (p.n - 1) / 2) * 2.6;
            const cx = mx + tx * o, cy = my + ty * o;
            d += `M${(cx - tx * 1.3 - ty * 2.2).toFixed(2)} ${(cy - ty * 1.3 + tx * 2.2).toFixed(2)}` +
                 `L${(cx + tx * 1.2).toFixed(2)} ${(cy + ty * 1.2).toFixed(2)}` +
                 `L${(cx - tx * 1.3 + ty * 2.2).toFixed(2)} ${(cy - ty * 1.3 - tx * 2.2).toFixed(2)}`;
        }
        el('path', { d, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.1, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    }
    if (S.closed) {
        cornerCones(topology, 59).forEach((angles, k) => {
            if (!angles.length) return;
            const [x, y] = pt(k);
            el('circle', { cx: x, cy: y, r: 1.7, fill: 'var(--bg-canvas)', stroke: 'currentColor', 'stroke-width': 0.9 });
        });
    }
    return svg;
}

/**
 * A group of role="radio" buttons: clicking one checks it, arrow keys move
 * the choice. `pick(button)` is called on a change. Returns set(match).
 */
function radioGroup(btns, pick) {
    const set = (match) => btns.forEach((b) => {
        const on = match(b);
        b.setAttribute('aria-checked', String(on));
        b.tabIndex = on ? 0 : -1;
    });
    btns.forEach((b, i) => {
        b.addEventListener('click', () => {
            if (b.getAttribute('aria-checked') === 'true') return;
            set((x) => x === b);
            pick(b);
        });
        b.addEventListener('keydown', (e) => {
            const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
            if (!d) return;
            e.preventDefault();
            const next = btns[(i + d + btns.length) % btns.length];
            next.focus();
            next.click();
        });
    });
    return set;
}

/**
 * Wire the controls. `$` is main.js's DOM cache; `sim` is mutated by the
 * callbacks. Returns { resetUI, showAbout, showPreset, model }.
 */
export function setupUI($, sim, hooks) {
    hooks = hooks || {};
    const haptic = (k) => { if (typeof _haptics !== 'undefined') _haptics.trigger(k); };

    // ── Surface picker (Experiments) ──
    const surfaceBtns = $.topologyToggles ? [...$.topologyToggles.querySelectorAll('.surface-btn')] : [];
    surfaceBtns.forEach((b) => b.prepend(surfaceGlyph(topoFromString(b.dataset.topology))));
    const setSurface = radioGroup(surfaceBtns, (b) => {
        sim.topology = topoFromString(b.dataset.topology);
        haptic('selection');
        if (hooks.onTopologyChange) hooks.onTopologyChange(sim.topology);
    });
    function syncSurface() {
        const key = topoToString(sim.topology);
        setSurface((b) => b.dataset.topology === key);
    }

    // ── Map view, over the plate ──
    const viewBtns = $.viewModeToggles ? [...$.viewModeToggles.querySelectorAll('.view-btn')] : [];
    const setView = radioGroup(viewBtns, (b) => {
        sim.viewMode = b.dataset.viewmode || ViewMode.COMPARTMENT;
        haptic('selection');
        if (hooks.onViewModeChange) hooks.onViewModeChange(sim.viewMode);
    });
    const syncView = () => setView((b) => b.dataset.viewmode === (sim.viewMode || ViewMode.COMPARTMENT));

    // ── World size (Experiments): a new size starts the run again ──
    const worldBtns = [];
    if ($.worldPicker) {
        for (const R of WORLD_RADII) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'word-btn';
            b.setAttribute('role', 'radio');
            b.dataset.world = String(R);
            b.textContent = worldCells(R).toLocaleString('en-US');
            b.title = 'Radius ' + R;
            $.worldPicker.appendChild(b);
            worldBtns.push(b);
        }
    }
    const setWorld = radioGroup(worldBtns, (b) => { if (hooks.onWorldChange) hooks.onWorldChange(parseInt(b.dataset.world, 10)); });
    const syncWorld = () => setWorld((b) => b.dataset.world === String(sim.R));

    // ── The list of plates, and the knob under the plate ──
    const list = buildExperimentList($.experimentList, {
        onApply: (key) => { if (hooks.onApplyPreset) hooks.onApplyPreset(key); },
        onRestore: () => { if (hooks.onRestore) hooks.onRestore(); }
    });
    const knob = buildKnob($.knob, {
        onKnob: (key, value, k) => { if (hooks.onKnob) hooks.onKnob(key, value, k); }
    });

    // ── Model ──
    const model = buildModel($.modelPanel, {
        params: hooks.params, toggles: hooks.toggles,
        onParam: (key, value, spec) => { if (hooks.onParam) hooks.onParam(key, value, spec); },
        onToggle: (key, value) => { if (hooks.onTogglesChange) hooks.onTogglesChange(key, value); },
        onDisplay: (key, value) => { if (hooks.onTogglesChange) hooks.onTogglesChange(key, value); },
        onRestore: () => { if (hooks.onRestore) hooks.onRestore(); }
    });

    // ── Brushes, on the plate ──
    if ($.brushRail && hooks.paintController) buildBrushRail($.brushRail, hooks.paintController, hooks.onPaintChange || null);

    if ($.resetBtn && hooks.onReset) $.resetBtn.addEventListener('click', () => hooks.onReset());

    // ── About panel ──
    let about = null;
    if (typeof window.initAboutPanel === 'function') {
        about = window.initAboutPanel({
            title: 'Miasma',
            description:
                'A stochastic epidemic on a hexagonal world, drawn as a plate from an epidemiological atlas. ' +
                'Run six experiments, each with one knob and a measured number; glue the world\'s edges into a plane, torus, Klein bottle or projective plane; ' +
                'paint interventions; and read the outbreak in its isochrones, Nightingale\'s rose, the phylogeny of its strains and the diagram of its model.',
            controls: [
                { label: 'Seed or paint', value: 'Choose a brush on the plate\'s left, then click or drag, the faded copies included' },
                { label: 'Zoom', value: 'Scroll, pinch, or = - 0' },
                { label: 'Pan', value: 'Two-finger drag' },
                { label: 'Undo', value: 'Ctrl+Z / Ctrl+Shift+Z, until the next day' }
            ],
            shortcuts: sim._shortcuts || [],
            repo: 'https://github.com/a9lim/a9lim.github.io',
            lastUpdated: '2026-10-26'
        });
    }

    return {
        model,
        showAbout() { if (about && about.show) about.show(); },
        // Show the experiment the plate is running (null: the sandbox), and
        // whether its model has been changed.
        showPreset(key) {
            list.show(key, modelChanged(key, hooks.params, hooks.toggles));
            knob.show(key, hooks.params);
        },
        // Re-sync the controls to the live params, toggles, surface, view and
        // world after a restart or an experiment.
        resetUI() {
            model.sync();
            syncSurface();
            syncView();
            syncWorld();
        }
    };
}
