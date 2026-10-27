// plate.js — composes the plate each frame: the lattice and its faded copies
// beyond the glued edges (gpu-plate.js, in WebGPU), then on the 2D canvas
// above it the edges, isochrone labels, and the plate furniture (title,
// Reference cartouche, scale bar).
//
// Bound to the model:
//   chevrons on an edge   that edge is glued; one, two or three name the pair,
//                         arrows that agree mean a translation, arrows that
//                         disagree a twist
//   faded copies          the world as it continues across a glued edge, under
//                         that edge's gluing isometry (shifted, or mirrored)
//   heavy rule, hachures  a shore: the edge is open and neighbors stop there
//   small open circles    cone points, where the gluing curves the surface
//   isochrone labels      the day the wave reached that line
//   A, A′                 the ends of the centre row, the section Fig. 3 plots
//   the trunk             in the Strain view, the route a lineage took: its
//                         ancestors' birthplaces in order, a dot at each birth
//   scale bar             the lattice's own scale (cells; µm on the slide)

import { SQRT3, ViewMode } from './config.js';
import { hexBounds, edgeGluings, cornerCones, SURFACES, wrap } from './topology.js';
import { createGpuPlate } from './gpu-plate.js';
import { wheelParams, strainStyle } from './strain-style.js';
import { ISO_LABEL, LABEL_FADE, LABEL_RUN, isoFade } from './isochrones.js';
import { getPreset, plateNumeral } from './presets.js';

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
        isoMajor: rgba(P.text, dark ? 0.66 : 0.6)
    };
    return _theme;
}

