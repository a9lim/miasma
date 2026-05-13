// ui.js — control panel setup for miasma.
// Phase 1: topology + view-mode mode-toggles, about panel.
// Phase 2: parameter sliders in #tab-settings (built via params.buildSettingsPanel),
// step/reset buttons wired to main-loop callbacks.
// Phase 3: compartment / flag toggles split into their own sub-section above the
// parameter sliders. The settings tab root is wiped once on setup and given two
// children — a toggles container and a params container — so the two builders
// don't clobber each other. _forms.bindDeps wiring for compartment / strain /
// preset deps still lives in Phase 3 follow-up work inside toggles.js.

import { topoFromString, ViewMode } from './config.js';
import { buildSettingsPanel, syncSliders } from './params.js';
import { buildTogglesPanel, syncToggles } from './toggles.js';
import { buildInterventionsPanel } from './paint.js';
import { buildPresetsPanel } from './presets.js';

/**
 * Wire control panel UI. The cache `$` is built in main.js; the `sim` object
 * is mutated in callbacks. The callbacks let main.js own the run-loop side
 * effects without ui.js importing anything from main.
 *
 * Returns a small handle so main.js can ask ui.js to re-sync DOM state on
 * reset (the toggles checkboxes need re-checking when the toggles object is
 * mutated back to defaults).
 *
 * @param {Object} $ — DOM cache from main.js
 * @param {Object} sim — sim state object (mutated in callbacks)
 * @param {Object} hooks — { onTopologyChange, onViewModeChange, onParamChange,
 *                          onTogglesChange, onStep, onReset, params, toggles,
 *                          settingsPanelEl, paintController,
 *                          interventionsPanelEl, onPaintChange }
 * @returns {{ resetUI: () => void }}
 */
export function setupUI($, sim, hooks) {
    hooks = hooks || {};

    // ── Topology mode-toggle ──
    if ($.topologyToggles) {
        window._forms.bindModeGroup($.topologyToggles, 'topology', (val) => {
            const t = topoFromString(val);
            sim.topology = t;
            if (hooks.onTopologyChange) hooks.onTopologyChange(t);
        });
    }

    // ── View-mode mode-toggle ──
    if ($.viewModeToggles) {
        window._forms.bindModeGroup($.viewModeToggles, 'viewmode', (val) => {
            sim.viewMode = val || ViewMode.COMPARTMENT;
            if (hooks.onViewModeChange) hooks.onViewModeChange(sim.viewMode);
        });
    }

    // ── Settings tab — presets + toggles + parameter sliders ──
    // The tab-settings root holds three stacked sub-sections, each owned
    // by its own builder. Build them with createElement and hand each child
    // element to the corresponding builder. The builders wipe their own
    // panelEl on each call, so passing them sub-containers keeps their
    // wipes scoped.
    let presetsEl = null;
    let togglesEl = null;
    let paramsEl = null;
    const panelEl = hooks.settingsPanelEl;
    if (panelEl) {
        // Clear the tab-settings panel once — the Phase 1 hint paragraph and
        // any prior content are removed via node-by-node removal so we
        // never touch HTML-string assignment.
        while (panelEl.firstChild) panelEl.removeChild(panelEl.firstChild);

        presetsEl = document.createElement('div');
        presetsEl.className = 'settings-section settings-presets';
        panelEl.appendChild(presetsEl);

        togglesEl = document.createElement('div');
        togglesEl.className = 'settings-section settings-toggles';
        panelEl.appendChild(togglesEl);

        paramsEl = document.createElement('div');
        paramsEl.className = 'settings-section settings-params';
        panelEl.appendChild(paramsEl);

        if (hooks.onApplyPreset) {
            buildPresetsPanel(presetsEl, hooks.onApplyPreset);
        }

        if (hooks.toggles) {
            buildTogglesPanel(togglesEl, hooks.toggles, (key, value) => {
                if (hooks.onTogglesChange) hooks.onTogglesChange(key, value);
            });
        }

        if (hooks.params) {
            buildSettingsPanel(paramsEl, hooks.params, hooks.onParamChange);
        }
    }

    // ── Interventions tab (Phase 11 paint) ──
    if (hooks.interventionsPanelEl && hooks.paintController) {
        buildInterventionsPanel(
            hooks.interventionsPanelEl,
            hooks.paintController,
            hooks.onPaintChange || null
        );
    }

    // ── Step button ──
    // Advances one tick when paused. Holding step under play is a no-op
    // (the run loop is already moving forward).
    if ($.stepBtn && hooks.onStep) {
        $.stepBtn.addEventListener('click', () => {
            if (!sim.playing) hooks.onStep();
        });
    }

    // ── Reset button ──
    if ($.resetBtn && hooks.onReset) {
        $.resetBtn.addEventListener('click', () => hooks.onReset());
    }

    // ── About panel ──
    if (typeof window.initAboutPanel === 'function') {
        const panel = window.initAboutPanel({
            title: 'miasma',
            description:
                'Stochastic spatial epidemic simulator on a hex lattice. ' +
                'Configurable compartmental model, multi-strain evolution, ' +
                'topology toggle (plane through RP²), intervention painting.',
            controls: [],
            shortcuts: [
                { key: 'space',  label: 'Play / pause' },
                { key: '.',      label: 'Step one tick' },
                { key: '1–6',    label: 'Paint mode (none / seed / vaccinate / quarantine / sanitize / cull)' },
                { key: '[ / ]',  label: 'Brush size down / up' },
                { key: 'ctrl+z', label: 'Undo last stroke' },
                { key: '?',      label: 'Toggle this panel' }
            ],
            repo: 'https://github.com/a9lim/a9lim.github.io'
        });
        if ($.aboutBtn && panel && typeof panel.show === 'function') {
            $.aboutBtn.addEventListener('click', panel.show);
        }
    }

    return {
        // Re-sync the toggles checkbox DOM to whatever the toggles object
        // currently holds. main.js calls this after Object.assign(toggles,
        // DEFAULT_TOGGLES) on reset so the UI matches reality. Phase 12
        // extends this to also re-sync the slider values + the topology
        // mode-group so an applied preset is visible everywhere.
        resetUI() {
            if (togglesEl && hooks.toggles) {
                syncToggles(togglesEl, hooks.toggles);
            }
            if (paramsEl && hooks.params) {
                syncSliders(paramsEl, hooks.params);
            }
            // Re-sync topology mode-group active button to sim.topology.
            if ($.topologyToggles) {
                const reverseTopo = {
                    0: 'plane', 1: 'cylinder', 2: 'torus',
                    3: 'mobius', 4: 'klein', 5: 'rp2'
                };
                const targetKey = reverseTopo[sim.topology] || 'torus';
                const btns = $.topologyToggles.querySelectorAll('.mode-btn');
                let activeBtn = null;
                btns.forEach((b) => {
                    const on = (b.dataset.topology === targetKey);
                    b.classList.toggle('active', on);
                    b.setAttribute('aria-selected', on ? 'true' : 'false');
                    if (on) activeBtn = b;
                });
                // Reposition the sliding mode-indicator if shared-forms wrote one.
                const indicator = $.topologyToggles.querySelector('.mode-indicator');
                if (indicator && activeBtn) {
                    indicator.style.width = activeBtn.offsetWidth + 'px';
                    indicator.style.transform = 'translateX(' + (activeBtn.offsetLeft - 3) + 'px)';
                }
            }
        }
    };
}
