// strains.js — strain registry, similarity metric, point mutation, bloom-filter
// prior-exposure helpers. Phase 7 implements the registry + point mutation +
// cross-immunity primitives. Phase 8 will add coinfection + recombination +
// lineage edges on top of these.
//
// Data model:
//   - The registry is a single mutable object owned by main.js (one per sim).
//     It holds parallel arrays for each strain attribute. ID 0 is reserved for
//     the seed strain α, created at construction time.
//   - Strain IDs are Uint16 indices into the registry. The sentinel
//     EMPTY_STRAIN (0xFFFF) marks an unoccupied per-cell slot.
//   - Per-cell prior exposure lives in a 64-bit bloom filter (8 Uint8 bytes
//     at offset cellIdx * 8 in grid.strain_hist). Two cheap hashes of the
//     strain ID set two bits per insertion; lookup ANDs both. Bloom filters
//     false-positive but never false-negative — the FPR scales with the
//     number of distinct strains inserted (~30 strains per cell ≈ 30% FPR,
//     which is acceptable for the optimistic-cross-immunity gate the
//     dynamics layer uses).
//
// This module is pure-ish: no DOM, no globals beyond the exported sentinels.
// Functions either mutate the supplied registry / bloom buffer or return
// fresh values.

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

// Similarity reference distance: from (0,0,0,0) to (1,1,1,0.1) in
// (β, σ, γ, μ) space. sqrt(1 + 1 + 1 + 0.01) = sqrt(3.01) ≈ 1.7349.
// Two strains at maximum parameter-space separation give similarity ≈ 0;
// identical params give similarity = 1. The exact constant doesn't need
// to be tight — it's just a normalization so callers get a [0, 1] knob.
//
// Phase A: similarity continues to use just (β, σ, γ, μ) even though the
// genome is now ~23 fields. Cross-immunity in dynamics.js gates on exact
// bloom membership, not similarity — this helper is purely a future hook
// for UI / debugging that wants a [0, 1] pairwise distance.
const SIMILARITY_REF_MAX = Math.sqrt(BETA_MAX * BETA_MAX +
                                     SIGMA_MAX * SIGMA_MAX +
                                     GAMMA_MAX * GAMMA_MAX +
                                     MU_MAX * MU_MAX);

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
 * Return the display name for a given strain ID.
 *   0..23  → α..ω
 *   24..47 → α1..ω1
 *   48..71 → α2..ω2
 *   ...
 * Wraps via modulo on the 24-letter Greek alphabet with a numeric suffix.
 *
 * @param {number} id
 * @returns {string}
 */
