// chains.js — the Counts tab's Fig. 4: chains of infection by size.
//
// A chain is a tree of who infected whom (descent.js), from a case placed by
// hand or a spillover from an animal to every case that descends from it; it
// closes with its last case. A subcritical chain stutters out after a few
// cases, and the sizes of closed chains follow the branching process's
// distribution, a power law with exponent −3/2 near its threshold; the mean
// is 1/(1 − R) for offspring mean R (Blumberg & Lloyd-Smith 2013 estimate R
// from exactly this). The figure plots the chains closed over the last
// SPAN_DAYS on log–log axes: sizes binned by doubling (1, 2–3, 4–7, …), each
// bin's count over its width, so a power law is a straight line, and a dashed
// guide of slope −3/2 runs from the first point: a critical chain's sizes lie
// along it, a subcritical one's fall away below.
//
// createChains(panel, canvas) → { render(grid), resize(), stats(grid) }

/** Days of closed chains the figure and the caption read. */
export const SPAN_DAYS = 365;

/**
 * Chains closed in the last SPAN_DAYS (at most the log's ring of them), those
 * rooted at source `src` if given (descent.js SRC_*): { n, mean, max, bins }
 * with bins[b] the chains of size 2^b … 2^(b+1) − 1.
 */
export function chainStats(d, src) {
    const ring = d.treeSize.length, first = Math.max(0, d.trees - ring), bins = [];
    let n = 0, sum = 0, max = 0;
    for (let k = d.trees - 1; k >= first; k--) {
        const t = k % ring;
        if (d.treeTick[t] <= d.now - SPAN_DAYS) break;
        if (src !== undefined && d.treeSrc[t] !== src) continue;
        const s = d.treeSize[t], b = 31 - Math.clz32(s);
        while (bins.length <= b) bins.push(0);
        bins[b]++; n++; sum += s;
        if (s > max) max = s;
    }
    return { n, mean: n ? sum / n : NaN, max, bins };
}

export function createChains(panelEl, canvasEl) {
    const ctx = canvasEl.getContext('2d');
    let w = 0, h = 0, dpr = 1;

    function resize() {
        const r = canvasEl.getBoundingClientRect();
        if (!r.width) return;
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        w = r.width; h = r.height || r.width * 0.62;
        canvasEl.width = Math.round(w * dpr);
        canvasEl.height = Math.round(h * dpr);
    }

    const GUTTER_L = 34, GUTTER_B = 30, PAD_T = 8, PAD_R = 8;

    function render(grid) {
        if (!w) resize();
        if (!w || !panelEl.closest('.tab-panel.active')) return;
        const P = _themePalette();
        const n2 = (hex) => { const v = parseInt(hex.slice(1), 16); return `${(v >> 16) & 255},${(v >> 8) & 255},${v & 255}`; };
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        const x0 = GUTTER_L, y0 = PAD_T, pw = w - GUTTER_L - PAD_R, ph = h - PAD_T - GUTTER_B;
        if (pw <= 10 || ph <= 10) return;
        const st = grid ? chainStats(grid.descent) : { n: 0, bins: [] };
        // sizes 1 … 10^4 at least, further while a chain is longer; chains per
        // size from 10^−2 (or the least) to the most
        const decX = Math.max(4, Math.ceil(Math.log10(Math.max(2, st.max || 1) + 1)));
        const dens = st.bins.map((c, b) => c / (1 << b)), seen = dens.filter((v) => v > 0);
        const top = Math.max(1, ...dens), decY1 = Math.max(1, Math.ceil(Math.log10(top)));
        const decY0 = Math.min(-2, Math.floor(Math.log10(Math.min(1, ...seen))));
        const X = (s) => x0 + pw * Math.log10(s) / decX;
        const Y = (v) => y0 + ph * (1 - (Math.log10(v) - decY0) / (decY1 - decY0));
        const ink = `rgba(${n2(P.text)},`;
        ctx.strokeStyle = ink + '0.24)'; ctx.lineWidth = 1;
        ctx.strokeRect(x0 - 0.5, y0 - 0.5, pw + 1, ph + 1);
        ctx.fillStyle = P.textMuted; ctx.font = `11px ${_FONT.text}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        for (let e = 0; e <= decX; e++) {
            const x = X(10 ** e);
            ctx.beginPath(); ctx.moveTo(x, y0 + ph); ctx.lineTo(x, y0 + ph + 3); ctx.stroke();
            ctx.fillText(e < 4 ? String(10 ** e) : `10${sup(e)}`, x, y0 + ph + 5);
        }
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        for (let e = decY0; e <= decY1; e++) {
            const y = Y(10 ** e);
            ctx.beginPath(); ctx.moveTo(x0 - 3, y); ctx.lineTo(x0, y); ctx.stroke();
            ctx.fillText(e >= 0 && e < 4 ? String(10 ** e) : `10${sup(e)}`, x0 - 5, y);
        }
        ctx.font = `italic 11px ${_FONT.text}`; ctx.textBaseline = 'alphabetic';
        ctx.textAlign = 'right'; ctx.fillText('cases in the chain', x0 + pw, h - 2);
        ctx.fillText('chains per size', x0 + pw - 5, y0 + 13);
        // the measured sizes: each bin a dot at its geometric middle, joined
        const pts = [];
        dens.forEach((v, b) => { if (v > 0) pts.push([X(Math.sqrt((1 << b) * ((2 << b) - 1))), Y(v)]); });
        if (pts.length && dens[0] > 0) {
            // the critical branching process's −3/2, from the first point
            const [gx, gy] = pts[0], x1 = x0 + pw, y1 = Y(dens[0] * (10 ** decX) ** -1.5);
            ctx.save();
            ctx.beginPath(); ctx.rect(x0, y0, pw, ph); ctx.clip();
            ctx.setLineDash([3, 3]); ctx.strokeStyle = ink + '0.32)'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(x1, y1); ctx.stroke();
            ctx.restore();
            const lx = x0 + pw * 0.62, ly = gy + (y1 - gy) * (lx - gx) / (x1 - gx);
            if (ly > y0 + 20 && ly < y0 + ph - 8) {
                ctx.fillStyle = P.textMuted; ctx.font = `italic 11px ${_FONT.text}`; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
                ctx.fillText('−3/2', lx + 3, ly - 3);
            }
        }
        if (pts.length) {
            ctx.strokeStyle = ink + '0.5)'; ctx.lineWidth = 1;
            ctx.beginPath(); pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
            ctx.fillStyle = P.accent;
            ctx.beginPath(); for (const [x, y] of pts) { ctx.moveTo(x + 2.6, y); ctx.arc(x, y, 2.6, 0, Math.PI * 2); } ctx.fill();
        }
        // the mean, a tick on the size axis
        if (st.n) {
            const x = X(st.mean);
            ctx.strokeStyle = P.accent; ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.moveTo(x, y0 + ph - 6); ctx.lineTo(x, y0 + ph); ctx.stroke();
        }
    }

    return { render, resize };
}

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
function sup(e) { return (e < 0 ? '⁻' : '') + String(Math.abs(e)).split('').map((c) => SUP[+c]).join(''); }
