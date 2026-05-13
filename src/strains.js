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

// Parameter clamps. Match the ranges enforced by DEFAULT_PARAMS in dynamics.js
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
const SIMILARITY_REF_MAX = Math.sqrt(BETA_MAX * BETA_MAX +
                                     SIGMA_MAX * SIGMA_MAX +
                                     GAMMA_MAX * GAMMA_MAX +
                                     MU_MAX * MU_MAX);

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
        beta:      [],
        sigma:     [],
        gamma:     [],
        mu:        [],
        parent:    [],
        parents2:  [],
        birthTick: []
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
    reg.beta.push(clamp(params.beta,  BETA_MIN,  BETA_MAX));
    reg.sigma.push(clamp(params.sigma, SIGMA_MIN, SIGMA_MAX));
    reg.gamma.push(clamp(params.gamma, GAMMA_MIN, GAMMA_MAX));
    reg.mu.push(clamp(params.mu,    MU_MIN,    MU_MAX));
    reg.parent.push(parentId === null || parentId === undefined ? null : (parentId | 0));
    reg.parents2.push(parent2Id === null || parent2Id === undefined ? null : (parent2Id | 0));
    reg.birthTick.push(birthTick | 0);
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
    return {
        id,
        name:      reg.names[id],
        beta:      reg.beta[id],
        sigma:     reg.sigma[id],
        gamma:     reg.gamma[id],
        mu:        reg.mu[id],
        parent:    reg.parent[id],
        parent2:   reg.parents2[id],
        birthTick: reg.birthTick[id]
    };
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

/**
 * Box-Muller transform: two uniform [0, 1) samples → one standard normal.
 * Defensive against u1 = 0 (log(0) = -∞) by clamping to a small ε.
 */
function gaussian(rng) {
    let u1 = rng();
    if (u1 < 1e-12) u1 = 1e-12;
    const u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

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
    const newParams = {
        beta:  src.beta  + src.beta  * strength * gaussian(r),
        sigma: src.sigma + src.sigma * strength * gaussian(r),
        gamma: src.gamma + src.gamma * strength * gaussian(r),
        mu:    src.mu    + src.mu    * strength * gaussian(r)
    };
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
    const noise = RECOMBINATION_NOISE_STDDEV;
    const newParams = {
        beta:  (a.beta  + b.beta)  / 2 + noise * gaussian(r),
        sigma: (a.sigma + b.sigma) / 2 + noise * gaussian(r),
        gamma: (a.gamma + b.gamma) / 2 + noise * gaussian(r),
        mu:    (a.mu    + b.mu)    / 2 + noise * gaussian(r)
    };
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

function bloomBits(strainId) {
    // Math.imul forces 32-bit multiplication; the unsigned shift normalizes
    // to a non-negative 32-bit integer before the low-6-bit mask.
    const h1 = (Math.imul(strainId, 2654435761) >>> 0) & 63;
    const h2 = ((Math.imul(strainId, 40503) + 0x9e3779b1) >>> 0) & 63;
    return { h1, h2 };
}

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
    const { h1, h2 } = bloomBits(strainId);
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
    const { h1, h2 } = bloomBits(strainId);
    const b1 = (bloom[base + (h1 >>> 3)] >>> (h1 & 7)) & 1;
    const b2 = (bloom[base + (h2 >>> 3)] >>> (h2 & 7)) & 1;
    return b1 === 1 && b2 === 1;
}
