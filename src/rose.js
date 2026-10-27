// rose.js — the Counts tab's figure: Nightingale's rose of 1858.
//
// Florence Nightingale drew the deaths in the army in the East as a polar-area
// diagram, one wedge per month and the area of each wedge proportional to the
// count, with two roses for two years side by side. Here a wedge is ten days
// and its area counts the events in them: new exposures (pale red), recoveries
// (stipple) and deaths (cross-hatched), overlaid from the center, largest at
// the back, as she overlaid her three causes. A fourth series, arrivals in Z
// (zombies, or transformed cells), is hatched in the plate's sap and appears
// only when the current rose holds any. A rose is twelve wedges, 120
// days, filling clockwise from nine o'clock; the previous rose stands beside
// it at the same scale, so the two can be compared.
//
// API (same as the stacked-area chart it replaces): initTimeseries(panel,
// canvas) → { push(stats, counts), render(), resize(), clear() }.

export const ROSE_PERIOD = 10;
export const ROSE_WEDGES = 12;
const SPAN = ROSE_PERIOD * ROSE_WEDGES;

export function initTimeseries(panelEl, canvasEl) {
    const ctx = canvasEl.getContext('2d');
    // per wedge: [exposures, recoveries, deaths, Z arrivals]; index = floor(tick / period)
    let wedges = [];
    let lastTick = 0;
    let w = 0, h = 0, dpr = 1;

    function resize() {
        const r = canvasEl.getBoundingClientRect();
        if (!r.width) return;
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        w = r.width; h = r.height || r.width;
        canvasEl.width = Math.round(w * dpr);
        canvasEl.height = Math.round(h * dpr);
    }

    function push(tick, counts) {
        const t = tick || 0;
        lastTick = t;
        if (!counts || t <= 0) return;
        const k = Math.floor((t - 1) / ROSE_PERIOD);
        while (wedges.length <= k) wedges.push([0, 0, 0, 0]);
        const wv = wedges[k];
        wv[0] += counts.sToE || 0;
        wv[1] += counts.iToR || 0;
        wv[2] += counts.iToD || 0;
        wv[3] += (counts.dToZ || 0) + (counts.iToZ || 0) + (counts.lToZ || 0) + (counts.zInfect || 0);
    }

    function clear() { wedges = []; lastTick = 0; }

    // the scale spans the current rose and the one before it
    const roseFrom = () => Math.floor(Math.max(0, lastTick - 1) / SPAN) * ROSE_WEDGES;
    const shownFrom = () => Math.max(0, roseFrom() - ROSE_WEDGES);

    function render() {
        if (!w) resize();
        if (!w || !panelEl.closest('.tab-panel.active')) return;
        const t = plateColors();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        const cur = Math.floor(Math.max(0, lastTick - 1) / SPAN);
        const first = cur * ROSE_WEDGES;
        let max = 1;
        for (let k = shownFrom(); k < wedges.length; k++) for (const v of wedges[k]) if (v > max) max = v;
        const R = Math.min(w, h) * 0.39, cx = w / 2, cy = h * 0.5;
        // the previous 120 days, at the same scale: a dashed envelope behind
        if (cur > 0) drawEnvelope(t, cx, cy, R, first - ROSE_WEDGES, max);
        drawRose(t, cx, cy, R, first, max, true);
    }

    function drawEnvelope(t, cx, cy, R, first, max) {
        const step = Math.PI * 2 / ROSE_WEDGES;
        ctx.setLineDash([2, 2.5]); ctx.strokeStyle = t.rule; ctx.lineWidth = 0.9;
        ctx.beginPath();
        for (let i = 0; i < ROSE_WEDGES; i++) {
            const v = wedges[first + i];
            if (!v) continue;
            const r = R * Math.sqrt(Math.max(v[0], v[1], v[2], v[3]) / max), a0 = Math.PI + i * step;
            ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, a0, a0 + step); ctx.closePath();
        }
        ctx.stroke();
        ctx.setLineDash([]);
    }

    function drawRose(t, cx, cy, R, first, max, labels) {
        const step = Math.PI * 2 / ROSE_WEDGES;
        // faint guide: the rim the largest wedge would reach
        ctx.strokeStyle = t.ruleSoft; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
        ctx.font = `italic 11px ${_FONT.text}`; ctx.fillStyle = t.muted; ctx.textAlign = 'center';
        ctx.fillText(`days ${first * ROSE_PERIOD}–${(first + ROSE_WEDGES) * ROSE_PERIOD}`, cx, cy + R + 24);
        for (let i = 0; i < ROSE_WEDGES; i++) {
            const a0 = Math.PI + i * step, a1 = a0 + step;
            const v = wedges[first + i];
            if (labels && i % 3 === 0) {
                const am = a0;
                ctx.font = `11px ${_FONT.text}`; ctx.fillStyle = t.muted; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(String((first + i) * ROSE_PERIOD), cx + Math.cos(am) * (R + 11), cy + Math.sin(am) * (R + 11));
                ctx.textBaseline = 'alphabetic';
            }
            if (!v) continue;
            const order = [0, 1, 2, 3].sort((p, q) => v[q] - v[p]);
            for (const c of order) {
                if (!v[c]) continue;
                const r = R * Math.sqrt(v[c] / max);
                ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, a0, a1); ctx.closePath();
                if (c === 0) { ctx.fillStyle = t.exposed; ctx.fill(); }
                else {
                    ctx.save(); ctx.clip();
                    ctx.fillStyle = t.paper; ctx.fill();
                    if (c === 3) {
                        // the plate's Z: a sap tint under wide cross-hatching
                        ctx.fillStyle = t.zombieTint; ctx.fill();
                        ctx.strokeStyle = t.zombie; ctx.lineWidth = 0.9;
                        ctx.beginPath();
                        for (let s = -R; s <= R; s += 4.5) { ctx.moveTo(cx + s - R, cy - R); ctx.lineTo(cx + s + R, cy + R); ctx.moveTo(cx + s + R, cy - R); ctx.lineTo(cx + s - R, cy + R); }
                        ctx.stroke();
                    } else if (c === 1) {
                        ctx.fillStyle = t.stipple;
                        for (let k = 0; k < 220 * (r / R) ** 2 + 4; k++) {
                            const rr = r * Math.sqrt(hash(first + i, k)), aa = a0 + step * hash(k, first + i + 99);
                            ctx.fillRect(cx + Math.cos(aa) * rr - 0.6, cy + Math.sin(aa) * rr - 0.6, 1.2, 1.2);
                        }
                    } else {
                        ctx.strokeStyle = t.cross; ctx.lineWidth = 0.8;
                        ctx.beginPath();
                        for (let s = -R; s <= R; s += 3) { ctx.moveTo(cx + s - R, cy - R); ctx.lineTo(cx + s + R, cy + R); ctx.moveTo(cx + s + R, cy - R); ctx.lineTo(cx + s - R, cy + R); }
                        ctx.stroke();
                    }
                    ctx.restore();
                }
                ctx.strokeStyle = c === 0 ? t.accent : t.rule; ctx.lineWidth = 0.8;
                ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, a0, a1); ctx.closePath(); ctx.stroke();
            }
        }
        // the current wedge, still filling
        if (labels && lastTick > 0) {
            const k = Math.floor((lastTick - 1) / ROSE_PERIOD) - first;
            if (k >= 0 && k < ROSE_WEDGES) {
                const a = Math.PI + (k + ((lastTick - 1) % ROSE_PERIOD + 1) / ROSE_PERIOD) * step;
                ctx.strokeStyle = t.accent; ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * (R - 4), cy + Math.sin(a) * (R - 4)); ctx.lineTo(cx + Math.cos(a) * (R + 3), cy + Math.sin(a) * (R + 3)); ctx.stroke();
            }
        }
    }

    return { push, render, resize, clear };
}

function hash(a, b) {
    let x = (a * 374761393 + b * 668265263) | 0;
    x = Math.imul(x ^ (x >>> 13), 1274126177);
    return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

function plateColors() {
    const P = _themePalette(), dark = document.documentElement.dataset.theme === 'dark';
    const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };
    return {
        paper: P.canvas, muted: P.textMuted, accent: P.accent,
        exposed: rgba(P.accent, dark ? 0.36 : 0.3),
        stipple: rgba(P.text, dark ? 0.7 : 0.62),
        cross: rgba(P.text, dark ? 0.7 : 0.66),
        zombie: P.inks.sap, zombieTint: rgba(P.inks.sap, 0.22),
        rule: rgba(P.text, 0.5), ruleSoft: rgba(P.text, 0.14)
    };
}
