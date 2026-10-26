// presets.js — six experiments, and the strip that runs them.
//
// A preset earns its place as an experiment, not as coverage: one knob, a
// phenomenon to look for, a number measured live in the figure caption
// (caption.js presetMeasure) and, where theory gives one, the predicted
// number beside it. The mechanics the cut presets showed stay reachable from
// Settings.
//
// Each entry is a partial override over DEFAULT_PARAMS + DEFAULT_TOGGLES:
//   key, label   — stable identifier and the strip's name
//   description  — one line, the phenomenon first (the strip's hint)
//   topology     — Topology enum value
//   toggles, params — merged over the defaults; a preset sets every key it
//                  relies on and turns off what its experiment doesn't use,
//                  because applyPreset resets to the defaults first
//   knob         — { key, label, min, max, step, digits, reset? }: the one
//                  slider; `reset` restarts the run with the new value (the
//                  world must be rebuilt), otherwise it acts live
//   marks(params) — where the knob's ruler is ticked: a predicted threshold
//                  where theory gives one, else the regimes the survey found
//   measure      — which measured sentence the caption carries
//   warmup       — days the opening runs before it is shown (opening preset)
//
// Calibration (docs/ROADMAP.md §2.3): every preset was surveyed headlessly
// across at least ten seeds (tools/presets-survey.mjs); the numbers below are
// for the default 24,031-cell world (re-surveyed 2026-10-25; the presets were
// first tuned on the 10,621-cell one), and say so where they differ from
// textbook values.

import { Topology } from './config.js';
import { DEFAULT_PARAMS } from './default-params.js';
import { DEFAULT_TOGGLES } from './default-toggles.js';

// ─── The theory the knobs are marked with ─────────────────────────────────
// Bond percolation threshold of the triangular lattice, the hex cells'
// adjacency graph.
const P_C = 2 * Math.sin(Math.PI / 18);

/** Chance an infectious cell infects a given neighbour before leaving I (geometric stay). */
export function edgeT(beta, exit) {
    return 1 - exit * (1 - beta) / (1 - (1 - exit) * (1 - beta));
}

/** β at which edgeT reaches the percolation threshold, for exit rate `exit`. */
export function criticalBeta(exit) {
    let lo = 0, hi = 1;
    for (let k = 0; k < 50; k++) { const m = (lo + hi) / 2; if (edgeT(m, exit) < P_C) lo = m; else hi = m; }
    return lo;
}

/** 1 − 1/R₀ with R₀ = 6·T, the mean-field herd-immunity threshold. */
export function meanFieldHerd(P) {
    return 1 - 1 / (6 * edgeT(P.beta, P.gamma + P.mu));
}

// Everything secondary off: the textbook core, which presets then extend.
const QUIET_TOGGLES = Object.freeze({
    V: false, M: false, Z: false, L: false, C: false, F: false,
    vax_rollout: false, auto_hospital: false, auto_quarantine: false
});
const NO_ANIMALS = Object.freeze({ animal_density: 0, spillover_rate: 0, reverse_spillover_rate: 0 });
const NO_DEMOGRAPHY = Object.freeze({
    birth_rate: 0, mortality_baseline: 0, mortality_age_max: 0,
    health_degrade_per_tick: 0, health_mortality_mult: 1,
    age_susceptibility_mult: 1, age_severity_mult: 1
});
const NO_EVOLUTION = Object.freeze({ mutation_rate: 0, ag_step: 0, ag_jump: 0, recombination_rate: 0 });

