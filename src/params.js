// params.js — Phase 3 parameter management + settings UI.
// Holds the live SEIR(D) + flag/maternal/Z parameter object and builds the
// slider panel that mutates it. The same object instance is shared with the
// tick loop, so slider changes take effect on the very next tick.
//
// Settings live inside the sidebar Settings tab (#tab-settings) rather than
// a dropdown — the sim's index.html doesn't carry a #settings-btn trigger,
// and the tab gives the rows persistent screen-reader-friendly placement.

import { DEFAULT_PARAMS } from './dynamics.js';

// Frozen snapshot of the full default param set — restated here so a "reset
// to defaults" callback has a stable target even if dynamics later picks up
// preset-driven overrides. Mirrors dynamics.js DEFAULT_PARAMS exactly.
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
const PANEL_LAYOUT = [
    { heading: 'Core SEIR(D)' },
    { key: 'beta',                label: 'β (transmission)',    min: 0,    max: 1,    step: 0.01,  digits: 2 },
    { key: 'sigma',               label: 'σ (E → I rate)',      min: 0.01, max: 1,    step: 0.01,  digits: 2 },
    { key: 'gamma',               label: 'γ (I → R rate)',      min: 0.01, max: 1,    step: 0.01,  digits: 2 },
    { key: 'mu',                  label: 'μ (I → D rate)',      min: 0,    max: 0.1,  step: 0.001, digits: 3 },

    { heading: 'Maternal / flag rates' },
    { key: 'm_decay',             label: 'M → S decay',         min: 0,    max: 0.2,  step: 0.001, digits: 3 },
    { key: 'l_reactivate',        label: 'L reactivation',      min: 0,    max: 0.05, step: 0.0005, digits: 4 },
    { key: 'c_transmit_mult',     label: 'C transmit ×β',       min: 0,    max: 1,    step: 0.01,  digits: 2 },
    { key: 'f_decay',             label: 'F flag decay',        min: 0,    max: 0.5,  step: 0.01,  digits: 2 },
    { key: 'f_transmit_mult',     label: 'F transmit ×β',       min: 0,    max: 1,    step: 0.01,  digits: 2 },

    { heading: 'Zombie params' },
    { key: 'dz_dead',             label: 'D → Z',               min: 0,    max: 0.5,  step: 0.005, digits: 3 },
    { key: 'dz_alive',            label: 'I → Z',               min: 0,    max: 0.1,  step: 0.001, digits: 3 },
    { key: 'z_infect',            label: 'Z neighbor infect',   min: 0,    max: 1,    step: 0.01,  digits: 2 },
    { key: 'z_exhaust_threshold', label: 'Z exhaust threshold', min: 1,    max: 6,    step: 1,     digits: 0 },
    { key: 'z_exhaust',           label: 'Z exhaust → D',       min: 0,    max: 0.5,  step: 0.01,  digits: 2 },

    { heading: 'Status (H / Q)' },
    { key: 'h_capacity_frac',           label: 'H capacity frac',     min: 0,    max: 0.2,  step: 0.005, digits: 3 },
    { key: 'h_recover_mult',            label: 'H recover ×γ',        min: 0.5,  max: 3,    step: 0.05,  digits: 2 },
    { key: 'h_mortality_mult',          label: 'H mortality ×μ',      min: 0,    max: 1,    step: 0.05,  digits: 2 },
    { key: 'h_overflow_mortality_mult', label: 'Overflow ×μ',         min: 1,    max: 3,    step: 0.05,  digits: 2 },
    { key: 'q_transmit_mult',           label: 'Q source ×β',         min: 0,    max: 1,    step: 0.01,  digits: 2 },
    { key: 'q_susceptibility_mult',     label: 'Q target ×p',         min: 0,    max: 1,    step: 0.01,  digits: 2 },

    { heading: 'Aging / births / health' },
    { key: 'birth_rate',              label: 'Birth rate / nbr',    min: 0,    max: 0.2,    step: 0.005,  digits: 3 },
    { key: 'birth_threshold',         label: 'Birth nbr min',       min: 1,    max: 6,      step: 1,      digits: 0 },
    { key: 'd_disposal',              label: 'D → EMPTY disposal',  min: 0,    max: 0.2,    step: 0.005,  digits: 3 },
    { key: 'health_degrade_per_tick', label: 'I health degrade',    min: 0,    max: 0.2,    step: 0.005,  digits: 3 },
    { key: 'mortality_baseline',      label: 'Nat. death age 0',    min: 0,    max: 0.01,   step: 0.0001, digits: 4 },
    { key: 'mortality_age_max',       label: 'Nat. death max',      min: 0,    max: 0.05,   step: 0.0005, digits: 4 },
    { key: 'mortality_max_age',       label: 'Max age (ticks)',     min: 100,  max: 20000,  step: 100,    digits: 0 },
    { key: 'age_susceptibility_mult', label: 'Age ×susceptibility', min: 0.5,  max: 4,      step: 0.05,   digits: 2 },
    { key: 'age_severity_mult',       label: 'Age ×μ',              min: 0.5,  max: 5,      step: 0.05,   digits: 2 },
    { key: 'health_mortality_mult',   label: 'Low-health ×μ',       min: 1,    max: 6,      step: 0.05,   digits: 2 },

    { heading: 'Multi-strain' },
    { key: 'mutation_rate',       label: 'Mutation rate',       min: 0,    max: 0.1,    step: 0.001, digits: 3 },
    { key: 'mutation_strength',   label: 'Mutation strength',   min: 0,    max: 0.5,    step: 0.01,  digits: 2 },
    { key: 'cross_immunity_mult', label: 'Cross-immunity ×',    min: 0,    max: 1,      step: 0.05,  digits: 2 },

    { heading: 'Coinfection / recombination' },
    { key: 'coinfection_load_delta', label: 'Coinfection load Δ', min: 0,    max: 1,    step: 0.01,  digits: 2 },
    { key: 'competition_strength',   label: 'Competition strength', min: 0,  max: 0.5,  step: 0.005, digits: 3 },
    { key: 'recombination_rate',     label: 'Recombination rate', min: 0,    max: 0.2,  step: 0.001, digits: 3 },
    { key: 'min_strain_load',        label: 'Min strain load',    min: 0,    max: 0.2,  step: 0.005, digits: 3 },

    { heading: 'Vector / reservoir' },
    { key: 'animal_density',         label: 'Animal density',      min: 0,    max: 0.5,  step: 0.01,  digits: 2 },
    { key: 'animal_beta',            label: 'Animal β',            min: 0,    max: 1,    step: 0.01,  digits: 2 },
    { key: 'animal_gamma',           label: 'Animal γ (I → R)',    min: 0,    max: 1,    step: 0.01,  digits: 2 },
    { key: 'animal_mu',              label: 'Animal μ (I → D)',    min: 0,    max: 0.1,  step: 0.001, digits: 3 },
    { key: 'animal_d_disposal',      label: 'Animal D → VOID',     min: 0,    max: 1,    step: 0.01,  digits: 2 },
    { key: 'spillover_rate',         label: 'Spillover (a → h)',   min: 0,    max: 0.5,  step: 0.001, digits: 3 },
    { key: 'reverse_spillover_rate', label: 'Reverse (h → a)',     min: 0,    max: 0.1,  step: 0.001, digits: 3 }
];

