// strains.js — strain registry, point mutation, recombination, reclamation.
//
// Data model:
//   - The registry is a single mutable object owned by main.js (one per sim).
//     It holds parallel arrays for each strain attribute. ID 0 is reserved for
//     the seed strain α, created at construction time.
//   - Strain IDs are Uint16 indices into the registry. The sentinel
//     EMPTY_STRAIN (0xFFFF) marks an unoccupied per-cell slot.
//   - Every strain has an antigenic position (ag_x, ag_y) on the torus of
//     immunity.js. Cells remember positions, not ids, so a strain that no cell
//     carries and no living strain descends from can be reclaimed and its id
//     reused (runExtinctionSweep). Display names follow a monotone birth
//     serial, so a reused id never repeats an old name.
//
// This module is pure-ish: no DOM, no globals beyond the exported sentinels
// and the shared gaussian().

import { agMid, agWrap } from './immunity.js';

// Greek lowercase letters, IDs 0..23 → α..ω. Past 24 we append a numeric
// suffix (α1, β1, ..., ω1, α2, ...). Defined once so strainName(id) is O(1).
const GREEK = [
    'α', 'β', 'γ', 'δ', 'ε', 'ζ',
    'η', 'θ', 'ι', 'κ', 'λ', 'μ',
    'ν', 'ξ', 'ο', 'π', 'ρ', 'σ',
    'τ', 'υ', 'φ', 'χ', 'ψ', 'ω'
];

// Uint16 caps strain count at 65535 — reserve 0xFFFF as the "no strain"
// sentinel for grid.strain_ids slots, so the usable registry size is bounded
// at MAX_STRAINS. If a Phase 8 caller bumps to Uint32 they need to audit
// every typed-array allocation in grid.js + this sentinel.
export const MAX_STRAINS = 65535;
export const EMPTY_STRAIN = 0xFFFF;

// Mutation: gaussian noise scales with each parameter. Default std-dev is
// 5% of the parameter's current value. Box-Muller turns two uniform [0,1)
// samples into one standard-normal sample.
const DEFAULT_MUTATION_STRENGTH = 0.05;

// Recombination: hybrids inherit the average of two parents' parameters,
// plus a small additive gaussian "novelty" jitter so siblings of the same
// parent pair aren't bitwise-identical. 0.02 is deliberately smaller than
// the 0.05 point-mutation strength — recombination is supposed to explore
// the segment between parents, not jump off it. The jitter is additive
// (not multiplicative like mutation) because the averaged params already
// carry parental magnitude, so a constant absolute noise floor avoids
// collapsing novelty to zero when both parents have very small μ.
const RECOMBINATION_NOISE_STDDEV = 0.02;

// Parameter clamps. Match the ranges enforced by DEFAULT_PARAMS in default-params.js
// for the four mutable per-strain rates.
const BETA_MIN  = 0;
const BETA_MAX  = 1;
const SIGMA_MIN = 0.01;
const SIGMA_MAX = 1;
const GAMMA_MIN = 0.01;
const GAMMA_MAX = 1;
const MU_MIN    = 0;
const MU_MAX    = 0.1;

// Antigenic steps (immunity.js units, AU). A mutation moves its strain a
// distance drawn with mean `ag_step`, or, with chance `ag_jump`, makes one
// large jump of AG_JUMP_AU: the occasional single substitution that changes
// antigenicity a lot. A recombinant takes its parents' midpoint plus a small
// jitter.
const AG_JUMP_AU = 2;
const AG_RECOMBINATION_JITTER = 0.05;

