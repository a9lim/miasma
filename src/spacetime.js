// spacetime.js — the Counts tab's Fig. 3: space against time.
//
// Hovmöller (1949) drew the troughs and ridges of the westerlies as position
// along a circle of latitude against time. Here the position is along the
// world's centre row, from its west corner (A on the plate) to its east (A′),
// and time runs down the figure over the last two years. Every new infection
// in a band of rows about the centre row inks its column on its day, by
// incidence: infections per cell of the band per day. The infections are the
// lineage log's events (descent.js), so recording visits only them, never
// every cell. A front travelling along the row is a V whose slope is its
// speed; a season is a horizontal band. In the Strain view each place and day
// takes the mark of the strain that last infected it there, hatched at its
// angle in its hue, so a sweep is a band where the mark changes.
//
// createSpacetime(panel, canvas) → { record(grid, reg, tick), render(strainView), resize(), clear(), day(t) }

import { hexBounds } from './topology.js';
import { angleCode, hueByte, hueColor, ANGLE_CODES } from './strain-style.js';
import { EMPTY_STRAIN } from './strains.js';

/** Days the figure spans. */
export const SPAN_DAYS = 730;

/** The band of rows about the centre row that the figure reads. */
export const bandOf = (R) => Math.max(2, Math.round(R / 16));

/**
 * The column (0 at A, 2R at A′) of cell i along the centre row of a W-wide
 * grid centred on (cq, cr), or −1 outside the band of `band` rows each side.
 */
export function columnOf(i, W, cq, cr, R, band) {
    const dr = ((i / W) | 0) - cr;
    if (dr > band || dr < -band) return -1;
    const col = Math.floor((i % W) - cq + dr / 2 + R + 0.5);
    return col < 0 ? 0 : (col > 2 * R ? 2 * R : col);
}

