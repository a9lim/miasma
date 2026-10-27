// strain-style.js — how a strain is drawn: hatch angle and hue from its antigen.
//
// A strain's antigenic position (ag_x, ag_y) on the torus of immunity.js is
// drawn directly: ag_x turns the hatching through 180°, ag_y walks the hue
// once around a wheel. Both axes are periodic, like the torus, so
// antigenically close strains look alike everywhere, drift reads as a slow
// turn of the hatching and a drift of colour, and a jump as a new colour.
// Pattern before hue: the angle alone separates strains in grayscale.
//
// The wheel is OKLCH at one lightness and chroma per theme, fitted like the
// inks so every hue clears 4.5:1 on the canvas and the panel (light L 0.525,
// C 0.08; dark L 0.62, C 0.10). The accent is the one red: α sits opposite
// it, the wheel hurries through the accent's hue, and its chroma dips there,
// so no strain reads as the disease. gpu-plate.js computes the same wheel in
// WGSL from wheelParams().

import { ANTIGENIC_SIZE, DEFAULTS } from './config.js';

const WHEEL = {
    light: { L: 0.525, C: 0.08, accentHue: 24.9 },   // accentHue: OKLCH hue of the theme's accent
    dark:  { L: 0.62,  C: 0.10, accentHue: 19.9 }
};
const HURRY = 0.35;        // the wheel turns (1 ± HURRY)× as fast; fastest through the accent
const DIP = 0.5;           // chroma × (1 − DIP·exp(−(Δh / DIP_WIDTH)²)) near the accent's hue
const DIP_WIDTH = 30;
export const ANGLE_CODES = 31;   // hatch angles the GPU texel carries (5 bits, 0 = none)

const theme = () => (typeof _themePalette === 'function' && _themePalette().dark ? 'dark' : 'light');

/** The wheel for the current theme: { L, C, accentHue, hurry, dip, dipWidth }. */
export function wheelParams() {
    return Object.assign({ hurry: HURRY, dip: DIP, dipWidth: DIP_WIDTH }, WHEEL[theme()]);
}

/** Hatch angle in degrees, [0, 180), from the antigen's x. */
export function markAngle(agx) {
    return (agx / ANTIGENIC_SIZE) * 180;
}

/** Hatch angle code 0..ANGLE_CODES−1 for the GPU texel. */
export function angleCode(agx) {
    return Math.round((agx / ANTIGENIC_SIZE) * ANGLE_CODES) % ANGLE_CODES;
}

/** Hue byte 0..255 from the antigen's y. */
export function hueByte(agy) {
    return Math.floor((agy / ANTIGENIC_SIZE) * 256) & 255;
}

// OKLCH → sRGB (0..1, gamma-encoded), the reference conversion.
function oklch(L, C, hDeg) {
    const h = hDeg * Math.PI / 180, a = C * Math.cos(h), b = C * Math.sin(h);
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
    const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
    const lin = [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    ];
    return lin.map(c => {
        const v = Math.min(1, Math.max(0, c));
        return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    });
}

/** OKLCH hue and chroma of hue byte `hb` on wheel `w`. */
function wheelAt(hb, w) {
    const v = ((hb + 0.5) / 256 + 0.5) % 1;   // α (ag_y 0) sits opposite the accent
    const h = w.accentHue + 360 * (v + w.hurry * Math.sin(2 * Math.PI * v) / (2 * Math.PI));
    const dh = Math.abs(((h - w.accentHue) % 360 + 540) % 360 - 180);
    return { h, C: w.C * (1 - w.dip * Math.exp(-(dh / w.dipWidth) * (dh / w.dipWidth))) };
}

const _lut = { light: null, dark: null };
function lut() {
    const t = theme();
    if (!_lut[t]) {
        const w = wheelParams();
        _lut[t] = Array.from({ length: 256 }, (_, hb) => {
            const { h, C } = wheelAt(hb, w);
            return '#' + oklch(w.L, C, h).map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
        });
    }
    return _lut[t];
}

/** Colour (#rrggbb, current theme) of hue byte `hb`. */
export function hueColor(hb) {
    return lut()[hb & 255];
}

/** Colour (#rrggbb, current theme) of an antigen's y. */
export function markColor(agy) {
    return lut()[hueByte(agy)];
}

/** { angle (degrees), ink (#rrggbb) } of an antigenic position. */
export function markAt(agx, agy) {
    return { angle: markAngle(agx), ink: markColor(agy) };
}

/** { angle, ink } of strain `id` in registry `reg`. */
export function strainStyle(reg, id) {
    return markAt(reg.ag_x[id] || 0, reg.ag_y[id] || 0);
}

/** Load quantized to the 15 line weights the plate draws (1..15; 15 is a whole load). */
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
