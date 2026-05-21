// stats.js — compartment census + rolling observed-Re estimator + idempotent panel renderer.
//
// Three exports:
//   computeStats(grid)                       — single-pass tally over grid.compartment + grid.status
//   computeReff(history, ...)                — observed-transitions rolling Re
//   renderStatsPanel(el, s, reff, capacity)  — build-once / text-only-update DOM into #tab-compartments
//
// No innerHTML anywhere. DOM is built on first call and only text-content
// is mutated on subsequent calls — safe at 60 Hz.

import { Compartment, Status, Flag, Animal } from './config.js';

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

const MIN_REFF_TICKS = 5;
const _counts = new Uint32Array(9);
const _statusCounts = new Uint32Array(3);
const _animalCounts = new Uint32Array(5);
const _statsOut = {
    S: 0, E: 0, I: 0, R: 0, D: 0, V: 0, M: 0, Z: 0, empty: 0,
    total: 0, statusH: 0, statusQ: 0,
    latentE: 0, carrierR: 0, fCorpseD: 0,
    meanAge: 0, meanHealth: 1,
    animalS: 0, animalI: 0, animalR: 0, animalD: 0,
    animalTotal: 0, animalMeanAge: 0,
    tick: 0
};

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
    const counts = _counts;
    const statusCounts = _statusCounts;
    const animalCounts = _animalCounts; // VOID/S/I/R/D — Phase 17
    counts.fill(0);
    statusCounts.fill(0);
    animalCounts.fill(0);
    const comp = grid.compartment;
    const status = grid.status; // may be undefined on very old grids; guard below
    const flags = grid.flags;   // bitfield: LATENT | CARRIER | F_CORPSE — may be undefined on very old grids
    const age = grid.age;       // Phase 5 — may be undefined on older grids
    const health = grid.health; // Phase 5 — may be undefined on older grids
    const animalArr = grid.animal;     // Phase 9 reservoir layer
    const animalAge = grid.animal_age; // Phase 17 — animal demography
    const mask = grid.mask;     // hex-shape mask — void cells (mask=0) excluded
    const n = comp.length;
    const active = grid.activeIndices;
    const activeCount = active ? active.length : n;
    let animalAgeSum = 0;       // sum of animal_age over non-VOID animals
    let animalAgeCount = 0;     // count of non-VOID animals

    let total = 0;           // count of in-world cells (mask=1)
    let ageSum = 0;          // sum of grid.age over non-EMPTY in-world cells
    let ageCount = 0;        // count of non-EMPTY in-world cells
    let healthSum = 0;       // sum of grid.health over alive cells
    let healthCount = 0;     // count of alive cells
    let latentE = 0;         // E cells carrying the LATENT flag
    let carrierR = 0;        // R cells carrying the CARRIER flag
    let fCorpseD = 0;        // D cells carrying the F_CORPSE flag

    for (let k = 0; k < activeCount; k++) {
        const i = active ? active[k] : k;
        // Skip void cells outside the hexagonal mask — they aren't part of
        // the simulated world, so they don't contribute to any tally.
        if (mask !== undefined && mask[i] === 0) continue;
        total++;
        // Bounds-safe: any unexpected byte falls into the EMPTY bucket.
        const c = comp[i];
        const cBucket = (c <= Compartment.EMPTY) ? c : Compartment.EMPTY;
        counts[cBucket]++;

        // Animal reservoir census — orthogonal layer, same indexing.
        if (animalArr !== undefined) {
            const av = animalArr[i];
            if (av <= Animal.D) animalCounts[av]++;
            if (av !== Animal.VOID && animalAge !== undefined) {
                animalAgeSum += animalAge[i];
                animalAgeCount++;
            }
        }

        if (status !== undefined) {
            const s = status[i];
            if (s === Status.H) statusCounts[Status.H]++;
            else if (s === Status.Q) statusCounts[Status.Q]++;
        }

        // Flag subcompartments — only count flags where they semantically belong
        // (LATENT on E, CARRIER on R, F_CORPSE on D) so stray bits don't leak.
        if (flags !== undefined) {
            const f = flags[i];
            if (f !== 0) {
                if (cBucket === Compartment.E && (f & Flag.LATENT))   latentE++;
                if (cBucket === Compartment.R && (f & Flag.CARRIER))  carrierR++;
                if (cBucket === Compartment.D && (f & Flag.F_CORPSE)) fCorpseD++;
            }
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
    const animalMeanAge = animalAgeCount > 0 ? Math.round(animalAgeSum / animalAgeCount) : 0;

    _statsOut.S = counts[Compartment.S];
    _statsOut.E = counts[Compartment.E];
    _statsOut.I = counts[Compartment.I];
    _statsOut.R = counts[Compartment.R];
    _statsOut.D = counts[Compartment.D];
    _statsOut.V = counts[Compartment.V];
    _statsOut.M = counts[Compartment.M];
    _statsOut.Z = counts[Compartment.Z];
    _statsOut.empty = counts[Compartment.EMPTY];
    _statsOut.total = total;
    _statsOut.statusH = statusCounts[Status.H];
    _statsOut.statusQ = statusCounts[Status.Q];
    _statsOut.latentE = latentE;
    _statsOut.carrierR = carrierR;
    _statsOut.fCorpseD = fCorpseD;
    _statsOut.meanAge = meanAge;
    _statsOut.meanHealth = meanHealth;
    _statsOut.animalS = animalCounts[Animal.S];
    _statsOut.animalI = animalCounts[Animal.I];
    _statsOut.animalR = animalCounts[Animal.R];
    _statsOut.animalD = animalCounts[Animal.D];
    _statsOut.animalTotal = animalCounts[Animal.S] + animalCounts[Animal.I]
        + animalCounts[Animal.R] + animalCounts[Animal.D];
    _statsOut.animalMeanAge = animalMeanAge;
    _statsOut.tick = 0;
    return _statsOut;
}

/**
 * Rolling observed-Re estimator from observed transitions.
 *
 * Formula: Re ≈ Σ(sToE) / Σ(iToR + iToD) over the last `windowSize` ticks.
 *
 * This is the "new infections per removal event" ratio — robust to model
 * misspecification because it sidesteps β and γ entirely and just reads off
 * the realized transition flows. When transmission balances removals, Re
 * sits at 1; epidemic growth pushes it above 1, decay below.
 *
 * Returns NaN if:
 *   - history has fewer than MIN_REFF_TICKS samples
 *   - the denominator (total removals in window) is zero (no signal yet)
 *
 * Accepts either the typed-array ring buffer from main.js
 *   `{ cap, head, length, sToE, eToI, iToR, iToD }`
 * or the legacy array-of-objects shape (kept for tests / external consumers
 * that haven't migrated). The ring-buffer path is the hot one and avoids any
 * per-tick allocation.
 *
 * @param {object|Array} history
 * @param {object} _params unused for the observed-transitions estimator; reserved for the β·S·(1/γ) alternate
 * @param {number} [windowSize=30]
 * @returns {number}
 */
export function computeReff(history, _params, windowSize = 30) {
    if (!history) return NaN;
    const n = history.length | 0;
    if (n < MIN_REFF_TICKS) return NaN;
    const take = n < windowSize ? n : windowSize;
    let infections = 0;
    let removals = 0;
    // Typed-array ring buffer path. Reads `take` entries ending at `head-1`,
    // wrapping around the cap.
    if (history.sToE && history.sToE.length) {
        const cap = history.cap;
        // First filled slot when buffer is saturated; else 0.
        const startSlot = (n < cap) ? 0 : history.head;
        // We want the LAST `take` entries — start `take` slots before head.
        const tail = (history.head + cap - take) % cap;
        for (let k = 0; k < take; k++) {
            const idx = (tail + k) % cap;
            infections += history.sToE[idx];
            removals   += history.iToR[idx] + history.iToD[idx];
        }
        // startSlot reference retained for future windowSize > cap paths;
        // touch it to keep linters quiet without affecting behavior.
        void startSlot;
    } else {
        // Legacy array path. Iterate the last `take` entries directly.
        const start = n - take;
        for (let i = start; i < n; i++) {
            const s = history[i];
            infections += s.sToE | 0;
            removals   += (s.iToR | 0) + (s.iToD | 0);
        }
    }
    if (removals === 0) return NaN;
    return infections / removals;
}

// ─── Renderer ───────────────────────────────────────────────────────────────
// Idempotent: first call builds DOM; subsequent calls find existing rows by
// data-compartment and update text only. No innerHTML, no full rebuilds.

// Build a "label / value" row, append it to `panelEl`, and return the value
// span so the renderer can cache the reference. Small helper to keep the
// skeleton-builder readable without changing the rendered DOM.
function appendValueRow(panelEl, labelText, role) {
    const row = document.createElement('div');
    row.className = 'stat-row';
    if (role) row.dataset.role = role;

    const label = document.createElement('span');
    label.className = 'stat-label';
    label.textContent = labelText;
    row.appendChild(label);

    const value = document.createElement('span');
    value.className = 'stat-value';
    if (role) value.dataset.role = role + '-value';
    value.textContent = '';
    row.appendChild(value);

    panelEl.appendChild(row);
    return value;
}

// Sub-rows used for flag breakdowns (L under E, C under R, F under D).
// E.g. ('Latent', 'latent', 'E') yields a row that inherits the parent's
// --stat-color via [data-compartment="E"] and adds .stat-sub indentation.
function appendSubRow(parent, labelText, role, parentKey) {
    const row = document.createElement('div');
    row.className = 'stat-row stat-sub';
    row.dataset.role = role;
    row.dataset.compartment = parentKey;
    row.dataset.subOf = parentKey;

    const label = document.createElement('span');
    label.className = 'stat-label';
    label.textContent = labelText;
    row.appendChild(label);

    const value = document.createElement('span');
    value.className = 'stat-value';
    value.dataset.role = role + '-value';
    value.textContent = '0';
    row.appendChild(value);

    parent.appendChild(row);
    return { row, value };
}

// Per-tick text + zero-state update for a flag sub-row. No allocations.
function updateSubRow(refs, role, count) {
    const valueEl = refs.subValues[role];
    const row = refs.subRows[role];
    if (!valueEl || !row) return;
    const text = '' + count;
    if (valueEl.textContent !== text) valueEl.textContent = text;
    if (count === 0) {
        if (row.dataset.zero !== 'true') row.dataset.zero = 'true';
    } else if (row.dataset.zero) {
        delete row.dataset.zero;
    }
}

// Build one compartment row. The label is now color-driven via CSS
// (--stat-color applied to .stat-label) — no swatch box.
function appendCompartmentRow(parent, key) {
    const row = document.createElement('div');
    row.className = 'stat-row';
    row.dataset.compartment = key;

    const label = document.createElement('span');
    label.className = 'stat-label';
    label.textContent = COMPARTMENT_LABELS[key];
    row.appendChild(label);

    const value = document.createElement('span');
    value.className = 'stat-value';
    value.textContent = '0';
    row.appendChild(value);

    parent.appendChild(row);
    return { row, value };
}

// Animal-reservoir census row. `key` is an S/I/R/D string used by
// styles.css [data-compartment] to color the row with the matching --epi-*
// var (the same colors the animal-dot overlay uses).
function appendAnimalRow(parent, key, labelText) {
    const row = document.createElement('div');
    row.className = 'stat-row stat-animal';
    row.dataset.compartment = key;
    row.dataset.role = 'animal-' + key;

    const label = document.createElement('span');
    label.className = 'stat-label';
    label.textContent = labelText;
    row.appendChild(label);

    const value = document.createElement('span');
    value.className = 'stat-value';
    value.textContent = '0';
    row.appendChild(value);

    parent.appendChild(row);
    return { row, value };
}

function buildPanelSkeleton(panelEl) {
    // Wipe prior content but PRESERVE the time-series chart — it lives as the
    // first child of #tab-compartments and its canvas context is captured
    // once by initTimeseries(); removing the node would orphan that context.
    let child = panelEl.firstChild;
    while (child) {
        const nextChild = child.nextSibling;
        if (!(child.nodeType === 1 && child.id === 'timeseries-panel')) {
            panelEl.removeChild(child);
        }
        child = nextChild;
    }

    // Cache the value-element refs we update each tick so renderStatsPanel
    // doesn't pay 12+ querySelector hits per call. The renderer reads these
    // back via panelEl._statsRefs.
    const refs = {
        compartments: Object.create(null),
        rows:         Object.create(null),
        subRows:      Object.create(null),
        subValues:    Object.create(null)
    };

    // Compartment list FIRST — primary readout sits at the top of the tab.
    // One row per key, all created up-front so we never mutate child set
    // after this point. Sub-rows (Latent/Carrier/Infectious corpse) live
    // inline directly under their parent compartment.
    const list = document.createElement('div');
    list.className = 'stat-group';
    list.dataset.role = 'compartment-list';

    for (const key of COMPARTMENT_KEYS) {
        const { row, value } = appendCompartmentRow(list, key);
        refs.compartments[key] = value;
        refs.rows[key] = row;

        // Flag subcompartments — colored to match parent via [data-compartment].
        if (key === 'E') {
            const sub = appendSubRow(list, 'Latent', 'latent', 'E');
            refs.subRows.latent = sub.row;
            refs.subValues.latent = sub.value;
        } else if (key === 'R') {
            const sub = appendSubRow(list, 'Carrier', 'carrier', 'R');
            refs.subRows.carrier = sub.row;
            refs.subValues.carrier = sub.value;
        } else if (key === 'D') {
            const sub = appendSubRow(list, 'Infectious corpse', 'fcorpse', 'D');
            refs.subRows.fcorpse = sub.row;
            refs.subValues.fcorpse = sub.value;
        }
    }
    panelEl.appendChild(list);

    // Population total + status readouts + summary rows sit below the
    // compartment list — secondary information, not per-compartment counts.
    refs.population = appendValueRow(panelEl, 'Population', 'population');
    refs.population.textContent = '0';
    refs.hospital   = appendValueRow(panelEl, 'Hospital',    'hospital');
    refs.hospital.textContent = '0';
    refs.quarantine = appendValueRow(panelEl, 'Quarantine',  'quarantine');
    refs.quarantine.textContent = '0';
    refs.reff       = appendValueRow(panelEl, 'Observed Re',  'reff');
    refs.reff.textContent = '—';
    refs.meanAge    = appendValueRow(panelEl, 'Mean age',    'mean-age');
    refs.meanAge.textContent = '0';
    refs.meanHealth = appendValueRow(panelEl, 'Mean health', 'mean-health');
    refs.meanHealth.textContent = '1.00';

    // Animal-reservoir census — Phase 17. The reservoir has its own
    // demography now (births / aging / death), so it earns a compartment-
    // style readout. Its own group, headed and visually separated from the
    // human compartments above.
    const animalGroup = document.createElement('div');
    animalGroup.className = 'stat-group stat-animal-group';
    animalGroup.dataset.role = 'animal-list';

    const animalHeading = document.createElement('div');
    animalHeading.className = 'stat-subhead';
    animalHeading.textContent = 'Animal reservoir';
    animalGroup.appendChild(animalHeading);

    refs.animalRows = Object.create(null);
    refs.animalValues = Object.create(null);
    const animalSpec = [['S', 'Susceptible'], ['I', 'Infectious'], ['R', 'Recovered'], ['D', 'Carcass']];
    for (const [key, label] of animalSpec) {
        const { row, value } = appendAnimalRow(animalGroup, key, label);
        refs.animalRows[key] = row;
        refs.animalValues[key] = value;
    }
    panelEl.appendChild(animalGroup);

    refs.animalTotal   = appendValueRow(panelEl, 'Reservoir total', 'animal-total');
    refs.animalTotal.textContent = '0';
    refs.animalMeanAge = appendValueRow(panelEl, 'Animal mean age', 'animal-mean-age');
    refs.animalMeanAge.textContent = '0';

    panelEl._statsRefs = refs;
    panelEl.dataset.statsReady = '1';
}

/**
 * Render (or update) the stats panel.
 * @param {HTMLElement} panelEl the #tab-compartments container
 * @param {ReturnType<typeof computeStats>} stats
 * @param {number} reff observed Re value, NaN for "not enough data"
 * @param {number} [capacity] optional integer hospital bed count. When provided,
 *     the Hospital row renders as "N / M"; when omitted, just "N".
 */
export function renderStatsPanel(panelEl, stats, reff, capacity) {
    if (!panelEl) return;
    if (panelEl.dataset.statsReady !== '1') {
        buildPanelSkeleton(panelEl);
    }

    // Skip when the Compartments tab isn't visible — .tab-panel sets
    // display:none on inactive tabs, so DOM mutations would be invisible
    // anyway. Use classList rather than offsetParent because reading
    // offsetParent forces a sync layout flush; checking the class is a
    // string compare with no layout dependency. wakeRenders() in main.js
    // remarks statsDirty on tab switch.
    if (!panelEl.classList.contains('active')) return;

    const refs = panelEl._statsRefs;

    // Population total.
    const totalStr = '' + (stats.total | 0);
    if (refs.population.textContent !== totalStr) refs.population.textContent = totalStr;

    // Per-compartment counts.
    for (let k = 0; k < COMPARTMENT_KEYS.length; k++) {
        const key = COMPARTMENT_KEYS[k];
        const count = stats[key] | 0;
        const valueEl = refs.compartments[key];
        const row = refs.rows[key];
        const text = '' + count;
        if (valueEl.textContent !== text) valueEl.textContent = text;
        // Mark zero-count rows so styles.css can dim them.
        if (count === 0) {
            if (row.dataset.zero !== 'true') row.dataset.zero = 'true';
        } else if (row.dataset.zero) {
            delete row.dataset.zero;
        }
    }

    // Flag subcompartments (Latent under E, Carrier under R, Infectious-corpse
    // under D). Same zero-row dimming treatment as the parent compartments.
    // Inlined three-way unroll to keep this allocation-free in the hot path.
    updateSubRow(refs, 'latent',  stats.latentE  | 0);
    updateSubRow(refs, 'carrier', stats.carrierR | 0);
    updateSubRow(refs, 'fcorpse', stats.fCorpseD | 0);

    // Hospital — "N / M" when capacity is known, else just "N".
    const h = stats.statusH | 0;
    const hospText = (typeof capacity === 'number' && Number.isFinite(capacity))
        ? (h + ' / ' + (capacity | 0))
        : ('' + h);
    if (refs.hospital.textContent !== hospText) refs.hospital.textContent = hospText;

    // Quarantine — count only.
    const quarText = '' + (stats.statusQ | 0);
    if (refs.quarantine.textContent !== quarText) refs.quarantine.textContent = quarText;

    // Observed Re.
    const reffText = Number.isFinite(reff) ? reff.toFixed(2) : '—';
    if (refs.reff.textContent !== reffText) refs.reff.textContent = reffText;

    // Mean age — integer ticks. Bare integer; unit is implicit from the sim clock.
    const a = Number.isFinite(stats.meanAge) ? (stats.meanAge | 0) : 0;
    const ageText = '' + a;
    if (refs.meanAge.textContent !== ageText) refs.meanAge.textContent = ageText;

    // Mean health — 2-decimal float, clamped to [0, 1].
    const raw = Number.isFinite(stats.meanHealth) ? stats.meanHealth : 1.0;
    const hv = raw < 0 ? 0 : (raw > 1 ? 1 : raw);
    const healthText = hv.toFixed(2);
    if (refs.meanHealth.textContent !== healthText) refs.meanHealth.textContent = healthText;

    // Animal reservoir census — Phase 17. Same text-equality guard and
    // zero-row dimming treatment as the human compartment rows.
    if (refs.animalValues) {
        const animalKeys = ['S', 'I', 'R', 'D'];
        const animalStat = { S: stats.animalS, I: stats.animalI, R: stats.animalR, D: stats.animalD };
        for (let k = 0; k < animalKeys.length; k++) {
            const key = animalKeys[k];
            const count = animalStat[key] | 0;
            const valueEl = refs.animalValues[key];
            const row = refs.animalRows[key];
            if (!valueEl || !row) continue;
            const text = '' + count;
            if (valueEl.textContent !== text) valueEl.textContent = text;
            if (count === 0) {
                if (row.dataset.zero !== 'true') row.dataset.zero = 'true';
            } else if (row.dataset.zero) {
                delete row.dataset.zero;
            }
        }
        const atotText = '' + (stats.animalTotal | 0);
        if (refs.animalTotal.textContent !== atotText) refs.animalTotal.textContent = atotText;
        const aAge = Number.isFinite(stats.animalMeanAge) ? (stats.animalMeanAge | 0) : 0;
        const aAgeText = '' + aAge;
        if (refs.animalMeanAge.textContent !== aAgeText) refs.animalMeanAge.textContent = aAgeText;
    }
}
