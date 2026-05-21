// toggles.js — Phase 3 compartment + flag toggle panel.
// Renders six checkbox rows (V, M, Z, L, C, F) inside the sidebar Settings tab,
// alongside the param sliders. Each toggle mutates the shared `toggles` object
// in place, so the tick loop picks up changes on the next iteration.
//
// Layout: two subsections, each with a small uppercase-mono header.
//   Compartments  — V (Vaccinated), M (Maternal immune), Z (Zombie)
//   Flags         — L (Latent on E), C (Carrier on R), F (Infectious corpse on D)
//
// V/M/Z rows carry a color swatch driven by --epi-{v,m,z} so they read
// consistently with the legend and stats panel. Flag rows have no swatch since
// flags are modifiers on existing compartments.
//
// No innerHTML — every node via createElement / textContent (hook-enforced).

// ─── Defaults ───────────────────────────────────────────────────────────────
// The simulation baseline lives in default-toggles.js so dynamics, presets,
// and the Settings UI share one source of truth. Z is opt-in by default;
// zombie/oncoviral presets turn it on explicitly.
import { DEFAULT_TOGGLES } from './default-toggles.js';
export { DEFAULT_TOGGLES };

/** Build a fresh, mutable toggles object seeded from DEFAULT_TOGGLES. */
export function makeToggles() {
    return Object.assign({}, DEFAULT_TOGGLES);
}

// ─── Row specs ──────────────────────────────────────────────────────────────
// `swatchVar` is null for flag rows (no compartment color); compartment rows
// pull from the same --epi-* vars the legend/stats panel use.

const COMPARTMENT_SPECS = [
    { key: 'V', label: 'V — Vaccinated',     swatchVar: '--epi-v', togClass: 'tog-v' },
    { key: 'M', label: 'M — Maternal immune', swatchVar: '--epi-m', togClass: 'tog-m' },
    { key: 'Z', label: 'Z — Zombie',          swatchVar: '--epi-z', togClass: 'tog-z' }
];

const FLAG_SPECS = [
    { key: 'L', label: 'L — Latent (on E)',             swatchVar: null, togClass: 'tog-e' },
    { key: 'C', label: 'C — Carrier (on R)',            swatchVar: null, togClass: 'tog-r' },
    { key: 'F', label: 'F — Infectious corpse (on D)',  swatchVar: null, togClass: 'tog-d' }
];

// Automatic-response toggles: system-driven interventions that run each tick
// without the user painting. tog-r (recovery green) for hospitalization,
// tog-e (matches the quarantine paint accent) for quarantine, tog-v for the
// vaccine rollout — purely cosmetic colour cues, the classes already exist.
const RESPONSE_SPECS = [
    { key: 'auto_hospital',   label: 'Auto-hospitalize',       swatchVar: null, togClass: 'tog-r' },
    { key: 'auto_quarantine', label: 'Auto-quarantine',        swatchVar: null, togClass: 'tog-e' },
    { key: 'vax_rollout',     label: 'Auto-vaccinate rollout', swatchVar: null, togClass: 'tog-v' }
];

// ─── DOM construction ──────────────────────────────────────────────────────

function buildSectionHeader(text) {
    const hdr = document.createElement('div');
    hdr.className = 'toggles-section-header';
    hdr.textContent = text;
    return hdr;
}

function buildToggleRow(spec, toggles, onChange) {
    // Layout follows the geon pattern: an iOS-style switch (.tog) whose
    // `--tog-color` is set by the per-key togClass (tog-v, tog-m, ...).
    // The label text on the left also picks up the per-key color via the
    // same class (shoals' colored-label pattern). No swatch box.
    //
    // Markup:
    //   <div class="settings-dd-row toggle-row {togClass}">
    //     <span class="toggle-label">{label}</span>
    //     <div class="tog-wrap">
    //       <input type="checkbox" id="toggle-{key}" role="switch">
    //       <label for="toggle-{key}" class="tog {togClass}"><span class="tog-thumb"></span></label>
    //     </div>
    //   </div>
    const row = document.createElement('div');
    row.className = 'settings-dd-row toggle-row';
    if (spec.togClass) row.classList.add(spec.togClass);
    row.dataset.toggle = spec.key;

    const lblText = document.createElement('span');
    lblText.className = 'toggle-label';
    lblText.textContent = spec.label;
    row.appendChild(lblText);

    const cbWrap = document.createElement('div');
    cbWrap.className = 'tog-wrap';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = `miasma-toggle-${spec.key}`;
    cb.checked = !!toggles[spec.key];
    cb.dataset.toggle = spec.key;
    cb.setAttribute('role', 'switch');
    cb.setAttribute('aria-label', spec.label);
    cb.setAttribute('aria-checked', cb.checked ? 'true' : 'false');

    const togLbl = document.createElement('label');
    togLbl.htmlFor = cb.id;
    togLbl.className = 'tog';
    if (spec.togClass) togLbl.classList.add(spec.togClass);
    const thumb = document.createElement('span');
    thumb.className = 'tog-thumb';
    togLbl.appendChild(thumb);

    const handleChange = (checked) => {
        toggles[spec.key] = !!checked;
        cb.setAttribute('aria-checked', checked ? 'true' : 'false');
        if (onChange) onChange(spec.key, !!checked);
    };

    if (window._forms && typeof window._forms.bindToggle === 'function') {
        window._forms.bindToggle(cb, handleChange);
    } else {
        cb.addEventListener('change', () => handleChange(cb.checked));
    }

    cbWrap.appendChild(cb);
    cbWrap.appendChild(togLbl);
    row.appendChild(cbWrap);
    return row;
}

