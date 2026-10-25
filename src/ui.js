// ui.js — the margin's controls.
// The surface picker draws each surface as a topology textbook draws a
// fundamental polygon: the world hexagon with chevrons on glued edges
// (one, two or three per pair; agreeing for a translation, opposed for a
// twist), hachured shores on open ones and circles at cone points, from the
// same tables the plate uses. Settings holds presets, the map view, the
// toggles and the advanced parameters; the transport row's eye jumps there.

import { topoFromString, topoToString, ViewMode, WORLD_RADII, worldCells } from './config.js';
import { SURFACES, cornerCones } from './topology.js';
import { buildSettingsPanel, syncSliders } from './params.js';
import { buildTogglesPanel, syncToggles } from './toggles.js';
import { buildInterventionsPanel } from './paint.js';
import { buildExperimentStrip } from './presets.js';

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
 * Wire the margin's controls. `$` is main.js's DOM cache; `sim` is mutated
 * by the callbacks. Returns { resetUI, showAbout }.
 */
export function setupUI($, sim, hooks) {
    hooks = hooks || {};

    // ── Surface picker ──
    const surfaceBtns = $.topologyToggles ? [...$.topologyToggles.querySelectorAll('.surface-btn')] : [];
    function syncSurface() {
        const key = topoToString(sim.topology);
        surfaceBtns.forEach((b) => {
            const on = b.dataset.topology === key;
            b.setAttribute('aria-checked', String(on));
            b.tabIndex = on ? 0 : -1;
        });
    }
    surfaceBtns.forEach((b, i) => {
        b.prepend(surfaceGlyph(topoFromString(b.dataset.topology)));
        b.addEventListener('click', () => {
            const t = topoFromString(b.dataset.topology);
            if (t === sim.topology) return;
            sim.topology = t;
            syncSurface();
            if (typeof _haptics !== 'undefined') _haptics.trigger('selection');
            if (hooks.onTopologyChange) hooks.onTopologyChange(t);
        });
        b.addEventListener('keydown', (e) => {
            const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
            if (!d) return;
            e.preventDefault();
            const next = surfaceBtns[(i + d + surfaceBtns.length) % surfaceBtns.length];
            next.focus();
            next.click();
        });
    });
    syncSurface();

    // ── Map view ──
    if ($.viewModeToggles) {
        window._forms.bindModeGroup($.viewModeToggles, 'viewmode', (val) => {
            sim.viewMode = val || ViewMode.COMPARTMENT;
            if (hooks.onViewModeChange) hooks.onViewModeChange(sim.viewMode);
        });
    }

    const mapControlsEl = $.mapControls || null;

    // ── The experiment strip: preset, knob, description ──
    const strip = buildExperimentStrip(document.getElementById('experiment'), {
        onApply: (key) => { if (hooks.onApplyPreset) hooks.onApplyPreset(key); },
        onKnob: (key, value, knob) => { if (hooks.onKnob) hooks.onKnob(key, value, knob); }
    });

    // ── Settings: presets, map view, toggles, parameters ──
    let togglesEl = null, paramsEl = null;
    const panelEl = hooks.settingsPanelEl;
    if (panelEl) {
        while (panelEl.firstChild) panelEl.removeChild(panelEl.firstChild);
        const section = (cls) => { const d = document.createElement('div'); d.className = 'settings-section ' + cls; panelEl.appendChild(d); return d; };
        if (mapControlsEl) panelEl.appendChild(mapControlsEl);
        buildWorldPicker(section('settings-world'));
        togglesEl = section('settings-toggles');
        paramsEl = section('settings-params');
        if (hooks.toggles) buildTogglesPanel(togglesEl, hooks.toggles, (key, value) => { if (hooks.onTogglesChange) hooks.onTogglesChange(key, value); });
        if (hooks.params) buildSettingsPanel(paramsEl, hooks.params, hooks.onParamChange);
    }

    // ── World size: cells in the world; a new size starts the run again ──
    function buildWorldPicker(el) {
        const head = document.createElement('div');
        head.className = 'toggles-section-header';
        head.textContent = 'World';
        const group = document.createElement('div');
        group.className = 'mode-toggles inline-mode-toggles';
        group.setAttribute('role', 'group');
        group.setAttribute('aria-label', 'World size, in cells');
        for (const R of WORLD_RADII) {
            const b = document.createElement('button');
            b.className = 'mode-btn' + (R === sim.R ? ' active' : '');
            b.dataset.world = String(R);
            b.textContent = worldCells(R).toLocaleString('en-US');
            b.title = worldCells(R).toLocaleString('en-US') + ' cells, ' + R + ' from the centre to an edge';
            group.appendChild(b);
        }
        const hint = document.createElement('p');
        hint.className = 'panel-hint';
        hint.textContent = 'Cells in the world. A new size starts the run again; zoom in to read a large one.';
        el.append(head, group, hint);
        window._forms.bindModeGroup(group, 'world', (val) => {
            if (hooks.onWorldChange) hooks.onWorldChange(parseInt(val, 10));
        });
    }

    // The transport eye opens Settings at the map view.
    if ($.viewModeBtn) {
        $.viewModeBtn.addEventListener('click', () => {
            if ($.atlas && $.atlas.classList.contains('margin-closed') && $.marginOpen) $.marginOpen.click();
            const tab = $.dashboard ? $.dashboard.querySelector('.tab-btn[data-tab="settings"]') : null;
            if (tab && !tab.classList.contains('active')) tab.click();
            if (mapControlsEl) requestAnimationFrame(() => mapControlsEl.scrollIntoView({ block: 'nearest' }));
        });
    }

    if (hooks.interventionsPanelEl && hooks.paintController) {
        buildInterventionsPanel(hooks.interventionsPanelEl, hooks.paintController, hooks.onPaintChange || null);
    }

    if ($.resetBtn && hooks.onReset) $.resetBtn.addEventListener('click', () => hooks.onReset());

    // ── About panel ──
    let about = null;
    if (typeof window.initAboutPanel === 'function') {
        about = window.initAboutPanel({
            title: 'Miasma',
            description:
                'A stochastic epidemic on a hexagonal world, drawn as a plate from an epidemiological atlas. ' +
                'Glue the world\'s edges into a plane, torus, Klein bottle or projective plane, seed cases, ' +
                'paint interventions, and read the outbreak in its isochrones, Nightingale\'s rose and the phylogeny of its strains.',
            controls: [
                { label: 'Seed or paint', value: 'Click or drag on the plate, the faded copies included' },
                { label: 'Zoom', value: 'Scroll, pinch, or = - 0' },
                { label: 'Pan', value: 'Two-finger drag' },
                { label: 'Undo', value: 'Ctrl+Z / Ctrl+Shift+Z, until the next day' }
            ],
            shortcuts: sim._shortcuts || [],
            repo: 'https://github.com/a9lim/a9lim.github.io',
            lastUpdated: '2026-10-25'
        });
    }

    return {
        showAbout() { if (about && about.show) about.show(); },
        // Show the preset the plate is running (null: the sandbox defaults).
        showPreset(key) {
            strip.show(key, hooks.params);
        },
        // Re-sync the controls to the live params, toggles, surface and view
        // after a reset or a preset.
        resetUI() {
            if (togglesEl && hooks.toggles) syncToggles(togglesEl, hooks.toggles);
            if (paramsEl && hooks.params) syncSliders(paramsEl, hooks.params);
            syncSurface();
            if ($.viewModeToggles) {
                let active = null;
                $.viewModeToggles.querySelectorAll('.mode-btn').forEach((b) => {
                    const on = b.dataset.viewmode === (sim.viewMode || ViewMode.COMPARTMENT);
                    b.classList.toggle('active', on);
                    b.setAttribute('aria-selected', String(on));
                    if (on) active = b;
                });
                const ind = $.viewModeToggles.querySelector('.mode-indicator');
                if (ind && active) { ind.style.width = active.offsetWidth + 'px'; ind.style.transform = 'translateX(' + (active.offsetLeft - 3) + 'px)'; }
            }
        }
    };
}