// ─── Per-strain genome fields ───────────────────────────────────────────────
//
// Phase A: every field a strain "carries" gets a clamp range. Used by:
//   - registerStrain: clamps incoming genome values
//   - mutateStrain:   per-field multiplicative gaussian noise + clamp
//   - recombineStrains: per-field additive gaussian noise scaled by range
//     ((max - min) * RECOMBINATION_NOISE_STDDEV) so a uniform 2% novelty
//     floor doesn't dominate small-range fields like l_reactivate (max 0.05).
//   - Phase C genome editor: drives the slider build
//
// Order is presentation order (matches DEFAULT_PARAMS grouping in
// default-params.js: core → maternal/flag → zombie spawn → zombie encounter →
// zombie death → health). z_exhaust_threshold intentionally stays sim-wide
// in params (it's an integer cell-count threshold; mutating it doesn't
// have continuous semantics).
export const GENOME_FIELDS = Object.freeze([
    { key: 'beta',                    min: BETA_MIN,  max: BETA_MAX  },
    { key: 'sigma',                   min: SIGMA_MIN, max: SIGMA_MAX },
    { key: 'gamma',                   min: GAMMA_MIN, max: GAMMA_MAX },
    { key: 'mu',                      min: MU_MIN,    max: MU_MAX    },
    { key: 'm_decay',                 min: 0,         max: 0.2       },
    { key: 'l_seed',                  min: 0,         max: 1         },
    { key: 'l_reactivate',            min: 0,         max: 0.05      },
    { key: 'l_transform',             min: 0,         max: 0.05      },
    { key: 'c_seed',                  min: 0,         max: 1         },
    { key: 'c_transmit_mult',         min: 0,         max: 1         },
    { key: 'f_decay',                 min: 0,         max: 0.5       },
    { key: 'f_transmit_mult',         min: 0,         max: 1         },
    { key: 'dz_dead',                 min: 0,         max: 0.5       },
    { key: 'dz_alive',                min: 0,         max: 0.1       },
    { key: 'z_fight_kill',            min: 0,         max: 1         },
    { key: 'z_fight_infect',          min: 0,         max: 1         },
    { key: 'z_fight_expose',          min: 0,         max: 1         },
    { key: 'z_convert_unopposed',     min: 0,         max: 1         },
    { key: 'z_die_fighting',          min: 0,         max: 0.5       },
    { key: 'z_die_natural',           min: 0,         max: 0.05      },
    { key: 'z_exhaust',               min: 0,         max: 0.5       },
    { key: 'health_degrade_per_tick', min: 0,         max: 0.2       },
    { key: 'health_mortality_mult',   min: 1,         max: 6         },
    // Reservoir (animal SIR) — per-strain since Phase 17. The animal layer
    // carries a strain id; animal-to-animal transmission and recovery read
    // these rates off the registry by that id.
    { key: 'animal_beta',             min: 0,         max: 1         },
    { key: 'animal_gamma',            min: 0,         max: 1         },
    { key: 'animal_mu',               min: 0,         max: 0.1       }
]);

// Frozen default genome — used when a caller passes a partial genome to
// registerStrain (missing keys fall back here). Values mirror DEFAULT_PARAMS
// in dynamics.js so a registry built without an explicit seed behaves like
// SEIR(D) at the textbook calibration. main.js's createRegistry call site
// passes the full live params snapshot so this fallback rarely fires in
// production — it's a safety net for test / forgot-a-key scenarios.
export const DEFAULT_GENOME = Object.freeze({
    beta:                    0.32,
    sigma:                   0.25,
    gamma:                   0.12,
    mu:                      0.003,
    m_decay:                 0.025,
    l_seed:                  0.15,
    l_reactivate:            0.0025,
    l_transform:             0.0005,
    c_seed:                  0.18,
    c_transmit_mult:         0.35,
    f_decay:                 0.06,
    f_transmit_mult:         0.55,
    dz_dead:                 0.04,
    dz_alive:                0.003,
    z_fight_kill:            0.15,
    z_fight_infect:          0.20,
    z_fight_expose:          0.05,
    z_convert_unopposed:     0.35,
    z_die_fighting:          0.04,
    z_die_natural:           0.005,
    z_exhaust:               0.08,
    health_degrade_per_tick: 0.025,
    health_mortality_mult:   2.8,
    animal_beta:             0.18,
    animal_gamma:            0.06,
    animal_mu:               0.006
});

/**
 * Return the display name for a strain's birth serial (its place in the
 * order strains were born, which never repeats even when ids are reused).
 *   0..23  → α..ω
 *   24..47 → α1..ω1
 *   48..71 → α2..ω2
 *   ...
 * Wraps via modulo on the 24-letter Greek alphabet with a numeric suffix.
 *
 * @param {number} serial
 * @returns {string}
 */
