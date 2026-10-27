// render.js — the plate: Miasma's world drawn as an epidemiological atlas.
//
// The scene is a plate in the line of John Snow's 1854 cholera map. The world
// hexagon is drawn once per change into an offscreen tile (cells, patterns,
// isochrones, overlays); each frame composites that tile at the world's place
// and, faded, under each glued edge's isometry, so the world visibly carries
// on across its edges. Edges, labels and the plate furniture (title,
// Reference cartouche, scale bar) are drawn in screen space on top.
//
// Encodings, compartment view (every state is a pattern first, a color
// second, so the plate survives grayscale):
//   S  graphite dot         E  pale red          I  solid red (the disease)
//   R  stipple              D  small cross       V  hatching (prussian)
//   M  small ring           Z  cross-hatch (sap) EMPTY  the paper
//   latent E: a dot in the red; carrier R: a red dot in the stipple;
//   F-corpse: a red cross; H: a plus; Q: a cordon (hex outline).
// Strain view hatches each carrier at the angle and ink of every strain it
// holds (strain-style.js), each strain's lines as heavy as its load. Age,
// health and immunity are single-ink ramps.
// The oncoviral preset turns the tile into an H&E-stained section (histology.js).
//
// This is the Canvas 2D renderer: the fallback when WebGPU is unavailable
// (gpu-plate.js draws the same marks from a state texture). The tile is
// redrawn only when the state, view, theme, zoom or brush changes; frames in
// between are a handful of drawImage calls.

import { memoryOf, susceptibility } from './immunity.js';
import { Compartment, Flag, Status, ViewMode, DEFAULTS, SQRT3 } from './config.js';
import { hexBounds } from './topology.js';
import { ANGLE_CODES, angleCode, hueByte, hueColor } from './strain-style.js';
import { drawHistology } from './histology.js';
import { ISO_LABEL, isoFade } from './isochrones.js';

// ─── Theme ──────────────────────────────────────────────────────────────────
let _theme = null;
let _themeKey = '';

function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** The current theme's plate colors, rebuilt when <html data-theme> changes. */
export function plateTheme() {
    const key = document.documentElement.dataset.theme || 'light';
    if (_theme && key === _themeKey) return _theme;
    const P = _themePalette(), dark = key === 'dark';
    _themeKey = key;
    _theme = {
        dark, P, rgba,
        paper: P.canvas, panel: P.panelSolid, text: P.text, text2: P.textSecondary, muted: P.textMuted,
        accent: P.accent, inks: P.inks,
        dot: rgba(P.textMuted, dark ? 0.62 : 0.55),
        exposed: rgba(P.accent, dark ? 0.36 : 0.3),
        infectious: rgba(P.accent, 0.94),
        stipple: rgba(P.text, dark ? 0.6 : 0.55),
        cross: rgba(P.text, dark ? 0.82 : 0.86),
        hatch: P.inks.prussian,
        zombie: P.inks.sap,
        maternal: P.inks.mulberry,
        cordon: P.inks.indigo,
        rule: rgba(P.text, 0.5),
        ruleSoft: rgba(P.text, 0.24),
        isoMajor: rgba(P.text, dark ? 0.66 : 0.6),
        isoA: dark ? 0.36 : 0.32, isoMajorA: dark ? 0.66 : 0.6
    };
    return _theme;
}

export function invalidateColorCache() { _theme = null; }

