// model.js — the Model tab: Fig. 6, the compartment diagram, and under it
// the parameters of whichever part of the model is chosen.
//
// The diagram is the textbook figure of the model the plate runs: each
// compartment a node drawn with the plate's own mark (graphite dots for S,
// pale and solid red for E and I, stipple, hatching, a ring, a cross,
// cross-hatching), each transition an arrow. Bound to the model:
//   node count            cells in that compartment now (the census)
//   arrow weight          transitions along it a day, smoothed (flux)
//   rate on an arrow      the rate it runs at (β σ γ μ)
//   faded, dashed         switched off, or its rate is zero
//   letter by a node      a flag it can carry (L on E, C on R, F on D)
// Choosing a node or an arrow (or one of the topics under the figure) shows
// its switch and sliders below. No innerHTML: the figure is built with
// createElementNS, the rows with createElement.

import { buildSliderRow } from './params.js';
import { buildSwitchRow } from './toggles.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const NUMBER = new Intl.NumberFormat('en-US');

// ─── The parts of the model ────────────────────────────────────────────────
// rows: a slider { key, label, min, max, step, digits }, a switch
// { toggle, label }, or a subhead { head }. `needs` lists the toggles a row
// depends on; it is dimmed while any is off. `on(P, T)` says whether the part
// is running, for the figure's fading.