export function strainName(serial) {
    const letter = GREEK[serial % 24];
    const cycle = Math.floor(serial / 24);
    return cycle === 0 ? letter : letter + cycle;
}

function clamp(v, lo, hi) {
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
}

/**
 * Construct the registry. Auto-registers the seed strain α at ID 0 with
 * `seedParams` and birthTick 0, parent null.
 *
 * Registry shape (mutable, parallel-array):
 *   ids[]        : Uint16 IDs (always equal to their array index — present
 *                  so consumers can pass the registry around as a row-like
 *                  object without reaching for indices)
 *   names[]      : string display names (strainName of the birth serial)
 *   ag_x[], ag_y[] : antigenic position on the torus of immunity.js (AU)
 *   gen[]        : generations from α (a recombinant counts its deeper parent);
 *                  kept when the sweep splices dead ancestors out of `parent`
 *   beta[]       : Float64
 *   sigma[]      : Float64
 *   gamma[]      : Float64
 *   mu[]         : Float64
 *   parent[]     : (Uint16 | null) primary parent strain ID; null for the seed.
 *                  For point mutants this is the source strain; for
 *                  recombination hybrids this is one of the two parents.
 *   parents2[]   : (Uint16 | null) second parent strain ID; null for the
 *                  seed and for point mutants. Populated only by
 *                  recombineStrains, where (parent, parents2) records the
 *                  unordered pair of recombination parents.
 *   birthTick[]  : Int32 tick at which the strain was registered
 *
 * Plain JS arrays (not typed) because the count is small (≤ MAX_STRAINS) and
 * we want growable storage without managing capacity. `free` holds reclaimed
 * ids (reclaimStrain), reused before the arrays grow; `born` counts every
 * strain ever registered.
 *
 * @param {{beta:number, sigma:number, gamma:number, mu:number}} seedParams
 * @returns {object} registry
 */
export function createRegistry(seedParams) {
    const reg = {
        ids:       [],
        names:     [],
        ag_x:      [],
        ag_y:      [],
        // Core SEIR(D) rates
        beta:                    [],
        sigma:                   [],
        gamma:                   [],
        mu:                      [],
        // Maternal + flag rates (per-strain after Phase A)
        m_decay:                 [],
        l_seed:                  [],
        l_reactivate:            [],
        l_transform:             [],
        c_seed:                  [],
        c_transmit_mult:         [],
        f_decay:                 [],
        f_transmit_mult:         [],
        // Zombie spawn
        dz_dead:                 [],
        dz_alive:                [],
        // Zombie encounter
        z_fight_kill:            [],
        z_fight_infect:          [],
        z_fight_expose:          [],
        z_convert_unopposed:     [],
        z_die_fighting:          [],
        // Zombie death
        z_die_natural:           [],
        z_exhaust:               [],
        // Health impact
        health_degrade_per_tick: [],
        health_mortality_mult:   [],
        // Reservoir (animal SIR) — per-strain since Phase 17
        animal_beta:             [],
        animal_gamma:            [],
        animal_mu:               [],
        // Lineage + bookkeeping
        parent:    [],
        parents2:  [],
        gen:       [],
        birthTick: [],
        // Extinction tombstone. `extinct[id]` is true when no live cell or
        // animal carries the strain in any slot; `extinctTick[id]` records the
        // sim tick at which the sweep first observed extinction. A strain can
        // resurrect from a maternal/carrier/F-corpse seed pulling it back into
        // circulation — the sweep unmarks in that case. A tombstoned strain
        // with no living descendant is reclaimed (`freed`), and its id goes
        // back on `free`.
        extinct:     [],
        extinctTick: [],
        freed:       [],
        free:        [],
        born:        0
    };
    registerStrain(reg, seedParams, null, 0, null, 0, 0);
    return reg;
}