if (typeof window !== 'undefined' && typeof MutationObserver !== 'undefined') {
    new MutationObserver(() => invalidateColorCache())
        .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

function cellHash(n) {
    let x = (n * 747796405 + 2891336453) >>> 0;
    x = Math.imul((x >>> ((x >>> 28) + 4)) ^ x, 277803737) >>> 0;
    x = ((x >>> 22) ^ x) >>> 0;
    return x / 4294967295;
}

// ─── Geometry ───────────────────────────────────────────────────────────────
// Cells are pointy-top hexes of circumradius rc; the world hexagon has its
// corners at E and W, apothem apo = 1.5·rc·(R + ½) and circumradius
// Rb = √3·rc·(R + ½).

/** Pixel offset of relative axial (q, r) for cell radius rc. */
export function axialToPx(q, r, rc) {
    return [SQRT3 * rc * (q + r / 2), 1.5 * rc * r];
}

/** Fractional relative axial coords of a pixel offset. */
export function pxToAxial(x, y, rc) {
    const r = y / (1.5 * rc);
    return [x / (SQRT3 * rc) - r / 2, r];
}

export function roundAxial(q, r) {
    let x = Math.round(q), z = Math.round(r), y = Math.round(-q - r);
    const dx = Math.abs(x - q), dy = Math.abs(y + q + r), dz = Math.abs(z - r);
    if (dx > dy && dx > dz) x = -y - z;
    else if (dy <= dz) z = -x - y;
    return [x, z];
}

/**
 * Fit the world hexagon into the plate frame (CSS px). Returns the base
 * viewport { cssWidth, cssHeight, hexSize, originX, originY, frame }, where
 * origin is the pixel of axial (0, 0) — the convention paint.js hit-tests in.
 */
export function computeViewport(canvas, grid, frame) {
    const rect = canvas.getBoundingClientRect();
    const cssWidth = rect.width || canvas.clientWidth, cssHeight = rect.height || canvas.clientHeight;
    const f = frame || { x: 0, y: 0, w: cssWidth, h: cssHeight };
    const { cq, cr, R } = hexBounds(grid.W, grid.H);
    const narrow = f.w < 600;
    const padL = f.padL || 0;
    const apo = Math.max(40, Math.min(f.h * (narrow ? 0.45 : 0.415), (f.w - padL) * (narrow ? 0.475 : 0.43) * SQRT3 / 2));
    const hexSize = apo / (1.5 * (R + 0.5));
    // Shift right into any spare width so the Reference cartouche (bottom
    // left) clears the world's south-west edge.
    const slack = f.w - 2 * apo * 2 / SQRT3;
    let cx = f.x + f.w / 2 + (narrow ? 0 : Math.max(0, Math.min(80, slack / 2 - 30)));
    // and keep the world's west corner clear of the brush rail
    cx = Math.max(cx, f.x + padL + 2 * apo / SQRT3 + 8);
    const cy = f.y + f.h / 2 + (narrow ? 4 : 10);
    const [ox, oy] = axialToPx(cq, cr, hexSize);
    return { cssWidth, cssHeight, hexSize, originX: cx - ox, originY: cy - oy, frame: f };
}

// ─── The tile ───────────────────────────────────────────────────────────────
const tile = { c: null, x: null, w: 0, h: 0, dpr: 1, rc: 0, grid: null, px: null, py: null, mask: null };

// Chrome builds a canvas path in time quadratic in its length: ten thousand
// hexes in one path take a quarter of a second, a hundred thousand twenty.
// Long runs of marks are therefore drawn BATCH to a path; marks that touch
// overlap by a hair, so a batch's seam does not show.
const BATCH = 400;

/** `n` marks, `emit(k)` adding mark k to the path and `paint()` filling or stroking it, BATCH per path. */
export function batched(c, n, emit, paint) {
    for (let s = 0; s < n; s += BATCH) {
        c.beginPath();
        const e = Math.min(n, s + BATCH);
        for (let k = s; k < e; k++) emit(k);
        paint();
    }
}

// Pointy-top corners, clockwise from the top, as (x in √3/2 units, y in halves),
// and the axial neighbour across the edge from corner e to corner e + 1.
const CORNER_X = [0, 1, 1, 0, -1, -1], CORNER_Y = [-2, -1, 1, 2, 1, -1];
const ACROSS = [[1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1]];

/**
 * The world's outline at cell radius rc, around its centre: the outer edges
 * of the rim's cells chained into one polygon, pushed out by a hair so the
 * faded copies abut it without a seam.
 */
function worldOutline(R, rc) {
    const inside = (q, r) => Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= R;
    const key = (X, Y) => (X + 4 * R + 8) * 65536 + (Y + 6 * R + 8);
    const next = new Map();
    let start = null;
    for (let r = -R; r <= R; r++) {
        for (let q = -R; q <= R; q++) {
            if (!inside(q, r) || Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) < R) continue;
            for (let e = 0; e < 6; e++) {
                if (inside(q + ACROSS[e][0], r + ACROSS[e][1])) continue;
                const f = (e + 1) % 6;
                const a = [2 * q + r + CORNER_X[e], 3 * r + CORNER_Y[e]], b = [2 * q + r + CORNER_X[f], 3 * r + CORNER_Y[f]];
                next.set(key(a[0], a[1]), b);
                if (!start) start = a;
            }
        }
    }
    const s = rc * (1 + 0.02 / (R + 0.5)), path = new Path2D();
    let v = start;
    for (let n = 0; n <= next.size; n++) {
        const x = v[0] * 0.8660254 * s, y = v[1] * 0.5 * s;
        if (n === 0) path.moveTo(x, y); else path.lineTo(x, y);
        v = next.get(key(v[0], v[1]));
        if (!v || (v[0] === start[0] && v[1] === start[1])) break;
    }
    path.closePath();
    return path;
}