const PARTS = {
    S: {
        title: 'Transmission', sym: 'S → E',
        rows: [
            { key: 'beta', label: 'β, transmission', min: 0, max: 1, step: 0.005, digits: 3 },
            { key: 'season_amp', label: 'Seasonal swing', min: 0, max: 0.8, step: 0.01, digits: 2 },
            { key: 'age_susceptibility_mult', label: 'Old age × susceptibility', min: 0.5, max: 4, step: 0.05, digits: 2 }
        ]
    },
    E: {
        title: 'Exposed', sym: 'E',
        rows: [
            { key: 'sigma', label: 'σ, onset', min: 0.01, max: 1, step: 0.01, digits: 2 },
            { toggle: 'L', label: 'Latent infections, L' },
            { key: 'l_seed', label: 'Share that go latent', min: 0, max: 1, step: 0.01, digits: 2, needs: ['L'] },
            { key: 'l_reactivate', label: 'Reactivation a day', min: 0, max: 0.05, step: 0.0005, digits: 4, needs: ['L'] }
        ]
    },
    I: {
        title: 'Infectious', sym: 'I',
        rows: [
            { key: 'gamma', label: 'γ, recovery', min: 0.01, max: 1, step: 0.01, digits: 2 },
            { key: 'mu', label: 'μ, death', min: 0, max: 0.1, step: 0.001, digits: 3 },
            { key: 'age_severity_mult', label: 'Old age × μ', min: 0.5, max: 5, step: 0.05, digits: 2 },
            { key: 'health_degrade_per_tick', label: 'Health lost a day', min: 0, max: 0.2, step: 0.005, digits: 3 },
            { key: 'health_mortality_mult', label: 'Frailty × μ', min: 1, max: 6, step: 0.05, digits: 2 }
        ]
    },
    R: {
        title: 'Recovered', sym: 'R',
        rows: [
            { key: 'immunity_strength', label: 'Protection against the same strain', min: 0, max: 1, step: 0.01, digits: 2 },
            { toggle: 'C', label: 'Chronic carriers, C' },
            { key: 'c_seed', label: 'Share who carry', min: 0, max: 1, step: 0.01, digits: 2, needs: ['C'] },
            { key: 'c_transmit_mult', label: 'Carrier × β', min: 0, max: 1, step: 0.01, digits: 2, needs: ['C'] }
        ]
    },
    D: {
        title: 'Deaths', sym: 'D',
        rows: [
            { key: 'd_disposal', label: 'Cleared a day', min: 0, max: 0.2, step: 0.005, digits: 3 },
            { toggle: 'F', label: 'Infectious corpses, F' },
            { key: 'f_decay', label: 'Corpse fades a day', min: 0, max: 0.5, step: 0.01, digits: 2, needs: ['F'] },
            { key: 'f_transmit_mult', label: 'Corpse × β', min: 0, max: 1, step: 0.01, digits: 2, needs: ['F'] }
        ]
    },
    V: {
        title: 'Vaccinated', sym: 'V',
        rows: [
            { toggle: 'V', label: 'Vaccination, V' },
            { key: 'vax_efficacy', label: 'Efficacy', min: 0, max: 1, step: 0.01, digits: 2, needs: ['V'] },
            { key: 'vax_coverage', label: 'Coverage at the start', min: 0, max: 0.9, step: 0.01, digits: 2, needs: ['V'] },
            { toggle: 'vax_rollout', label: 'Rollout', needs: ['V'] },
            { key: 'vax_rollout_rate', label: 'Vaccinated a day', min: 0, max: 0.05, step: 0.0005, digits: 4, needs: ['V', 'vax_rollout'] }
        ],
        on: (P, T) => T.V
    },
    M: {
        title: 'Maternal immunity', sym: 'M',
        rows: [
            { toggle: 'M', label: 'Maternal immunity, M' },
            { key: 'm_decay', label: 'Wanes a day', min: 0, max: 0.2, step: 0.001, digits: 3, needs: ['M'] }
        ],
        on: (P, T) => T.M && P.birth_rate > 0
    },
    Z: {
        title: 'Z', sym: 'Z',
        rows: [
            { toggle: 'Z', label: 'The Z compartment' },
            { head: 'Rises' },
            { key: 'dz_dead', label: 'From infectious corpses', min: 0, max: 0.5, step: 0.005, digits: 3, needs: ['Z', 'F'] },
            { key: 'dz_alive', label: 'From the infectious', min: 0, max: 0.1, step: 0.001, digits: 3, needs: ['Z'] },
            { key: 'l_transform', label: 'From latent infections', min: 0, max: 0.05, step: 0.0005, digits: 4, needs: ['Z', 'L'] },
            { head: 'Each encounter with the living' },
            { key: 'z_fight_kill', label: 'Kills', min: 0, max: 1, step: 0.01, digits: 2, needs: ['Z'] },
            { key: 'z_fight_infect', label: 'Kills, leaving a corpse', min: 0, max: 1, step: 0.01, digits: 2, needs: ['Z'] },
            { key: 'z_fight_expose', label: 'Exposes', min: 0, max: 1, step: 0.01, digits: 2, needs: ['Z'] },
            { key: 'z_convert_unopposed', label: 'Converts', min: 0, max: 1, step: 0.01, digits: 2, needs: ['Z'] },
            { key: 'z_die_fighting', label: 'Z dies fighting', min: 0, max: 0.5, step: 0.005, digits: 3, needs: ['Z'] },
            { head: 'Dies' },
            { key: 'z_die_natural', label: 'Of age, a day', min: 0, max: 0.05, step: 0.0005, digits: 4, needs: ['Z'] },
            { key: 'z_exhaust_threshold', label: 'Crowded at Z neighbours', min: 1, max: 6, step: 1, digits: 0, needs: ['Z'] },
            { key: 'z_exhaust', label: 'Of crowding, a day', min: 0, max: 0.5, step: 0.01, digits: 2, needs: ['Z'] }
        ],
        on: (P, T) => T.Z
    },
    births: {
        title: 'Births and age', sym: '',
        rows: [
            { key: 'birth_rate', label: 'Birth rate, per living neighbour', min: 0, max: 0.2, step: 0.005, digits: 3 },
            { key: 'birth_threshold', label: 'Living neighbours needed', min: 1, max: 6, step: 1, digits: 0 },
            { key: 'mortality_baseline', label: 'Natural death, newborn', min: 0, max: 0.01, step: 0.0001, digits: 4 },
            { key: 'mortality_age_max', label: 'Natural death, old age', min: 0, max: 0.05, step: 0.0005, digits: 4 },
            { key: 'mortality_max_age', label: 'Old age, days', min: 100, max: 20000, step: 100, digits: 0 }
        ],
        on: (P) => P.birth_rate > 0 || P.mortality_baseline > 0 || P.mortality_age_max > 0
    },
    reservoir: {
        title: 'Reservoir', sym: '△',
        rows: [
            { key: 'spillover_rate', label: 'Spillover to people', min: 0, max: 0.5, step: 0.001, digits: 3 },
            { key: 'reverse_spillover_rate', label: 'People to animals', min: 0, max: 0.1, step: 0.001, digits: 3 },
            { key: 'animal_beta', label: 'Animal β', min: 0, max: 1, step: 0.01, digits: 2 },
            { key: 'animal_gamma', label: 'Animal γ', min: 0, max: 1, step: 0.01, digits: 2 },
            { key: 'animal_mu', label: 'Animal μ', min: 0, max: 0.1, step: 0.001, digits: 3 },
            { head: 'The animals' },
            { key: 'animal_density', label: 'Density at the start', min: 0, max: 0.5, step: 0.01, digits: 2 },
            { key: 'animal_seed', label: 'Infected at the start', min: 0, max: 0.5, step: 0.005, digits: 3 },
            { key: 'animal_birth_rate', label: 'Birth rate', min: 0, max: 0.2, step: 0.005, digits: 3 },
            { key: 'animal_birth_threshold', label: 'Neighbours needed', min: 1, max: 6, step: 1, digits: 0 },
            { key: 'animal_mortality_baseline', label: 'Natural death, newborn', min: 0, max: 0.01, step: 0.0001, digits: 4 },
            { key: 'animal_mortality_age_max', label: 'Natural death, old age', min: 0, max: 0.05, step: 0.0005, digits: 4 },
            { key: 'animal_max_age', label: 'Old age, days', min: 100, max: 20000, step: 100, digits: 0 },
            { key: 'animal_d_disposal', label: 'Carcass cleared a day', min: 0, max: 1, step: 0.01, digits: 2 },
            { display: 'animalDisplay', label: 'On the plate' }
        ],
        on: (P) => P.animal_density > 0
    },
    response: {
        title: 'Hospital and quarantine', sym: '',
        rows: [
            { toggle: 'auto_hospital', label: 'Hospitals' },
            { key: 'h_capacity_frac', label: 'Beds, share of cells', min: 0, max: 0.2, step: 0.005, digits: 3, needs: ['auto_hospital'] },
            { key: 'h_recover_mult', label: 'In hospital × γ', min: 0.5, max: 3, step: 0.05, digits: 2, needs: ['auto_hospital'] },
            { key: 'h_mortality_mult', label: 'In hospital × μ', min: 0, max: 1, step: 0.05, digits: 2, needs: ['auto_hospital'] },
            { key: 'h_overflow_mortality_mult', label: 'Without a bed × μ', min: 1, max: 3, step: 0.05, digits: 2, needs: ['auto_hospital'] },
            { toggle: 'auto_quarantine', label: 'Contact tracing' },
            { key: 'quarantine_trace_rate', label: 'Traced a day', min: 0, max: 1, step: 0.01, digits: 2, needs: ['auto_quarantine'] },
            { head: 'Quarantine, painted or traced' },
            { key: 'q_transmit_mult', label: 'Quarantined source × β', min: 0, max: 1, step: 0.01, digits: 2 },
            { key: 'q_susceptibility_mult', label: 'Quarantined target × β', min: 0, max: 1, step: 0.01, digits: 2 }
        ],
        on: (P, T) => T.auto_hospital || T.auto_quarantine
    },
    evolution: {
        title: 'Evolution', sym: '',
        rows: [
            { key: 'mutation_rate', label: 'Mutation rate', min: 0, max: 0.1, step: 0.001, digits: 3 },
            { key: 'mutation_strength', label: 'Rates jitter by', min: 0, max: 0.5, step: 0.01, digits: 2 },
            { key: 'ag_step', label: 'Antigenic step, AU', min: 0, max: 1.5, step: 0.01, digits: 2 },
            { key: 'ag_jump', label: 'Chance of a 2 AU jump', min: 0, max: 0.2, step: 0.005, digits: 3 },
            { head: 'In one host' },
            { key: 'coinfection_load_delta', label: 'A second strain enters at', min: 0, max: 1, step: 0.01, digits: 2 },
            { key: 'competition_strength', label: 'Competition', min: 0, max: 0.5, step: 0.005, digits: 3 },
            { key: 'recombination_rate', label: 'Recombination', min: 0, max: 0.2, step: 0.001, digits: 3 },
            { key: 'min_strain_load', label: 'Smallest load kept', min: 0, max: 0.2, step: 0.005, digits: 3 }
        ],
        on: (P) => P.mutation_rate > 0
    }
};