/**
 * Append a strain. Auto-names it; returns the assigned ID.
 *
 * Clamps the supplied params to the per-rate ranges that match dynamics.js
 * before storing so downstream callers can trust the registry's values
 * without re-validating.
 *
 * Takes a reclaimed id when one is free, else appends. Silently returns -1
 * if every id up to MAX_STRAINS is live.
 *
 * `parent2Id` is optional and defaults to null — only recombination hybrids
 * (see recombineStrains) supply a second parent. The antigenic position
 * defaults to the parent's, or α's origin.
 *
 * @param {object} reg
 * @param {{beta:number, sigma:number, gamma:number, mu:number}} params
 * @param {number|null} parentId
 * @param {number} birthTick
 * @param {number|null} [parent2Id]
 * @param {number} [agX]
 * @param {number} [agY]
 * @returns {number} new strain ID, or -1 if the registry is full
 */
export function registerStrain(reg, params, parentId, birthTick, parent2Id, agX, agY) {
    const id = reg.free.length ? reg.free.pop() : reg.ids.length;
    if (id >= MAX_STRAINS) return -1;
    const hasParent = parentId !== null && parentId !== undefined;
    reg.ids[id] = id;
    reg.names[id] = strainName(reg.born++);
    reg.ag_x[id] = agWrap(typeof agX === 'number' ? agX : (hasParent ? reg.ag_x[parentId] : 0));
    reg.ag_y[id] = agWrap(typeof agY === 'number' ? agY : (hasParent ? reg.ag_y[parentId] : 0));
    // Iterate the canonical genome field list so adding a new per-strain
    // field is a one-line change to GENOME_FIELDS + DEFAULT_GENOME, not a
    // hand-edit here. Missing keys fall back to DEFAULT_GENOME.
    const src = params || {};
    for (const f of GENOME_FIELDS) {
        const raw = (typeof src[f.key] === 'number')
            ? src[f.key]
            : DEFAULT_GENOME[f.key];
        reg[f.key][id] = clamp(raw, f.min, f.max);
    }
    reg.parent[id] = hasParent ? (parentId | 0) : null;
    reg.parents2[id] = parent2Id === null || parent2Id === undefined ? null : (parent2Id | 0);
    reg.gen[id] = hasParent ? 1 + Math.max(reg.gen[parentId] | 0, reg.parents2[id] === null ? 0 : (reg.gen[reg.parents2[id]] | 0)) : 0;
    reg.birthTick[id] = birthTick | 0;
    // Every new strain starts alive (the caller is registering it because
    // it's about to write the ID into a slot). The next extinction sweep that
    // finds zero carriers will mark it.
    reg.extinct[id] = false;
    reg.extinctTick[id] = -1;
    reg.freed[id] = false;
    return id;
}

/**
 * Bounds-safe read of a strain. Returns null if the ID is out of range or
 * is the EMPTY_STRAIN sentinel. Returns a fresh plain object — callers
 * mutating the result do not affect the registry.
 *
 * @param {object} reg
 * @param {number} id
 * @returns {object|null}
 */
export function getStrain(reg, id) {
    if (id === EMPTY_STRAIN) return null;
    if (id < 0 || id >= reg.ids.length || reg.freed[id]) return null;
    const out = {
        id,
        name:        reg.names[id],
        agX:         reg.ag_x[id],
        agY:         reg.ag_y[id],
        parent:      reg.parent[id],
        parent2:     reg.parents2[id],
        gen:         reg.gen[id],
        birthTick:   reg.birthTick[id],
        extinct:     !!reg.extinct[id],
        extinctTick: reg.extinctTick[id] | 0
    };
    for (const f of GENOME_FIELDS) {
        out[f.key] = reg[f.key][id];
    }
    return out;
}

/**
 * Size of the id space in use: one past the highest id ever assigned. Loops
 * over strains run to this bound and skip `freed` ids.
 *
 * @param {object} reg
 * @returns {number}
 */
export function strainCount(reg) {
    return reg.ids.length;
}

/** Number of strains ever born, including reclaimed ones. */
export function bornCount(reg) {
    return reg.born;
}