export function strainName(id) {
    const letter = GREEK[id % 24];
    const cycle = Math.floor(id / 24);
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
 *   names[]      : string display names (matches strainName(id))
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
 * we want growable storage without managing capacity. The dynamics path
 * never iterates the registry in a per-cell hot loop — per-tick traffic
 * goes through getStrain() / similarity() for the top-K prevalent set.
 *
 * @param {{beta:number, sigma:number, gamma:number, mu:number}} seedParams
 * @returns {object} registry
 */
export function createRegistry(seedParams) {
    const reg = {
        ids:       [],
        names:     [],
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
        birthTick: [],
        // Extinction tombstone (Phase B). `extinct[id]` is true when no live
        // cell carries the strain in any strain_ids slot;
        // `extinctTick[id]` records the sim tick at which the sweep first
        // observed extinction. Tombstones never reclaim IDs (the bloom filter
        // hashes IDs into per-cell prior-exposure bits; reusing an ID would
        // invalidate that record). A strain can resurrect from a
        // maternal/carrier/F-corpse seed pulling it back into circulation —
        // the sweep unmarks in that case.
        extinct:     [],
        extinctTick: []
    };
    registerStrain(reg, seedParams, null, 0);
    return reg;
}

/**
 * Append a strain. Auto-names it; returns the assigned ID.
 *
 * Clamps the supplied params to the per-rate ranges that match dynamics.js
 * before storing so downstream callers can trust the registry's values
 * without re-validating.
 *
 * Throws (well, no — silently returns -1) if the registry has hit
 * MAX_STRAINS. Phase 7 won't get anywhere near 65k strains in practice,
 * but the guard keeps the Uint16 invariant honest if a pathological
 * mutation-heavy preset is loaded.
 *
 * `parent2Id` is optional and defaults to null — only recombination hybrids
 * (see recombineStrains) supply a second parent. Phase 7 callers that pass
 * 4 args keep working unchanged.
 *
 * @param {object} reg
 * @param {{beta:number, sigma:number, gamma:number, mu:number}} params
 * @param {number|null} parentId
 * @param {number} birthTick
 * @param {number|null} [parent2Id]
 * @returns {number} new strain ID, or -1 if the registry is full
 */
export function registerStrain(reg, params, parentId, birthTick, parent2Id) {
    const id = reg.ids.length;
    if (id >= MAX_STRAINS) return -1;
    reg.ids.push(id);
    reg.names.push(strainName(id));
    // Iterate the canonical genome field list so adding a new per-strain
    // field is a one-line change to GENOME_FIELDS + DEFAULT_GENOME, not a
    // hand-edit here. Missing keys fall back to DEFAULT_GENOME.
    const src = params || {};
    for (const f of GENOME_FIELDS) {
        const raw = (typeof src[f.key] === 'number')
            ? src[f.key]
            : DEFAULT_GENOME[f.key];
        reg[f.key].push(clamp(raw, f.min, f.max));
    }
    reg.parent.push(parentId === null || parentId === undefined ? null : (parentId | 0));
    reg.parents2.push(parent2Id === null || parent2Id === undefined ? null : (parent2Id | 0));
    reg.birthTick.push(birthTick | 0);
    // Phase B: every new strain starts alive (a brand-new mutant has at least
    // one cell carrying it — the caller is registering it because it's about
    // to write the ID into a slot). The next extinction sweep that finds zero
    // carriers will mark it.
    reg.extinct.push(false);
    reg.extinctTick.push(-1);
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
    if (id < 0 || id >= reg.ids.length) return null;
    const out = {
        id,
        name:        reg.names[id],
        parent:      reg.parent[id],
        parent2:     reg.parents2[id],
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
 * Number of registered strains.
 *
 * @param {object} reg
 * @returns {number}
 */
export function strainCount(reg) {
    return reg.ids.length;
}

// ─── Extinction tombstoning (Phase B) ───────────────────────────────────────
//
// A strain is "extinct" when no cell in the world carries it in any
// strain_ids slot (active load — including the load=0 memory cases for M /
// R+CARRIER / D+F-corpse / Z-pseudo). Tombstoning is decoupled from registration — the registry
// never frees an ID, because the per-cell bloom filter hashes IDs into
// prior-exposure bits and reusing an ID would silently corrupt cross-
// immunity records. Phase B is tombstone-only; no GC, no compaction.
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

/**
 * Similarity in [0, 1] between two strains by L2 distance in
 * (β, σ, γ, μ) parameter space.
 *
 *   dist = sqrt((Δβ)² + (Δσ)² + (Δγ)² + (Δμ)²)
 *   sim  = max(0, 1 - dist / SIMILARITY_REF_MAX)
 *
 * Same ID gets a fast-path 1.0. Out-of-range IDs return 0 (treat as
 * "maximally different") so the dynamics layer doesn't have to null-check
 * every cross-immunity query.
 *
 * @param {object} reg
 * @param {number} idA
 * @param {number} idB
 * @returns {number}
 */
export function similarity(reg, idA, idB) {
    if (idA === idB) return 1.0;
    const n = reg.ids.length;
    if (idA < 0 || idA >= n || idB < 0 || idB >= n) return 0;
    const db = reg.beta[idA]  - reg.beta[idB];
    const ds = reg.sigma[idA] - reg.sigma[idB];
    const dg = reg.gamma[idA] - reg.gamma[idB];
    const dm = reg.mu[idA]    - reg.mu[idB];
    const dist = Math.sqrt(db * db + ds * ds + dg * dg + dm * dm);
    const sim = 1 - dist / SIMILARITY_REF_MAX;
    return sim < 0 ? 0 : sim;
}

// gaussian(rng) → standard-normal sample via the shared Box-Muller helper
// (window.gaussian from /shared-utils.js); same rng-consumption order, and
// it applies the same u1≥1e-12 clamp, so seeded sequences are unchanged.

/**
 * Spawn a mutated child strain off `sourceId`, register it, and return the
 * new ID. Each parameter is perturbed by multiplicative gaussian noise:
 *
 *   p' = p + p × σ_strength × N(0, 1)
 *
 * where σ_strength defaults to 0.05 (5% of the parameter's magnitude per
 * standard deviation). Results are clamped to the per-rate ranges. Lineage
 * is recorded via the `parent` field; the registry is append-only so the
 * lineage forms a forest (or a tree, if every mutation descends from α).
 *
 * Returns -1 if the source ID is invalid or the registry is full.
 *
 * @param {object} reg
 * @param {number} sourceId
 * @param {number} mutationStrength
 * @param {() => number} rng — uniform [0, 1); defaults to Math.random
 * @param {number} birthTick
 * @returns {number} new strain ID, or -1 on failure
 */
export function mutateStrain(reg, sourceId, mutationStrength, rng, birthTick) {
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
    return registerStrain(reg, newParams, sourceId, birthTick);
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
 * Both parents are recorded: `parent` = idA, `parent2` = idB. The
 * registry's append-only lineage thus becomes a DAG rather than a tree
 * once any recombination occurs.
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
    return registerStrain(reg, newParams, idA, birthTick, idB);
}

// ─── Bloom filter ───
// 64 bits per cell at offset cellIdx * 8 in a Uint8Array. Two independent
// hashes pick two bits to set on insertion; lookup ANDs both.
//
// h1: Knuth multiplicative hash (golden-ratio Fibonacci constant 2654435761).
// h2: Different multiplier plus a Weyl-sequence offset (0x9e3779b1) so the
// two hashes are decorrelated for sequential strain IDs — which is exactly
// the access pattern we get since IDs are assigned in order. Both `>>> 0`
// to force unsigned. Bit indices are h & 63 (low 6 bits → one of 64 bits).
//
// False-positive math (for documentation, not code): for k=2 hashes on
// m=64 bits with n insertions, FPR ≈ (1 - e^(-kn/m))^k. At n=10 → ~7%,
// n=30 → ~33%, n=64 → ~67%. The dynamics layer uses bloomHas as an
// optimistic "you might have seen this" check — false positives gate
// cross-immunity ON when the cell may not actually have seen the strain,
// which is the gentler failure mode (the cell appears more-immune than
// reality, not less).

/**
 * Set the two bloom bits for `strainId` in the cell at `cellIdx`. Bloom
 * filters are write-only-set; clearing a strain's bits is not possible
 * without resetting the whole word for the cell.
 *
 * @param {Uint8Array} bloom — typically grid.strain_hist
 * @param {number} cellIdx — linear cell index
 * @param {number} strainId
 */
export function bloomSet(bloom, cellIdx, strainId) {
    const base = cellIdx * 8;
    // Math.imul forces 32-bit multiplication; the unsigned shift normalizes
    // to a non-negative 32-bit integer before the low-6-bit mask.
    const h1 = (Math.imul(strainId, 2654435761) >>> 0) & 63;
    const h2 = ((Math.imul(strainId, 40503) + 0x9e3779b1) >>> 0) & 63;
    bloom[base + (h1 >>> 3)] |= 1 << (h1 & 7);
    bloom[base + (h2 >>> 3)] |= 1 << (h2 & 7);
}

/**
 * Check both bloom bits for `strainId` in the cell at `cellIdx`. Returns
 * true iff BOTH are set ("probably seen this strain"). False positives
 * are possible (rate scales with the number of distinct strains inserted);
 * false negatives are not.
 *
 * NOTE on enumeration: a bloom filter cannot enumerate its members. The
 * cross-immunity caller is expected to iterate the top-K most-prevalent
 * strains (e.g. drawn from the registry / per-tick prevalence stats) and
 * call bloomHas(strain) for each candidate. Approximate by design.
 *
 * @param {Uint8Array} bloom
 * @param {number} cellIdx
 * @param {number} strainId
 * @returns {boolean}
 */
export function bloomHas(bloom, cellIdx, strainId) {
    const base = cellIdx * 8;
    const h1 = (Math.imul(strainId, 2654435761) >>> 0) & 63;
    const h2 = ((Math.imul(strainId, 40503) + 0x9e3779b1) >>> 0) & 63;
    const b1 = (bloom[base + (h1 >>> 3)] >>> (h1 & 7)) & 1;
    const b2 = (bloom[base + (h2 >>> 3)] >>> (h2 & 7)) & 1;
    return b1 === 1 && b2 === 1;
}
