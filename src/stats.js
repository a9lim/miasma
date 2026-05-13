// stats.js — compartment census + rolling R_eff estimator + idempotent panel renderer.
//
// Three exports:
//   computeStats(grid)                       — single-pass tally over grid.compartment + grid.status
//   computeReff(history, ...)                — observed-transitions rolling R_eff
//   renderStatsPanel(el, s, reff, capacity)  — build-once / text-only-update DOM into #tab-compartments
//
// No innerHTML anywhere. DOM is built on first call and only text-content
// is mutated on subsequent calls — safe at 60 Hz.

import { Compartment, Status } from './config.js';

// Compartment ordering used both for the typed-array count buffer and the
// display order in the panel. Index in this array === Compartment enum value.
const COMPARTMENT_KEYS = ['S', 'E', 'I', 'R', 'D', 'V', 'M', 'Z', 'empty'];

const COMPARTMENT_LABELS = Object.freeze({
    S:     'Susceptible',
    E:     'Exposed',
    I:     'Infectious',
    R:     'Recovered',
    D:     'Deceased',
    V:     'Vaccinated',
    M:     'Maternal immune',
    Z:     'Zombie',
    empty: 'Empty'
});

// CSS var per compartment for the swatch background. Must match miasma/colors.js.
const COMPARTMENT_SWATCH_VAR = Object.freeze({
    S:     '--epi-s',
    E:     '--epi-e',
    I:     '--epi-i',
    R:     '--epi-r',
    D:     '--epi-d',
    V:     '--epi-v',
    M:     '--epi-m',
    Z:     '--epi-z',
    empty: '--bg-base'
});

const MIN_REFF_TICKS = 5;

/**
 * Tally cells per compartment and per status, and collect age / health summary.
 * Single combined pass over grid.compartment / grid.status / grid.age / grid.health
 * for cache locality; uses Uint32Array tally buffers to avoid object allocations
 * in the hot path.
 *
 * meanAge: integer (ticks), averaged over all non-EMPTY cells. 0 if no non-EMPTY.
 * meanHealth: 0..1 float, averaged over S/E/I/R/V/M ("alive") cells only —
 *     excludes D, Z, EMPTY. Returns 1.0 sentinel if no alive cells (nothing to assess).
 *
 * @param {{compartment: Uint8Array, status?: Uint8Array, age?: Uint16Array, health?: Float32Array}} grid
 * @returns {{S:number,E:number,I:number,R:number,D:number,V:number,M:number,Z:number,empty:number,total:number,statusH:number,statusQ:number,meanAge:number,meanHealth:number}}
 */
export function computeStats(grid) {
    const counts = new Uint32Array(9);
    const statusCounts = new Uint32Array(3);
    const comp = grid.compartment;
    const status = grid.status; // may be undefined on very old grids; guard below
    const age = grid.age;       // Phase 5 — may be undefined on older grids
    const health = grid.health; // Phase 5 — may be undefined on older grids
    const mask = grid.mask;     // hex-shape mask — void cells (mask=0) excluded
    const n = comp.length;

    let total = 0;           // count of in-world cells (mask=1)
    let ageSum = 0;          // sum of grid.age over non-EMPTY in-world cells
    let ageCount = 0;        // count of non-EMPTY in-world cells
    let healthSum = 0;       // sum of grid.health over alive cells
    let healthCount = 0;     // count of alive cells

    for (let i = 0; i < n; i++) {
        // Skip void cells outside the hexagonal mask — they aren't part of
        // the simulated world, so they don't contribute to any tally.
        if (mask !== undefined && mask[i] === 0) continue;
        total++;
        // Bounds-safe: any unexpected byte falls into the EMPTY bucket.
        const c = comp[i];
        const cBucket = (c <= Compartment.EMPTY) ? c : Compartment.EMPTY;
        counts[cBucket]++;

        if (status !== undefined) {
            const s = status[i];
            if (s === Status.H) statusCounts[Status.H]++;
            else if (s === Status.Q) statusCounts[Status.Q]++;
        }

        // Age: any non-EMPTY cell contributes.
        if (cBucket !== Compartment.EMPTY) {
            if (age !== undefined) {
                ageSum += age[i];
                ageCount++;
            }
            // "Alive" = S, E, I, R, V, M (exclude D, Z, EMPTY).
            if (
                health !== undefined &&
                cBucket !== Compartment.D &&
                cBucket !== Compartment.Z
            ) {
                healthSum += health[i];
                healthCount++;
            }
        }
    }

    const meanAge = ageCount > 0 ? Math.round(ageSum / ageCount) : 0;
    const meanHealth = healthCount > 0 ? (healthSum / healthCount) : 1.0;

    return {
        S:          counts[Compartment.S],
        E:          counts[Compartment.E],
        I:          counts[Compartment.I],
        R:          counts[Compartment.R],
        D:          counts[Compartment.D],
        V:          counts[Compartment.V],
        M:          counts[Compartment.M],
        Z:          counts[Compartment.Z],
        empty:      counts[Compartment.EMPTY],
        total:      total,
        statusH:    statusCounts[Status.H],
        statusQ:    statusCounts[Status.Q],
        meanAge:    meanAge,
        meanHealth: meanHealth
    };
}