/**
 * Reclaim a tombstoned strain: mark it freed and put its id back for reuse.
 * The caller (runExtinctionSweep) guarantees nothing references it: no cell
 * or animal slot, and no living strain descends from it.
 */
export function reclaimStrain(reg, id) {
    if (id <= 0 || id >= reg.ids.length || reg.freed[id] || !reg.extinct[id]) return;
    reg.freed[id] = true;
    reg.free.push(id);
}

// ─── Extinction tombstoning (Phase B) ───────────────────────────────────────
//
// A strain is "extinct" when no cell in the world carries it in any
// strain_ids slot (active load — including the load=0 memory cases for M /
// R+CARRIER / D+F-corpse / Z) and no animal carries it. A tombstoned strain
// with no living descendant is later reclaimed (reclaimStrain).
//
// α (ID 0) is special-cased to never extinct: it's the seed strain, used as
// the default founder for de-novo infections (animal spillover, paint-seed,
// etc.), and code paths can read its rates without first checking the
// extinct bit.
//
// Resurrection: if a previously-extinct strain reappears through a retained
// cell slot, we clear the tombstone so downstream consumers don't show it as
// extinct.

/**
 * Tombstone a strain. No-op if `id` is 0 (α), out of range, or already
 * marked extinct. Records the tick at which extinction was first observed.
 *
 * @param {object} reg
 * @param {number} id
 * @param {number} tick
 */
export function markExtinct(reg, id, tick) {
    if (id === 0) return;
    if (id < 0 || id >= reg.ids.length) return;
    if (reg.extinct[id]) return;
    reg.extinct[id] = true;
    reg.extinctTick[id] = tick | 0;
}

/**
 * Check whether a strain is tombstoned. Out-of-range IDs return false (no
 * tombstone exists for them — they're nothing, not extinct).
 *
 * @param {object} reg
 * @param {number} id
 * @returns {boolean}
 */
export function isExtinct(reg, id) {
    if (id < 0 || id >= reg.ids.length) return false;
    return !!reg.extinct[id];
}

/**
 * Resurrection path. Clears the tombstone if the strain reappears. No-op if
 * the strain isn't currently tombstoned or the ID is out of range.
 *
 * @param {object} reg
 * @param {number} id
 */
export function unmarkExtinct(reg, id) {
    if (id < 0 || id >= reg.ids.length) return;
    if (!reg.extinct[id]) return;
    reg.extinct[id] = false;
    reg.extinctTick[id] = -1;
}

/**
 * Count of strains NOT currently tombstoned. O(N) scan over the extinct
 * parallel array. UI panels call this for "X living / Y total" displays.
 *
 * @param {object} reg
 * @returns {number}
 */
export function countLiving(reg) {
    const n = reg.ids.length;
    let alive = 0;
    for (let i = 0; i < n; i++) {
        if (!reg.extinct[i]) alive++;
    }
    return alive;
}

// gaussian(rng) → standard-normal sample via the shared Box-Muller helper
// (window.gaussian from /shared/utils.js); same rng-consumption order, and
// it applies the same u1≥1e-12 clamp, so seeded sequences are unchanged.

/**
 * Spawn a mutated child strain off `sourceId`, register it, and return the
 * new ID. Each genome field is perturbed by multiplicative gaussian noise:
 *
 *   p' = p + p × σ_strength × N(0, 1)
 *
 * where σ_strength defaults to 0.05 (5% of the parameter's magnitude per
 * standard deviation), clamped to the field's range. The antigenic position
 * takes one step in a uniformly random direction: length exponential with
 * mean `agStep`, or AG_JUMP_AU with chance `agJump`. Lineage is recorded via
 * the `parent` field.
 *
 * Returns -1 if the source ID is invalid or the registry is full.
 *
 * @param {object} reg
 * @param {number} sourceId
 * @param {number} mutationStrength
 * @param {() => number} rng — uniform [0, 1); defaults to Math.random
 * @param {number} birthTick
 * @param {number} [agStep] — mean antigenic step, AU
 * @param {number} [agJump] — chance of a large jump instead
 * @returns {number} new strain ID, or -1 on failure
 */