// ─── Animal-display mode group (Phase 9 toggle) ────────────────────────────
// Three-way: dots / only / off. Mirrors the geon mode-group pattern — a row
// of buttons inside .mode-toggles with a sliding indicator that picks up the
// active button's tint via the bound class.

const ANIMAL_DISPLAY_SPECS = [
    { key: 'dots', label: 'With dots', hint: 'Animal layer overlaid on human compartment (default)' },
    { key: 'only', label: 'Only',      hint: 'Animal layer only — human compartment hidden' },
    { key: 'off',  label: 'Off',       hint: 'Hide the animal layer entirely' }
];

function buildAnimalDisplayRow(toggles, onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'settings-dd-row animal-display-row';

    const lbl = document.createElement('span');
    lbl.className = 'toggle-label';
    lbl.textContent = 'Animal layer';
    wrap.appendChild(lbl);

    const group = document.createElement('div');
    group.className = 'mode-toggles inline-mode-toggles';
    group.dataset.role = 'animalDisplay';
    group.setAttribute('role', 'tablist');
    group.setAttribute('aria-label', 'Animal layer display mode');

    const initial = toggles.animalDisplay || 'dots';
    const buttons = [];
    for (const spec of ANIMAL_DISPLAY_SPECS) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mode-btn' + (spec.key === initial ? ' active' : '');
        btn.dataset.animalDisplay = spec.key;
        btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-selected', spec.key === initial ? 'true' : 'false');
        btn.title = spec.hint;
        btn.textContent = spec.label;
        group.appendChild(btn);
        buttons.push(btn);
    }
    group.addEventListener('click', (e) => {
        const btn = e.target.closest('.mode-btn');
        if (!btn) return;
        const key = btn.dataset.animalDisplay;
        if (!key) return;
        for (const b of buttons) {
            const on = (b === btn);
            b.classList.toggle('active', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
        }
        toggles.animalDisplay = key;
        if (onChange) onChange('animalDisplay', key);
    });

    wrap.appendChild(group);
    return wrap;
}

/**
 * Wipe `containerEl` and build the toggle panel.
 * @param {HTMLElement} containerEl — the section container inside #tab-settings
 * @param {object} toggles — mutable toggles object, mutated on each checkbox change
 * @param {(key:string, value:boolean) => void} [onChange]
 *        Called after every toggle change.
 */
export function buildTogglesPanel(containerEl, toggles, onChange) {
    if (!containerEl) return;
    while (containerEl.firstChild) containerEl.removeChild(containerEl.firstChild);
    containerEl.__toggleDepsUpdate = null;

    containerEl.appendChild(buildSectionHeader('Compartments'));
    for (const spec of COMPARTMENT_SPECS) {
        containerEl.appendChild(buildToggleRow(spec, toggles, onChange));
    }

    containerEl.appendChild(buildSectionHeader('Flags'));
    for (const spec of FLAG_SPECS) {
        containerEl.appendChild(buildToggleRow(spec, toggles, onChange));
    }

    containerEl.appendChild(buildSectionHeader('Automatic response'));
    for (const spec of RESPONSE_SPECS) {
        containerEl.appendChild(buildToggleRow(spec, toggles, onChange));
    }

    containerEl.appendChild(buildSectionHeader('Display'));
    containerEl.appendChild(buildAnimalDisplayRow(toggles, onChange));

    // ── Dep wiring ──
    // Auto-vaccinate rollout is meaningless when V is off — disable that
    // row when t.V is unchecked. The shared bindDeps API takes
    // `{ target, enable: () => bool }`; on disable it clears the checkbox
    // and tags the surrounding .settings-dd-row with `.ctrl-disabled`
    // (handled by the CSS rules added in styles.css).
    if (window._forms && typeof window._forms.bindDeps === 'function') {
        const vCb = containerEl.querySelector('input[data-toggle="V"]');
        const vaxCb = containerEl.querySelector('input[data-toggle="vax_rollout"]');
        if (vCb && vaxCb) {
            const update = window._forms.bindDeps([
                { target: vaxCb, enable: () => !!vCb.checked }
            ], {
                onDisable: (el) => {
                    if (el === vaxCb) toggles.vax_rollout = false;
                }
            });
            containerEl.__toggleDepsUpdate = update;
            vCb.addEventListener('change', () => update());
        }
    }

    containerEl.dataset.togglesReady = '1';
}

/** Re-sync checkbox states to the current `toggles` object (e.g. after reset). */
export function syncToggles(containerEl, toggles) {
    if (!containerEl) return;
    const allSpecs = COMPARTMENT_SPECS.concat(FLAG_SPECS).concat(RESPONSE_SPECS);
    for (const spec of allSpecs) {
        const cb = containerEl.querySelector(`input[type="checkbox"][data-toggle="${spec.key}"]`);
        if (!cb) continue;
        const v = !!toggles[spec.key];
        cb.checked = v;
        cb.setAttribute('aria-checked', v ? 'true' : 'false');
    }
    if (typeof containerEl.__toggleDepsUpdate === 'function') {
        containerEl.__toggleDepsUpdate();
    }
    // Animal-display mode group: re-sync active button to toggles.animalDisplay.
    const animalGroup = containerEl.querySelector('[data-role="animalDisplay"]');
    if (animalGroup) {
        const target = toggles.animalDisplay || 'dots';
        animalGroup.querySelectorAll('.mode-btn').forEach((b) => {
            const on = (b.dataset.animalDisplay === target);
            b.classList.toggle('active', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
    }
}