const ANIMAL_DISPLAY = [['dots', 'With people'], ['only', 'Alone'], ['off', 'Hidden']];

// ─── The figure ────────────────────────────────────────────────────────────
// A tall figure for a narrow margin: the chain S → E → I → R runs down the
// left column, the compartments it feeds (V, Z, D) sit in the middle one,
// and the sources and sinks (births, the reservoir, cleared cells) round the
// edges. Each node is a chip: the plate's mark, the letter, the count.
const COL = [80, 192, 300], ROW = [24, 90, 156, 222, 288];
const NODES = {
    src: { x: COL[0], y: ROW[0], part: 'births', word: 'births', label: 'Births and age' },
    M: { x: COL[1], y: ROW[0], part: 'M', count: 'M' },
    S: { x: COL[0], y: ROW[1], part: 'S', count: 'S' },
    V: { x: COL[1], y: ROW[1], part: 'V', count: 'V' },
    A: { x: COL[2], y: ROW[1], part: 'reservoir', count: 'animalTotal', label: 'Reservoir' },
    E: { x: COL[0], y: ROW[2], part: 'E', count: 'E', flag: 'L' },
    Z: { x: COL[1], y: ROW[2], part: 'Z', count: 'Z' },
    I: { x: COL[0], y: ROW[3], part: 'I', count: 'I' },
    D: { x: COL[1], y: ROW[3], part: 'D', count: 'D', flag: 'F' },
    sink: { x: COL[2], y: ROW[3], part: 'D', word: 'cleared', label: 'Deaths: cleared cells' },
    R: { x: COL[0], y: ROW[4], part: 'R', count: 'R', flag: 'C' }
};
const CHIP_W = 37, CHIP_H = 11;   // half-sizes

