// params.js — Phase 3 parameter management + settings UI.
// Holds the live SEIR(D) + flag/maternal/Z parameter object and builds the
// slider panel that mutates it. The same object instance is shared with the
// tick loop, so slider changes take effect on the very next tick.
//
// Settings live inside the sidebar Settings tab (#tab-settings) rather than
// a dropdown — the sim's index.html doesn't carry a #settings-btn trigger,
// and the tab gives the rows persistent screen-reader-friendly placement.

import { DEFAULT_PARAMS } from './default-params.js';

// Frozen snapshot of the full default param set — restated here so a "reset
// to defaults" callback has a stable target even if dynamics later picks up
// preset-driven overrides. Mirrors default-params.js exactly.
export const SEIR_DEFAULTS = Object.freeze(Object.assign({}, DEFAULT_PARAMS));

/** Build a fresh, mutable params object seeded from DEFAULT_PARAMS. */
export function makeParams() {
    return Object.assign({}, DEFAULT_PARAMS);
}

// ─── Settings panel ─────────────────────────────────────────────────────────
// Idempotent: first call wipes any placeholder content (the Phase-1 hint)
// and constructs slider rows; subsequent calls update slider DOM to match
// the current params object (used by "Reset to defaults").
//
// No innerHTML — every node is created via createElement.

// Section/slider layout. Section headers carry a `heading` field; sliders
// carry a `key`. Sections are visual grouping only — they don't affect the
// underlying params object.
//
// Split into two tiers:
//   CORE_LAYOUT     — renders inline in #tab-settings. Knobs a casual user
//                     actually reaches for. Phase-15 polish: empty — every
//                     parameter lives under the Advanced gear dropdown so
//                     the Settings tab is dominated by toggles/presets.
//   ADVANCED_LAYOUT — collapsed into an "Advanced parameters" gear dropdown
//                     built via _settings.create(). All tunable sliders.
const CORE_LAYOUT = [];

