// toggles.js — the live switches (compartments V, M, Z; flags L, C, F; the
// automatic responses; the animal layer's display) and the hairline switch
// row the Model tab builds them with. The same object instance is shared
// with the tick loop, so a switch takes effect on the next tick.
//
// No innerHTML — every node via createElement / textContent.

// The baseline lives in default-toggles.js so dynamics, presets and the UI
// share one source of truth. Z is opt-in; the Z presets turn it on.
import { DEFAULT_TOGGLES } from './default-toggles.js';
export { DEFAULT_TOGGLES };

/** Build a fresh, mutable toggles object seeded from DEFAULT_TOGGLES. */
export function makeToggles() {
    return Object.assign({}, DEFAULT_TOGGLES);
}

/**
 * One switch row: its label, then a hairline switch over a visually clipped
 * checkbox (focusable and announced).
 *   <div class="settings-dd-row toggle-row">
 *     <label class="toggle-label" for="…">{label}</label>
 *     <div class="tog-wrap"><input type="checkbox" role="switch"><label class="tog"><span class="tog-thumb"></span></label></div>
 *   </div>
 * @param {{key:string, label:string}} spec
 * @param {object} toggles — mutated on change
 * @param {(key:string, value:boolean) => void} [onChange]
 */
export function buildSwitchRow(spec, toggles, onChange) {
    const row = document.createElement('div');
    row.className = 'settings-dd-row toggle-row';
    row.dataset.toggle = spec.key;

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = `miasma-toggle-${spec.key}`;
    cb.checked = !!toggles[spec.key];
    cb.dataset.toggle = spec.key;
    cb.setAttribute('role', 'switch');
    cb.setAttribute('aria-checked', cb.checked ? 'true' : 'false');

    const lblText = document.createElement('label');
    lblText.className = 'toggle-label';
    lblText.htmlFor = cb.id;
    lblText.textContent = spec.label;

    const cbWrap = document.createElement('div');
    cbWrap.className = 'tog-wrap';
    const togLbl = document.createElement('label');
    togLbl.htmlFor = cb.id;
    togLbl.className = 'tog';
    const thumb = document.createElement('span');
    thumb.className = 'tog-thumb';
    togLbl.appendChild(thumb);

    const handleChange = (checked) => {
        toggles[spec.key] = !!checked;
        cb.setAttribute('aria-checked', checked ? 'true' : 'false');
        if (onChange) onChange(spec.key, !!checked);
    };
    if (window._forms && typeof window._forms.bindToggle === 'function') window._forms.bindToggle(cb, handleChange);
    else cb.addEventListener('change', () => handleChange(cb.checked));

    cbWrap.append(cb, togLbl);
    row.append(lblText, cbWrap);
    return row;
}
