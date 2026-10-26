// params.js — the live parameter object, the strain genome editor's layout,
// and the hairline slider row that the Model tab and the genome editor both
// build. The same params instance is shared with the tick loop, so a slider
// takes effect on the next tick (a genome field only through the strains it
// is written onto: main.js onParam).

import { DEFAULT_PARAMS } from './default-params.js';

/** Build a fresh, mutable params object seeded from DEFAULT_PARAMS. */
export function makeParams() {
    return Object.assign({}, DEFAULT_PARAMS);
}

// Per-strain genome editor layout. Same row-spec shape as the Model tab's
// rows (model.js PARTS) — the lineage panel's detail block iterates this and
// builds sliders whose `oninput` writes into `reg.<key>[selectedId]`
// instead of into the global params object. Rows here MUST mirror keys in
// strains.js GENOME_FIELDS — adding a new genome field means appending to
// both lists.
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

/**
 * Build a single slider row. The `target` parameter is a settable object
 * indexed by `spec.key` — either the global `params` object (sim-wide sliders)
 * or a per-strain "view" wrapper for the genome editor (see lineage.js, which
 * passes an object with getters/setters that proxy into `reg.<key>[selectedId]`).
 *
 * Shared by the Model tab and the lineage panel's genome editor, so both
 * keep one DOM shape, style and bindSlider hookup.
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