// from, to, the part it opens, the flux key (tick counts), a rate symbol
// and its param or a word (`at` its place along the arrow, from the source),
// dashed (a re-entry through memory), on(P, T) for fading, and `arc` (a bow
// to the left, in px) for a curved arrow.
const ARROWS = [
    { from: 'src', to: 'S', part: 'births', flux: 'births', on: (P) => P.birth_rate > 0 },
    { from: 'src', to: 'M', part: 'M', flux: 'births', on: (P, T) => T.M && P.birth_rate > 0 },
    { from: 'M', to: 'S', part: 'M', flux: 'mToS', word: 'wanes', on: (P, T) => T.M && P.birth_rate > 0 },
    { from: 'S', to: 'E', part: 'S', flux: 'sToE', sym: 'β', key: 'beta' },
    { from: 'S', to: 'V', part: 'V', flux: 'vaxRollout', word: 'vaccine', on: (P, T) => T.V && (T.vax_rollout || P.vax_coverage > 0) },
    { from: 'V', to: 'E', part: 'V', dashed: true, word: 'breakthrough', at: 0.45, on: (P, T) => T.V && P.vax_efficacy < 1 },
    { from: 'A', to: 'E', part: 'reservoir', flux: 'spillovers', word: 'spillover', at: 0.36, on: (P) => P.animal_density > 0 && P.spillover_rate > 0 },
    { from: 'E', to: 'I', part: 'E', flux: 'eToI', sym: 'σ', key: 'sigma' },
    { from: 'E', to: 'Z', part: 'Z', flux: 'lToZ', on: (P, T) => T.Z && T.L && P.l_transform > 0 },
    { from: 'I', to: 'R', part: 'I', flux: 'iToR', sym: 'γ', key: 'gamma' },
    { from: 'I', to: 'D', part: 'I', flux: 'iToD', sym: 'μ', key: 'mu' },
    { from: 'I', to: 'Z', part: 'Z', flux: 'iToZ', on: (P, T) => T.Z && P.dz_alive > 0 },
    { from: 'D', to: 'Z', part: 'Z', flux: 'dToZ', word: 'rises', on: (P, T) => T.Z && T.F && P.dz_dead > 0 },
    { from: 'D', to: 'sink', part: 'D', flux: 'dToEmpty', on: (P) => P.d_disposal > 0 },
    { from: 'R', to: 'E', part: 'R', dashed: true, word: 'reinfection', arc: 40, on: (P) => P.immunity_strength < 1 || P.ag_step > 0 || P.mutation_rate > 0 }
];

/** Tick-count keys the figure's arrows read, for main.js's smoothed flux. */
export const FLUX_KEYS = ['births', 'mToS', 'sToE', 'eToI', 'iToR', 'iToD', 'vaxRollout', 'spillovers', 'lToZ', 'iToZ', 'dToZ', 'dToEmpty'];