function ensureTile(grid, rc, dpr) {
    const { R } = hexBounds(grid.W, grid.H);
    const Rb = SQRT3 * rc * (R + 0.5), apo = 1.5 * rc * (R + 0.5);
    const w = Math.ceil(2 * Rb + 4 * rc + 4), h = Math.ceil(2 * apo + 4 * rc + 4);
    if (!tile.c) { tile.c = document.createElement('canvas'); tile.x = tile.c.getContext('2d'); }
    if (tile.w !== w || tile.h !== h || tile.dpr !== dpr) {
        tile.w = w; tile.h = h; tile.dpr = dpr;
        tile.c.width = Math.ceil(w * dpr); tile.c.height = Math.ceil(h * dpr);
        tile.rc = 0;
    }
    if (tile.rc !== rc || tile.grid !== grid) {
        tile.rc = rc; tile.grid = grid;
        const act = grid.activeIndices, { cq, cr } = hexBounds(grid.W, grid.H);
        tile.px = new Float32Array(grid.W * grid.H);
        tile.py = new Float32Array(grid.W * grid.H);
        for (let k = 0; k < act.length; k++) {
            const i = act[k], r = (i / grid.W) | 0, q = i - r * grid.W;
            const [x, y] = axialToPx(q - cq, r - cr, rc);
            tile.px[i] = x; tile.py[i] = y;
        }
        tile.mask = worldOutline(hexBounds(grid.W, grid.H).R, rc);
    }
    return tile;
}

/** Pointy-top hex of circumradius rr, appended to a path or context. */
export function hexPath(p, x, y, rr) {
    const h = rr * 0.8660254;
    p.moveTo(x, y - rr); p.lineTo(x + h, y - rr / 2); p.lineTo(x + h, y + rr / 2);
    p.lineTo(x, y + rr); p.lineTo(x - h, y + rr / 2); p.lineTo(x - h, y - rr / 2); p.closePath();
}

// Hatch lines at `angle` (degrees) across the box (x0, y0)–(x1, y1), spaced
// `gap` and anchored at the origin, so every group shares one phase.
function hatchBox(c, angle, gap, x0, y0, x1, y1, phase = 0) {
    const a = angle * Math.PI / 180, ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux;
    let smin = Infinity, smax = -Infinity, tmin = Infinity, tmax = -Infinity;
    for (const x of [x0, x1]) for (const y of [y0, y1]) {
        const s = x * nx + y * ny, t = x * ux + y * uy;
        if (s < smin) smin = s; if (s > smax) smax = s;
        if (t < tmin) tmin = t; if (t > tmax) tmax = t;
    }
    c.beginPath();
    for (let s = (Math.ceil(smin / gap - phase) + phase) * gap; s <= smax; s += gap) {
        c.moveTo(nx * s + ux * tmin, ny * s + uy * tmin);
        c.lineTo(nx * s + ux * tmax, ny * s + uy * tmax);
    }
    c.stroke();
}

function fillCells(c, cells, fill, rr) {
    if (!cells.length) return;
    c.fillStyle = fill;
    batched(c, cells.length, (k) => hexPath(c, tile.px[cells[k]], tile.py[cells[k]], rr), () => c.fill());
}

