// timeseries.js — bottom-panel compartment-count chart.
// Phase 6: ring buffer of per-tick compartment snapshots + two-mode canvas
// renderer (stacked area vs line overlay) + a mode-toggle button group in
// the panel header. Vanilla canvas 2D, no external dep.
//
// Ring buffer pushes happen from main.js inside tickOnce (one push per tick)
// so the chart's x-axis is "ticks ago" — not wall-clock seconds. At default
// tick rate (10/sec) the 500-sample cap covers ~50 seconds of sim time.
//
// Theme-aware: CSS vars are re-read every render so light↔dark theme flips
// take effect on the next render-dirty pass without a panel rebuild.

const HISTORY_CAP = 500;

// Stack order, bottom → top of each vertical slice:
//   alive baseline (S/M/V) at the bottom → sick (E/I) → outcomes (R/D) →
//   zombies + empty at the top. Mirrors the rough flow of an epidemic.
//   "empty" sits on top because it represents land that's been depopulated.
const STACK_ORDER = ['S', 'M', 'V', 'E', 'I', 'R', 'D', 'Z', 'empty'];

const COMPARTMENT_VAR = Object.freeze({
    S:     '--epi-s',
    E:     '--epi-e',
    I:     '--epi-i',
    R:     '--epi-r',
    D:     '--epi-d',
    V:     '--epi-v',
    M:     '--epi-m',
    Z:     '--epi-z',
    empty: '--bg-base'
});

function readColors() {
    const style = getComputedStyle(document.documentElement);
    const out = {};
    for (const key in COMPARTMENT_VAR) {
        const v = style.getPropertyValue(COMPARTMENT_VAR[key]).trim();
        out[key] = v || '#888';
    }
    return out;
}

/**
 * Wire the time-series panel.
 *
 * @param {HTMLElement} panelEl     — #timeseries-panel
 * @param {HTMLCanvasElement} canvasEl — #timeseries-canvas (will be reparented)
 * @param {{mode?: 'stacked'|'lines'}} [opts]
 * @returns {{
 *   push:    (stats: object) => void,   // call from tickOnce with computeStats output
 *   render:  () => void,                // call when tsDirty is true
 *   resize:  () => void,                // call on window resize / canvas resize
 *   setMode: (mode: 'stacked'|'lines') => void
 * }}
 */
