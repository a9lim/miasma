// presets.js — named configurations for the sim.
//
// Presets cover the textbook curriculum plus a few exotic cases. Each preset
// is a partial override over
// DEFAULT_PARAMS + DEFAULT_TOGGLES + a topology and a clearing policy.
// Apply order:
//   1. Reset toggles to DEFAULT_TOGGLES, then merge preset.toggles
//   2. Reset params to DEFAULT_PARAMS, then merge preset.params
//   3. Set topology
//   4. Optionally reset the sim (clear paint, refresh strains, restart history)
//
// The preset list is the source of truth for the dropdown label + the
// applied configuration. `applyPreset` does the actual mutation; it lives
// here so a future shortcut (?preset=ebola) can wire directly without
// importing UI.
//
// IMPORTANT: presets MERGE over DEFAULT_PARAMS, they don't replace it
// wholesale. That way new keys added in future phases get sensible
// defaults without every preset opting in.

import { Topology } from './config.js';
import { DEFAULT_PARAMS } from './default-params.js';
import { DEFAULT_TOGGLES } from './default-toggles.js';

// ─── Preset table ──────────────────────────────────────────────────────────
// Each entry:
//   key         — stable identifier (URL param, localStorage)
//   label       — display name in the dropdown
//   description — one-line summary; shown in panel-hint under the dropdown
//   topology    — Topology enum value
//   toggles     — partial override over DEFAULT_TOGGLES
//   params      — partial override over DEFAULT_PARAMS
//
// Per-preset calibration notes are inline. Numbers are tuned by hand to
// produce visually canonical outbreak shapes on the default 120×120 hex
// grid; they're not literal epidemiological estimates.