export function createSpacetime(panelEl, canvasEl) {
    const ctx = canvasEl.getContext('2d');
    let w = 0, h = 0, dpr = 1;
    let grid = null, W = 0, cq = 0, cr = 0, R = 0, C = 0, band = 0;
    let count = null, mark = null, rowTick = null, bandCells = null;
    let lastHead = 0, now = 0;

    function setup(g) {
        grid = g; W = g.W;
        ({ cq, cr, R } = hexBounds(g.W, g.H));
        C = 2 * R + 1; band = bandOf(R);
        count = new Uint16Array(SPAN_DAYS * C);
        mark = new Uint16Array(SPAN_DAYS * C);
        rowTick = new Int32Array(SPAN_DAYS).fill(-1);
        bandCells = new Uint16Array(C);
        for (const i of g.activeIndices) {
            const col = colOf(i);
            if (col >= 0) bandCells[col]++;
        }
        lastHead = g.descent.base; now = 0;
    }

    const colOf = (i) => columnOf(i, W, cq, cr, R, band);

    /** After a tick: ink the infections logged since the last call. */
    function record(g, reg, tick) {
        if (g !== grid) setup(g);
        const d = g.descent, m = d.mask, ids = g.strain_ids;
        if (lastHead > d.head) lastHead = d.head;          // an undone stroke's cases
        if (lastHead < d.base) lastHead = d.base;
        for (let s = lastHead; s < d.head; s++) {
            const k = s & m, i = d.cell[k], col = colOf(i);
            if (col < 0) continue;
            const t = d.tick[k], row = t % SPAN_DAYS;
            if (rowTick[row] !== t) {
                rowTick[row] = t;
                count.fill(0, row * C, row * C + C);
                mark.fill(0, row * C, row * C + C);
            }
            const o = row * C + col;
            if (count[o] < 65535) count[o]++;
            const sid = ids[i * 4];
            if (reg && sid !== EMPTY_STRAIN && sid < reg.ag_x.length) mark[o] = (angleCode(reg.ag_x[sid]) + 1) | (hueByte(reg.ag_y[sid]) << 5);
        }
        lastHead = d.head;
        if (tick > now) now = tick;
    }

    function clear() { grid = null; lastHead = 0; now = 0; }

    /** The infections recorded on `day` by column, or null when none are kept (tests). */
    function day(t) {
        const row = t % SPAN_DAYS;
        return t >= 0 && t > now - SPAN_DAYS && count && rowTick[row] === t ? count.subarray(row * C, row * C + C) : null;
    }

    function resize() {
        const r = canvasEl.getBoundingClientRect();
        if (!r.width) return;
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        w = r.width; h = r.height || r.width * 0.75;
        canvasEl.width = Math.round(w * dpr);
        canvasEl.height = Math.round(h * dpr);
    }

    const GUTTER_L = 34, GUTTER_B = 17, PAD_T = 6, PAD_R = 2;
    let img = null, dens = null, best = null;
    const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
    // each hatch angle's unit normal, for the strain marks
    const NX = Float32Array.from({ length: ANGLE_CODES }, (_, a) => -Math.sin(a / ANGLE_CODES * Math.PI));
    const NY = Float32Array.from({ length: ANGLE_CODES }, (_, a) => Math.cos(a / ANGLE_CODES * Math.PI));

    function render(strainView) {
        if (!w) resize();
        if (!w || !panelEl.closest('.tab-panel.active')) return;
        const P = _themePalette(), dark = document.documentElement.dataset.theme === 'dark';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        const px0 = GUTTER_L, py0 = PAD_T, pw = w - GUTTER_L - PAD_R, ph = h - PAD_T - GUTTER_B;
        if (pw <= 4 || ph <= 4) return;
        const from = now - SPAN_DAYS + 1;
        if (grid) {
            // incidence by column and image row: an image row holds one day or several
            const W2 = Math.round(pw * dpr), H2 = Math.round(ph * dpr), rows = Math.min(SPAN_DAYS, H2);
            if (!dens || dens.length !== rows * C) { dens = new Float32Array(rows * C); best = new Uint16Array(rows * C); }
            dens.fill(0); best.fill(0);
            const top = new Uint16Array(C);
            for (let y = 0; y < rows; y++) {
                const d0 = from + Math.floor(y * SPAN_DAYS / rows), d1 = from + Math.floor((y + 1) * SPAN_DAYS / rows);
                top.fill(0);
                for (let day = Math.max(d0, 0); day < d1; day++) {
                    const row = day % SPAN_DAYS;
                    if (rowTick[row] !== day) continue;
                    for (let c = 0, o = row * C; c < C; c++, o++) {
                        const n = count[o];
                        if (!n) continue;
                        dens[y * C + c] += n;
                        if (n >= top[c] && mark[o]) { top[c] = n; best[y * C + c] = mark[o]; }
                    }
                }
                for (let c = 0; c < C; c++) dens[y * C + c] /= Math.max(1, bandCells[c]) * Math.max(1, d1 - d0);
            }
            // full ink at the 95th percentile of the inked places, so a few
            // dense ones (a seeded cluster) don't wash the rest out
            const max = quantile(dens, 0.95);
            if (max > 0) {
                if (!img || img.width !== W2 || img.height !== H2) img = ctx.createImageData(W2, H2);
                const data = img.data, paper = rgb(P.canvas), accent = rgb(P.accent);
                const gap = 3 * dpr, hw = 0.55 * dpr;
                for (let py = 0; py < H2; py++) {
                    const y = Math.floor(py * rows / H2);
                    for (let px = 0; px < W2; px++) {
                        const c = Math.floor(px * C / W2), v = dens[y * C + c], o = (py * W2 + px) * 4;
                        let a = v > 0 ? Math.sqrt(Math.min(1, v / max)) : 0, ink = accent;
                        if (a > 0 && strainView) {
                            const mk = best[y * C + c];
                            if (mk) {
                                const code = (mk & 31) - 1;
                                ink = rgb(hueColor(mk >> 5));
                                const t = (px * NX[code] + py * NY[code]) / gap;
                                const dd = Math.abs(t - Math.round(t)) * gap;
                                a *= 0.35 + 0.65 * Math.min(1, Math.max(0, hw - dd + 0.5));
                            }
                        }
                        a *= dark ? 0.92 : 0.95;
                        data[o] = paper[0] + (ink[0] - paper[0]) * a;
                        data[o + 1] = paper[1] + (ink[1] - paper[1]) * a;
                        data[o + 2] = paper[2] + (ink[2] - paper[2]) * a;
                        data[o + 3] = 255;
                    }
                }
                ctx.putImageData(img, Math.round(px0 * dpr), Math.round(py0 * dpr));
            }
        }
        // the frame, the days down the left, A and A′ along the foot
        const muted = P.textMuted, [tr, tg, tb] = rgb(P.text);
        ctx.strokeStyle = `rgba(${tr},${tg},${tb},0.24)`;
        ctx.lineWidth = 1;
        ctx.strokeRect(px0 - 0.5, py0 - 0.5, pw + 1, ph + 1);
        ctx.fillStyle = muted; ctx.font = `11px ${_FONT.text}`; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        const step = 200;
        for (let day = Math.ceil(Math.max(0, from) / step) * step; day <= now; day += step) {
            const y = py0 + ph * (day - from + 0.5) / SPAN_DAYS;
            ctx.fillText(String(day), px0 - 5, y);
            ctx.beginPath(); ctx.moveTo(px0 - 3, y); ctx.lineTo(px0, y); ctx.stroke();
        }
        ctx.textBaseline = 'alphabetic'; ctx.font = `italic 11px ${_FONT.text}`;
        ctx.textAlign = 'left'; ctx.fillText('A', px0, h - 3);
        ctx.textAlign = 'right'; ctx.fillText('A′', px0 + pw, h - 3);
    }

    return { record, render, resize, clear, day };
}

// The q-quantile of the positive values of `a` (0 when there are none), from
// at most about 4,096 of them taken evenly.
function quantile(a, q) {
    let n = 0;
    for (let k = 0; k < a.length; k++) if (a[k] > 0) n++;
    if (!n) return 0;
    const every = Math.max(1, Math.floor(n / 4096)), v = [];
    for (let k = 0, j = 0; k < a.length; k++) if (a[k] > 0 && j++ % every === 0) v.push(a[k]);
    v.sort((x, y) => x - y);
    return v[Math.min(v.length - 1, Math.floor(q * v.length))];
}