// Hatching at each of `angles` (degrees) through the cells, a batch at a time:
// each batch clips to its cells and hatches its own bounds, on lines anchored
// at the origin (offset by `phase` of the gap), so the batches share one phase.
function hatchCells(c, cells, rr, angles, gap, color, lw, phase = 0) {
    c.strokeStyle = color; c.lineWidth = lw;
    for (let s = 0; s < cells.length; s += BATCH) {
        const e = Math.min(cells.length, s + BATCH);
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        c.save();
        c.beginPath();
        for (let k = s; k < e; k++) {
            const x = tile.px[cells[k]], y = tile.py[cells[k]];
            hexPath(c, x, y, rr);
            if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
        c.clip();
        for (const a of angles) hatchBox(c, a, gap, x0 - rr, y0 - rr, x1 + rr, y1 + rr, phase);
        c.restore();
    }
}

const PAINT_INK = { seed: 'accent', vaccinate: 'prussian', quarantine: 'indigo', sanitize: 'verdigris', cull: 'text' };

/**
 * Draw the world into the tile. opts: { mode, ageMax, animalDisplay,
 * paintOverlay, contours, isoLatest, histology, dpr }.
 */
export function renderTile(grid, rc, opts) {
    const dpr = opts.dpr || 1, T = ensureTile(grid, rc, dpr), t = plateTheme(), c = T.x;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, T.c.width, T.c.height);
    c.setTransform(dpr, 0, 0, dpr, dpr * T.w / 2, dpr * T.h / 2);
    c.save();
    c.clip(T.mask);
    c.fillStyle = t.paper;
    c.fill(T.mask);
    if (opts.histology) drawHistology(c, grid, T, rc, t, opts);
    else drawAtlas(c, grid, T, rc, t, opts);
    if (!opts.histology || opts.mode !== ViewMode.COMPARTMENT) drawContours(c, rc, t, opts.contours, opts.isoLatest);
    if (opts.paintOverlay && opts.paintOverlay.inside && opts.paintOverlay.mode !== 'none') drawBrush(c, grid, T, rc, t, opts.paintOverlay);
    c.restore();
    return T;
}