function el(name, attrs, parent) {
    const e = document.createElementNS(SVGNS, name);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
}

function hexD(x, y, r) {
    let d = '';
    for (let k = 0; k < 6; k++) {
        const a = Math.PI / 6 + k * Math.PI / 3;
        d += (k ? 'L' : 'M') + (x + r * Math.cos(a)).toFixed(2) + ' ' + (y + r * Math.sin(a)).toFixed(2);
    }
    return d + 'Z';
}

// The plate's marks as SVG patterns, coloured by CSS (styles.css .pat-*).
function defs(svg) {
    const d = el('defs', null, svg);
    const pat = (id, w, h, build) => { const p = el('pattern', { id, width: w, height: h, patternUnits: 'userSpaceOnUse' }, d); build(p); };
    pat('mdl-dots', 4.6, 4, (p) => { el('circle', { cx: 1.1, cy: 1, r: 0.7, class: 'pat-s' }, p); el('circle', { cx: 3.4, cy: 3, r: 0.7, class: 'pat-s' }, p); });
    pat('mdl-stipple', 5, 5, (p) => {
        for (const [x, y] of [[0.8, 1], [3.4, 0.6], [2, 2.8], [4.4, 3.4], [0.5, 4], [3, 4.6]]) el('circle', { cx: x, cy: y, r: 0.5, class: 'pat-r' }, p);
    });
    pat('mdl-hatch', 2.8, 2.8, (p) => el('path', { d: 'M-1 1L1 -1M0 2.8L2.8 0M1.8 3.8L3.8 1.8', class: 'pat-v' }, p));
    pat('mdl-cross', 2.8, 2.8, (p) => el('path', { d: 'M-1 1L1 -1M0 2.8L2.8 0M1.8 3.8L3.8 1.8M-1 1.8L1 3.8M0 0L2.8 2.8M1.8 -1L3.8 1', class: 'pat-z' }, p));
}

// An open chevron at (x, y) pointing along (dx, dy), like the plate's.
function tipD(x, y, dx, dy) {
    const L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, a = 4.6, b = 2.9;
    const bx = x - ux * a, by = y - uy * a;
    return `M${(bx - uy * b).toFixed(2)} ${(by + ux * b).toFixed(2)}L${x.toFixed(2)} ${y.toFixed(2)}L${(bx + uy * b).toFixed(2)} ${(by - ux * b).toFixed(2)}`;
}

// The node's mark, a small hexagon at (x, y) drawn as the plate draws it.
function drawMark(g, key, x, y) {
    const r = 7;
    switch (key) {
        case 'src': case 'sink': el('path', { d: hexD(x, y, r - 0.5), class: 'mdl-empty' }, g); break;
        case 'S': el('path', { d: hexD(x, y, r), class: 'mdl-node mdl-s' }, g); break;
        case 'E': el('path', { d: hexD(x, y, r), class: 'mdl-node mdl-e' }, g); break;
        case 'I': el('path', { d: hexD(x, y, r), class: 'mdl-node mdl-i' }, g); break;
        case 'R': el('path', { d: hexD(x, y, r), class: 'mdl-node mdl-r' }, g); break;
        case 'V': el('path', { d: hexD(x, y, r), class: 'mdl-node mdl-v' }, g); break;
        case 'Z': el('path', { d: hexD(x, y, r), class: 'mdl-node mdl-z' }, g); break;
        case 'M': el('circle', { cx: x, cy: y, r: 3.8, class: 'mdl-ring' }, g); break;
        case 'D': el('path', { d: `M${x - 3.6} ${y - 3.6}L${x + 3.6} ${y + 3.6}M${x + 3.6} ${y - 3.6}L${x - 3.6} ${y + 3.6}`, class: 'mdl-cross' }, g); break;
        case 'A': el('path', { d: `M${x} ${y - 5.6}L${x + 5.6} ${y + 4.2}L${x - 5.6} ${y + 4.2}Z`, class: 'mdl-animal' }, g); break;
    }
}

// Where the ray from a chip's centre along (dx, dy) leaves the chip, plus a gap.
function exit(n, dx, dy) {
    const L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, gap = 4;
    const t = Math.min(ux ? (CHIP_W + gap) / Math.abs(ux) : Infinity, uy ? (CHIP_H + gap) / Math.abs(uy) : Infinity);
    return [n.x + ux * t, n.y + uy * t];
}