export const PRESETS = Object.freeze([
    {
        // From the opening's two 7-cell seeds, final size jumps from about 2%
        // to 85% between β 0.060 and 0.080 (2% at 0.060, 7% at 0.065, 20% at
        // 0.070, where 6 of 10 seeds take off, 85% at 0.080, where all 10
        // do). At β 0.11 (T ≈ 0.50, 1.8× critical) the front stays ragged
        // and holed, reaches the world's edge in about 190 days and fills 97%
        // of cells; the opening shows it at day 300, about 30% reached.
        key: 'threshold',
        label: 'Threshold',
        description: 'Below a critical β an outbreak stays a finite cluster; just above it, the front is ragged and holed.',
        topology: Topology.TORUS,
        toggles: { ...QUIET_TOGGLES },
        params: {
            beta: 0.11, sigma: 0.25, gamma: 0.12, mu: 0.003,
            immunity_strength: 1, season_amp: 0, vax_coverage: 0,
            ...NO_EVOLUTION, ...NO_DEMOGRAPHY, ...NO_ANIMALS
        },
        knob: { key: 'beta', label: 'β', min: 0.04, max: 0.3, step: 0.005, digits: 3 },
        marks: (P) => [{ at: criticalBeta(P.gamma + P.mu), label: 'critical' }],
        measure: 'threshold',
        warmup: 300
    },
    {
        // Random coverage at efficacy 1: from the opening seeds the wave
        // fills 92% of the unvaccinated at coverage 0.44, 66% at 0.48, 10% at
        // 0.50, 3% at 0.52 and 2% at 0.55 (medians of ten seeds; on the
        // 10,621-cell world, more finite, 92, 73, 39, 15 and 5%), against the
        // mean-field threshold 1 − 1/R0 ≈ 82%.
        key: 'herd-immunity',
        label: 'Herd immunity',
        description: 'Contacts only between neighbours stop the wave at about half coverage, far below the textbook formula.',
        topology: Topology.TORUS,
        toggles: { ...QUIET_TOGGLES, V: true },
        params: {
            beta: 0.55, sigma: 0.16, gamma: 0.07, mu: 0.018,
            vax_efficacy: 1, immunity_strength: 1, vax_coverage: 0.48, season_amp: 0,
            ...NO_EVOLUTION, ...NO_DEMOGRAPHY, ...NO_ANIMALS
        },
        knob: { key: 'vax_coverage', label: 'Coverage', min: 0, max: 0.9, step: 0.01, digits: 2, reset: true },
        marks: (P) => [{ at: 0.5, label: 'lattice' }, { at: meanFieldHerd(P), label: '1 − 1/R₀' }],
        measure: 'herd'
    },
    {
        // Twenty seeds, 3,000 days on the 10,621-cell world: no extinctions,
        // waves locked to the 365-day season (peaks 358 days apart, troughs
        // at 12% of the peaks), mean prevalence 8.6%, peaks 19%; on the
        // 24,031-cell world ten seeds never end either and peak at 19%. A low mutation rate keeps
        // each wave to a few variants, so the strain view shows coherent
        // sectors rather than confetti. Evolution is antigenic only: no
        // genome noise, no recombination, which would otherwise let
        // selection inflate β. Births and deaths run at their defaults to
        // recruit susceptibles.
        key: 'antigenic-drift',
        label: 'Antigenic drift',
        description: 'Each season a variant that has drifted from what hosts remember returns; the phylogeny grows a trunk.',
        topology: Topology.TORUS,
        toggles: { ...QUIET_TOGGLES },
        params: {
            beta: 0.18, sigma: 0.5, gamma: 0.25, mu: 0.003,
            immunity_strength: 0.98, mutation_rate: 0.002, mutation_strength: 0,
            ag_step: 1.2, ag_jump: 0.02, recombination_rate: 0,
            season_amp: 0.3, vax_coverage: 0,
            ...NO_ANIMALS
        },
        knob: { key: 'ag_step', label: 'Antigenic step', min: 0, max: 1.5, step: 0.05, digits: 2 },
        // one antigenic unit: a step that long meets 1/e of the immunity to its parent
        marks: () => [{ at: 1, label: '1 AU' }],
        measure: 'drift'
    },
    {
        // Human-to-human transmission is subcritical (β 0.03, T ≈ 0.25
        // against the threshold's 0.35; no chronic human carriers, which
        // would transmit for life), so every human chain dies out on its own.
        // The rodents carry the infection chronically (recovery 0.01 a day,
        // lifespan about 800 days), 5% of them infected at the start, and
        // about 20% stay infected. Ten seeds, days 1,000–3,000: spillover
        // 0.01 gives human Re 0.47 and 53% of human cases from the
        // reservoir, 0.02 gives 0.38 and 62%, 0.04 0.31 and 69%, 0.08 0.26
        // and 74% (the same on the 10,621-cell world: these do not depend on
        // its size).
        key: 'spillover',
        label: 'Spillover',
        description: 'Human chains too weak to last never end, because a rodent reservoir keeps sparking new ones.',
        topology: Topology.PLANE,
        toggles: { ...QUIET_TOGGLES },
        params: {
            beta: 0.03, sigma: 0.15, gamma: 0.07, mu: 0.025,
            immunity_strength: 1, ...NO_EVOLUTION, season_amp: 0, vax_coverage: 0,
            animal_density: 0.35, animal_seed: 0.05,
            animal_beta: 0.08, animal_gamma: 0.01, animal_mu: 0.002, animal_max_age: 800,
            animal_d_disposal: 0.05,
            spillover_rate: 0.02, reverse_spillover_rate: 0.001
        },
        knob: { key: 'spillover_rate', label: 'Spillover', min: 0, max: 0.1, step: 0.005, digits: 3 },
        measure: 'spillover'
    },
    {
        // An oncovirus spreads through the tissue (β 0.3, mostly latent),
        // integrated provirus occasionally transforms a cell, transformed
        // clones grow by contact, and surveillance kills them where they
        // touch healthy tissue (z_die_fighting rolls per encounter, so a
        // tumour's interior is shielded). Necrotic cells clear and tissue
        // regrows into the gaps. Ten seeds, 3,000 days: surveillance 0.25
        // escapes (5,400 transformed cells by day 1,000, 6,800 by 3,000), 0.29
        // holds (about 850 by day 1,000, 1,700 by 3,000, turning over), 0.32
        // or more shrinks it (at 0.35, 47 cells by day 1,000 and 30 by
        // 3,000).
        key: 'immunoediting',
        label: 'Immunoediting',
        description: 'Cells, not people: immune surveillance eliminates, holds or loses a tumour seeded by an oncovirus.',
        topology: Topology.TORUS,
        toggles: { ...QUIET_TOGGLES, Z: true, L: true },
        params: {
            beta: 0.3, sigma: 0.2, gamma: 0.03, mu: 0.001,
            l_seed: 0.3, l_reactivate: 0.0001, l_transform: 0.0003,
            dz_dead: 0, dz_alive: 0,
            z_convert_unopposed: 0.3, z_fight_kill: 0, z_fight_infect: 0, z_fight_expose: 0,
            z_die_fighting: 0.29, z_die_natural: 0, z_exhaust_threshold: 5, z_exhaust: 0.05,
            d_disposal: 0.01, birth_rate: 0.03, birth_threshold: 2,
            mortality_baseline: 0, mortality_age_max: 0,
            health_degrade_per_tick: 0, health_mortality_mult: 1,
            age_susceptibility_mult: 1, age_severity_mult: 1,
            immunity_strength: 1, ...NO_EVOLUTION, season_amp: 0, vax_coverage: 0,
            ...NO_ANIMALS
        },
        knob: { key: 'z_die_fighting', label: 'Surveillance', min: 0, max: 0.5, step: 0.005, digits: 3 },
        marks: () => [{ at: 0.25, label: 'escapes', align: 'end' }, { at: 0.32, label: 'shrinks', align: 'start' }],
        measure: 'immunoediting'
    },
    {
        // Corpses of the infected rise (F → Z); every encounter between a
        // zombie and the living resolves as a kill, an infecting kill, an
        // exposure or a conversion, and the zombie dies in the fight with
        // chance `z_die_fighting`. The living breed back into cleared
        // ground. Ten seeds, 3,000 days: fight-back 0.03 is overrun (the
        // living about 450 by day 1,000 and 140 by 3,000, and half the runs
        // end with nobody left), 0.06 holds a standoff (about 3,300 zombies
        // against 1,600–1,800 living, and none of ten burns out), and the
        // living gain ground as it rises (0.10: about 2,100 against 3,200).
        key: 'zombie-apocalypse',
        label: 'Zombie apocalypse',
        description: 'Infectious corpses rise and the living fight back: overrun, an uneasy cycle, or the upper hand.',
        topology: Topology.PLANE,
        toggles: { ...QUIET_TOGGLES, Z: true, F: true },
        params: {
            beta: 0.30, sigma: 0.18, gamma: 0.07, mu: 0.025,
            f_decay: 0.04, f_transmit_mult: 0.5, d_disposal: 0.05,
            dz_dead: 0.05, dz_alive: 0.001,
            z_convert_unopposed: 0.05, z_fight_kill: 0.20, z_fight_infect: 0.30, z_fight_expose: 0.05,
            z_die_fighting: 0.06, z_die_natural: 0.007, z_exhaust_threshold: 5, z_exhaust: 0.04,
            l_transform: 0,
            birth_rate: 0.1, birth_threshold: 2,
            mortality_baseline: 0, mortality_age_max: 0,
            health_degrade_per_tick: 0, health_mortality_mult: 1,
            age_susceptibility_mult: 1, age_severity_mult: 1,
            immunity_strength: 0.9, ...NO_EVOLUTION, season_amp: 0, vax_coverage: 0,
            ...NO_ANIMALS
        },
        knob: { key: 'z_die_fighting', label: 'Fight-back', min: 0, max: 0.2, step: 0.005, digits: 3 },
        marks: () => [{ at: 0.03, label: 'overrun' }, { at: 0.10, label: 'upper hand' }],
        measure: 'zombie'
    }
]);