function drawAtlas(c, grid, T, rc, t, opts) {
    const mode = opts.mode || ViewMode.COMPARTMENT, act = grid.activeIndices;
    const comp = grid.compartment, flags = grid.flags, status = grid.status, rr = rc * 1.005;
    const human = opts.animalDisplay !== 'only';
    const S = [], E = [], I = [], R = [], D = [], Dc = [], V = [], M = [], Z = [], lat = [], car = [], H = [], Q = [];
    // Strain view: every strain a carrier holds (strainMarks), binned to
    // ANGLE_CODES hatch angles × 32 hues (strain-style.js) × line weight ×
    // interleave phase, so a cell sits in one bin per strain.
    const strains = mode === ViewMode.STRAIN && opts.strains ? new Map() : null;
    const reg = opts.strains, marks = _marks;
    const ramp = mode === ViewMode.AGE || mode === ViewMode.HEALTH || mode === ViewMode.IMMUNITY ? [] : null;
    for (let k = 0; k < act.length; k++) {
        const i = act[k], x = comp[i];
        if (x === Compartment.EMPTY) continue;
        if (status[i] === Status.H) H.push(i); else if (status[i] === Status.Q) Q.push(i);
        if (ramp && x !== Compartment.D) { ramp.push(i); continue; }
        if (strains && (x === Compartment.E || x === Compartment.I || x === Compartment.Z)) {
            const n = strainMarks(grid, i, reg, marks);
            if (n > 0) {
                for (let m = 0; m < n; m++) {
                    // key: angle · hue/8 · load level · phase. Strains that share an
                    // angle interleave, each `before` / `same` of the gap along
                    // (the heaviest at 0), instead of overprinting.
                    let same = 0, before = 0;
                    for (let j = 0; j < n; j++) if (marks.a[j] === marks.a[m]) { same++; if (j < m) before++; }
                    const key = (((marks.a[m] * 32 + (marks.h[m] >> 3)) * 16 + loadLevel(marks.l[m])) * 4 + before) * 5 + same;
                    let g = strains.get(key);
                    if (!g) strains.set(key, g = []);
                    g.push(i);
                }
                continue;
            }
        }
        switch (x) {
            case Compartment.S: S.push(i); break;
            case Compartment.E: E.push(i); if (flags[i] & Flag.LATENT) lat.push(i); break;
            case Compartment.I: I.push(i); break;
            case Compartment.R: R.push(i); if (flags[i] & Flag.CARRIER) car.push(i); break;
            case Compartment.D: (flags[i] & Flag.F_CORPSE ? Dc : D).push(i); break;
            case Compartment.V: V.push(i); break;
            case Compartment.M: M.push(i); break;
            case Compartment.Z: Z.push(i); break;
        }
    }
    const quiet = mode === ViewMode.STATUS;    // status view mutes everything but H and Q
    if (human) {
        if (ramp) drawRamp(c, grid, ramp, mode, rr, t, opts);
        // susceptible: one graphite dot per cell
        const ds = Math.max(0.9, rc * 0.34);
        c.fillStyle = quiet ? t.rgba(t.muted, 0.3) : t.dot;
        batched(c, S.length, (k) => c.rect(T.px[S[k]] - ds / 2, T.py[S[k]] - ds / 2, ds, ds), () => c.fill());
        fillCells(c, E, quiet ? t.rgba(t.accent, 0.12) : t.exposed, rr);
        fillCells(c, I, quiet ? t.rgba(t.accent, 0.3) : t.infectious, rr);
        if (R.length) {
            // dots at hashed spots in each cell: filling thousands of adjacent
            // hexes with a pattern costs Canvas ~20 ms, rects under 1 ms
            const ds = Math.max(0.9, 1.05 / T.dpr);
            c.fillStyle = t.stipple;
            batched(c, R.length, (n) => {
                const i = R[n];
                for (let k = 0; k < 3; k++) {
                    const hx = cellHash(i * 3 + k) - 0.5, hy = cellHash(i * 3 + k + 101) - 0.5;
                    c.rect(T.px[i] + hx * rc * 1.15 - ds / 2, T.py[i] + hy * rc * 1.15 - ds / 2, ds, ds);
                }
            }, () => c.fill());
        }
        if (V.length) hatchCells(c, V, rr, [-45], Math.max(2.4, rc * 0.82), t.hatch, Math.max(0.7, rc * 0.2));
        if (Z.length) {
            fillCells(c, Z, t.rgba(t.zombie, 0.22), rr);
            hatchCells(c, Z, rr, [45, -45], Math.max(2.4, rc * 0.8), t.zombie, Math.max(0.7, rc * 0.18));
        }
        if (strains) {
            // lightest first, so where a host's strains cross the heaviest lies on top;
            // a strain's tint and line width are its load's share of a whole carrier's
            const bins = [...strains].map(([key, cells]) => {
                const same = key % 5, before = ((key / 5) | 0) % 4, rest = (key / 20) | 0;
                const q = rest % 16, mark = (rest / 16) | 0;
                return { cells, q, phase: before / same, angle: ((mark >> 5) / ANGLE_CODES) * 180, ink: hueColor((mark & 31) * 8 + 4) };
            }).sort((a, b) => a.q - b.q);
            for (const b of bins) {
                const l = b.q / LOAD_LEVELS;
                fillCells(c, b.cells, t.rgba(b.ink, 0.14 * l), rr);
                hatchCells(c, b.cells, rr, [b.angle], Math.max(2.4, rc * 0.78), b.ink, Math.max(0.8, rc * 0.24) * l, b.phase);
            }
        }
        if (M.length) {
            c.strokeStyle = t.maternal; c.lineWidth = Math.max(0.7, rc * 0.18);
            const mr = rc * 0.42;
            batched(c, M.length, (k) => { const i = M[k]; c.moveTo(T.px[i] + mr, T.py[i]); c.arc(T.px[i], T.py[i], mr, 0, Math.PI * 2); }, () => c.stroke());
        }
        crosses(c, D, rc, t.cross, Math.max(0.75, rc * 0.2));
        crosses(c, Dc, rc, t.accent, Math.max(0.85, rc * 0.24));
        if (mode === ViewMode.COMPARTMENT) {
            const dd = Math.max(0.9, rc * 0.36);
            c.fillStyle = t.text;
            batched(c, lat.length, (k) => c.rect(T.px[lat[k]] - dd / 2, T.py[lat[k]] - dd / 2, dd, dd), () => c.fill());
            c.fillStyle = t.accent;
            batched(c, car.length, (k) => c.rect(T.px[car[k]] - dd / 2, T.py[car[k]] - dd / 2, dd, dd), () => c.fill());
        }
    }
    if (mode === ViewMode.COMPARTMENT || mode === ViewMode.STATUS) {
        if (Q.length) {
            c.strokeStyle = t.cordon; c.lineWidth = Math.max(0.8, rc * (quiet ? 0.3 : 0.22));
            batched(c, Q.length, (k) => hexPath(c, T.px[Q[k]], T.py[Q[k]], rc * 0.78), () => c.stroke());
        }
        if (H.length) {
            const a = rc * 0.4;
            c.strokeStyle = quiet ? t.text : t.cross; c.lineWidth = Math.max(0.8, rc * (quiet ? 0.3 : 0.2));
            batched(c, H.length, (k) => { const x = T.px[H[k]], y = T.py[H[k]]; c.moveTo(x - a, y); c.lineTo(x + a, y); c.moveTo(x, y - a); c.lineTo(x, y + a); }, () => c.stroke());
        }
    }
    if (opts.animalDisplay !== 'off' && grid.animal && rc >= 2) drawAnimals(c, grid, T, rc, t, !human);
}

