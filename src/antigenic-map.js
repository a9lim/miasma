// antigenic-map.js — the Strains tab's antigenic map (Fig. 5).
//
// Every strain the registry keeps sits at its antigenic position on the torus
// of immunity.js, drawn as the fundamental square with its glued edges marked
// like the plate's: one chevron on the left and right edges, two on the top
// and bottom, pointing the same way because the gluing is a translation. The
// ground is the key: each place is faintly hatched at the angle, and tinted
// in the colour, that a strain there takes on the plate. Living strains are
// hexagons hatched in their own mark and sized by prevalence; the ancestors
// the registry keeps for them are graphite dots; the dominant strain's
// descent is a line, the trunk. The vaccine's antigen is a cross, ringed at
// 1 AU, where its protection has fallen to 1/e. The square is centred on α,
// the origin, which any fundamental domain of a torus is free to be.

import { ANTIGENIC_SIZE } from './config.js';
import { agDelta, agDist, agWrap } from './immunity.js';
import { markAt, strainStyle } from './strain-style.js';

const S = ANTIGENIC_SIZE;
const KEY_TILES = 16;
const MAX_LIVING = 600;    // most prevalent living strains drawn as hexagons
const _map = { pts: [], x0: 0, y0: 0, side: 1 };
let _key = null;           // { canvas, side, dpr, theme }: the cached ground

function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function hatchIn(c, x, y, w, h, angle, gap) {
    const a = angle * Math.PI / 180, ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux;
    const cx = x + w / 2, cy = y + h / 2, L = Math.hypot(w, h) / 2;
    for (let s = -L; s <= L; s += gap) {
        c.moveTo(cx + nx * s - ux * L, cy + ny * s - uy * L);
        c.lineTo(cx + nx * s + ux * L, cy + ny * s + uy * L);
    }
}

// The ground (the key), cached per size and theme.
function keyGround(side, dpr) {
    const theme = document.documentElement.dataset.theme;
    if (_key && _key.side === side && _key.dpr === dpr && _key.theme === theme) return _key.canvas;
    const cv = document.createElement('canvas');
    cv.width = Math.round(side * dpr); cv.height = Math.round(side * dpr);
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const t = side / KEY_TILES;
    for (let j = 0; j < KEY_TILES; j++) {
        for (let i = 0; i < KEY_TILES; i++) {
            const m = markAt(agWrap((i + 0.5) / KEY_TILES * S - S / 2), agWrap((j + 0.5) / KEY_TILES * S - S / 2));
            c.save();
            c.beginPath(); c.rect(i * t, j * t, t, t); c.clip();
            c.fillStyle = rgba(m.ink, 0.07); c.fillRect(i * t, j * t, t, t);
            c.strokeStyle = rgba(m.ink, 0.28); c.lineWidth = 0.7;
            c.beginPath(); hatchIn(c, i * t, j * t, t, t, m.angle, 3.2); c.stroke();
            c.restore();
        }
    }
    _key = { canvas: cv, side, dpr, theme };
    return cv;
}

function hexagon(c, x, y, r) {
    const hh = r * 0.866;
    c.moveTo(x, y - r); c.lineTo(x + hh, y - r / 2); c.lineTo(x + hh, y + r / 2);
    c.lineTo(x, y + r); c.lineTo(x - hh, y + r / 2); c.lineTo(x - hh, y - r / 2); c.closePath();
}

function chevron(c, x, y, dx, dy, s) {
    // a chevron at (x, y) pointing along (dx, dy)
    const px = -dy, py = dx;
    c.moveTo(x - dx * s + px * s, y - dy * s + py * s);
    c.lineTo(x, y);
    c.lineTo(x - dx * s - px * s, y - dy * s - py * s);
}

/**
 * Draw the map. prevalence: rows from computeStrainPrevalence; vax: { x, y }
 * the vaccine's antigen. Returns the live clause for the caption.
 */