/**
 * Whether the live params and toggles differ from what the preset `key` (or,
 * for null, the sandbox) puts in place, leaving out its knob and the
 * vaccine's antigen, which the experiment itself moves.
 */
export function modelChanged(key, params, toggles) {
    const p = getPreset(key);
    const P = Object.assign({}, DEFAULT_PARAMS, p ? p.params : null);
    const T = Object.assign({}, DEFAULT_TOGGLES, p ? p.toggles : null);
    if (!T.V) T.vax_rollout = false;
    const skip = new Set(['vax_ag_x', 'vax_ag_y', p ? p.knob.key : '']);
    for (const k in P) if (!skip.has(k) && Math.abs((params[k] || 0) - (P[k] || 0)) > 1e-9) return true;
    for (const k in T) if (k !== 'animalDisplay' && !!toggles[k] !== !!T[k]) return true;
    return false;
}

/** Look up a preset by its `key`. Returns null when missing. */
export function getPreset(key) {
    for (const p of PRESETS) if (p.key === key) return p;
    return null;
}

/**
 * Apply a preset to live mutable state. Mutates params, toggles, and sim
 * in place — the run loop and UI panels keep their existing references.
 * The caller rebuilds the world (main.js applyScene), which copies the
 * params into strain α's genome.
 *
 * @param {Object} preset — an entry from PRESETS (or a preset-shaped object)
 * @param {Object} params — live params object (mutated in place)
 * @param {Object} toggles — live toggles object (mutated in place)
 * @param {Object} sim — sim state (sim.topology is set; sim.tick is not touched)
 * @returns {boolean} true if applied
 */