// Flat slider-only list for syncSliders + reset.
const SLIDER_SPECS = PANEL_LAYOUT.filter((row) => row.key);

function buildSliderRow(spec, params, onChange) {
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
    slider.value = String(params[spec.key]);
    slider.setAttribute('aria-label', spec.label);

    const valEl = document.createElement('span');
    valEl.className = 'settings-dd-val';
    valEl.dataset.role = 'value';
    valEl.textContent = Number(params[spec.key]).toFixed(spec.digits);

    const fmt = (v) => Number(v).toFixed(spec.digits);
    const handler = () => {
        const v = parseFloat(slider.value);
        valEl.textContent = fmt(v);
        params[spec.key] = v;
        if (onChange) onChange(spec.key, v);
    };

    if (window._forms && typeof window._forms.bindSlider === 'function') {
        window._forms.bindSlider(slider, valEl, (v) => {
            params[spec.key] = v;
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

/**
 * Wipe `#tab-settings` placeholder content and build the parameter panel.
 * @param {HTMLElement} panelEl — the tab panel container (usually #tab-settings)
 * @param {object} params — mutable params object, mutated on slider input
 * @param {(key:string|null, value:number|null) => void} [onChange]
 *        Called after every slider change. `key === null` signals a bulk reset.
 */
export function buildSettingsPanel(panelEl, params, onChange) {
    if (!panelEl) return;
    while (panelEl.firstChild) panelEl.removeChild(panelEl.firstChild);

    for (const row of PANEL_LAYOUT) {
        if (row.heading) {
            panelEl.appendChild(buildHeadingRow(row.heading));
        } else {
            panelEl.appendChild(buildSliderRow(row, params, onChange));
        }
    }
    panelEl.appendChild(buildResetButton(params, panelEl, onChange));

    panelEl.dataset.paramsReady = '1';
}

/** Re-sync slider DOM to the current values in `params` (e.g. after reset). */
export function syncSliders(panelEl, params) {
    if (!panelEl) return;
    for (const spec of SLIDER_SPECS) {
        const row = panelEl.querySelector(`[data-param="${spec.key}"]`);
        if (!row) continue;
        const slider = row.querySelector('input[type="range"]');
        const valEl = row.querySelector('[data-role="value"]');
        if (slider) slider.value = String(params[spec.key]);
        if (valEl)  valEl.textContent = Number(params[spec.key]).toFixed(spec.digits);
    }
}
