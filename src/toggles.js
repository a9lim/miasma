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

// ─── Defaults (must match src/dynamics.js DEFAULT_TOGGLES) ──────────────────
export const DEFAULT_TOGGLES = Object.freeze({
    V: true,
    M: true,
    Z: false,
    L: true,
    C: true,
    F: true
});

/** Build a fresh, mutable toggles object seeded from DEFAULT_TOGGLES. */
export function makeToggles() {
    return Object.assign({}, DEFAULT_TOGGLES);
}

// ─── Row specs ──────────────────────────────────────────────────────────────
// `swatchVar` is null for flag rows (no compartment color); compartment rows
// pull from the same --epi-* vars the legend/stats panel use.

const COMPARTMENT_SPECS = [
    { key: 'V', label: 'V — Vaccinated',     swatchVar: '--epi-v' },
    { key: 'M', label: 'M — Maternal immune', swatchVar: '--epi-m' },
    { key: 'Z', label: 'Z — Zombie',          swatchVar: '--epi-z' }
];

const FLAG_SPECS = [
    { key: 'L', label: 'L — Latent (on E)',             swatchVar: null },
    { key: 'C', label: 'C — Carrier (on R)',            swatchVar: null },
    { key: 'F', label: 'F — Infectious corpse (on D)',  swatchVar: null }
];

// ─── DOM construction ──────────────────────────────────────────────────────

function buildSectionHeader(text) {
    const hdr = document.createElement('div');
    hdr.className = 'toggles-section-header';
    hdr.textContent = text;
    return hdr;
}

function buildToggleRow(spec, toggles, onChange) {
    // Reuse .settings-dd-row layout so the toggles align with the param sliders
    // above. The row contains a label (with optional swatch) on the left and
    // a .checkbox-label-wrapped checkbox on the right.
    const row = document.createElement('div');
    row.className = 'settings-dd-row';
    row.dataset.toggle = spec.key;

    // ── Label side ──
    const lbl = document.createElement('label');
    lbl.className = 'settings-dd-label toggles-row-label';

    if (spec.swatchVar) {
        const swatch = document.createElement('span');
        swatch.className = 'stat-swatch';
        swatch.style.backgroundColor = `var(${spec.swatchVar})`;
        swatch.setAttribute('aria-hidden', 'true');
        lbl.appendChild(swatch);
    }

    const lblText = document.createElement('span');
    lblText.textContent = spec.label;
    lbl.appendChild(lblText);

    // ── Checkbox side ──
    const cbWrap = document.createElement('label');
    cbWrap.className = 'checkbox-label toggles-checkbox-wrap';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!toggles[spec.key];
    cb.dataset.toggle = spec.key;
    cb.setAttribute('aria-label', spec.label);
    cb.setAttribute('aria-checked', cb.checked ? 'true' : 'false');

    // Tie the visible label to the checkbox for click-through.
    lbl.setAttribute('for', '');
    lbl.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT') return;
        cb.click();
    });

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

    row.append(lbl, cbWrap);
    return row;
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

    containerEl.appendChild(buildSectionHeader('Compartments'));
    for (const spec of COMPARTMENT_SPECS) {
        containerEl.appendChild(buildToggleRow(spec, toggles, onChange));
    }

    containerEl.appendChild(buildSectionHeader('Flags'));
    for (const spec of FLAG_SPECS) {
        containerEl.appendChild(buildToggleRow(spec, toggles, onChange));
    }

    // Phase 3 dep wiring: trivially-true placeholder. Compartment-level
    // dependencies (V↔vaccinate intervention, M↔births enabled) belong in
    // Phase 11 when those interventions exist. Flag rows depend on their
    // parent compartment, but E/R/D are always on in Phase 3, so the deps
    // would be no-ops. Skipping bindDeps here to avoid introducing broken
    // references — the integrator can layer them in later.

    containerEl.dataset.togglesReady = '1';
}

/** Re-sync checkbox states to the current `toggles` object (e.g. after reset). */
export function syncToggles(containerEl, toggles) {
    if (!containerEl) return;
    const allSpecs = COMPARTMENT_SPECS.concat(FLAG_SPECS);
    for (const spec of allSpecs) {
        const cb = containerEl.querySelector(`input[type="checkbox"][data-toggle="${spec.key}"]`);
        if (!cb) continue;
        const v = !!toggles[spec.key];
        cb.checked = v;
        cb.setAttribute('aria-checked', v ? 'true' : 'false');
    }
}
