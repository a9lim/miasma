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
//                  slider; `reset` re-applies the preset with the new value
//                  (the world must be rebuilt), otherwise it acts live
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
        knob: { key: 'vax_coverage', label: 'Coverage', min: 0, max: 0.8, step: 0.01, digits: 2, reset: true },
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
        knob: { key: 'z_die_fighting', label: 'Fight-back', min: 0, max: 0.5, step: 0.005, digits: 3 },
        measure: 'zombie'
    }
]);

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

// ─── The experiment strip ──────────────────────────────────────────────────
// In the margin head: the preset picker (choosing applies it), the preset's
// one knob, and its line of description. No innerHTML.

/**
 * Build the strip into `el`. hooks: { onApply(key), onKnob(key, value, knob) }.
 * Returns { show(key, params) } to sync it to the running preset without
 * applying anything.
 */
export function buildExperimentStrip(el, hooks) {
    if (!el) return { show() {} };
    while (el.firstChild) el.removeChild(el.firstChild);

    const select = document.createElement('select');
    select.className = 'sim-select preset-select';
    select.setAttribute('aria-label', 'Experiment');
    const custom = document.createElement('option');
    custom.value = '';
    custom.textContent = 'Sandbox';
    select.appendChild(custom);
    for (const p of PRESETS) {
        const opt = document.createElement('option');
        opt.value = p.key;
        opt.textContent = p.label;
        select.appendChild(opt);
    }
    el.appendChild(select);

    const knobRow = document.createElement('div');
    knobRow.className = 'knob-row';
    const knobLabel = document.createElement('label');
    knobLabel.className = 'knob-label';
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'sim-slider knob-slider';
    const value = document.createElement('span');
    value.className = 'knob-value';
    knobRow.append(knobLabel, slider, value);
    el.appendChild(knobRow);

    const hint = document.createElement('p');
    hint.className = 'experiment-hint';
    el.appendChild(hint);

    if (window._dropdown && typeof window._dropdown.enhance === 'function') {
        try { window._dropdown.enhance(select); } catch (_) { /* ok */ }
    }

    let current = null, syncing = false;
    select.addEventListener('change', () => {
        if (syncing) return;
        if (hooks.onApply) hooks.onApply(select.value || null);
    });
    const fmt = (v) => (current ? Number(v).toFixed(current.knob.digits) : '');
    slider.addEventListener('input', () => {
        if (!current) return;
        value.textContent = fmt(slider.value);
        if (!current.knob.reset && hooks.onKnob) hooks.onKnob(current.knob.key, parseFloat(slider.value), current.knob);
    });
    slider.addEventListener('change', () => {
        if (current && current.knob.reset && hooks.onKnob) hooks.onKnob(current.knob.key, parseFloat(slider.value), current.knob);
    });

    function show(key, params) {
        current = getPreset(key);
        syncing = true;
        select.value = key || '';
        select.dispatchEvent(new Event('change'));
        syncing = false;
        knobRow.hidden = !current;
        if (current) {
            const k = current.knob;
            knobLabel.textContent = k.label;
            slider.min = String(k.min); slider.max = String(k.max); slider.step = String(k.step);
            slider.value = String(params[k.key]);
            slider.setAttribute('aria-label', k.label);
            value.textContent = fmt(params[k.key]);
            hint.textContent = current.description;
        } else {
            hint.textContent = 'Every mechanic live at its default; Settings has the rest.';
        }
    }
    return { show };
}
