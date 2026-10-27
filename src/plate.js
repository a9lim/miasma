// plate.js — composes the plate each frame: the world tile, its faded copies
// beyond the glued edges, the edges themselves, isochrone labels, and the
// plate furniture (title, Reference cartouche, scale bar).
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
//   scale bar             the lattice's own scale (cells; µm on the slide)

import { SQRT3, ViewMode } from './config.js';
import { hexBounds, edgeGluings, cornerCones, SURFACES, wrap } from './topology.js';
import { plateTheme, renderTile, axialToPx, pxToAxial, roundAxial, hexPath, paintInk, _tile } from './render.js';
import { createGpuPlate } from './gpu-plate.js';
import { wheelParams } from './strain-style.js';
import { ISO_LABEL, LABEL_FADE, LABEL_RUN, isoFade } from './isochrones.js';
import { getPreset, plateNumeral } from './presets.js';

/**
 * Plate title: the experiment (its plate numeral and name; the sandbox has
 * neither), the surface, and what the view draws; shorter on a 'medium'
 * plate, the numeral alone on a 'narrow' one. `immunity` names the immunity
 * view's strain.
 */
export function plateTitle(mode, topology, histology, width, immunity, presetKey) {
    const S = SURFACES[topology], p = getPreset(presetKey), numeral = plateNumeral(presetKey);
    const n = numeral ? `Plate ${numeral}.` : 'Sandbox.';
    if (width === 'narrow') return numeral ? n : '';
    if (width === 'medium') return p ? `${n} ${p.label}` : n;
    const subject = p ? p.label : 'The outbreak';
    const on = 'on a ' + (S.key === 'rp2' ? 'projective plane' : S.name);
    if (histology) return `${n} ${subject}: a section stained with haematoxylin and eosin`;
    switch (mode) {
        case ViewMode.STRAIN: return `${n} ${subject} ${on}, by strain`;
        case ViewMode.AGE: return `${n} ${subject} ${on}, by age`;
        case ViewMode.HEALTH: return `${n} ${subject} ${on}, by health`;
        case ViewMode.STATUS: return `${n} ${subject} ${on}: hospital beds and quarantine`;
        case ViewMode.IMMUNITY: return `${n} ${subject} ${on}, by immunity to strain ${(immunity && immunity.name) || 'α'}`;
        default: return `${n} ${subject} ${on}, by day of arrival`;
    }
}

/**
 * The plate on `canvas` (2D: edges, labels, furniture, and everything when
 * WebGPU is unavailable) over `gpuCanvas` (the lattice, when it is).
 * `onGpu(ok)` is called once WebGPU has started or failed.
 */