if (typeof window !== 'undefined' && typeof MutationObserver !== 'undefined') {
    new MutationObserver(() => { _theme = null; })
        .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

const PAINT_INK = { seed: 'accent', vaccinate: 'prussian', quarantine: 'indigo', sanitize: 'verdigris', cull: 'text' };

/** The ink of a paint brush's footprint. */
function paintInk(mode, t) {
    const name = PAINT_INK[mode] || 'text';
    return name === 'accent' ? t.accent : name === 'text' ? t.text : t.inks[name];
}

// ─── Geometry ───────────────────────────────────────────────────────────────
// Cells are pointy-top hexes of circumradius rc; the world hexagon has its
// corners at E and W, apothem apo = 1.5·rc·(R + ½) and circumradius
// Rb = √3·rc·(R + ½).

/** Pixel offset of relative axial (q, r) for cell radius rc. */
function axialToPx(q, r, rc) {
    return [SQRT3 * rc * (q + r / 2), 1.5 * rc * r];
}

/** Fractional relative axial coords of a pixel offset. */
function pxToAxial(x, y, rc) {
    const r = y / (1.5 * rc);
    return [x / (SQRT3 * rc) - r / 2, r];
}

function roundAxial(q, r) {
    let x = Math.round(q), z = Math.round(r), y = Math.round(-q - r);
    const dx = Math.abs(x - q), dy = Math.abs(y + q + r), dz = Math.abs(z - r);
    if (dx > dy && dx > dz) x = -y - z;
    else if (dy <= dz) z = -x - y;
    return [x, z];
}

/** Pointy-top hex of circumradius rr, appended to a path or context. */
function hexPath(p, x, y, rr) {
    const h = rr * 0.8660254;
    p.moveTo(x, y - rr); p.lineTo(x + h, y - rr / 2); p.lineTo(x + h, y + rr / 2);
    p.lineTo(x, y + rr); p.lineTo(x - h, y + rr / 2); p.lineTo(x - h, y - rr / 2); p.closePath();
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

/**
 * Plate title: the experiment's plate numeral and name ("Sandbox" when none),
 * and H&E on the slide; the numeral alone on a narrow plate. The surface and
 * the view are left to their own controls.
 */
export function plateTitle(presetKey, histology, narrow) {
    const p = getPreset(presetKey);
    if (!p) return narrow ? '' : 'Sandbox';
    const n = `Plate ${plateNumeral(presetKey)}.`;
    return narrow ? n : `${n} ${p.label}${histology ? ', H&E' : ''}`;
}

/**
 * The plate: the lattice on `gpuCanvas` (WebGPU), and on `canvas` above it
 * (2D) the edges, labels and furniture. `onGpu(ok)` is called once WebGPU
 * has started or failed, and again if a lost device cannot be replaced.
 */
export function createPlate(canvas, gpuCanvas, onGpu) {
    const ctx = canvas.getContext('2d');
    let stateDirty = true, gpu = null, starting = false;
    // Start WebGPU; a device that is lost (a driver reset, the GPU process
    // restarting) is replaced the same way on the next frame.
    function start() {
        starting = true;
        createGpuPlate(gpuCanvas).then((g) => {
            starting = false;
            gpu = g;
            stateDirty = true;
            if (onGpu) onGpu(!!g);
        }, () => { starting = false; gpu = null; if (onGpu) onGpu(false); });
    }
    start();
    const placed = [];
    const font = (size, italic) => `${italic ? 'italic ' : ''}${size}px ${_FONT.text}`;

    function geometry(grid, vp) {
        const { cq, cr, R } = hexBounds(grid.W, grid.H), rc = vp.hexSize;
        const [ox, oy] = axialToPx(cq, cr, rc);
        return { R, rc, cx: vp.originX + ox, cy: vp.originY + oy, apo: 1.5 * rc * (R + 0.5), Rb: SQRT3 * rc * (R + 0.5) };
    }

    /**
     * Draw one frame. s: { grid, vp, topology, mode, dpr, stateOpts, contours,
     * histology, legend, scaleUnit }. Until WebGPU has started (or when it
     * cannot), only the paper is drawn.
     */
    function draw(s) {
        const t = plateTheme(), dpr = s.dpr, G = geometry(s.grid, s.vp);
        const S = SURFACES[s.topology], frame = s.vp.frame;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (gpu && gpu.lost && !starting) { gpu = null; start(); }
        if (!gpu || !drawGpu(s, t, G, S, dpr)) {
            ctx.fillStyle = t.paper;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            return;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawEdges(t, G, S);
        if (s.trunk) drawTrunk(t, s, G, S);
        placed.length = 0;
        drawSection(t, G, frame);
        const furniture = drawFurniture(t, s, G, frame).concat(s.avoid || []);
        if (S.closed) drawCones(t, G, cornerCones(s.topology, G.R), frame);
        if ((!s.histology || s.mode !== ViewMode.COMPARTMENT) && s.mode !== ViewMode.DESCENT) drawIsoLabels(t, s, G, frame, furniture);
    }

    // The lattice: re-pack the state texture when the world changed, then
    // one full-screen pass. Returns false while the device is unusable.
    function drawGpu(s, t, G, S, dpr) {
        const { cq, cr } = hexBounds(s.grid.W, s.grid.H), o = s.stateOpts;
        if (stateDirty) {
            gpu.uploadState(s.grid, s.mode, o);
            if (s.field && s.field.padded) gpu.uploadField(s.field.padded, s.field.side);
            stateDirty = false;
        }
        gpu.resize(canvas.width, canvas.height);
        const po = o.paintOverlay;
        const rampInk = s.mode === ViewMode.AGE ? t.inks.umber : s.mode === ViewMode.HEALTH ? t.inks.viridian : t.inks.prussian;
        return gpu.render({
            cssW: s.vp.cssWidth, cssH: s.vp.cssHeight, dpr, rc: G.rc, cx: G.cx, cy: G.cy, R: G.R,
            closed: S.closed, fade: [G.apo * 0.92, G.Rb * 1.9, t.dark ? 0.55 : 0.5], mode: s.mode,
            histology: s.histology, animalDisplay: o.animalDisplay, maxLevel: s.field ? s.field.maxLevel : 0, isoLatest: s.field ? s.field.latest : 0, step: 8, fadeDays: s.fadeDays,
            brush: { q: po ? po.q - cq : 0, r: po ? po.r - cr : 0, size: po ? po.brushSize : 0, active: !!(po && po.inside && po.mode !== 'none'), ink: paintInk(po ? po.mode : 'seed', t) },
            cq, cr, W: s.grid.W, side: s.field ? s.field.side : 0, theme: t, rampInk,
            wheel: wheelParams(),
            ghosts: S.closed ? edgeGluings(s.topology, G.R) : null
        });
    }

    // The centre row's ends, A at the west corner and A′ at the east: the
    // section Fig. 3 plots against time. Below the corner, where a cone
    // point's label (above it) leaves room.
    function drawSection(t, G, frame) {
        ctx.font = font(12, true); ctx.textBaseline = 'middle'; ctx.fillStyle = t.muted;
        for (const [k, label, out] of [[3, 'A', -1], [0, 'A′', 1]]) {
            const [x, y] = corner(G, k), w = ctx.measureText(label).width;
            let dir = out;
            if (dir > 0 && x + 9 + w > frame.x + frame.w - 4) dir = -1;
            if (dir < 0 && x - 9 - w < frame.x + 4) dir = 1;
            ctx.textAlign = dir > 0 ? 'left' : 'right';
            ctx.fillText(label, x + dir * 7, y + 12);
            placed.push(dir > 0 ? [x + 5, y + 4, x + 9 + w, y + 20] : [x - 9 - w, y + 4, x - 5, y + 20]);
        }
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    }

    // The trunk on the map (Strain view): a lineage's route through its
    // ancestors' birthplaces (strains.js bornAt), oldest first. Each leg runs
    // the short way round: straight, or, when the far end is nearer through a
    // glued edge, as two segments, one to its image beyond that edge and one
    // from the near end's image beyond the partner edge, clipped to the world,
    // so the leg runs to the edge and on from where the gluing takes it, as
    // the lineage did. A dot marks each birth; the strain's own is ringed in
    // its mark.
    function drawTrunk(t, s, G, S) {
        const { reg, id } = s.trunk, W = s.grid.W, { cq, cr } = hexBounds(W, s.grid.H);
        const births = [];
        for (let k = id, guard = 0; k !== null && k !== undefined && guard < 65536; guard++) {
            const c = reg.bornAt[k];
            if (c >= 0 && c !== births[births.length - 1]) births.push(c);
            k = reg.parent[k];
        }
        if (!births.length) return;
        births.reverse();
        const at = (c) => [c % W - cq, ((c / W) | 0) - cr];
        const toPx = ([q, r]) => { const [x, y] = axialToPx(q, r, G.rc); return [G.cx + x, G.cy + y]; };
        const far = ([q0, r0], [q1, r1]) => { const [x, y] = axialToPx(q1 - q0, r1 - r0, 1); return x * x + y * y; };
        const map = (g, [q, r]) => [g.m[0] * q + g.m[1] * r + g.v[0], g.m[2] * q + g.m[3] * r + g.v[1]];
        const unmap = (g, [q, r]) => {
            const [a, b, c, d] = g.m, det = a * d - b * c, x = q - g.v[0], y = r - g.v[1];
            return [(d * x - b * y) / det, (a * y - c * x) / det];
        };
        const glue = S.closed ? edgeGluings(s.topology, G.R) : null;
        const seg = (p, q) => { const [x0, y0] = toPx(p), [x1, y1] = toPx(q); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); };
        ctx.save();
        ctx.beginPath();
        for (let k = 0; k < 6; k++) { const [x, y] = corner(G, k); if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
        ctx.closePath(); ctx.clip();
        ctx.strokeStyle = t.rgba(t.text, 0.72); ctx.lineWidth = 1.3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath();
        for (let k = 1; k < births.length; k++) {
            const a = at(births[k - 1]), b = at(births[k]);
            let best = b, d = far(a, b), via = null;
            if (glue) for (const g of glue) {
                if (!g) continue;
                const bi = map(g, b), di = far(a, bi);
                if (di < d) { d = di; best = bi; via = g; }
            }
            seg(a, best);
            if (via) seg(unmap(via, a), b);
        }
        ctx.stroke();
        ctx.fillStyle = t.rgba(t.text, 0.78);
        ctx.beginPath();
        for (const c of births) { const [x, y] = toPx(at(c)); ctx.moveTo(x + 2, y); ctx.arc(x, y, 2, 0, Math.PI * 2); }
        ctx.fill();
        if (reg.bornAt[id] >= 0) {
            const [x, y] = toPx(at(reg.bornAt[id]));
            ctx.fillStyle = t.paper; ctx.strokeStyle = strainStyle(reg, id).ink; ctx.lineWidth = 1.6;
            ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
        ctx.restore();
    }

    function corner(G, k) {
        const a = k * Math.PI / 3;
        return [G.cx + G.Rb * Math.cos(a), G.cy + G.Rb * Math.sin(a)];
    }

    function chevrons(mx, my, tx, ty, n, color) {
        const gap = 6.5;
        ctx.save();
        ctx.translate(mx, my);
        ctx.transform(tx, ty, -ty, tx, 0, 0);
        ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        for (let i = 0; i < n; i++) {
            const o = (i - (n - 1) / 2) * gap;
            ctx.beginPath(); ctx.moveTo(o - 3.4, -5.4); ctx.lineTo(o + 3, 0); ctx.lineTo(o - 3.4, 5.4); ctx.stroke();
        }
        ctx.restore();
    }

    function drawEdges(t, G, S) {
        const pairOf = new Array(6).fill(null);
        S.pairs.forEach(([e, f, kind], n) => { pairOf[e] = { n: n + 1, kind, first: true }; pairOf[f] = { n: n + 1, kind, first: false }; });
        for (let k = 0; k < 6; k++) {
            const [x0, y0] = corner(G, k), [x1, y1] = corner(G, k + 1);
            const na = (60 * k + 30) * Math.PI / 180, nx = Math.cos(na), ny = Math.sin(na);
            const p = pairOf[k];
            if (p) {
                ctx.strokeStyle = t.ruleSoft; ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
                // tangent from corner k to k+1; a translated partner runs the other way
                let tx = (x1 - x0), ty = (y1 - y0);
                const L = Math.hypot(tx, ty); tx /= L; ty /= L;
                if (!p.first && p.kind === 'translate') { tx = -tx; ty = -ty; }
                const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
                ctx.fillStyle = t.paper;
                ctx.beginPath(); ctx.arc(mx, my, 7 + p.n * 3.4, 0, Math.PI * 2); ctx.fill();
                chevrons(mx, my, tx, ty, p.n, t.text);
            } else {
                // a shore: heavier rule, hachures falling away from the land
                ctx.strokeStyle = t.rgba(t.text, 0.85); ctx.lineWidth = 1.6;
                ctx.beginPath(); ctx.moveTo(x0 + nx * 1.5, y0 + ny * 1.5); ctx.lineTo(x1 + nx * 1.5, y1 + ny * 1.5); ctx.stroke();
                ctx.strokeStyle = t.rgba(t.text, 0.42); ctx.lineWidth = 1;
                ctx.beginPath();
                const len = Math.hypot(x1 - x0, y1 - y0), n = Math.floor(len / 6.5);
                for (let i = 1; i < n; i++) {
                    const u = i / n, px = x0 + (x1 - x0) * u, py = y0 + (y1 - y0) * u, h = i % 2 ? 5.5 : 3.5;
                    ctx.moveTo(px + nx * 3.5, py + ny * 3.5); ctx.lineTo(px + nx * (3.5 + h), py + ny * (3.5 + h));
                }
                ctx.stroke();
            }
        }
    }

    function drawCones(t, G, cones, frame) {
        ctx.font = font(11.5, true); ctx.textBaseline = 'middle';
        for (let k = 0; k < 6; k++) {
            if (!cones[k].length) continue;
            const [x, y] = corner(G, k), a = k * Math.PI / 3;
            ctx.fillStyle = t.paper; ctx.strokeStyle = t.text; ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.arc(x, y, 3.4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            const label = cones[k].map(v => v + '°').join(', ');
            const w = ctx.measureText(label).width;
            // outward from the corner, unless that leaves the frame
            let dir = Math.cos(a) > 0.3 ? 1 : Math.cos(a) < -0.3 ? -1 : 0;
            if (dir > 0 && x + 15 + w > frame.x + frame.w - 4) dir = -1;
            if (dir < 0 && x - 15 - w < frame.x + 4) dir = 1;
            const lx = dir ? x + dir * 12 : x, ly = dir ? y + Math.sin(a) * 15 - (Math.abs(Math.sin(a)) < 0.2 ? 13 : 0) : y + Math.sin(a) * 15;
            ctx.textAlign = dir > 0 ? 'left' : dir < 0 ? 'right' : 'center';
            const bx = ctx.textAlign === 'left' ? lx - 2 : ctx.textAlign === 'right' ? lx - w - 2 : lx - w / 2 - 2;
            ctx.fillStyle = t.rgba(t.paper, 0.9); ctx.fillRect(bx, ly - 8, w + 4, 16);
            ctx.fillStyle = t.muted; ctx.fillText(label, lx, ly);
            placed.push([bx, ly - 8, bx + w + 4, ly + 8]);
        }
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    }

    const hit = (r) => placed.some(p => r[0] < p[2] && r[2] > p[0] && r[1] < p[3] && r[3] > p[1]);

    // A level is labeled only while its line is still plain (isoFade at least
    // LABEL_FADE), at the segments of a connected run at least LABEL_RUN cells
    // long, so the small loops around single spillover cases carry no number.
    function drawIsoLabels(t, s, G, frame, furniture) {
        const cs = s.contours;
        if (!cs || !cs.length) return;
        const narrow = frame.w < 600, latest = s.field ? s.field.latest : 0;
        ctx.font = font(narrow ? 11 : 12.5, true); ctx.textBaseline = 'middle';
        for (const { level, segs, runLen } of cs) {
            if (level % (narrow ? ISO_LABEL * 2 : ISO_LABEL) || !runLen) continue;
            const fade = isoFade(latest - level, s.fadeDays);
            if (fade < LABEL_FADE) continue;
            const text = 'day ' + level, w = ctx.measureText(text).width + 8;
            const long = [];
            for (let k = 0; k < runLen.length; k++) if (runLen[k] >= LABEL_RUN) long.push(k);
            const stepK = Math.max(1, Math.floor(long.length / 28));
            let done = 0;
            for (let m = Math.floor(stepK / 2); m < long.length && done < (narrow ? 1 : 2); m += stepK) {
                const k = long[m];
                const ax = (segs[k * 4] + segs[k * 4 + 2]) / 2, ay = (segs[k * 4 + 1] + segs[k * 4 + 3]) / 2;
                const [q, r] = pxToAxial(ax, ay, 1);
                if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) > G.R - 4) continue;
                const x = G.cx + ax * G.rc, y = G.cy + ay * G.rc;
                const rect = [x - w / 2, y - 9, x + w / 2, y + 9];
                if (rect[0] < frame.x + 4 || rect[2] > frame.x + frame.w - 4 || rect[1] < frame.y + 40 || rect[3] > frame.y + frame.h - 4) continue;
                if (hit(rect) || furniture.some(f => rect[0] < f[2] && rect[2] > f[0] && rect[1] < f[3] && rect[3] > f[1])) continue;
                placed.push([rect[0] - 18, rect[1] - 10, rect[2] + 18, rect[3] + 10]);
                ctx.fillStyle = t.rgba(t.paper, 0.92); ctx.fillRect(rect[0], rect[1] + 1, w, 16);
                ctx.fillStyle = t.rgba(t.text, fade); ctx.textAlign = 'center';
                ctx.fillText(text, x, y + 1);
                done++;
            }
        }
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    }

    // Title (top right), Reference cartouche (bottom left), scale bar (bottom
    // right). Returns their rectangles so labels keep clear of them.
    function drawFurniture(t, s, G, f) {
        const rects = [], narrow = f.w < 600;
        // title
        ctx.font = font(narrow ? 13.5 : 14.5, true); ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
        const title = plateTitle(s.presetKey, s.histology, narrow);
        if (title) {
            const tw = ctx.measureText(title).width, tx = f.x + f.w - (narrow ? 12 : 22), ty = f.y + (narrow ? 18 : 24);
            ctx.fillStyle = t.rgba(t.paper, 0.92); ctx.fillRect(tx - tw - 8, ty - 17, tw + 14, 24);
            ctx.fillStyle = t.muted; ctx.fillText(title, tx, ty);
            rects.push([tx - tw - 8, ty - 17, tx + 6, ty + 7]);
        }
        // scale bar
        const cell = SQRT3 * G.rc, nice = [1, 2, 5, 10, 20, 50];
        let per = nice.find(v => v * cell >= (narrow ? 26 : 34)) || 50;
        const segs = narrow ? 3 : 4, segW = per * cell, bw = segW * segs;
        const bx = f.x + f.w - (narrow ? 12 : 22) - bw, by = f.y + f.h - (narrow ? 14 : 24);
        ctx.fillStyle = t.rgba(t.paper, 0.92); ctx.fillRect(bx - 10, by - 22, bw + 22, 32);
        for (let i = 0; i < segs; i++) { ctx.fillStyle = i % 2 ? t.paper : t.text; ctx.fillRect(bx + i * segW, by, segW, 4); }
        ctx.strokeStyle = t.text; ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, 4);
        ctx.font = font(12.5); ctx.fillStyle = t.text2; ctx.textAlign = 'center';
        const unit = s.scaleUnit || { per: 1, name: 'cells' };
        ctx.fillText('0', bx, by - 6);
        if (!narrow) for (let i = 2; i < segs; i += 2) ctx.fillText(String(per * i * unit.per), bx + segW * i, by - 6);
        ctx.textAlign = 'right';
        ctx.fillText(`${per * segs * unit.per} ${unit.name}`, bx + bw + 6, by - 6);
        rects.push([bx - 10, by - 22, bx + bw + 12, by + 10]);
        // Reference cartouche
        if (f.w >= 640 && f.h >= 460 && s.legend && s.legend.length) {
            const rows = s.legend, rowH = 18.5, lw = 178, lh = rowH * rows.length + 38;
            const lx = f.x + 18, ly = f.y + f.h - lh - 18;
            ctx.fillStyle = t.rgba(t.paper, 0.95); ctx.fillRect(lx, ly, lw, lh);
            ctx.strokeStyle = t.rgba(t.text, 0.5); ctx.lineWidth = 1; ctx.strokeRect(lx + 0.5, ly + 0.5, lw - 1, lh - 1);
            ctx.strokeStyle = t.rgba(t.text, 0.2); ctx.strokeRect(lx + 3.5, ly + 3.5, lw - 7, lh - 7);
            ctx.font = font(14.5, true); ctx.fillStyle = t.text; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
            ctx.fillText('Reference', lx + lw / 2, ly + 23);
            ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = font(13);
            rows.forEach((row, i) => {
                const yy = ly + 39 + i * rowH, sx = lx + 20;
                swatch(t, row.kind, sx, yy, row);
                ctx.fillStyle = t.text2; ctx.font = font(13);
                ctx.fillText(row.label, sx + 17, yy + 1);
            });
            ctx.textBaseline = 'alphabetic';
            rects.push([lx, ly, lx + lw, ly + lh]);
        }
        return rects;
    }

    // Legend swatches drawn with the plate's own marks.
    function swatch(t, kind, x, y, row) {
        ctx.save();
        ctx.beginPath();
        const clipHex = () => { ctx.beginPath(); hexPath(ctx, x, y, 7); };
        switch (kind) {
            case 'I': case 'E': clipHex(); ctx.fillStyle = kind === 'I' ? t.infectious : t.exposed; ctx.fill(); break;
            case 'S': ctx.fillStyle = t.dot; for (const [a, b] of [[-3, -3], [3, -3], [0, 2], [-5, 3], [5, 3]]) ctx.fillRect(x + a - 0.8, y + b - 0.8, 1.6, 1.6); break;
            case 'R': clipHex(); ctx.clip(); ctx.fillStyle = t.stipple; for (const [a, b] of [[-3, -2], [2, -4], [0, 2], [-4, 3], [4, 1], [1, -1], [-1, 5], [5, -2]]) ctx.fillRect(x + a - 0.6, y + b - 0.6, 1.2, 1.2); break;
            case 'V': case 'H#': case 'Z': {
                clipHex(); ctx.clip();
                if (kind === 'Z') { ctx.fillStyle = t.rgba(t.zombie, 0.22); ctx.fill(); }
                ctx.strokeStyle = kind === 'Z' ? t.zombie : row.ink || t.hatch; ctx.lineWidth = 1;
                const ang = kind === 'V' ? [-45] : kind === 'Z' ? [45, -45] : [row.angle];
                for (const an of ang) {
                    const a = an * Math.PI / 180, ux = Math.cos(a), uy = Math.sin(a);
                    ctx.beginPath();
                    for (let s = -9; s <= 9; s += 3) { ctx.moveTo(x - uy * s - ux * 10, y + ux * s - uy * 10); ctx.lineTo(x - uy * s + ux * 10, y + ux * s + uy * 10); }
                    ctx.stroke();
                }
                break;
            }
            case 'H2': {
                // two strains in one host: the lighter load drawn thinner, first;
                // at one angle they interleave, as on the plate
                clipHex(); ctx.clip();
                const [a, b] = row.marks, same = Math.abs(a.angle - b.angle) < 1e-6;
                for (const [m, lw, off] of [[b, 0.5, same ? 1.5 : 0], [a, 1, 0]]) {
                    const r = m.angle * Math.PI / 180, ux = Math.cos(r), uy = Math.sin(r);
                    ctx.strokeStyle = m.ink; ctx.lineWidth = lw;
                    ctx.beginPath();
                    for (let s = -9 + off; s <= 9; s += 3) { ctx.moveTo(x - uy * s - ux * 10, y + ux * s - uy * 10); ctx.lineTo(x - uy * s + ux * 10, y + ux * s + uy * 10); }
                    ctx.stroke();
                }
                break;
            }
            case 'D': case 'Dc': ctx.strokeStyle = kind === 'D' ? t.cross : t.accent; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
                ctx.moveTo(x - 3.5, y - 3.5); ctx.lineTo(x + 3.5, y + 3.5); ctx.moveTo(x + 3.5, y - 3.5); ctx.lineTo(x - 3.5, y + 3.5); ctx.stroke(); break;
            case 'M': ctx.strokeStyle = t.maternal; ctx.lineWidth = 1.1; ctx.arc(x, y, 3.6, 0, Math.PI * 2); ctx.stroke(); break;
            case 'Q': ctx.strokeStyle = t.cordon; ctx.lineWidth = 1.2; hexPath(ctx, x, y, 6); ctx.stroke(); break;
            case '+': ctx.strokeStyle = t.cross; ctx.lineWidth = 1.2; ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y); ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4); ctx.stroke(); break;
            case 'A': ctx.fillStyle = t.accent; ctx.moveTo(x, y - 3.5); ctx.lineTo(x + 3.5, y + 2.8); ctx.lineTo(x - 3.5, y + 2.8); ctx.closePath(); ctx.fill(); break;
            case 'L': ctx.strokeStyle = t.isoMajor; ctx.lineWidth = 1; ctx.moveTo(x - 8, y + 2); ctx.bezierCurveTo(x - 3, y - 5, x + 2, y + 6, x + 8, y - 2); ctx.stroke(); break;
            case 'G': ctx.strokeStyle = t.ruleSoft; ctx.lineWidth = 1; ctx.moveTo(x - 9, y); ctx.lineTo(x + 9, y); ctx.stroke(); ctx.restore(); ctx.fillStyle = t.paper; ctx.fillRect(x - 6, y - 6, 12, 12); chevrons(x, y, 1, 0, 2, t.text); return;
            case 'shore': ctx.strokeStyle = t.rgba(t.text, 0.85); ctx.lineWidth = 1.6; ctx.moveTo(x - 9, y - 2); ctx.lineTo(x + 9, y - 2); ctx.stroke();
                ctx.beginPath(); ctx.strokeStyle = t.rgba(t.text, 0.42); ctx.lineWidth = 1; for (const o of [-6, -1, 4]) { ctx.moveTo(x + o, y); ctx.lineTo(x + o, y + 4.5); } ctx.stroke(); break;
            case 'cone': ctx.fillStyle = t.paper; ctx.strokeStyle = t.text; ctx.lineWidth = 1.2; ctx.arc(x, y, 3.4, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); break;
            case 'ramp': for (let b = 0; b < 4; b++) { ctx.fillStyle = t.rgba(row.ink, 0.12 + 0.24 * b); ctx.fillRect(x - 9 + b * 4.5, y - 5, 4.5, 10); } break;
            // the trunk on the map: legs between birthplaces, the strain's own ringed in its mark
            case 'Tk': ctx.strokeStyle = t.rgba(t.text, 0.72); ctx.lineWidth = 1.3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
                ctx.moveTo(x - 9, y + 3); ctx.lineTo(x - 3, y - 3); ctx.lineTo(x + 5, y + 1); ctx.stroke();
                ctx.beginPath(); ctx.fillStyle = t.rgba(t.text, 0.78); for (const [a, b] of [[-9, 3], [-3, -3]]) { ctx.moveTo(x + a + 2, y + b); ctx.arc(x + a, y + b, 2, 0, Math.PI * 2); } ctx.fill();
                ctx.beginPath(); ctx.fillStyle = t.paper; ctx.strokeStyle = row.ink; ctx.lineWidth = 1.6; ctx.arc(x + 5, y + 1, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); break;
            // Descent: a trunk splitting into lighter twigs; a stroke into a live case or a zombie;
            // the ring of a case placed by hand; spillover from the animal's mark
            case 'Dl': ctx.strokeStyle = t.muted; ctx.lineCap = 'round';
                for (const [x1, y1, w] of [[-9, 0, 3], [8, -5, 1.6], [8, 5, 0.8]]) { ctx.beginPath(); ctx.lineWidth = w; ctx.moveTo(x, y); ctx.lineTo(x + x1, y + y1); ctx.stroke(); }
                break;
            case 'Dt': case 'Dz': ctx.strokeStyle = kind === 'Dt' ? t.accent : t.zombie; ctx.lineWidth = 1.6; ctx.lineCap = 'round'; ctx.moveTo(x - 8, y); ctx.lineTo(x + 8, y); ctx.stroke(); break;
            case 'Do': ctx.strokeStyle = t.muted; ctx.lineWidth = 1.1; ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.stroke(); break;
            case 'Dx': ctx.fillStyle = t.zombie; ctx.arc(x, y, 3.2, 0, Math.PI * 2); ctx.fill(); break;
            case 'Da': ctx.strokeStyle = t.muted; ctx.lineWidth = 1.4; ctx.lineCap = 'round'; ctx.moveTo(x - 5, y - 3); ctx.lineTo(x + 3, y + 2); ctx.stroke();
                ctx.beginPath(); ctx.fillStyle = t.accent; ctx.moveTo(x + 4, y - 0.5); ctx.lineTo(x + 7.5, y + 5.8); ctx.lineTo(x + 0.5, y + 5.8); ctx.closePath(); ctx.fill(); break;
            default: if (row.draw) row.draw(ctx, x, y, t);
        }
        ctx.restore();
    }

    /** Cell under a canvas point, through the faded copies too; { q, r } or null. */
    function pick(grid, vp, topology, x, y) {
        const G = geometry(grid, vp), { cq, cr } = hexBounds(grid.W, grid.H);
        const dx = x - G.cx, dy = y - G.cy;
        const [fq, fr] = pxToAxial(dx, dy, G.rc), [q, r] = roundAxial(fq, fr);
        if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= G.R) return { q: cq + q, r: cr + r };
        if (!SURFACES[topology].closed || Math.hypot(dx, dy) > G.Rb * 1.85) return null;
        return wrap(cq + q, cr + r, topology, grid.W, grid.H);
    }

    return {
        draw, pick, geometry,
        get gpu() { return !!gpu && !gpu.lost; },
        markState() { stateDirty = true; }
    };
}