/**
 * Rolling R_eff estimator from observed transitions.
 *
 * Formula: R_eff ≈ Σ(sToE) / Σ(iToR + iToD) over the last `windowSize` ticks.
 *
 * This is the "new infections per removal event" ratio — robust to model
 * misspecification because it sidesteps β and γ entirely and just reads off
 * the realized transition flows. When transmission balances removals, R_eff
 * sits at 1; epidemic growth pushes it above 1, decay below.
 *
 * Returns NaN if:
 *   - history has fewer than MIN_REFF_TICKS samples
 *   - the denominator (total removals in window) is zero (no signal yet)
 *
 * @param {Array<{tick:number, sToE:number, eToI:number, iToR:number, iToD:number, Icount:number}>} history
 * @param {object} _params unused for the observed-transitions estimator; reserved for the β·S·(1/γ) alternate
 * @param {number} [windowSize=30]
 * @returns {number}
 */
export function computeReff(history, _params, windowSize = 30) {
    if (!history || history.length < MIN_REFF_TICKS) return NaN;
    const start = Math.max(0, history.length - windowSize);
    let infections = 0;
    let removals = 0;
    for (let i = start; i < history.length; i++) {
        const s = history[i];
        infections += s.sToE | 0;
        removals   += (s.iToR | 0) + (s.iToD | 0);
    }
    if (removals === 0) return NaN;
    return infections / removals;
}

// ─── Renderer ───────────────────────────────────────────────────────────────
// Idempotent: first call builds DOM; subsequent calls find existing rows by
// data-compartment and update text only. No innerHTML, no full rebuilds.

function buildPanelSkeleton(panelEl) {
    // Wipe any placeholder content (e.g. the Phase-1 .panel-hint).
    while (panelEl.firstChild) panelEl.removeChild(panelEl.firstChild);

    // Population total row — distinct .stat-row above the per-compartment list.
    const popRow = document.createElement('div');
    popRow.className = 'stat-row';
    popRow.dataset.role = 'population';

    const popLabel = document.createElement('span');
    popLabel.className = 'stat-label';
    popLabel.textContent = 'Population';
    popRow.appendChild(popLabel);

    const popValue = document.createElement('span');
    popValue.className = 'stat-value';
    popValue.dataset.role = 'population-value';
    popValue.textContent = '0';
    popRow.appendChild(popValue);

    panelEl.appendChild(popRow);

    // Compartment list — one row per key, all created up-front so we never
    // mutate child set after this point.
    const list = document.createElement('div');
    list.className = 'stat-group';
    list.dataset.role = 'compartment-list';

    for (const key of COMPARTMENT_KEYS) {
        const row = document.createElement('div');
        row.className = 'stat-row';
        row.dataset.compartment = key;

        const labelWrap = document.createElement('span');
        labelWrap.className = 'stat-label';

        const swatch = document.createElement('span');
        swatch.className = 'stat-swatch';
        swatch.style.backgroundColor = `var(${COMPARTMENT_SWATCH_VAR[key]})`;
        swatch.setAttribute('aria-hidden', 'true');
        labelWrap.appendChild(swatch);

        const labelText = document.createElement('span');
        labelText.className = 'stat-label-text';
        labelText.textContent = COMPARTMENT_LABELS[key];
        labelWrap.appendChild(labelText);

        row.appendChild(labelWrap);

        const value = document.createElement('span');
        value.className = 'stat-value';
        value.textContent = '0';
        row.appendChild(value);

        list.appendChild(row);
    }
    panelEl.appendChild(list);

    // Status readouts — Hospital + Quarantine. Summary rows like R_eff, not
    // per-compartment counts; no swatch.
    const hospRow = document.createElement('div');
    hospRow.className = 'stat-row';
    hospRow.dataset.role = 'hospital';

    const hospLabel = document.createElement('span');
    hospLabel.className = 'stat-label';
    hospLabel.textContent = 'Hospital';
    hospRow.appendChild(hospLabel);

    const hospValue = document.createElement('span');
    hospValue.className = 'stat-value';
    hospValue.dataset.role = 'hospital-value';
    hospValue.textContent = '0';
    hospRow.appendChild(hospValue);

    panelEl.appendChild(hospRow);

    const quarRow = document.createElement('div');
    quarRow.className = 'stat-row';
    quarRow.dataset.role = 'quarantine';

    const quarLabel = document.createElement('span');
    quarLabel.className = 'stat-label';
    quarLabel.textContent = 'Quarantine';
    quarRow.appendChild(quarLabel);

    const quarValue = document.createElement('span');
    quarValue.className = 'stat-value';
    quarValue.dataset.role = 'quarantine-value';
    quarValue.textContent = '0';
    quarRow.appendChild(quarValue);

    panelEl.appendChild(quarRow);

    // R_eff readout — bottom row, treated as a stat-sub for the dimmer caption look.
    const reffRow = document.createElement('div');
    reffRow.className = 'stat-row';
    reffRow.dataset.role = 'reff';

    const reffLabel = document.createElement('span');
    reffLabel.className = 'stat-label';
    reffLabel.textContent = 'R_eff';
    reffRow.appendChild(reffLabel);

    const reffValue = document.createElement('span');
    reffValue.className = 'stat-value';
    reffValue.dataset.role = 'reff-value';
    reffValue.textContent = '—';
    reffRow.appendChild(reffValue);

    panelEl.appendChild(reffRow);

    // Mean age — Phase 5 summary row, integer ticks.
    const ageRow = document.createElement('div');
    ageRow.className = 'stat-row';
    ageRow.dataset.role = 'mean-age';

    const ageLabel = document.createElement('span');
    ageLabel.className = 'stat-label';
    ageLabel.textContent = 'Mean age';
    ageRow.appendChild(ageLabel);

    const ageValue = document.createElement('span');
    ageValue.className = 'stat-value';
    ageValue.dataset.role = 'mean-age-value';
    ageValue.textContent = '0';
    ageRow.appendChild(ageValue);

    panelEl.appendChild(ageRow);

    // Mean health — Phase 5 summary row, 0..1 float (2dp).
    const healthRow = document.createElement('div');
    healthRow.className = 'stat-row';
    healthRow.dataset.role = 'mean-health';

    const healthLabel = document.createElement('span');
    healthLabel.className = 'stat-label';
    healthLabel.textContent = 'Mean health';
    healthRow.appendChild(healthLabel);

    const healthValue = document.createElement('span');
    healthValue.className = 'stat-value';
    healthValue.dataset.role = 'mean-health-value';
    healthValue.textContent = '1.00';
    healthRow.appendChild(healthValue);

    panelEl.appendChild(healthRow);

    panelEl.dataset.statsReady = '1';
}