export function createPlate(canvas, gpuCanvas, onGpu) {
    const ctx = canvas.getContext('2d');
    const ghost = { c: document.createElement('canvas'), x: null };
    ghost.x = ghost.c.getContext('2d');
    let tileDirty = true, last = null, gpu = null;
    if (gpuCanvas && !/[?&]canvas2d\b/.test(location.search)) {
        createGpuPlate(gpuCanvas).then((g) => {
            gpu = g;
            if (onGpu) onGpu(!!g);
        }, () => { if (onGpu) onGpu(false); });
    } else if (onGpu) Promise.resolve().then(() => onGpu(false));
    const placed = [];
    const font = (size, italic) => `${italic ? 'italic ' : ''}${size}px ${_FONT.text}`;

    function geometry(grid, vp) {
        const { cq, cr, R } = hexBounds(grid.W, grid.H), rc = vp.hexSize;
        const [ox, oy] = axialToPx(cq, cr, rc);
        return { R, rc, cx: vp.originX + ox, cy: vp.originY + oy, apo: 1.5 * rc * (R + 0.5), Rb: SQRT3 * rc * (R + 0.5) };
    }

    // Canvas transform for the copy of the world under gluing g, around (cx, cy).
    function ghostMatrix(g, G) {
        const [a, b, c, d] = g.m;
        // K = A·M·A⁻¹ with A = [[√3, √3/2], [0, 3/2]] (axial → pixel)
        const A = [SQRT3, SQRT3 / 2, 0, 1.5], Ai = [1 / SQRT3, -1 / 3, 0, 2 / 3];
        const AM = [A[0] * a + A[1] * c, A[0] * b + A[1] * d, A[2] * a + A[3] * c, A[2] * b + A[3] * d];
        const K = [AM[0] * Ai[0] + AM[1] * Ai[2], AM[0] * Ai[1] + AM[1] * Ai[3], AM[2] * Ai[0] + AM[3] * Ai[2], AM[2] * Ai[1] + AM[3] * Ai[3]];
        const [vx, vy] = axialToPx(g.v[0], g.v[1], G.rc);
        return [K[0], K[2], K[1], K[3], G.cx + vx, G.cy + vy];
    }

    /**
     * Draw one frame. s: { grid, vp, topology, mode, dpr, tileOpts, contours,
     * histology, legend, scaleUnit }.
     */
    function draw(s) {
        const t = plateTheme(), dpr = s.dpr, W = s.vp.cssWidth, H = s.vp.cssHeight, G = geometry(s.grid, s.vp);
        const S = SURFACES[s.topology], frame = s.vp.frame;
        if (gpu && !gpu.lost && drawGpu(s, t, G, S, dpr)) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            overlay(s, t, G, S, frame);
            return;
        }
        if (tileDirty || !last || last.rc !== G.rc || last.dpr !== dpr) {
            renderTile(s.grid, G.rc, Object.assign({ dpr, contours: s.contours, isoLatest: s.field ? s.field.latest : 0, histology: s.histology }, s.tileOpts));
            tileDirty = false;
        }
        last = { rc: G.rc, dpr };
        const T = _tile;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = t.paper;
        ctx.fillRect(0, 0, W, H);
        const gl = S.closed ? edgeGluings(s.topology, G.R) : null;
        if (gl) {
            if (ghost.c.width !== canvas.width || ghost.c.height !== canvas.height) { ghost.c.width = canvas.width; ghost.c.height = canvas.height; }
            const g2 = ghost.x;
            g2.setTransform(1, 0, 0, 1, 0, 0);
            g2.globalCompositeOperation = 'source-over';
            g2.clearRect(0, 0, ghost.c.width, ghost.c.height);
            for (let e = 0; e < 6; e++) {
                const m = ghostMatrix(gl[e], G);
                g2.setTransform(dpr * m[0], dpr * m[1], dpr * m[2], dpr * m[3], dpr * m[4], dpr * m[5]);
                g2.drawImage(T.c, -T.w / 2, -T.h / 2, T.w, T.h);
            }
            // the copies fade with distance, so they read as "continues", not as more world
            g2.setTransform(dpr, 0, 0, dpr, 0, 0);
            g2.globalCompositeOperation = 'destination-in';
            const peak = t.dark ? 0.55 : 0.5;
            const grad = g2.createRadialGradient(G.cx, G.cy, G.apo * 0.92, G.cx, G.cy, G.Rb * 1.9);
            grad.addColorStop(0, `rgba(0,0,0,${peak})`);
            grad.addColorStop(0.42, `rgba(0,0,0,${peak * 0.5})`);
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            g2.fillStyle = grad;
            g2.fillRect(0, 0, W, H);
            g2.globalCompositeOperation = 'source-over';
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.drawImage(ghost.c, 0, 0);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
        ctx.drawImage(T.c, G.cx - T.w / 2, G.cy - T.h / 2, T.w, T.h);
        overlay(s, t, G, S, frame);
    }

    function overlay(s, t, G, S, frame) {
        drawEdges(t, G, S);
        placed.length = 0;
        const furniture = drawFurniture(t, s, G, frame).concat(s.avoid || []);
        if (S.closed) drawCones(t, G, cornerCones(s.topology, G.R), frame);
        if (!s.histology || s.mode !== ViewMode.COMPARTMENT) drawIsoLabels(t, s, G, frame, furniture);
    }

    // The lattice through WebGPU: re-pack the state texture when the world
    // changed, then one full-screen pass. Returns false to fall back.
    function drawGpu(s, t, G, S, dpr) {
        const { cq, cr } = hexBounds(s.grid.W, s.grid.H), o = s.tileOpts;
        if (tileDirty) {
            gpu.uploadState(s.grid, s.mode, o);
            if (s.field && s.field.padded) gpu.uploadField(s.field.padded, s.field.side);
            tileDirty = false;
        }
        gpu.resize(canvas.width, canvas.height);
        const po = o.paintOverlay;
        const rampInk = s.mode === ViewMode.AGE ? t.inks.umber : s.mode === ViewMode.HEALTH ? t.inks.viridian : t.inks.prussian;
        return gpu.render({
            cssW: s.vp.cssWidth, cssH: s.vp.cssHeight, dpr, rc: G.rc, cx: G.cx, cy: G.cy, R: G.R,
            closed: S.closed, fade: [G.apo * 0.92, G.Rb * 1.9, t.dark ? 0.55 : 0.5], mode: s.mode,
            histology: s.histology, animalDisplay: o.animalDisplay, maxLevel: s.field ? s.field.maxLevel : 0, isoLatest: s.field ? s.field.latest : 0, step: 8,
            brush: { q: po ? po.q - cq : 0, r: po ? po.r - cr : 0, size: po ? po.brushSize : 0, active: !!(po && po.inside && po.mode !== 'none'), ink: paintInk(po ? po.mode : 'seed', t) },
            cq, cr, W: s.grid.W, side: s.field ? s.field.side : 0, theme: t, rampInk,
            wheel: wheelParams(),
            ghosts: S.closed ? edgeGluings(s.topology, G.R) : null
        });
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
            const fade = isoFade(latest - level);
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
        const title = plateTitle(s.mode, s.topology, s.histology, narrow ? 'narrow' : f.w < 820 ? 'medium' : 'wide', s.tileOpts && s.tileOpts.immunity, s.presetKey);
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
        markTile() { tileDirty = true; },
        get ctx() { return ctx; }
    };
}