/** An arrow's path between two chips: straight, or bowed `arc` px to its left. */
function route(A, B, arc, at) {
    if (!arc) {
        const [x0, y0] = exit(A, B.x - A.x, B.y - A.y), [x1, y1] = exit(B, A.x - B.x, A.y - B.y);
        const u = at || 0.5;
        return { d: `M${x0.toFixed(1)} ${y0.toFixed(1)}L${x1.toFixed(1)} ${y1.toFixed(1)}`, tip: tipD(x1, y1, x1 - x0, y1 - y0), mid: [x0 + (x1 - x0) * u, y0 + (y1 - y0) * u], ang: Math.atan2(y1 - y0, x1 - x0) };
    }
    // a bow out to the side of the chain: leave and arrive horizontally
    const x0 = A.x - CHIP_W - 4, x1 = B.x - CHIP_W - 4, cx = Math.min(x0, x1) - arc;
    const d = `M${x0} ${A.y}C${cx} ${A.y} ${cx} ${B.y} ${x1} ${B.y}`;
    return { d, tip: tipD(x1, B.y, 1, 0), mid: [x0 - arc * 0.75, (A.y + B.y) / 2], ang: Math.PI / 2 * Math.sign(B.y - A.y) };
}

/**
 * Build the Model tab into `panelEl`. hooks: { params, toggles,
 * onParam(key, value, spec), onToggle(key, value), onDisplay(key, value),
 * onRestore() }. Returns { sync(), refresh(), update(stats, flux), select(part) }:
 * sync rebuilds the chosen part's rows (a new experiment), refresh re-reads
 * their values (the knob moved), update writes the counts and flux.
 */