export function mutateStrain(reg, sourceId, mutationStrength, rng, birthTick, agStep, agJump) {
    const src = getStrain(reg, sourceId);
    if (src === null) return -1;
    const strength = mutationStrength > 0 ? mutationStrength : DEFAULT_MUTATION_STRENGTH;
    const r = rng || Math.random;
    // Multiplicative gaussian on every per-strain field. Note: a parent
    // with value 0 in some field stays at 0 in the child — this is
    // intentional (evolutionarily, the mechanic stays "off" in the lineage
    // unless the parent already had a non-zero rate). Recombination is the
    // mechanism for picking up a mechanic from another strain. Clamping
    // happens inside registerStrain.
    const newParams = {};
    for (const f of GENOME_FIELDS) {
        const v = src[f.key];
        newParams[f.key] = v + v * strength * gaussian(r);
    }
    let len = 0;
    if (agJump > 0 && r() < agJump) len = AG_JUMP_AU;
    else if (agStep > 0) len = -agStep * Math.log(1 - r());
    const theta = 2 * Math.PI * r();
    return registerStrain(reg, newParams, sourceId, birthTick, null,
        src.agX + len * Math.cos(theta), src.agY + len * Math.sin(theta));
}

/**
 * Spawn a recombination hybrid from two parent strains and register it.
 * Each rate parameter is the arithmetic mean of the two parents' values,
 * plus a small additive gaussian "novelty" jitter (std-dev
 * RECOMBINATION_NOISE_STDDEV = 0.02) so sibling hybrids from the same
 * parent pair occupy slightly different points in parameter space:
 *
 *   p' = (p_a + p_b) / 2 + RECOMBINATION_NOISE_STDDEV × N(0, 1)
 *
 * The jitter is additive (not multiplicative like mutation) because the
 * mean already carries parental magnitude — a multiplicative jitter would
 * collapse to zero for parents whose μ is near zero, killing the novelty
 * exactly where it matters. Results are clamped to the per-rate ranges.
 *
 * Both parents are recorded: `parent` = idA, `parent2` = idB, so the lineage
 * becomes a DAG once any recombination occurs. The antigenic position is the
 * parents' midpoint (the shorter way round the torus) plus a small jitter.
 *
 * Returns -1 if either parent ID is out of range, is EMPTY_STRAIN, or
 * idA === idB (no self-recombination — that's just a noisy mutation, and
 * the caller can ask for mutateStrain if that's what they want). Also
 * returns -1 if the registry is full.
 *
 * @param {object} reg
 * @param {number} idA — first parent strain ID
 * @param {number} idB — second parent strain ID (must differ from idA)
 * @param {() => number} rng — uniform [0, 1); defaults to Math.random
 * @param {number} birthTick
 * @returns {number} new strain ID, or -1 on failure
 */
export function recombineStrains(reg, idA, idB, rng, birthTick) {
    if (idA === idB) return -1;
    if (idA === EMPTY_STRAIN || idB === EMPTY_STRAIN) return -1;
    const a = getStrain(reg, idA);
    if (a === null) return -1;
    const b = getStrain(reg, idB);
    if (b === null) return -1;
    const r = rng || Math.random;
    // Additive gaussian on each field, scaled by the field's range so a
    // uniform constant noise floor doesn't dominate small-range fields
    // (l_reactivate has max 0.05; using 0.02 constant absolute noise would
    // be 40% of its dynamic range). RECOMBINATION_NOISE_STDDEV is the
    // fraction-of-range. For β (range 1) this collapses to the original
    // constant-0.02 behavior.
    const newParams = {};
    for (const f of GENOME_FIELDS) {
        const fieldRange = f.max - f.min;
        const noise = RECOMBINATION_NOISE_STDDEV * fieldRange;
        newParams[f.key] = (a[f.key] + b[f.key]) / 2 + noise * gaussian(r);
    }
    return registerStrain(reg, newParams, idA, birthTick, idB,
        agMid(a.agX, b.agX) + AG_RECOMBINATION_JITTER * gaussian(r),
        agMid(a.agY, b.agY) + AG_RECOMBINATION_JITTER * gaussian(r));
}
