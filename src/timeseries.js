// timeseries.js — compartment-count chart.
// Phase 6 / Phase-15 polish: ring buffer of per-tick compartment snapshots
// rendered as a single stacked-area chart. The legacy line-overlay mode and
// its in-panel mode toggle were removed — stacked is the only view. The
// chart sits naked in its host panel: no glass background, no caption, no
// wrap div. Canvas fills the panel directly.
//
// Phase 17: the panel moved out of a floating bottom HUD bar and into the
// top of the sidebar's Compartments tab. Visibility is now gated on the host
// .tab-panel's `active` class rather than a `.hidden` flag.
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

// Cache CSS-var reads — getComputedStyle forces a sync style pass. Invalidate
// when the html[data-theme] attribute changes via a MutationObserver below.
let _colorCache = null;
let _colorCacheTheme = null;

function readColors() {
    const theme = document.documentElement.dataset.theme || '';
    if (_colorCache !== null && theme === _colorCacheTheme) return _colorCache;
    const style = getComputedStyle(document.documentElement);
    const out = {};
    for (const key in COMPARTMENT_VAR) {
        const v = style.getPropertyValue(COMPARTMENT_VAR[key]).trim();
        out[key] = v || '#888';
    }
    _colorCache = out;
    _colorCacheTheme = theme;
    return out;
}

if (typeof window !== 'undefined' && typeof MutationObserver !== 'undefined') {
    const mo = new MutationObserver(() => { _colorCache = null; });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

/**
 * Wire the time-series panel.
 *
 * @param {HTMLElement} panelEl     — #timeseries-panel
 * @param {HTMLCanvasElement} canvasEl — #timeseries-canvas (will be reparented)
 * @param {object} [opts] — reserved for future config (no current options)
 * @returns {{
 *   push:    (stats: object) => void,   // call from tickOnce with computeStats output
 *   render:  () => void,                // call when tsDirty is true
 *   resize:  () => void,                // call on window resize / canvas resize
 *   clear:   () => void                 // drop all ring samples on reset
 * }}
 */
export function initTimeseries(panelEl, canvasEl, opts) {
    opts = opts || {};
    const cols = {
        tick:  new Int32Array(HISTORY_CAP),
        S:     new Uint32Array(HISTORY_CAP),
        E:     new Uint32Array(HISTORY_CAP),
        I:     new Uint32Array(HISTORY_CAP),
        R:     new Uint32Array(HISTORY_CAP),
        D:     new Uint32Array(HISTORY_CAP),
        V:     new Uint32Array(HISTORY_CAP),
        M:     new Uint32Array(HISTORY_CAP),
        Z:     new Uint32Array(HISTORY_CAP),
        empty: new Uint32Array(HISTORY_CAP),
        total: new Uint32Array(HISTORY_CAP)
    };
    const yBottoms = new Float32Array(HISTORY_CAP);
    let head = 0;
    let length = 0;
    /** @type {CanvasRenderingContext2D | null} */
    let ctx = null;
    // Host .tab-panel — render bails when it isn't the active tab. classList
    // lookup is layout-free; reading offsetParent / getBoundingClientRect on a
    // display:none ancestor would force a sync layout flush.
    const hostPanel = panelEl ? panelEl.closest('.tab-panel') : null;

    if (panelEl && canvasEl) {
        ctx = canvasEl.getContext('2d');
    }

    function push(stats) {
        if (!stats) return;
        cols.tick[head] = stats.tick | 0;
        cols.S[head] = stats.S | 0;
        cols.E[head] = stats.E | 0;
        cols.I[head] = stats.I | 0;
        cols.R[head] = stats.R | 0;
        cols.D[head] = stats.D | 0;
        cols.V[head] = stats.V | 0;
        cols.M[head] = stats.M | 0;
        cols.Z[head] = stats.Z | 0;
        cols.empty[head] = stats.empty | 0;
        cols.total[head] = stats.total | 0;
        head = (head + 1) % HISTORY_CAP;
        if (length < HISTORY_CAP) length++;
    }

    function resize() {
        if (!canvasEl || !ctx) return;
        // resizeCanvasDPR is global from shared-utils.js — sets backing-store
        // dims and applies DPR transform so draws use CSS pixels.
        if (typeof window.resizeCanvasDPR === 'function') {
            window.resizeCanvasDPR(canvasEl, ctx);
        }
    }

    /** Drop all samples — used by main's reset path so the chart restarts clean. */
    function clear() {
        head = 0;
        length = 0;
    }

    function render() {
        if (!ctx || !canvasEl) return;
        // Skip when the Compartments tab isn't the active sidebar tab — the
        // panel is display:none then, so a draw would be invisible anyway and
        // getBoundingClientRect would force a layout flush. The width check
        // below still bails on zero-size canvases as a backstop.
        if (hostPanel && !hostPanel.classList.contains('active')) return;
        const rect = canvasEl.getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;
        if (w === 0 || h === 0) return;

        ctx.clearRect(0, 0, w, h);
        if (length === 0) return;

        renderStacked(w, h, readColors());
    }

    function renderStacked(w, h, colors) {
        const n = length;
        // Y-scale normalizes to the largest total population in the window —
        // important because births/disposal can shift total over time.
        let maxTotal = 0;
        for (let i = 0; i < n; i++) {
            const slot = sampleSlot(i);
            if (cols.total[slot] > maxTotal) maxTotal = cols.total[slot];
        }
        if (maxTotal === 0) return;

        // n=1 special case: with only one sample, the polygon path below is
        // zero-width (both polygon vertices land at x=0) and nothing visible
        // gets filled. Draw constant-value horizontal bands instead so the
        // initial seeded sample (pushed at page load before any tick fires)
        // is visible from page load, not just once the sim starts running.
        if (n === 1) {
            let yBot = h;
            const slot = sampleSlot(0);
            for (let k = 0; k < STACK_ORDER.length; k++) {
                const key = STACK_ORDER[k];
                const segH = (cols[key][slot] / maxTotal) * h;
                const yTop = yBot - segH;
                ctx.fillStyle = colors[key] || '#888';
                ctx.fillRect(0, yTop, w, segH);
                yBot = yTop;
            }
            return;
        }

        const xStep = w / Math.max(n - 1, 1);

        // Running per-tick "top edge of the previous compartment". Starts at
        // canvas bottom and walks upward as we draw each compartment band.
        for (let i = 0; i < n; i++) yBottoms[i] = h;

        for (let k = 0; k < STACK_ORDER.length; k++) {
            const key = STACK_ORDER[k];
            const col = cols[key];
            // Build closed polygon: top edge left→right, bottom edge right→left.
            ctx.beginPath();
            for (let i = 0; i < n; i++) {
                const slot = sampleSlot(i);
                const x = i * xStep;
                const segH = (col[slot] / maxTotal) * h;
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
                const slot = sampleSlot(i);
                const segH = (col[slot] / maxTotal) * h;
                yBottoms[i] -= segH;
            }
        }
    }

    function sampleSlot(i) {
        return length < HISTORY_CAP ? i : (head + i) % HISTORY_CAP;
    }

    return { push, render, resize, clear };
}