export function applyPreset(preset, params, toggles, sim) {
    if (!preset || !params || !toggles || !sim) return false;
    for (const k in DEFAULT_PARAMS) params[k] = DEFAULT_PARAMS[k];
    for (const k in DEFAULT_TOGGLES) toggles[k] = DEFAULT_TOGGLES[k];
    if (preset.params) for (const k in preset.params) params[k] = preset.params[k];
    if (preset.toggles) for (const k in preset.toggles) toggles[k] = preset.toggles[k];
    if (!toggles.V) toggles.vax_rollout = false;
    if (typeof preset.topology === 'number') sim.topology = preset.topology;
    return true;
}

// ─── The list of plates ────────────────────────────────────────────────────
// The experiments are the atlas's plates, numbered in order; the sandbox
// closes the list unnumbered. Choosing one applies it. No innerHTML.

const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
const SANDBOX_LINE = 'Every mechanic at its default, for free play; the Model tab holds every rate.';

/** The plate numeral of a preset, or null (the sandbox). */
export function plateNumeral(key) {
    const k = PRESETS.findIndex((p) => p.key === key);
    return k < 0 ? null : NUMERALS[k];
}

/**
 * Build the list into `el` (an <ol>). hooks: { onApply(key), onRestore() }.
 * Returns { show(key, changed) } to mark the running plate without applying
 * anything; `changed` says its model has been edited, which offers Restore.
 */