// Advanced (gear dropdown) layout — SIM-WIDE rows only post-Phase-C.
// Per-strain genome rows now live in STRAIN_GENOME_LAYOUT below and render
// inside the lineage panel's per-strain detail block instead of here. The
// dynamics tick still reads its global knobs from `params`; the genome editor
// writes into the registry's parallel arrays directly.
const ADVANCED_LAYOUT = [
    { heading: 'Births' },
    { key: 'birth_rate',          label: 'Birth rate / nbr',    min: 0,    max: 0.2,  step: 0.005, digits: 3 },
    { key: 'birth_threshold',     label: 'Birth nbr min',       min: 1,    max: 6,    step: 1,     digits: 0 },

    { heading: 'Vaccination rollout' },
    { key: 'vax_rollout_rate',    label: 'Rollout rate / tick', min: 0,    max: 0.05, step: 0.0005, digits: 4 },
    { key: 'vax_efficacy',        label: 'Vaccine efficacy',    min: 0,    max: 1,    step: 0.01,  digits: 2 },

    { heading: 'Reinfection' },
    { key: 'r_susceptibility_mult', label: 'R susceptibility ×p', min: 0,  max: 1,    step: 0.01,  digits: 2 },

    { heading: 'Multi-strain' },
    { key: 'mutation_rate',       label: 'Mutation rate',       min: 0,    max: 0.1,  step: 0.001, digits: 3 },
    { key: 'mutation_strength',   label: 'Mutation strength',   min: 0,    max: 0.5,  step: 0.01,  digits: 2 },
    { key: 'cross_immunity_mult', label: 'Cross-immunity ×',    min: 0,    max: 1,    step: 0.05,  digits: 2 },

    { heading: 'Coinfection / recombination' },
    { key: 'coinfection_load_delta', label: 'Coinfection load Δ',   min: 0, max: 1,    step: 0.01,  digits: 2 },
    { key: 'competition_strength',   label: 'Competition strength', min: 0, max: 0.5,  step: 0.005, digits: 3 },
    { key: 'recombination_rate',     label: 'Recombination rate',   min: 0, max: 0.2,  step: 0.001, digits: 3 },
    { key: 'min_strain_load',        label: 'Min strain load',      min: 0, max: 0.2,  step: 0.005, digits: 3 },

    // Reservoir — strain-independent rows only. The animal SIR rates
    // (animal_beta / animal_gamma / animal_mu) are per-strain since Phase 17
    // and live in STRAIN_GENOME_LAYOUT's "Reservoir (animal)" section instead.
    { heading: 'Reservoir — population' },
    { key: 'animal_density',            label: 'Animal density',        min: 0,   max: 0.5,   step: 0.01,   digits: 2 },
    { key: 'animal_birth_rate',         label: 'Animal birth / nbr',    min: 0,   max: 0.2,   step: 0.005,  digits: 3 },
    { key: 'animal_birth_threshold',    label: 'Animal birth nbr min',  min: 1,   max: 6,     step: 1,      digits: 0 },
    { key: 'animal_mortality_baseline', label: 'Animal nat. death 0',   min: 0,   max: 0.01,  step: 0.0001, digits: 4 },
    { key: 'animal_mortality_age_max',  label: 'Animal nat. death max', min: 0,   max: 0.05,  step: 0.0005, digits: 4 },
    { key: 'animal_max_age',            label: 'Animal max age (ticks)', min: 100, max: 20000, step: 100,   digits: 0 },
    { key: 'animal_d_disposal',         label: 'Animal D → VOID',       min: 0,   max: 1,     step: 0.01,   digits: 2 },

    { heading: 'Reservoir — spillover' },
    { key: 'spillover_rate',            label: 'Spillover (a → h)',     min: 0,   max: 0.5,   step: 0.001,  digits: 3 },
    { key: 'reverse_spillover_rate',    label: 'Reverse (h → a)',       min: 0,   max: 0.1,   step: 0.001,  digits: 3 },

    { heading: 'Status (H / Q)' },
    { key: 'h_capacity_frac',           label: 'H capacity frac', min: 0,    max: 0.2, step: 0.005, digits: 3 },
    { key: 'h_recover_mult',            label: 'H recover ×γ',    min: 0.5,  max: 3,   step: 0.05,  digits: 2 },
    { key: 'h_mortality_mult',          label: 'H mortality ×μ',  min: 0,    max: 1,   step: 0.05,  digits: 2 },
    { key: 'h_overflow_mortality_mult', label: 'Overflow ×μ',     min: 1,    max: 3,   step: 0.05,  digits: 2 },
    { key: 'q_transmit_mult',           label: 'Q source ×β',     min: 0,    max: 1,   step: 0.01,  digits: 2 },
    { key: 'q_susceptibility_mult',     label: 'Q target ×p',     min: 0,    max: 1,   step: 0.01,  digits: 2 },
    { key: 'quarantine_trace_rate',     label: 'Q trace rate',    min: 0,    max: 1,   step: 0.01,  digits: 2 },

    { heading: 'Aging / death' },
    { key: 'd_disposal',              label: 'D → EMPTY disposal',  min: 0,    max: 0.2,    step: 0.005,  digits: 3 },
    { key: 'mortality_baseline',      label: 'Nat. death age 0',    min: 0,    max: 0.01,   step: 0.0001, digits: 4 },
    { key: 'mortality_age_max',       label: 'Nat. death max',      min: 0,    max: 0.05,   step: 0.0005, digits: 4 },
    { key: 'mortality_max_age',       label: 'Max age (ticks)',     min: 100,  max: 20000,  step: 100,    digits: 0 },
    { key: 'age_susceptibility_mult', label: 'Age ×susceptibility', min: 0.5,  max: 4,      step: 0.05,   digits: 2 },
    { key: 'age_severity_mult',       label: 'Age ×μ',              min: 0.5,  max: 5,      step: 0.05,   digits: 2 },

    { heading: 'Zombie — threshold' },
    { key: 'z_exhaust_threshold', label: 'Z exhaust threshold', min: 1,    max: 6,    step: 1,     digits: 0 }
];