export function initTimeseries(panelEl, canvasEl, opts) {
    opts = opts || {};
    let mode = opts.mode === 'lines' ? 'lines' : 'stacked';
    const ring = [];
    /** @type {CanvasRenderingContext2D | null} */
    let ctx = null;

    if (panelEl && canvasEl) {
        buildHeader(panelEl, canvasEl);
        ctx = canvasEl.getContext('2d');
    }

    function push(stats) {
        if (!stats) return;
        ring.push({
            tick:  stats.tick | 0,
            S:     stats.S | 0,
            E:     stats.E | 0,
            I:     stats.I | 0,
            R:     stats.R | 0,
            D:     stats.D | 0,
            V:     stats.V | 0,
            M:     stats.M | 0,
            Z:     stats.Z | 0,
            empty: stats.empty | 0,
            total: stats.total | 0
        });
        // Rolling cap. ring.shift() is O(n) but n ≤ 500 so it's cheap.
        while (ring.length > HISTORY_CAP) ring.shift();
    }

    function resize() {
        if (!canvasEl || !ctx) return;
        // resizeCanvasDPR is global from shared-utils.js — sets backing-store
        // dims and applies DPR transform so draws use CSS pixels.
        if (typeof window.resizeCanvasDPR === 'function') {
            window.resizeCanvasDPR(canvasEl, ctx);
        }
    }

    function setMode(m) {
        if (m !== 'stacked' && m !== 'lines') return;
        mode = m;
        render();
    }

    /** Drop all samples — used by main's reset path so the chart restarts clean. */
    function clear() {
        ring.length = 0;
    }

    function render() {
        if (!ctx || !canvasEl) return;
        const rect = canvasEl.getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;
        if (w === 0 || h === 0) return;

        ctx.clearRect(0, 0, w, h);
        if (ring.length === 0) return;

        const colors = readColors();
        if (mode === 'stacked') renderStacked(w, h, colors);
        else                    renderLines(w, h, colors);
    }

    function renderStacked(w, h, colors) {
        const n = ring.length;
        // Y-scale normalizes to the largest total population in the window —
        // important because births/disposal can shift total over time.
        let maxTotal = 0;
        for (let i = 0; i < n; i++) {
            if (ring[i].total > maxTotal) maxTotal = ring[i].total;
        }
        if (maxTotal === 0) return;

        const xStep = w / Math.max(n - 1, 1);

        // Running per-tick "top edge of the previous compartment". Starts at
        // canvas bottom and walks upward as we draw each compartment band.
        const yBottoms = new Float32Array(n);
        for (let i = 0; i < n; i++) yBottoms[i] = h;

        for (let k = 0; k < STACK_ORDER.length; k++) {
            const key = STACK_ORDER[k];
            // Build closed polygon: top edge left→right, bottom edge right→left.
            ctx.beginPath();
            for (let i = 0; i < n; i++) {
                const x = i * xStep;
                const segH = (ring[i][key] / maxTotal) * h;
                const yTop = yBottoms[i] - segH;
                if (i === 0) ctx.moveTo(x, yTop);
                else         ctx.lineTo(x, yTop);
            }
            for (let i = n - 1; i >= 0; i--) {
                ctx.lineTo(i * xStep, yBottoms[i]);
            }
            ctx.closePath();
            ctx.fillStyle = colors[key] || '#888';
            ctx.fill();

            // Walk yBottoms up for the next compartment in the stack.
            for (let i = 0; i < n; i++) {
                const segH = (ring[i][key] / maxTotal) * h;
                yBottoms[i] -= segH;
            }
        }
    }

    function renderLines(w, h, colors) {
        const n = ring.length;
        // Y-scale = max count across all compartments + ticks in the window.
        // EMPTY is intentionally NOT included in this max — it dominates the
        // chart on a freshly-reset grid and squishes everything else.
        let maxCount = 1;
        for (let i = 0; i < n; i++) {
            const s = ring[i];
            if (s.S > maxCount) maxCount = s.S;
            if (s.M > maxCount) maxCount = s.M;
            // Skip 'empty' from the y-scale. S is already the dominant alive
            // band so this keeps the chart legible.
        }
        // For line mode we usually care about the active disease compartments
        // more than the S baseline. Use a y-scale that prioritizes them:
        // ignore S as well when picking the scale, but draw it.
        let activeMax = 1;
        for (let i = 0; i < n; i++) {
            const s = ring[i];
            for (const key of ['E', 'I', 'R', 'D', 'V', 'M', 'Z']) {
                if (s[key] > activeMax) activeMax = s[key];
            }
        }
        // Final scale: use max(activeMax, S/20) so a tiny outbreak in a sea of
        // S doesn't draw S as a flat line clipped to the top.
        const yScale = Math.max(activeMax, maxCount / 20);

        const xStep = w / Math.max(n - 1, 1);

        ctx.lineWidth = 1.5;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        for (const key of STACK_ORDER) {
            if (key === 'empty') continue; // skip empty in line mode

            // Auto-track: skip compartments that are zero throughout the window.
            let any = false;
            for (let i = 0; i < n; i++) {
                if (ring[i][key] > 0) { any = true; break; }
            }
            if (!any) continue;

            ctx.beginPath();
            ctx.strokeStyle = colors[key] || '#888';
            for (let i = 0; i < n; i++) {
                const x = i * xStep;
                const v = ring[i][key];
                const y = h - Math.min(1, v / yScale) * h;
                if (i === 0) ctx.moveTo(x, y);
                else         ctx.lineTo(x, y);
            }
            ctx.stroke();
        }
    }

    function buildHeader(panelEl, canvasEl) {
        // Reparent the canvas into a .ts-canvas-wrap div so .ts-head can sit
        // above it. styles.css already has rules for both classes.
        const wrap = document.createElement('div');
        wrap.className = 'ts-canvas-wrap';
        canvasEl.parentNode.insertBefore(wrap, canvasEl);
        wrap.appendChild(canvasEl);

        const head = document.createElement('div');
        head.className = 'ts-head';

        const title = document.createElement('span');
        title.className = 'ts-title';
        title.textContent = 'Compartments';
        head.appendChild(title);

        const toggles = document.createElement('div');
        toggles.className = 'mode-toggles ts-mode-toggles';
        toggles.setAttribute('role', 'tablist');
        toggles.setAttribute('aria-label', 'Time-series view mode');

        const modes = [
            { key: 'stacked', label: 'Stacked' },
            { key: 'lines',   label: 'Lines'   }
        ];
        for (const m of modes) {
            const btn = document.createElement('button');
            const isActive = m.key === mode;
            btn.className = 'mode-btn' + (isActive ? ' active' : '');
            btn.dataset.ts = m.key;
            btn.setAttribute('role', 'tab');
            btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
            btn.textContent = m.label;
            toggles.appendChild(btn);
        }
        head.appendChild(toggles);
        panelEl.insertBefore(head, wrap);

        if (window._forms && typeof window._forms.bindModeGroup === 'function') {
            window._forms.bindModeGroup(toggles, 'ts', (val) => setMode(val));
        }
    }

    return { push, render, resize, setMode, clear };
}
