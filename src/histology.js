// histology.js — the oncoviral preset as an H&E-stained section.
//
// The same lattice and the same Z state machine, read at the scale of cells:
// each hex is a cell, eosin (madder) stains its cytoplasm and haematoxylin
// (violet) its nucleus. What each mark reads:
//   normal nucleus, small and round     S, R, M and V cells
//   latent integration                  an E cell carrying the provirus: a dot
//                                       of red in the nucleus
//   viral inclusion                     I: the nucleus holds a red inclusion body
//   enlarged, dark, irregular nucleus   Z, the transformed clone (nuclear atypia)
//   pink, anucleate                     D, necrosis (crowding exhaustion at the
//                                       tumor core): eosin deepens, the nucleus
//                                       breaks into dust
//   bare glass                          EMPTY
// Nuclear size and density carry the state, so the slide reads in grayscale.

import { Compartment, Flag } from './config.js';

function hash(i) {
    let x = (i ^ 0x9e3779b9) >>> 0;
    x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
    return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

export function drawHistology(c, grid, T, rc, t, opts) {
    const act = grid.activeIndices, comp = grid.compartment, flags = grid.flags;
    const eosin = t.inks.madder, haem = t.inks.violet, deep = t.inks.indigo;
    const living = [], necrotic = [], normal = [], latent = [], infected = [], transformed = [];
    for (let k = 0; k < act.length; k++) {
        const i = act[k], x = comp[i];
        if (x === Compartment.EMPTY) continue;
        if (x === Compartment.D) { necrotic.push(i); continue; }
        living.push(i);
        if (x === Compartment.Z) transformed.push(i);
        else if (x === Compartment.I) infected.push(i);
        else if (x === Compartment.E) (flags[i] & Flag.LATENT ? latent : normal).push(i);
        else normal.push(i);
    }
    const cell = (cells, fill, rr) => {
        if (!cells.length) return;
        c.fillStyle = fill;
        c.beginPath();
        for (const i of cells) hexAt(c, T.px[i], T.py[i], rr);
        c.fill();
    };
    // cytoplasm; the paper between cells reads as the membranes
    const rr = rc * (rc > 3 ? 0.9 : 0.97);
    cell(living, t.rgba(eosin, t.dark ? 0.44 : 0.36), rr);
    cell(transformed, t.rgba(haem, t.dark ? 0.22 : 0.16), rr);
    cell(necrotic, t.rgba(eosin, t.dark ? 0.66 : 0.56), rr);
    const nuclei = (cells, color, size, jitter) => {
        if (!cells.length) return;
        c.fillStyle = color;
        c.beginPath();
        for (const i of cells) {
            const h = hash(i), h2 = hash(i + 7919);
            const x = T.px[i] + (h - 0.5) * jitter * rc, y = T.py[i] + (h2 - 0.5) * jitter * rc;
            const rx = size * rc * (0.85 + 0.3 * h2), ry = size * rc * (0.85 + 0.3 * h);
            c.moveTo(x + rx, y);
            c.ellipse(x, y, rx, ry, h * Math.PI, 0, Math.PI * 2);
        }
        c.fill();
    };
    nuclei(normal, t.rgba(haem, t.dark ? 0.82 : 0.72), 0.3, 0.25);
    nuclei(latent, t.rgba(haem, t.dark ? 0.86 : 0.78), 0.34, 0.25);
    nuclei(infected, t.rgba(haem, t.dark ? 0.6 : 0.5), 0.38, 0.2);
    nuclei(transformed, t.rgba(deep, t.dark ? 0.95 : 0.9), 0.52, 0.32);
    // the red: proviral foci and inclusion bodies
    const dots = (cells, size) => {
        if (!cells.length) return;
        c.fillStyle = t.accent;
        c.beginPath();
        for (const i of cells) {
            const x = T.px[i], y = T.py[i], s = Math.max(0.8, size * rc);
            c.moveTo(x + s, y); c.arc(x, y, s, 0, Math.PI * 2);
        }
        c.fill();
    };
    dots(latent, 0.1);
    dots(infected, 0.2);
    // karyorrhexis: the necrotic nucleus as dust
    c.fillStyle = t.rgba(haem, 0.6);
    c.beginPath();
    const d = Math.max(0.7, rc * 0.12);
    for (const i of necrotic) {
        const h = hash(i);
        for (let k = 0; k < 3; k++) {
            const a = (h + k / 3) * Math.PI * 2;
            c.rect(T.px[i] + Math.cos(a) * rc * 0.32 - d / 2, T.py[i] + Math.sin(a) * rc * 0.32 - d / 2, d, d);
        }
    }
    c.fill();
}

function hexAt(c, x, y, rr) {
    const h = rr * 0.8660254;
    c.moveTo(x, y - rr); c.lineTo(x + h, y - rr / 2); c.lineTo(x + h, y + rr / 2);
    c.lineTo(x, y + rr); c.lineTo(x - h, y + rr / 2); c.lineTo(x - h, y - rr / 2); c.closePath();
}

// Reference rows for the slide, drawn with the same marks.
const nucleus = (size, ink, alpha, inclusion) => (c, x, y, t) => {
    c.beginPath(); hexAt(c, x, y, 7); c.fillStyle = t.rgba(t.inks.madder, t.dark ? 0.44 : 0.36); c.fill();
    c.beginPath(); c.arc(x, y, size, 0, Math.PI * 2); c.fillStyle = t.rgba(t.inks[ink], alpha); c.fill();
    if (inclusion) { c.beginPath(); c.arc(x, y, inclusion, 0, Math.PI * 2); c.fillStyle = t.accent; c.fill(); }
};
export const HISTOLOGY_ROWS = [
    { label: 'Cell, normal nucleus', kind: 'draw', draw: nucleus(2.2, 'violet', 0.75) },
    { label: 'Latent provirus', kind: 'draw', draw: nucleus(2.5, 'violet', 0.8, 0.9) },
    { label: 'Viral inclusion', kind: 'draw', draw: nucleus(2.8, 'violet', 0.5, 1.5) },
    { label: 'Transformed, atypical', kind: 'draw', draw: nucleus(3.8, 'indigo', 0.92) },
    { label: 'Necrosis', kind: 'draw', draw: (c, x, y, t) => {
        c.beginPath(); hexAt(c, x, y, 7); c.fillStyle = t.rgba(t.inks.madder, t.dark ? 0.66 : 0.56); c.fill();
        c.fillStyle = t.rgba(t.inks.violet, 0.6);
        for (const [a, b] of [[-2, -1], [2, -2], [0, 2.5]]) c.fillRect(x + a - 0.6, y + b - 0.6, 1.2, 1.2);
    } },
    { label: 'Glass', kind: 'draw', draw: (c, x, y, t) => { c.beginPath(); hexAt(c, x, y, 7); c.strokeStyle = t.rgba(t.text, 0.25); c.lineWidth = 1; c.stroke(); } }
];