// Per-strain genome editor layout (Phase C). Same row-spec shape as
// ADVANCED_LAYOUT — the lineage panel's detail block iterates this and
// builds sliders whose `oninput` writes into `reg.<key>[selectedId]`
// instead of into the global params object. Rows here MUST mirror keys in
// strains.js GENOME_FIELDS — adding a new genome field means appending to
// both lists. Labels/min/max/step/digits are copied from the prior
// ADVANCED_LAYOUT entries verbatim.
export const STRAIN_GENOME_LAYOUT = [
    { heading: 'Core SEIR(D)' },
    { key: 'beta',                    label: 'β (transmission)',      min: 0,    max: 1,    step: 0.01,   digits: 2 },
    { key: 'sigma',                   label: 'σ (E → I rate)',        min: 0.01, max: 1,    step: 0.01,   digits: 2 },
    { key: 'gamma',                   label: 'γ (I → R rate)',        min: 0.01, max: 1,    step: 0.01,   digits: 2 },
    { key: 'mu',                      label: 'μ (I → D rate)',        min: 0,    max: 0.1,  step: 0.001,  digits: 3 },

    { heading: 'Maternal / flag rates' },
    { key: 'm_decay',                 label: 'M → S decay',           min: 0,    max: 0.2,  step: 0.001,  digits: 3 },
    { key: 'l_seed',                  label: 'L seed (S → E latent)', min: 0,    max: 1,    step: 0.01,   digits: 2 },
    { key: 'l_reactivate',            label: 'L reactivation',        min: 0,    max: 0.05, step: 0.0005, digits: 4 },
    { key: 'l_transform',             label: 'L → Z transform',       min: 0,    max: 0.05, step: 0.0005, digits: 4 },
    { key: 'c_seed',                  label: 'C seed (I → R carrier)', min: 0,   max: 1,    step: 0.01,   digits: 2 },
    { key: 'c_transmit_mult',         label: 'C transmit ×β',         min: 0,    max: 1,    step: 0.01,   digits: 2 },
    { key: 'f_decay',                 label: 'F flag decay',          min: 0,    max: 0.5,  step: 0.01,   digits: 2 },
    { key: 'f_transmit_mult',         label: 'F transmit ×β',         min: 0,    max: 1,    step: 0.01,   digits: 2 },

    { heading: 'Zombie — spawn' },
    { key: 'dz_dead',                 label: 'D → Z (F-corpse)',      min: 0,    max: 0.5,  step: 0.005,  digits: 3 },
    { key: 'dz_alive',                label: 'I → Z (spontaneous)',   min: 0,    max: 0.1,  step: 0.001,  digits: 3 },

    { heading: 'Zombie — encounter' },
    { key: 'z_fight_kill',            label: 'Z encounter → D',       min: 0,    max: 1,    step: 0.01,   digits: 2 },
    { key: 'z_fight_infect',          label: 'Z encounter → D+F',     min: 0,    max: 1,    step: 0.01,   digits: 2 },
    { key: 'z_fight_expose',          label: 'Z encounter → E',       min: 0,    max: 1,    step: 0.01,   digits: 2 },
    { key: 'z_convert_unopposed',     label: 'Z encounter → Z',       min: 0,    max: 1,    step: 0.01,   digits: 2 },
    { key: 'z_die_fighting',          label: 'Z dies in fight',       min: 0,    max: 0.5,  step: 0.005,  digits: 3 },

    { heading: 'Zombie — death' },
    { key: 'z_die_natural',           label: 'Z natural decay',       min: 0,    max: 0.05, step: 0.0005, digits: 4 },
    { key: 'z_exhaust',               label: 'Z exhaust → D',         min: 0,    max: 0.5,  step: 0.01,   digits: 2 },

    { heading: 'Health impact' },
    { key: 'health_degrade_per_tick', label: 'I health degrade',      min: 0,    max: 0.2,  step: 0.005,  digits: 3 },
    { key: 'health_mortality_mult',   label: 'Low-health ×μ',         min: 1,    max: 6,    step: 0.05,   digits: 2 },

    // Reservoir (animal) SIR rates — per-strain since Phase 17. The animal
    // layer carries a strain id; these rates drive animal-to-animal spread
    // and recovery for whichever strain a given infectious animal holds.
    { heading: 'Reservoir (animal)' },
    { key: 'animal_beta',             label: 'Animal β',              min: 0,    max: 1,    step: 0.01,   digits: 2 },
    { key: 'animal_gamma',            label: 'Animal γ (I → R)',      min: 0,    max: 1,    step: 0.01,   digits: 2 },
    { key: 'animal_mu',               label: 'Animal μ (I → D)',      min: 0,    max: 0.1,  step: 0.001,  digits: 3 }
];