/**
 * Render (or update) the stats panel.
 * @param {HTMLElement} panelEl the #tab-compartments container
 * @param {ReturnType<typeof computeStats>} stats
 * @param {number} reff R_eff value, NaN for "not enough data"
 * @param {number} [capacity] optional integer hospital bed count. When provided,
 *     the Hospital row renders as "N / M"; when omitted, just "N".
 */
export function renderStatsPanel(panelEl, stats, reff, capacity) {
    if (!panelEl) return;
    if (panelEl.dataset.statsReady !== '1') {
        buildPanelSkeleton(panelEl);
    }

    // Population total.
    const popValue = panelEl.querySelector('[data-role="population-value"]');
    if (popValue) popValue.textContent = String(stats.total);

    // Per-compartment counts.
    for (const key of COMPARTMENT_KEYS) {
        const row = panelEl.querySelector(`[data-compartment="${key}"]`);
        if (!row) continue;
        const count = stats[key] | 0;
        const valueEl = row.lastElementChild;
        if (valueEl) valueEl.textContent = String(count);
        // Mark zero-count rows so styles.css can dim them.
        if (count === 0) row.dataset.zero = 'true';
        else if (row.dataset.zero) delete row.dataset.zero;
    }

    // Hospital — "N / M" when capacity is known, else just "N".
    const hospEl = panelEl.querySelector('[data-role="hospital-value"]');
    if (hospEl) {
        const h = stats.statusH | 0;
        hospEl.textContent = (typeof capacity === 'number' && Number.isFinite(capacity))
            ? `${h} / ${capacity | 0}`
            : String(h);
    }

    // Quarantine — count only.
    const quarEl = panelEl.querySelector('[data-role="quarantine-value"]');
    if (quarEl) {
        quarEl.textContent = String(stats.statusQ | 0);
    }

    // R_eff.
    const reffEl = panelEl.querySelector('[data-role="reff-value"]');
    if (reffEl) {
        reffEl.textContent = Number.isFinite(reff) ? reff.toFixed(2) : '—';
    }

    // Mean age — integer ticks. Bare integer; unit is implicit from the sim clock.
    const ageEl = panelEl.querySelector('[data-role="mean-age-value"]');
    if (ageEl) {
        const a = Number.isFinite(stats.meanAge) ? (stats.meanAge | 0) : 0;
        ageEl.textContent = String(a);
    }

    // Mean health — 2-decimal float, clamped to [0, 1].
    const healthEl = panelEl.querySelector('[data-role="mean-health-value"]');
    if (healthEl) {
        const raw = Number.isFinite(stats.meanHealth) ? stats.meanHealth : 1.0;
        const h = raw < 0 ? 0 : (raw > 1 ? 1 : raw);
        healthEl.textContent = h.toFixed(2);
    }
}