function crosses(c, cells, rc, color, lw) {
    if (!cells.length) return;
    const a = rc * 0.4;
    c.strokeStyle = color; c.lineWidth = lw; c.lineCap = 'round';
    batched(c, cells.length, (k) => {
        const x = tile.px[cells[k]], y = tile.py[cells[k]];
        c.moveTo(x - a, y - a); c.lineTo(x + a, y + a); c.moveTo(x + a, y - a); c.lineTo(x - a, y + a);
    }, () => c.stroke());
    c.lineCap = 'butt';
}

/** Load quantized to the 15 line weights both renderers draw (1..15; 15 is a whole load). */
export const LOAD_LEVELS = 15;
export const loadLevel = (l) => Math.max(1, Math.min(LOAD_LEVELS, Math.round(l * LOAD_LEVELS)));

/**
 * The strains a carrier holds, as the Strain view draws them, heaviest first:
 * each slot with load gives its hatch angle code (out.a), hue byte (out.h)
 * and load (out.l), and two strains that share both codes are merged, since
 * their lines would coincide. `out` holds four of each; returns how many.
 */
export function strainMarks(grid, i, reg, out) {
    const base = i * DEFAULTS.maxActiveStrains, A = out.a, Hb = out.h, L = out.l;
    let n = 0;
    if (!reg) return 0;
    for (let s = 0; s < DEFAULTS.maxActiveStrains; s++) {
        const id = grid.strain_ids[base + s], l = grid.strain_loads[base + s];
        if (id === 0xFFFF || !(l > 0) || id >= reg.ag_x.length) continue;
        const a = angleCode(reg.ag_x[id]), h = hueByte(reg.ag_y[id]);
        let k = 0;
        while (k < n && (A[k] !== a || Hb[k] !== h)) k++;
        if (k < n) { L[k] += l; continue; }
        A[n] = a; Hb[n] = h; L[n] = l; n++;
    }
    for (let k = 1; k < n; k++) {
        const a = A[k], h = Hb[k], l = L[k];
        let j = k - 1;
        for (; j >= 0 && L[j] < l; j--) { A[j + 1] = A[j]; Hb[j + 1] = Hb[j]; L[j + 1] = L[j]; }
        A[j + 1] = a; Hb[j + 1] = h; L[j + 1] = l;
    }
    return n;
}

const _marks = { a: new Uint8Array(4), h: new Uint8Array(4), l: new Float32Array(4) };

/** The ink of a paint brush's footprint. */
export function paintInk(mode, t) {
    const name = PAINT_INK[mode] || 'text';
    return name === 'accent' ? t.accent : name === 'text' ? t.text : t.inks[name];
}