// Flat slider-only list across both tiers — used for syncSliders + reset so
// a preset apply (or "Reset to defaults") covers every param, not just the
// inline ones.
const SLIDER_SPECS = CORE_LAYOUT.concat(ADVANCED_LAYOUT).filter((row) => row.key);

/**
 * Build a single slider row. The `target` parameter is a settable object
 * indexed by `spec.key` — either the global `params` object (sim-wide sliders)
 * or a per-strain "view" wrapper for the genome editor (see lineage.js, which
 * passes an object with getters/setters that proxy into `reg.<key>[selectedId]`).
 *
 * Exported so the lineage-panel genome editor can reuse the same DOM shape /
 * styling / bindSlider hookup as the global advanced-section sliders. Without
 * this shared builder the genome editor would have to clone the DOM shape and
 * drift over time.
 *
 * @param {{key:string, label:string, min:number, max:number, step:number, digits:number}} spec
 * @param {object} target — object whose `[spec.key]` is read/written by the slider
 * @param {(key:string, value:number) => void} [onChange]
 */
export function buildSliderRow(spec, target, onChange) {
    const row = document.createElement('div');
    row.className = 'settings-dd-row';
    row.dataset.param = spec.key;

    const lbl = document.createElement('label');
    lbl.className = 'settings-dd-label';
    lbl.textContent = spec.label;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'sim-slider';
    slider.min = String(spec.min);
    slider.max = String(spec.max);
    slider.step = String(spec.step);
    slider.value = String(target[spec.key]);
    slider.setAttribute('aria-label', spec.label);

    const valEl = document.createElement('span');
    valEl.className = 'settings-dd-val';
    valEl.dataset.role = 'value';
    valEl.textContent = Number(target[spec.key]).toFixed(spec.digits);

    const fmt = (v) => Number(v).toFixed(spec.digits);
    const handler = () => {
        const v = parseFloat(slider.value);
        valEl.textContent = fmt(v);
        target[spec.key] = v;
        if (onChange) onChange(spec.key, v);
    };

    if (window._forms && typeof window._forms.bindSlider === 'function') {
        window._forms.bindSlider(slider, valEl, (v) => {
            target[spec.key] = v;
            if (onChange) onChange(spec.key, v);
        }, fmt);
    } else {
        slider.addEventListener('input', handler);
    }

    row.append(lbl, slider, valEl);
    return row;
}

function buildHeadingRow(text) {
    const row = document.createElement('div');
    row.className = 'settings-dd-row';
    row.dataset.role = 'heading';

    const span = document.createElement('span');
    span.className = 'panel-hint';
    span.textContent = text;
    row.appendChild(span);
    return row;
}

function buildResetButton(params, panelEl, onChange) {
    const row = document.createElement('div');
    row.className = 'settings-dd-row';
    row.dataset.role = 'reset';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tool-btn';
    btn.textContent = 'Reset to defaults';
    btn.addEventListener('click', () => {
        for (const k in SEIR_DEFAULTS) params[k] = SEIR_DEFAULTS[k];
        syncSliders(panelEl, params);
        if (onChange) onChange(null, null);
    });

    row.appendChild(btn);
    return row;
}