export function buildExperimentList(el, hooks) {
    if (!el) return { show() {} };
    while (el.firstChild) el.removeChild(el.firstChild);
    const entries = [];
    const note = document.createElement('p');
    note.className = 'plate-changed';
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'text-btn';
    restore.textContent = 'Restore';
    restore.addEventListener('click', () => { if (hooks.onRestore) hooks.onRestore(); });
    note.append('Changed in the Model tab. ', restore);
    const add = (key, numeral, title, line) => {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'plate-entry';
        b.dataset.preset = key || '';
        const n = document.createElement('span');
        n.className = 'plate-n';
        n.textContent = numeral || '';
        const t = document.createElement('span');
        t.className = 'plate-title';
        t.textContent = title;
        const d = document.createElement('span');
        d.className = 'plate-line';
        d.textContent = line;
        b.append(n, t, d);
        b.addEventListener('click', () => {
            if (b.getAttribute('aria-current') === 'true') return;
            if (hooks.onApply) hooks.onApply(key || null);
        });
        li.appendChild(b);
        el.appendChild(li);
        entries.push(b);
    };
    PRESETS.forEach((p, k) => add(p.key, NUMERALS[k], p.label, p.description));
    add(null, '', 'Sandbox', SANDBOX_LINE);

    function show(key, changed) {
        for (const b of entries) {
            const on = b.dataset.preset === (key || '');
            b.setAttribute('aria-current', on ? 'true' : 'false');
            if (on && changed && note.parentNode !== b.parentNode) b.parentNode.appendChild(note);
        }
        if (!changed && note.parentNode) note.parentNode.removeChild(note);
    }
    return { show };
}

// ─── The knob ──────────────────────────────────────────────────────────────
// Beside the figure caption, which measures it: the running experiment's one
// slider, drawn as a ruler ticked where theory (or the survey) puts its
// thresholds. Hidden in the sandbox.

/**
 * Build the knob into `el`. hooks: { onKnob(key, value, knob) }. Returns
 * { show(key, params) }.
 */
export function buildKnob(el, hooks) {
    if (!el) return { show() {} };
    while (el.firstChild) el.removeChild(el.firstChild);
    const label = document.createElement('label');
    label.className = 'knob-label';
    const ruler = document.createElement('div');
    ruler.className = 'knob-ruler';
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'knob-slider';
    slider.id = 'knob-slider';
    label.htmlFor = slider.id;
    const marks = document.createElement('div');
    marks.className = 'knob-marks';
    marks.setAttribute('aria-hidden', 'true');
    ruler.append(slider, marks);
    const value = document.createElement('output');
    value.className = 'knob-value';
    value.htmlFor = slider.id;
    el.append(label, ruler, value);

    let current = null;
    const fmt = (v) => (current ? Number(v).toFixed(current.knob.digits) : '');
    const fill = () => {
        const k = current.knob;
        slider.style.setProperty('--fill', ((slider.value - k.min) / (k.max - k.min) * 100) + '%');
    };
    slider.addEventListener('input', () => {
        if (!current) return;
        value.textContent = fmt(slider.value);
        fill();
        if (!current.knob.reset && hooks.onKnob) hooks.onKnob(current.knob.key, parseFloat(slider.value), current.knob);
    });
    slider.addEventListener('change', () => {
        if (current && current.knob.reset && hooks.onKnob) hooks.onKnob(current.knob.key, parseFloat(slider.value), current.knob);
    });

    function show(key, params) {
        current = getPreset(key);
        el.hidden = !current;
        if (!current) return;
        const k = current.knob;
        label.textContent = k.label;
        slider.min = String(k.min); slider.max = String(k.max); slider.step = String(k.step);
        slider.value = String(params[k.key]);
        slider.setAttribute('aria-label', k.label);
        value.textContent = fmt(params[k.key]);
        fill();
        while (marks.firstChild) marks.removeChild(marks.firstChild);
        const list = current.marks ? current.marks(params) : [];
        for (const m of list) {
            if (!(m.at >= k.min && m.at <= k.max)) continue;
            const tick = document.createElement('span');
            tick.className = 'knob-mark' + (m.align ? ' knob-mark-' + m.align : '');
            tick.style.setProperty('--at', ((m.at - k.min) / (k.max - k.min)).toFixed(4));
            const em = document.createElement('em');
            em.textContent = m.label;
            tick.appendChild(em);
            marks.appendChild(tick);
        }
        el.title = list.length ? list.map((m) => `${m.label}: ${Number(m.at).toFixed(k.digits)}`).join('; ') : '';
    }
    return { show };
}