export const PRESETS = Object.freeze([
    {
        key: 'seir-vanilla',
        label: 'SEIR vanilla',
        description: 'Pure Kermack–McKendrick on a torus. No flags, no animals, no Z.',
        topology: Topology.TORUS,
        toggles: { V: false, M: false, Z: false, L: false, C: false, F: false,
                   auto_hospital: false, auto_quarantine: false },
        params: {
            beta:  0.32,
            sigma: 0.25,
            gamma: 0.12,
            mu:    0.003,
            // Disable everything that's gated on toggles or animal density.
            animal_density: 0,
            spillover_rate: 0,
            reverse_spillover_rate: 0,
            // No births so the population stays fixed during the run.
            birth_rate: 0,
            // No spontaneous mortality so we see the textbook S+E+I+R curve.
            mortality_baseline: 0,
            mortality_age_max: 0,
            health_degrade_per_tick: 0,
            health_mortality_mult: 1,
            age_susceptibility_mult: 1,
            age_severity_mult: 1
        }
    },
    {
        key: 'covid',
        label: 'COVID-like',
        description: 'Moderate β with longer infectious period, hospital/quarantine pressure.',
        topology: Topology.TORUS,
        toggles: { V: true, M: false, Z: false, L: false, C: false, F: false },
        params: {
            beta:  0.42,
            sigma: 0.18,   // ~5 tick latency
            gamma: 0.08,   // ~12 tick infectious
            mu:    0.006,
            h_capacity_frac:           0.03,
            h_recover_mult:            1.8,
            h_mortality_mult:          0.35,
            h_overflow_mortality_mult: 1.6,
            q_transmit_mult:           0.15,
            q_susceptibility_mult:     0.3,
            mutation_rate: 0.004,
            // Waning immunity + imperfect vaccine — both are real for COVID.
            r_susceptibility_mult: 0.15,   // recovered cells ~15% as susceptible as naive
            vax_efficacy:          0.80,   // ~20% breakthrough on contact
            animal_density: 0,
            spillover_rate: 0,
            reverse_spillover_rate: 0
        }
    },
    {
        key: 'ebola',
        label: 'Ebola',
        description: 'Lower β, high mortality, infectious corpses (F flag).',
        topology: Topology.PLANE,
        toggles: { V: false, M: false, Z: false, L: false, C: false, F: true },
        params: {
            beta:  0.22,
            sigma: 0.12,
            gamma: 0.06,
            mu:    0.04,           // ~50% CFR by ratio mu/(mu+gamma)
            f_decay: 0.03,         // F flag persists ~33 ticks
            f_transmit_mult: 0.85, // corpses are highly infectious
            d_disposal: 0.015,     // slow corpse disposal
            health_degrade_per_tick: 0.05,
            health_mortality_mult: 4,
            animal_density: 0,
            spillover_rate: 0,
            reverse_spillover_rate: 0
        }
    },
    {
        key: 'tb',
        label: 'Tuberculosis',
        description: 'Most exposures go latent (L flag); slow reactivation makes a long-tailed burn.',
        topology: Topology.TORUS,
        toggles: { V: false, M: false, Z: false, L: true, C: false, F: false },
        params: {
            beta:  0.18,
            sigma: 0.02,          // long latency for the (rare) non-latent path
            gamma: 0.015,         // long infectious
            mu:    0.001,         // low CFR with treatment proxy
            l_seed:       0.90,   // ~90% of fresh exposures latch latent (TB's defining feature)
            l_reactivate: 0.0008, // slow trickle of latent → active
            mutation_rate: 0.0005,
            animal_density: 0,
            spillover_rate: 0,
            reverse_spillover_rate: 0
        }
    },
    {
        key: 'hantavirus',
        label: 'Andes hantavirus',
        description: 'Reservoir-primary (rodents); rare human-to-human spread; chronic-carrier recoveries.',
        topology: Topology.PLANE,
        toggles: { V: false, M: false, Z: false, L: false, C: true, F: false },
        params: {
            beta:  0.08,                  // h-to-h is genuinely rare
            sigma: 0.15,
            gamma: 0.07,
            mu:    0.025,                 // ~30% CFR
            animal_density: 0.35,         // dense rodent reservoir
            animal_beta:   0.18,
            animal_gamma:  0.03,
            animal_mu:     0.001,
            animal_d_disposal: 0.05,
            spillover_rate:         0.04, // animal → human is the primary driver
            reverse_spillover_rate: 0.001,
            c_seed:          0.40,        // ~40% of recoveries become chronic carriers
            c_transmit_mult: 0.6          // chronic carriage on rodents proxy
        }
    },
    {
        key: 'smallpox',
        label: 'Smallpox',
        description: 'High β, severe mortality. Vaccination canonical.',
        topology: Topology.TORUS,
        toggles: { V: true, M: false, Z: false, L: false, C: false, F: false },
        params: {
            beta:  0.55,
            sigma: 0.16,
            gamma: 0.07,
            mu:    0.018,        // ~20% CFR
            health_degrade_per_tick: 0.03,
            age_severity_mult: 2.5,
            mutation_rate: 0.0005, // antigenically stable
            animal_density: 0,
            spillover_rate: 0,
            reverse_spillover_rate: 0
        }
    },
    {
        key: 'plague',
        label: 'Plague + rats',
        description: 'Bidirectional rodent spillover. F-corpse infectious.',
        topology: Topology.PLANE,
        toggles: { V: false, M: false, Z: false, L: false, C: false, F: true },
        params: {
            beta:  0.34,
            sigma: 0.18,
            gamma: 0.08,
            mu:    0.03,
            f_decay: 0.02,
            f_transmit_mult: 0.7,
            d_disposal: 0.012,
            animal_density: 0.25,
            animal_beta:    0.22,
            animal_gamma:   0.04,
            animal_mu:      0.012,
            animal_d_disposal: 0.06,
            spillover_rate:         0.06,
            reverse_spillover_rate: 0.02
        }
    },
    {
        key: 'zombie-apocalypse',
        label: 'Zombie apocalypse',
        description: 'Infectious corpses reanimate; humans fight back; zombies have a finite lifespan. Macro reading.',
        topology: Topology.PLANE,
        toggles: { V: false, M: false, Z: true, L: false, C: false, F: true,
                   vax_rollout: false, auto_quarantine: false },
        params: {
            // Modest baseline outbreak so a Z front has something to chew
            // through. Disease is the pretext, not the main mechanic.
            beta:  0.30,
            sigma: 0.18,
            gamma: 0.07,
            mu:    0.025,        // ~25% CFR — feeds the F-corpse spawn pipe
            f_decay: 0.04,       // F-corpses persist long enough to reanimate
            f_transmit_mult: 0.5,
            d_disposal: 0.01,    // slow cleanup so the F-corpse pool builds
            // Encounter dynamics: humans fight, zombies kill+infect more
            // often than they convert directly (because conversion is the
            // F-corpse pathway). Z natural lifespan ~150 ticks.
            dz_dead:             0.05,
            dz_alive:            0.001,
            z_convert_unopposed: 0.05,
            z_fight_kill:        0.20,
            z_fight_infect:      0.30,
            z_fight_expose:      0.05,
            z_die_fighting:      0.06,   // humans fight back hard
            z_die_natural:       0.007,  // ~140-tick lifespan
            z_exhaust_threshold: 5,      // crowding rarely kills zombies in this reading
            z_exhaust:           0.04,
            l_transform:         0,      // no oncoviral pathway
            // No animals; no births to keep horde dynamics legible.
            birth_rate: 0,
            animal_density: 0,
            spillover_rate: 0,
            reverse_spillover_rate: 0,
            mutation_rate: 0
        }
    },
    {
        key: 'oncoviral-transformation',
        label: 'Oncoviral transformation',
        description: 'Cells, not people. Latent integration → malignant transformation; immune surveillance; tumor-core necrosis. Micro reading.',
        topology: Topology.TORUS,
        toggles: { V: false, M: false, Z: true, L: true, C: false, F: false,
                   vax_rollout: false, auto_quarantine: false },
        params: {
            // The "disease" is the oncovirus itself — slow chronic
            // infection that mostly stays latent. β stays low so naive
            // cells aren't infected en masse; L seeding is high so the
            // exposures that do happen integrate latently.
            beta:  0.10,
            sigma: 0.001,        // rare non-latent activation
            gamma: 0.02,         // slow viral clearance
            mu:    0.001,        // viral phase rarely kills cells outright
            l_seed:       0.95,  // ~95% of exposures integrate latently
            l_reactivate: 0.0001, // very rare viral reactivation
            // The transformation pathway: latent → Z at a small per-tick
            // rate. With l_seed near 1, the L pool grows; l_transform
            // turns a small fraction of it malignant each tick.
            l_transform:         0.0008,
            // Cell-level encounter dynamics: high conversion (clonal
            // expansion drives the tumor front), near-zero "fight" (cells
            // don't fight; the small z_die_fighting represents NK / CTL
            // immune surveillance). No natural lifespan — transformed
            // cells are immortal (telomerase reactivation). Tumor-core
            // necrosis via exhaust-by-crowding.
            dz_dead:             0,
            dz_alive:            0,
            z_convert_unopposed: 0.45,
            z_fight_kill:        0,
            z_fight_infect:      0,
            z_fight_expose:      0,
            z_die_fighting:      0.005, // immune surveillance, not combat
            z_die_natural:       0,     // immortal transformed cells
            z_exhaust_threshold: 5,     // necrosis only in dense cores
            z_exhaust:           0.10,
            // No births, no animals — this is one tissue, one population.
            birth_rate: 0,
            animal_density: 0,
            spillover_rate: 0,
            reverse_spillover_rate: 0,
            mutation_rate: 0.002 // tumor-clone evolution, small but nonzero
        }
    },
    {
        key: 'absurd',
        label: 'Absurd mode',
        description: 'Every toggle on, including Z. High mutation. Anything goes.',
        topology: Topology.KLEIN,
        toggles: { V: true, M: true, Z: true, L: true, C: true, F: true },
        params: {
            beta:  0.5,
            sigma: 0.22,
            gamma: 0.1,
            mu:    0.025,
            f_decay: 0.04,
            f_transmit_mult: 0.8,
            dz_dead:  0.08,
            dz_alive: 0.01,
            z_convert_unopposed: 0.45,
            z_fight_kill:        0.15,
            z_fight_infect:      0.20,
            z_fight_expose:      0.05,
            z_die_fighting:      0.03,
            z_die_natural:       0.003,
            z_exhaust_threshold: 4,
            z_exhaust:           0.12,
            l_transform:         0.001,
            l_seed:          0.30,
            l_reactivate:    0.003,
            c_seed:          0.40,
            c_transmit_mult: 0.5,
            r_susceptibility_mult: 0.25,
            vax_efficacy:          0.75,
            birth_rate: 0.06,
            mutation_rate:     0.02,
            mutation_strength: 0.08,
            recombination_rate: 0.025,
            animal_density:         0.18,
            animal_beta:            0.3,
            animal_gamma:           0.05,
            animal_mu:              0.01,
            spillover_rate:         0.04,
            reverse_spillover_rate: 0.01
        }
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
 *
 * @param {Object} preset — an entry from PRESETS
 * @param {Object} params — live params object (mutated in place)
 * @param {Object} toggles — live toggles object (mutated in place)
 * @param {Object} sim — sim state (sim.topology is set; sim.tick is not touched)
 * @returns {boolean} true if applied
 */
export function applyPreset(preset, params, toggles, sim) {
    if (!preset || !params || !toggles || !sim) return false;
    // Restore defaults first so a preset's omitted keys land on the
    // documented baseline (not whatever the previous preset bequeathed).
    // Phase A: per-strain fields (β, σ, γ, μ, m_decay, l_*, c_*, f_*,
    // dz_*, z_*, health_*) still live in params here — they're the source
    // of truth for α's seed genome. main.js's onApplyPreset calls
    // resetGridOnly() right after this, which rebuilds the strain
    // registry via createRegistry(params), routing per-strain fields
    // through registerStrain into α's genome row. So preset.params keys
    // for those fields hit α on the next reset — no separate code path
    // needed here.
    for (const k in DEFAULT_PARAMS) params[k] = DEFAULT_PARAMS[k];
    for (const k in DEFAULT_TOGGLES) toggles[k] = DEFAULT_TOGGLES[k];
    // Merge preset overrides.
    if (preset.params) {
        for (const k in preset.params) params[k] = preset.params[k];
    }
    if (preset.toggles) {
        for (const k in preset.toggles) toggles[k] = preset.toggles[k];
    }
    if (!toggles.V) toggles.vax_rollout = false;
    if (typeof preset.topology === 'number') {
        sim.topology = preset.topology;
    }
    return true;
}

// ─── Settings panel — preset dropdown ──────────────────────────────────────
// Builder consumed by ui.js. Lives here so the preset table and its UI sit
// together — adding a preset only needs one edit. No innerHTML.

function buildSelect(initialKey) {
    const select = document.createElement('select');
    select.className = 'sim-select preset-select';
    select.setAttribute('aria-label', 'Preset');

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '— Custom —';
    select.appendChild(placeholder);

    for (const p of PRESETS) {
        const opt = document.createElement('option');
        opt.value = p.key;
        opt.textContent = p.label;
        if (p.key === initialKey) opt.selected = true;
        select.appendChild(opt);
    }
    return select;
}

/**
 * Build the preset chooser panel.
 *
 * @param {HTMLElement} panelEl — container element (cleared)
 * @param {(presetKey:string) => void} onApply — fired when the user clicks
 *   Apply. Caller is responsible for resetting the sim + re-syncing UI.
 */
export function buildPresetsPanel(panelEl, onApply) {
    if (!panelEl) return;
    while (panelEl.firstChild) panelEl.removeChild(panelEl.firstChild);

    const hdr = document.createElement('div');
    hdr.className = 'toggles-section-header';
    hdr.textContent = 'Preset';
    panelEl.appendChild(hdr);

    const row = document.createElement('div');
    row.className = 'settings-dd-row preset-row';

    const select = buildSelect('');
    row.appendChild(select);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tool-btn preset-apply-btn';
    btn.textContent = 'Apply';
    btn.disabled = true;
    btn.setAttribute('aria-label', 'Apply selected preset');
    row.appendChild(btn);

    panelEl.appendChild(row);

    // Description hint updates when the dropdown changes — so the user can
    // read what they're about to apply.
    const desc = document.createElement('div');
    desc.className = 'settings-dd-row preset-desc';
    const descText = document.createElement('span');
    descText.className = 'panel-hint';
    descText.textContent = 'Pick a calibrated configuration. Apply replaces all parameters, toggles, and topology.';
    desc.appendChild(descText);
    panelEl.appendChild(desc);

    // Enhance into a custom dropdown if available — handles styling parity
    // with the rest of the design system. Fires native 'change' so our
    // handler still runs.
    if (window._dropdown && typeof window._dropdown.enhance === 'function') {
        try { window._dropdown.enhance(select); } catch (_) { /* ok */ }
    }

    select.addEventListener('change', () => {
        const p = getPreset(select.value);
        btn.disabled = !p;
        descText.textContent = p
            ? p.description
            : 'Pick a calibrated configuration. Apply replaces all parameters, toggles, and topology.';
    });

    btn.addEventListener('click', () => {
        const p = getPreset(select.value);
        if (!p) return;
        if (typeof onApply === 'function') onApply(p.key);
    });

    panelEl.dataset.presetsReady = '1';
}