// ─── Advanced parameters (shoals-style collapsible inline section) ─────────
// Shoals pattern: a single "Advanced Parameters" button toggles a `.hidden`
// class on a sibling container that holds all advanced sliders inline in the
// settings tab. No floating dropdown, no _settings.create — just a plain
// collapse/expand. Refs are populated as we build so syncSliders can find
// each slider on reset / preset-apply.
function buildAdvancedSection(params, onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'advanced-wrap';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'advanced-toggle';
    btn.className = 'tool-btn advanced-toggle-btn';
    btn.textContent = 'Advanced Parameters';
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', 'advanced-section');

    const section = document.createElement('div');
    section.id = 'advanced-section';
    section.className = 'advanced-section hidden';

    btn.addEventListener('click', () => {
        const hidden = section.classList.toggle('hidden');
        btn.setAttribute('aria-expanded', hidden ? 'false' : 'true');
        btn.classList.toggle('active', !hidden);
    });

    const refs = Object.create(null);
    for (const spec of ADVANCED_LAYOUT) {
        if (spec.heading) {
            section.appendChild(buildHeadingRow(spec.heading));
            continue;
        }
        const row = buildSliderRow(spec, params, onChange);
        section.appendChild(row);
        refs[spec.key] = {
            slider: row.querySelector('input[type="range"]'),
            valEl:  row.querySelector('[data-role="value"]'),
            digits: spec.digits
        };
    }

    wrap.append(btn, section);
    return { wrap, refs };
}

/**
 * Wipe `#tab-settings` placeholder content and build the parameter panel.
 * Core sliders render inline; the rarely-touched ones live in a collapsible
 * "Advanced Parameters" section (shoals pattern) toggled by a button row.
 * @param {HTMLElement} panelEl — the tab panel container (usually #tab-settings)
 * @param {object} params — mutable params object, mutated on slider input
 * @param {(key:string|null, value:number|null) => void} [onChange]
 *        Called after every slider change. `key === null` signals a bulk reset.
 */
export function buildSettingsPanel(panelEl, params, onChange) {
    if (!panelEl) return;
    while (panelEl.firstChild) panelEl.removeChild(panelEl.firstChild);

    for (const row of CORE_LAYOUT) {
        if (row.heading) {
            panelEl.appendChild(buildHeadingRow(row.heading));
        } else {
            panelEl.appendChild(buildSliderRow(row, params, onChange));
        }
    }

    // Advanced collapsible section — appended after core, before reset.
    const { wrap: advancedWrap, refs } = buildAdvancedSection(params, onChange);
    panelEl.appendChild(advancedWrap);
    panelEl.__advancedRefs = refs;

    panelEl.appendChild(buildResetButton(params, panelEl, onChange));

    panelEl.dataset.paramsReady = '1';
}

/** Re-sync slider DOM to the current values in `params` (e.g. after reset). */
export function syncSliders(panelEl, params) {
    if (!panelEl) return;
    const advancedRefs = panelEl.__advancedRefs || {};
    for (const spec of SLIDER_SPECS) {
        // Inline (core) sliders live in the panel DOM.
        const row = panelEl.querySelector(`[data-param="${spec.key}"]`);
        if (row) {
            const slider = row.querySelector('input[type="range"]');
            const valEl = row.querySelector('[data-role="value"]');
            if (slider) slider.value = String(params[spec.key]);
            if (valEl)  valEl.textContent = Number(params[spec.key]).toFixed(spec.digits);
            continue;
        }
        // Fallback to the refs map (advanced sliders pre-Phase-15 lived in a
        // floating dropdown). Post-Phase-15 they're inline under #advanced-
        // section so panelEl.querySelector finds them in the branch above —
        // this fallback is redundant but defensive.
        const ref = advancedRefs[spec.key];
        if (!ref) continue;
        if (ref.slider) ref.slider.value = String(params[spec.key]);
        if (ref.valEl)  ref.valEl.textContent = Number(params[spec.key]).toFixed(ref.digits);
    }
}