// Single-ink ramps, quantized to eight steps so each step is one batched fill.
function drawRamp(c, grid, cells, mode, rr, t, opts) {
    const ink = mode === ViewMode.AGE ? t.inks.umber : mode === ViewMode.HEALTH ? t.inks.viridian : t.inks.prussian;
    const bins = Array.from({ length: 8 }, () => []);
    // age reads relative to the oldest living cell, so the ramp spans the population
    let ageMax = 1;
    if (mode === ViewMode.AGE) for (const i of cells) if (grid.age[i] > ageMax) ageMax = grid.age[i];
    const im = opts.immunity, mem = im ? memoryOf(grid) : null;
    for (const i of cells) {
        let v;
        if (mode === ViewMode.AGE) v = Math.min(1, grid.age[i] / ageMax);
        else if (mode === ViewMode.HEALTH) v = Math.max(0, Math.min(1, grid.health[i]));
        else v = im ? 1 - susceptibility(mem, i, im.ax, im.ay, im.cInf, im.cVax) : 0;
        bins[Math.min(7, (v * 8) | 0)].push(i);
    }
    for (let b = 0; b < 8; b++) fillCells(c, bins[b], t.rgba(ink, 0.08 + 0.1 * b), rr);
}

function drawAnimals(c, grid, T, rc, t, only) {
    const an = grid.animal, act = grid.activeIndices, s = Math.max(1, rc * (only ? 0.5 : 0.34));
    const ox = only ? 0 : rc * 0.42, oy = only ? 0 : rc * 0.36;
    const groups = [[], [], [], [], []];
    for (let k = 0; k < act.length; k++) { const i = act[k]; if (an[i]) groups[an[i]].push(i); }
    const fills = [null, t.rgba(t.inks.umber, 0.75), t.accent, t.rgba(t.inks.umber, 0.35), t.text];
    for (let a = 1; a <= 4; a++) {
        if (!groups[a].length) continue;
        c.fillStyle = fills[a];
        // a small triangle: the reservoir's mark, distinct from the human square dot
        const g = groups[a];
        batched(c, g.length, (k) => {
            const x = T.px[g[k]] + ox, y = T.py[g[k]] + oy;
            c.moveTo(x, y - s); c.lineTo(x + s, y + s * 0.8); c.lineTo(x - s, y + s * 0.8); c.closePath();
        }, () => c.fill());
    }
}

// Each level is drawn at its base opacity times isoFade of its age behind
// `latest`, the newest stamp (the GPU shader does the same per pixel).
function drawContours(c, rc, t, contours, latest) {
    if (!contours || !contours.length) return;
    c.lineCap = 'round';
    for (const { level, segs } of contours) {
        const major = level % ISO_LABEL === 0;
        c.strokeStyle = t.rgba(t.text, (major ? t.isoMajorA : t.isoA) * isoFade(latest - level));
        c.lineWidth = major ? 1.15 : 0.75;
        batched(c, segs.length / 4, (n) => { const k = 4 * n; c.moveTo(segs[k] * rc, segs[k + 1] * rc); c.lineTo(segs[k + 2] * rc, segs[k + 3] * rc); }, () => c.stroke());
    }
    c.lineCap = 'butt';
}

function drawBrush(c, grid, T, rc, t, o) {
    const inkName = PAINT_INK[o.mode] || 'text';
    const col = inkName === 'accent' ? t.accent : inkName === 'text' ? t.text : t.inks[inkName];
    c.beginPath();
    const n = o.brushSize | 0;
    for (let dq = -n; dq <= n; dq++) {
        for (let dr = Math.max(-n, -dq - n); dr <= Math.min(n, -dq + n); dr++) {
            const q = o.q + dq, r = o.r + dr;
            if (q < 0 || q >= grid.W || r < 0 || r >= grid.H) continue;
            const i = r * grid.W + q;
            if (grid.mask[i] === 0) continue;
            hexPath(c, T.px[i], T.py[i], rc);
        }
    }
    c.fillStyle = t.rgba(col, 0.24); c.fill();
    c.strokeStyle = t.rgba(col, 0.9); c.lineWidth = 1.2; c.stroke();
}

export { tile as _tile };