export function renderAntigenicMap(canvas, reg, prevalence, selectedId, vax) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 300;
    const pad = 16, side = Math.max(120, Math.min(300, w - 2 * pad));
    const h = side + 2 * pad;
    if (Math.abs(canvas.clientHeight - h) > 1) canvas.style.height = h + 'px';
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    const c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const P = _themePalette();
    const x0 = Math.round((w - side) / 2), y0 = pad, k = side / S;
    Object.assign(_map, { x0, y0, side, pts: [] });
    // map position of an antigen, the square centred on α; segment ends may
    // pass the edge (they're clipped), points are wrapped onto the square
    const X = (ax) => x0 + agWrap(ax + S / 2) * k, Y = (ay) => y0 + agWrap(ay + S / 2) * k;

    c.drawImage(keyGround(side, dpr), x0, y0, side, side);
    // 1 AU graticule and the square
    c.strokeStyle = rgba(P.text, 0.07); c.lineWidth = 1;
    c.beginPath();
    for (let u = 1; u < S; u++) {
        c.moveTo(X(u) + 0.5, y0); c.lineTo(X(u) + 0.5, y0 + side);
        c.moveTo(x0, Y(u) + 0.5); c.lineTo(x0 + side, Y(u) + 0.5);
    }
    c.stroke();
    c.strokeStyle = rgba(P.text, 0.4);
    c.strokeRect(x0 + 0.5, y0 + 0.5, side - 1, side - 1);
    // glued edges: one chevron left and right, two top and bottom
    c.strokeStyle = P.textMuted; c.lineWidth = 1.1;
    c.beginPath();
    for (const ex of [x0, x0 + side]) chevron(c, ex, y0 + side / 2 - 3, 0, -1, 4);
    for (const ey of [y0, y0 + side]) for (const o of [-4, 4]) chevron(c, x0 + side / 2 + o + 2, ey, 1, 0, 4);
    c.stroke();

    c.save();
    c.beginPath(); c.rect(x0, y0, side, side); c.clip();
    // a segment a → b the short way round, drawn from both ends so it wraps
    const seg = (ax, ay, bx, by) => {
        const dx = agDelta(ax, bx) * k, dy = agDelta(ay, by) * k;
        const pa = [X(ax), Y(ay)], pb = [X(bx), Y(by)];
        c.moveTo(pa[0], pa[1]); c.lineTo(pa[0] + dx, pa[1] + dy);
        if (Math.abs(pb[0] - pa[0] - dx) > 0.5 || Math.abs(pb[1] - pa[1] - dy) > 0.5) {
            c.moveTo(pb[0] - dx, pb[1] - dy); c.lineTo(pb[0], pb[1]);
        }
    };
    // the vaccine's ring and cross, at every copy that can show
    if (vax) {
        c.strokeStyle = P.inks.prussian; c.lineWidth = 1;
        c.setLineDash([3, 3]);
        c.beginPath();
        for (const ox of [-side, 0, side]) for (const oy of [-side, 0, side]) {
            c.moveTo(X(vax.x) + ox + k, Y(vax.y) + oy);
            c.arc(X(vax.x) + ox, Y(vax.y) + oy, k, 0, Math.PI * 2);
        }
        c.stroke();
        c.setLineDash([]);
        c.lineWidth = 1.4;
        c.beginPath();
        const vx = X(vax.x), vy = Y(vax.y);
        c.moveTo(vx - 4, vy - 4); c.lineTo(vx + 4, vy + 4); c.moveTo(vx + 4, vy - 4); c.lineTo(vx - 4, vy + 4);
        c.stroke();
    }
    // ancestors the registry keeps for the living (dead branches are reclaimed)
    const n = reg.ids.length;
    c.fillStyle = rgba(P.textMuted, 0.75);
    c.beginPath();
    for (let id = 0; id < n; id++) {
        if (reg.freed[id] || !reg.extinct[id]) continue;
        const x = X(reg.ag_x[id]), y = Y(reg.ag_y[id]);
        c.moveTo(x + 1.3, y); c.arc(x, y, 1.3, 0, Math.PI * 2);
        _map.pts.push({ id, x, y });
    }
    c.fill();
    // the trunk: the dominant strain's descent
    const dom = prevalence.length ? prevalence[0].id : 0;
    let travelled = 0;
    c.strokeStyle = rgba(P.text, 0.55); c.lineWidth = 1;
    c.beginPath();
    for (let id = dom, guard = 0; id !== null && id !== undefined && guard < 100000; guard++) {
        const p = reg.parent[id];
        if (p === null || p === undefined) break;
        seg(reg.ag_x[p], reg.ag_y[p], reg.ag_x[id], reg.ag_y[id]);
        travelled += agDist(reg.ag_x[p], reg.ag_y[p], reg.ag_x[id], reg.ag_y[id]);
        id = p;
    }
    c.stroke();
    // living strains, least prevalent first so the dominant draws on top
    const rows = prevalence.slice(0, MAX_LIVING).reverse();
    for (const row of rows) {
        const id = row.id, st = strainStyle(reg, id);
        const x = X(reg.ag_x[id]), y = Y(reg.ag_y[id]);
        const r = 2.6 + 9 * Math.sqrt(row.fraction);
        c.save();
        c.beginPath(); hexagon(c, x, y, r);
        c.fillStyle = P.canvas; c.fill();
        c.clip();
        c.strokeStyle = st.ink; c.lineWidth = 1;
        c.beginPath(); hatchIn(c, x - r, y - r, 2 * r, 2 * r, st.angle, 2.2); c.stroke();
        c.restore();
        c.strokeStyle = st.ink; c.lineWidth = 1;
        c.beginPath(); hexagon(c, x, y, r); c.stroke();
        if (id === selectedId) {
            c.strokeStyle = P.accent; c.lineWidth = 1.2;
            c.beginPath(); hexagon(c, x, y, r + 2.5); c.stroke();
        }
        _map.pts.push({ id, x, y, r });
    }
    c.restore();

    const name = reg.names[dom];
    const fromA = agDist(0, 0, reg.ag_x[dom], reg.ag_y[dom]);
    const fromV = vax ? agDist(vax.x, vax.y, reg.ag_x[dom], reg.ag_y[dom]) : NaN;
    return { name, fromA, fromV, travelled };
}

/** The strain under (px, py) in css px of the canvas, or -1. */
export function pickAntigenic(px, py) {
    let best = -1, bd = 64;
    for (const p of _map.pts) {
        const d = (p.x - px) * (p.x - px) + (p.y - py) * (p.y - py);
        const lim = Math.max(36, (p.r || 0) * (p.r || 0));
        if (d < bd && d <= lim) { bd = d; best = p.id; }
    }
    return best;
}