export function buildModel(panelEl, hooks) {
    if (!panelEl) return { sync() {}, refresh() {}, update() {}, select() {} };
    const P = hooks.params, T = hooks.toggles;
    while (panelEl.firstChild) panelEl.removeChild(panelEl.firstChild);

    // ── Fig. 6 ──
    const fig = document.createElement('figure');
    fig.className = 'model-figure';
    const svg = el('svg', { viewBox: '0 0 340 304', class: 'model-svg', role: 'group', 'aria-label': 'The compartments of the model and the flows between them' });
    defs(svg);
    const arrowLayer = el('g', { class: 'mdl-arrows' }, svg);
    const nodeLayer = el('g', { class: 'mdl-nodes' }, svg);
    const cap = document.createElement('figcaption');
    cap.className = 'caption model-caption';
    const capN = document.createElement('span');
    capN.className = 'caption-n';
    capN.textContent = 'Fig. 6.';
    cap.append(capN, ' Compartments and flows');
    fig.append(svg, cap);
    panelEl.appendChild(fig);

    const nodeEls = {}, countEls = {}, arrowEls = [];
    const choose = (part) => () => select(part);
    const keyed = (g, part, label) => {
        g.setAttribute('tabindex', '0');
        g.setAttribute('role', 'button');
        g.setAttribute('aria-label', label);
        g.addEventListener('click', choose(part));
        g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(part); } });
    };

    for (const a of ARROWS) {
        const g = el('g', { class: 'mdl-arrow' + (a.dashed ? ' mdl-dashed' : '') }, arrowLayer);
        const r = route(NODES[a.from], NODES[a.to], a.arc || 0, a.at);
        el('path', { d: r.d, class: 'mdl-hit' }, g);
        const line = el('path', { d: r.d, class: 'mdl-line' }, g);
        el('path', { d: r.tip, class: 'mdl-tip' }, g);
        let text = null;
        if (a.sym) {
            // a rate sits beside its arrow: right of a vertical one, above a level one
            const vertical = Math.abs(Math.cos(r.ang)) < 0.2;
            text = el('text', { x: r.mid[0] + (vertical ? 7 : 0), y: r.mid[1] + (vertical ? 4 : -5), class: 'mdl-rate', 'text-anchor': vertical ? 'start' : 'middle' }, g);
        } else if (a.word) {
            // a word runs along its arrow, upright, on the arrow's upper or left side
            let deg = r.ang * 180 / Math.PI;
            if (deg > 90) deg -= 180;
            if (deg < -90) deg += 180;
            const [mx, my] = r.mid;
            text = el('text', { x: mx, y: my, dy: -4.5, class: 'mdl-word', 'text-anchor': 'middle', transform: `rotate(${deg.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)})` }, g);
        }
        keyed(g, a.part, PARTS[a.part].title);
        arrowEls.push({ a, g, line, text });
    }
    for (const key in NODES) {
        const n = NODES[key];
        const g = el('g', { class: 'mdl-part' }, nodeLayer);
        el('rect', { x: n.x - CHIP_W, y: n.y - CHIP_H, width: 2 * CHIP_W, height: 2 * CHIP_H, class: 'mdl-chip' }, g);
        const left = n.x - CHIP_W + 9;
        drawMark(g, key, left, n.y);
        const t = el('text', { x: left + 12, y: n.y + 4, class: 'mdl-count' }, g);
        if (n.word) {
            el('tspan', { class: 'mdl-sym' }, t).textContent = n.word;
        } else {
            if (key !== 'A') el('tspan', { class: 'mdl-letter' }, t).textContent = key + ' ';
            countEls[key] = el('tspan', null, t);
        }
        // a flag the compartment can carry follows its count
        if (n.flag) {
            const f = el('tspan', { class: 'mdl-flag', dx: 5 }, t);
            f.textContent = n.flag;
            nodeEls[key + 'flag'] = f;
        }
        el('line', { x1: n.x - CHIP_W + 2, x2: n.x + CHIP_W - 2, y1: n.y + CHIP_H, y2: n.y + CHIP_H, class: 'mdl-underline' }, g);
        const title = el('title', null, g);
        title.textContent = n.label || PARTS[n.part].title;
        keyed(g, n.part, n.label || PARTS[n.part].title);
        nodeEls[key] = g;
    }

    // ── Topics with no node of their own ──
    const topics = document.createElement('div');
    topics.className = 'model-topics';
    const topicBtns = {};
    for (const part of ['response', 'evolution']) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'model-topic';
        b.textContent = PARTS[part].title;
        b.addEventListener('click', choose(part));
        topics.appendChild(b);
        topicBtns[part] = b;
    }
    panelEl.appendChild(topics);

    // ── The chosen part ──
    const detail = document.createElement('section');
    detail.className = 'model-detail';
    detail.setAttribute('aria-live', 'polite');
    panelEl.appendChild(detail);

    const foot = document.createElement('div');
    foot.className = 'model-foot';
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'text-btn model-restore';
    restore.textContent = 'Restore';
    restore.addEventListener('click', () => { if (hooks.onRestore) hooks.onRestore(); });
    foot.append(restore);
    panelEl.appendChild(foot);

    let chosen = 'S', rowEls = [];

    function rowsEnabled() {
        for (const r of rowEls) {
            const ok = !r.spec.needs || r.spec.needs.every((k) => T[k]);
            r.el.classList.toggle('ctrl-disabled', !ok);
            const input = r.el.querySelector('input');
            if (input) input.disabled = !ok;
        }
    }

    function buildDetail() {
        while (detail.firstChild) detail.removeChild(detail.firstChild);
        rowEls = [];
        const part = PARTS[chosen];
        const h = document.createElement('h2');
        h.className = 'model-title';
        h.textContent = part.title;
        if (part.sym && part.sym !== part.title) {
            const s = document.createElement('span');
            s.className = 'model-sym';
            s.textContent = part.sym;
            h.append(' ', s);
        }
        detail.append(h);
        for (const spec of part.rows) {
            let row;
            if (spec.head) {
                row = document.createElement('div');
                row.className = 'model-subhead';
                row.textContent = spec.head;
            } else if (spec.toggle) {
                row = buildSwitchRow({ key: spec.toggle, label: spec.label }, T, (key, v) => {
                    if (key === 'V' && !v) T.vax_rollout = false;
                    if (hooks.onToggle) hooks.onToggle(key, v);
                    syncSwitches();
                    rowsEnabled();
                    paintFigure();
                });
            } else if (spec.display) {
                row = displayRow(spec);
            } else {
                row = buildSliderRow(spec, P, (key, v) => {
                    if (hooks.onParam) hooks.onParam(key, v, spec);
                    paintFigure();
                });
            }
            detail.appendChild(row);
            rowEls.push({ spec, el: row });
        }
        rowsEnabled();
    }

    function displayRow(spec) {
        const row = document.createElement('div');
        row.className = 'settings-dd-row model-display';
        const lbl = document.createElement('span');
        lbl.className = 'settings-dd-label';
        lbl.textContent = spec.label;
        const group = document.createElement('div');
        group.className = 'word-picker';
        group.setAttribute('role', 'radiogroup');
        group.setAttribute('aria-label', spec.label);
        for (const [val, text] of ANIMAL_DISPLAY) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'word-btn';
            b.setAttribute('role', 'radio');
            b.setAttribute('aria-checked', String((T[spec.display] || 'dots') === val));
            b.textContent = text;
            b.addEventListener('click', () => {
                T[spec.display] = val;
                group.querySelectorAll('.word-btn').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
                if (hooks.onDisplay) hooks.onDisplay(spec.display, val);
            });
            group.appendChild(b);
        }
        row.append(lbl, group);
        return row;
    }

    function syncSwitches() {
        for (const r of rowEls) {
            if (!r.spec.toggle) continue;
            const cb = r.el.querySelector('input');
            if (cb) { cb.checked = !!T[r.spec.toggle]; cb.setAttribute('aria-checked', String(!!T[r.spec.toggle])); }
        }
    }

    // Fading, rate labels and the selection: everything that follows the
    // params and toggles rather than the clock.
    function paintFigure() {
        for (const { a, g, text } of arrowEls) {
            const on = !a.on || a.on(P, T);
            g.classList.toggle('mdl-off', !on);
            g.classList.toggle('mdl-chosen', a.part === chosen);
            if (text) text.textContent = a.sym ? `${a.sym} ${fmtRate(P[a.key])}` : a.word;
        }
        for (const key in NODES) {
            const n = NODES[key], g = nodeEls[key], part = PARTS[n.part];
            const off = key === 'sink' ? !(P.d_disposal > 0) : !!part.on && !part.on(P, T) && !'SEIR'.includes(key);
            g.classList.toggle('mdl-off', off);
            g.classList.toggle('mdl-chosen', n.part === chosen);
            if (n.flag) nodeEls[key + 'flag'].classList.toggle('mdl-flag-on', !!T[n.flag]);
        }
        for (const part in topicBtns) {
            topicBtns[part].setAttribute('aria-pressed', String(part === chosen));
            topicBtns[part].classList.toggle('mdl-off', !PARTS[part].on(P, T));
        }
    }

    function select(part) {
        if (!PARTS[part]) return;
        chosen = part;
        buildDetail();
        paintFigure();
    }

    /** Counts and flux, while the tab is showing. flux: { key: per day }. */
    function update(stats, flux) {
        if (!panelEl.classList.contains('active') || !stats) return;
        for (const key in countEls) {
            const v = stats[NODES[key].count] | 0;
            const t = NUMBER.format(v);
            if (countEls[key].textContent !== t) countEls[key].textContent = t;
        }
        // line weight is flux: a day's crossings against 1% of the living
        const scale = Math.max(1, 0.01 * (stats.total || 1));
        for (const { a, line } of arrowEls) {
            const f = a.flux && flux ? flux[a.flux] || 0 : 0;
            const w = (1 + 3.2 * Math.sqrt(Math.min(1, f / scale))).toFixed(2);
            if (line.getAttribute('stroke-width') !== w) line.setAttribute('stroke-width', w);
        }
    }

    // Values set from outside (the knob): the sliders and labels follow.
    function refresh() {
        for (const r of rowEls) {
            if (!r.spec.key) continue;
            const input = r.el.querySelector('input'), val = r.el.querySelector('[data-role="value"]');
            const v = P[r.spec.key];
            if (input && String(v) !== input.value) {
                input.value = String(v);
                input.style.setProperty('--slider-fill', ((v - r.spec.min) / (r.spec.max - r.spec.min) * 100) + '%');
            }
            if (val) val.textContent = Number(v).toFixed(r.spec.digits);
        }
        paintFigure();
    }

    function sync() {
        buildDetail();
        paintFigure();
    }

    select(chosen);
    return { sync, refresh, update, select, get chosen() { return chosen; } };
}

// Two significant figures, as a diagram labels its rates.
function fmtRate(v) {
    if (!Number.isFinite(v)) return '–';
    return v >= 0.1 ? v.toFixed(2) : String(Number(v.toPrecision(2)));
}
