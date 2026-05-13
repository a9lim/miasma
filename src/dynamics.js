// dynamics.js — per-tick state transitions.
// Phase 2: single-strain SEIR(D). S → E → I → {R, D}. No status, no aging,
// no flags. Simultaneous-update semantics: transitions are computed against
// the START-of-tick compartment buffer and written into a scratch buffer,
// then swapped in at the end. This prevents a newly-infected cell from
// transmitting to its neighbor within the same tick (a classic CA bug).
//
// Phase 3 adds V, M, Z compartments + flags L (latent E), C (carrier R),
// F (infectious corpse D). Phase 4 adds status (H/Q) effects. Phase 5 adds
// aging, births, health degradation, spontaneous mortality, D→EMPTY
// disposal, plus age- and health-stratified susceptibility/severity.
// Phase 7 adds multi-strain.
//
// The Phase 5 per-tick step order (numbered to match the plan doc):
//   1. age          — every non-EMPTY cell ages by 1 (cap at Uint16 max)
//   2. births       — EMPTY cells with ≥ birth_threshold neighbors may → M
//   3. strain dyn.  — within-host replicator-dynamics competition + pruning +
//                     recombination roll (Phase 8); per coinfected I cell
//   4. transmission — S → E and I → I-coinfection, weighted by C/F-flagged
//                     sources, age-stratified, multi-strain source aggregation
//   5. transitions  — E→I (with L variant), I→{R,D} (with age + health
//                     mortality modifiers), M→S, D→EMPTY disposal, F decay
//   6. hospitals    — pre-pass before step 5 (existing)
//   7. health       — I cells lose health_degrade_per_tick (clamped to 0)
//   8. mortality    — per-cell age-curve roll → D (Z, EMPTY, D exempt)
//   9. Z dynamics   — D→Z, I→Z, Z→neighbor, Z exhaustion
//  10. Animal dyn.  — animal SIR (S→I via animal neighbors, I→{R,D}, D→VOID
//                     disposal) + bidirectional spillover (animal I → human
//                     S→E with strain α; human I → animal S→I)
// Z writes overwrite anything earlier steps wrote (intentional: "Z wins").
// Animal dynamics run AFTER Z so Z's conversion of an I human into Z cannot
// then spillover-flow to its co-located animal within the same tick.

import { Animal, Compartment, DEFAULTS, Flag, Status } from './config.js';
import { neighbors } from './topology.js';
import {
    bloomHas,
    bloomSet,
    EMPTY_STRAIN,
    getStrain,
    mutateStrain,
    recombineStrains
} from './strains.js';

const MAX_ACTIVE = DEFAULTS.maxActiveStrains;

// Per-cell scratch reused inside the transmission branches for strain
// attribution. Sized to the hex max-neighbor count (6). Module-level so we
// don't allocate per-cell per-tick.
//   _edgeStrainBuf: per-edge picked strain ID (phase 7 legacy; phase 8 path
//                   uses _edgeNbrIdxBuf instead and re-picks within neighbor)
//   _edgeWeightBuf: per-edge contribution weight (used in the weighted-pick
//                   across neighbors)
//   _edgeNbrIdxBuf: per-edge neighbor cell index (phase 8 — needed to re-read
//                   the neighbor's slot list for the in-neighbor strain pick)
const _edgeStrainBuf = new Uint16Array(6);
const _edgeWeightBuf = new Float64Array(6);
const _edgeNbrIdxBuf = new Int32Array(6);

// Default SEIR(D) + flag/maternal/Z rates. Tunable per-preset later; these
// match the values in the Phase-3 task spec.
export const DEFAULT_PARAMS = Object.freeze({
    // Core SEIR(D)
    beta:  0.3,   // transmission probability per S-I contact per tick
    sigma: 0.2,   // E → I rate per tick (1/sigma ≈ incubation period)
    gamma: 0.1,   // I → R rate per tick (1/gamma ≈ infectious period)
    mu:    0.01,  // I → D rate per tick

    // Maternal immunity decay + flag dynamics
    m_decay:         0.02,   // M → S per-tick probability
    l_reactivate:    0.001,  // E-with-L → I per-tick probability (slow reactivation)
    c_transmit_mult: 0.3,    // multiplier on β for R-with-C transmission
    f_decay:         0.05,   // F flag clears per-tick (D-with-F → plain D)
    f_transmit_mult: 0.7,    // multiplier on β for D-with-F transmission

    // Zombie dynamics
    dz_dead:             0.05,   // D → Z per-tick probability
    dz_alive:            0.005,  // I → Z per-tick probability
    z_infect:            0.85,   // per-Z-neighbor conversion probability for non-Z cells
    z_exhaust_threshold: 4,      // Z neighbors required for exhaustion
    z_exhaust:           0.08,   // Z → D probability when exhausted (≥ threshold Z neighbors)

    // Status (H / Q) — Phase 4
    h_capacity_frac:           0.02,  // hospital capacity as fraction of W*H
    h_recover_mult:            1.8,   // γ multiplier for H-status I cells
    h_mortality_mult:          0.4,   // μ multiplier for H-status I cells
    h_overflow_mortality_mult: 1.5,   // μ multiplier for I cells denied a bed
    q_transmit_mult:           0.1,   // Q-status source: transmission weight ×
    q_susceptibility_mult:     0.3,   // Q-status target: per-cell infection prob ×

    // Aging / births / health — Phase 5
    d_disposal:              0.02,    // D (no F flag) → EMPTY per-tick probability
    birth_rate:              0.04,    // per-neighbor base probability when ≥ threshold neighbors
    birth_threshold:         3,       // min inhabited neighbors for births
    health_degrade_per_tick: 0.02,    // I cells lose this much health/tick
    mortality_baseline:      0.0002,  // natural death per tick at age 0
    mortality_age_max:       0.004,   // natural death per tick at mortality_max_age
    mortality_max_age:       5000,    // age at which natural mortality saturates
    age_susceptibility_mult: 1.5,     // susceptibility multiplier at saturated age
    age_severity_mult:       2.0,     // mortality multiplier at saturated age
    health_mortality_mult:   3.0,     // mortality multiplier when health = 0

    // Multi-strain — Phase 7
    mutation_rate:       0.005,  // per-transmission probability of spawning a mutant strain
    mutation_strength:   0.05,   // multiplicative gaussian noise std-dev per param
    cross_immunity_mult: 1.0,    // global multiplier on cross-immunity from prior exposure (0 disables)

    // Coinfection / recombination — Phase 8
    coinfection_load_delta: 0.30,   // load taken by an incoming strain on coinfection
    competition_strength:   0.05,   // replicator-dynamics selection strength per tick
    recombination_rate:     0.01,   // per-coinfected-cell per-tick recombination probability
    min_strain_load:        0.02,   // strains below this threshold get pruned from a cell

    // Vector / reservoir (animal SIR + spillover) — Phase 9
    animal_density:          0.10,   // fraction of in-world cells seeded with S animal
    animal_beta:             0.20,   // animal-to-animal per S-I contact transmission
    animal_gamma:            0.05,   // animal I → R rate per tick
    animal_mu:               0.005,  // animal I → D rate per tick
    animal_d_disposal:       0.10,   // animal D → VOID disposal per tick
    spillover_rate:          0.02,   // animal I → co-located human S → E per tick
    reverse_spillover_rate:  0.005   // human I → co-located animal S → I per tick
});

// Permissive default toggles when the caller omits the toggles arg. Z stays
// off — it's the one mechanic the plan explicitly says defaults to off.
const DEFAULT_TOGGLES = Object.freeze({
    V: true, M: true, Z: false, L: true, C: true, F: true
});

// Scratch buffers reused across ticks so we don't allocate per tick on a
// 120×120 grid. Sized to match the grid the first time `tick` is called
// against it and grown if the grid ever changes size. Nine buffers now:
// compartment (Uint8), flags (Uint8), status (Uint8), age (Uint16), health
// (Float32), strain_ids (Uint16, N*MAX_ACTIVE wide), strain_loads (Float32,
// N*MAX_ACTIVE wide), strain_hist (Uint8, N*8 wide), animal (Uint8).
let _scratch = null;
let _flagScratch = null;
let _statusScratch = null;
let _ageScratch = null;
let _healthScratch = null;
let _strainIdsScratch = null;
let _strainLoadsScratch = null;
let _strainHistScratch = null;
let _animalScratch = null;

function ensureScratch(N) {
    if (_scratch === null || _scratch.length !== N) {
        _scratch = new Uint8Array(N);
    }
    if (_flagScratch === null || _flagScratch.length !== N) {
        _flagScratch = new Uint8Array(N);
    }
    if (_statusScratch === null || _statusScratch.length !== N) {
        _statusScratch = new Uint8Array(N);
    }
    if (_ageScratch === null || _ageScratch.length !== N) {
        _ageScratch = new Uint16Array(N);
    }
    if (_healthScratch === null || _healthScratch.length !== N) {
        _healthScratch = new Float32Array(N);
    }
    const idsLen = N * MAX_ACTIVE;
    if (_strainIdsScratch === null || _strainIdsScratch.length !== idsLen) {
        _strainIdsScratch = new Uint16Array(idsLen);
    }
    if (_strainLoadsScratch === null || _strainLoadsScratch.length !== idsLen) {
        _strainLoadsScratch = new Float32Array(idsLen);
    }
    const histLen = N * 8;
    if (_strainHistScratch === null || _strainHistScratch.length !== histLen) {
        _strainHistScratch = new Uint8Array(histLen);
    }
    if (_animalScratch === null || _animalScratch.length !== N) {
        _animalScratch = new Uint8Array(N);
    }
}

/**
 * One-time initialization of grid health/age for a freshly-constructed
 * grid. Grid.js constructs with Float32Array zero-fill, which would mean
 * every alive cell starts at health=0 and immediately maxes out the
 * health-modulated mortality multiplier. Call this once after Grid
 * construction (and on reset) to give every non-D, non-EMPTY cell a
 * baseline health of 1.0 and age of 0.
 *
 * Not auto-invoked inside `tick` — the dispatcher (main.js) is expected
 * to wire it.
 *
 * NB Phase 9: the animal layer is NOT seeded here. Call
 * `initializeAnimals(grid, params, rng)` separately after `initializeGrid`
 * if you want a non-empty animal reservoir. Keeping this separate gives
 * the integrator control over whether a preset uses animals at all and
 * lets the density be tuned independently from human-side reset.
 *
 * @param {import('./grid.js').Grid} grid
 */
export function initializeGrid(grid) {
    // Shape the storage rhombus into a regular hexagon by masking out the
    // two acute-angle corners. mask=0 cells are treated as "void" — never
    // rendered, never tallied, never births-eligible, never clickable. The
    // dynamics pass over them is cheap because they sit as EMPTY forever.
    applyHexMask(grid);

    const { compartment, mask, age, health, strain_ids, strain_loads, strain_hist } = grid;
    const N = compartment.length;
    // Defensive: Grid constructor already fills strain_ids with 0xFFFF, but a
    // reset path may reuse the same arrays after Phase 7 cells have written
    // strain IDs into them. Wipe the strain state to the empty sentinel and
    // clear the bloom for a fresh-population start. Loads parallel ids — any
    // empty slot must have load 0.
    if (strain_ids) strain_ids.fill(EMPTY_STRAIN);
    if (strain_loads) strain_loads.fill(0);
    if (strain_hist) strain_hist.fill(0);
    for (let i = 0; i < N; i++) {
        age[i] = 0;
        if (mask[i] === 0) {
            // Void cell — stays cold, dead, empty.
            health[i] = 0;
            continue;
        }
        const c = compartment[i];
        if (c === Compartment.D || c === Compartment.EMPTY) {
            health[i] = 0;
        } else {
            health[i] = 1.0;
        }
    }
}

/**
 * Inscribe a regular hexagon inside the W×H axial-coord rhombus.
 * Sets grid.mask[i] = 1 for cells inside the hexagon, 0 for cells in the
 * two acute corners of the rhombus. Outside cells are also wiped to a
 * cold EMPTY state (compartment, status, flags, age, health all zeroed).
 *
 * Hex axial-distance formula: d(q1,r1, q2,r2) = max(|dq|, |dr|, |dq+dr|).
 * Centered at (floor(W/2), floor(H/2)) with radius min(cq, cr, W-1-cq, H-1-cr).
 * For the default 120×120 storage that's center (60, 60), radius 59 — about
 * 10800 in-world cells (~75% of the rhombus storage).
 */
export function applyHexMask(grid) {
    const { W, H, mask, compartment, status, flags, age, health, animal } = grid;
    const cq = Math.floor(W / 2);
    const cr = Math.floor(H / 2);
    // Largest R that fits entirely inside the rhombus on every axis.
    const R = Math.min(cq, cr, W - 1 - cq, H - 1 - cr);
    for (let r = 0; r < H; r++) {
        const rowBase = r * W;
        const dr = r - cr;
        for (let q = 0; q < W; q++) {
            const dq = q - cq;
            const ds = -dq - dr;
            const dist = Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds));
            const i = rowBase + q;
            if (dist <= R) {
                mask[i] = 1;
            } else {
                mask[i] = 0;
                compartment[i] = Compartment.EMPTY;
                status[i] = 0;
                flags[i] = 0;
                age[i] = 0;
                health[i] = 0;
                // Phase 9: void cells carry no animal. Animal defaults to VOID
                // (=0) on Grid construction; we re-assert here so a re-mask
                // (e.g. after dimension change) wipes any stale animal state.
                if (animal) animal[i] = Animal.VOID;
            }
        }
    }
}

/**
 * Phase 9: seed the per-cell animal layer with S animals at the given
 * density. mask=0 cells stay VOID; in-world cells are independently rolled
 * — `params.animal_density` fraction become Animal.S, the rest stay
 * Animal.VOID. Idempotent on a fresh grid; on a non-fresh grid this
 * overwrites the animal layer wholesale (deliberate — animals are a
 * "background ecology" not a state to preserve across resets).
 *
 * Called explicitly by the integrator after `initializeGrid` — never
 * auto-invoked from inside `tick`. The rng arg is passed through so a
 * seeded run reproduces.
 *
 * @param {import('./grid.js').Grid} grid
 * @param {object} [params] — uses params.animal_density (default 0.10)
 * @param {() => number} [rng] — uniform [0, 1); defaults to Math.random
 */
export function initializeAnimals(grid, params, rng) {
    const { animal, mask } = grid;
    if (!animal) return;
    const p = params || DEFAULT_PARAMS;
    const r = rng || Math.random;
    const density = typeof p.animal_density === 'number'
        ? (p.animal_density < 0 ? 0 : (p.animal_density > 1 ? 1 : p.animal_density))
        : 0;
    const N = animal.length;
    for (let i = 0; i < N; i++) {
        if (mask && mask[i] === 0) {
            animal[i] = Animal.VOID;
            continue;
        }
        animal[i] = (r() < density) ? Animal.S : Animal.VOID;
    }
}

const UINT16_MAX = 65535;

/**
 * Advance the grid one tick. Returns transition counts for time-series /
 * stats. Simultaneous-update: reads are taken from `grid.compartment`,
 * `grid.flags`, `grid.status`, `grid.age`, `grid.health`, `grid.strain_ids`,
 * `grid.strain_hist`; writes land in scratch buffers, and we swap buffers at
 * the end so the grid still owns the start-of-tick arrays (no GC churn).
 *
 * Invariant: after tick, the count of cells in every compartment sums to
 * W*H. All transitions preserve cell identity (write-in-place to scratch).
 *
 * @param {import('./grid.js').Grid} grid
 * @param {object} [params] — see DEFAULT_PARAMS shape
 * @param {{V:boolean,M:boolean,Z:boolean,L:boolean,C:boolean,F:boolean}} [toggles]
 * @param {number} [topology] — Topology enum value
 * @param {() => number} [rng] — uniform [0, 1) source; defaults to Math.random
 * @param {object} [strainRegistry] — strain registry from `createRegistry()`.
 *   When provided, transmission becomes strain-aware: each infectious neighbor
 *   contributes its strain's β (not the global β), cross-immunity from the
 *   target cell's bloom modulates the per-edge survival product, and on
 *   infection a per-edge weighted pick chooses the source strain (with a
 *   `mutation_rate` probability of spawning a mutant via mutateStrain).
 *   When omitted, falls through to the existing single-strain behavior.
 * @param {number} [simTick] — current sim tick counter; passed through to
 *   mutateStrain when spawning a mutant strain (used by the registry to
 *   timestamp the new lineage entry). Defaults to 0 if omitted.
 * @returns {{
 *   sToE:number, eToI:number, iToR:number, iToD:number,
 *   mToS:number, lReact:number, fDecay:number,
 *   dToZ:number, iToZ:number, zInfect:number, zExhaust:number,
 *   hAssigned:number, hOverflow:number,
 *   births:number, ageOut:number, dToEmpty:number,
 *   coinfections:number, recombinations:number, prunes:number,
 *   spillovers:number, reverseSpillovers:number,
 *   animalSToI:number, animalIToR:number, animalIToD:number,
 *   animalDisposed:number
 * }}
 */
export function tick(grid, params, toggles, topology, rng, strainRegistry, simTick) {
    const p = params || DEFAULT_PARAMS;
    const t = toggles || DEFAULT_TOGGLES;
    const r = rng || Math.random;
    const { W, H, compartment, flags, status, age, health, strain_ids, strain_loads, strain_hist, animal } = grid;
    const N = W * H;
    const useStrains = !!strainRegistry;
    const tickIdx = simTick | 0;

    ensureScratch(N);
    const next = _scratch;
    const nextFlags = _flagScratch;
    const nextStatus = _statusScratch;
    const nextAge = _ageScratch;
    const nextHealth = _healthScratch;
    const nextStrainIds = _strainIdsScratch;
    const nextStrainLoads = _strainLoadsScratch;
    const nextStrainHist = _strainHistScratch;
    const nextAnimal = _animalScratch;
    // Copy start-of-tick state into scratch buffers. Cells we don't act on
    // pass through unchanged.
    next.set(compartment);
    nextFlags.set(flags);
    nextStatus.set(status);
    nextAge.set(age);
    nextHealth.set(health);
    if (strain_ids) nextStrainIds.set(strain_ids);
    else nextStrainIds.fill(EMPTY_STRAIN);
    if (strain_loads) nextStrainLoads.set(strain_loads);
    else nextStrainLoads.fill(0);
    if (strain_hist) nextStrainHist.set(strain_hist);
    else nextStrainHist.fill(0);
    if (animal) nextAnimal.set(animal);
    else nextAnimal.fill(Animal.VOID);

    const {
        beta, sigma, gamma, mu,
        m_decay, l_reactivate, c_transmit_mult, f_decay, f_transmit_mult,
        dz_dead, dz_alive, z_infect, z_exhaust_threshold, z_exhaust,
        h_capacity_frac, h_recover_mult, h_mortality_mult,
        h_overflow_mortality_mult, q_transmit_mult, q_susceptibility_mult,
        d_disposal, birth_rate, birth_threshold, health_degrade_per_tick,
        mortality_baseline, mortality_age_max, mortality_max_age,
        age_susceptibility_mult, age_severity_mult, health_mortality_mult,
        mutation_rate, mutation_strength, cross_immunity_mult,
        coinfection_load_delta, competition_strength, recombination_rate,
        min_strain_load,
        animal_beta, animal_gamma, animal_mu, animal_d_disposal,
        spillover_rate, reverse_spillover_rate
    } = p;
    // Clamp cross-immunity multiplier into [0, 1]; values outside the range
    // would invert the bloom check or push survival negative.
    const xImm = cross_immunity_mult > 1 ? 1 : (cross_immunity_mult < 0 ? 0 : cross_immunity_mult);
    const mutRate = mutation_rate > 0 ? mutation_rate : 0;
    const mutStrength = mutation_strength > 0 ? mutation_strength : 0;
    // Phase 8 clamps. coinfection_load_delta in [0, 1) so existing loads have
    // something left to rescale; competition_strength ≥ 0; min_strain_load
    // in [0, 1); recombination_rate in [0, 1].
    const coDelta = coinfection_load_delta > 0
        ? (coinfection_load_delta < 0.999 ? coinfection_load_delta : 0.999)
        : 0;
    const compStrength = competition_strength > 0 ? competition_strength : 0;
    const recombRate = recombination_rate > 0
        ? (recombination_rate < 1 ? recombination_rate : 1)
        : 0;
    const minLoad = min_strain_load > 0
        ? (min_strain_load < 1 ? min_strain_load : 0.999)
        : 0;

    let sToE = 0;
    let eToI = 0;
    let iToR = 0;
    let iToD = 0;
    let mToS = 0;
    let lReact = 0;
    let fDecay = 0;
    let dToZ = 0;
    let iToZ = 0;
    let zInfect = 0;
    let zExhaust = 0;
    let hAssigned = 0;
    let hOverflow = 0;
    let births = 0;
    let ageOut = 0;
    let dToEmpty = 0;
    let coinfections = 0;
    let recombinations = 0;
    let prunes = 0;
    let spillovers = 0;
    let reverseSpillovers = 0;
    let animalSToI = 0;
    let animalIToR = 0;
    let animalIToD = 0;
    let animalDisposed = 0;

    // Guard against zero/negative max_age (would NaN the linear interp).
    const safeMaxAge = mortality_max_age > 0 ? mortality_max_age : 1;
    const mortDelta = mortality_age_max - mortality_baseline;
    const ageSuscDelta = age_susceptibility_mult - 1;
    const ageSevDelta = age_severity_mult - 1;
    const healthMortDelta = health_mortality_mult - 1;

    // ─── Step 1: Age ────────────────────────────────────────────────────
    // Every non-EMPTY cell ages by 1, capped at Uint16 max. EMPTY cells
    // are reset to age 0 (clean slate for next birth). This runs against
    // start-of-tick compartment so newly-born M cells in this same tick
    // get age=0 from the births pass instead of being incremented here.
    for (let i = 0; i < N; i++) {
        if (compartment[i] === Compartment.EMPTY) {
            nextAge[i] = 0;
        } else {
            const a = age[i];
            nextAge[i] = a < UINT16_MAX ? a + 1 : UINT16_MAX;
        }
    }

    // ─── Step 2: Births ────────────────────────────────────────────────
    // EMPTY cells with ≥ birth_threshold inhabited (non-EMPTY, non-D)
    // neighbors roll 1 - (1 - birth_rate)^count for spawn probability. On
    // success: compartment=M, age=0, health=1, flags=0, status=0. We
    // treat D as not contributing to neighbor count — corpses don't beget
    // newborns. Z is also excluded from neighbor count (no neighborly
    // procreation with the undead).
    if (birth_rate > 0 && birth_threshold > 0) {
        const mask = grid.mask;
        for (let row = 0; row < H; row++) {
            const rowBase = row * W;
            for (let q = 0; q < W; q++) {
                const i = rowBase + q;
                if (compartment[i] !== Compartment.EMPTY) continue;
                // Void cells (outside the hex shape) are EMPTY by definition
                // but never birth — they're not part of the simulated world.
                if (mask && mask[i] === 0) continue;
                const ns = neighbors(q, row, topology, W, H);
                let count = 0;
                for (let j = 0; j < ns.length; j++) {
                    const nb = ns[j];
                    const nc = compartment[nb.r * W + nb.q];
                    if (nc !== Compartment.EMPTY && nc !== Compartment.D && nc !== Compartment.Z) {
                        count++;
                    }
                }
                if (count >= birth_threshold) {
                    // 1 - (1 - birth_rate)^count
                    const pBirth = 1 - Math.pow(1 - birth_rate, count);
                    if (r() < pBirth) {
                        next[i] = Compartment.M;
                        nextAge[i] = 0;
                        nextHealth[i] = 1.0;
                        nextFlags[i] = Flag.NONE;
                        nextStatus[i] = Status.NONE;
                        // Newborn: no active strain, fresh-slate bloom. Clear
                        // all MAX_ACTIVE slots in case stale IDs lingered. Zero
                        // loads in parallel — newborn carries no infection.
                        const slotBase = i * MAX_ACTIVE;
                        for (let s = 0; s < MAX_ACTIVE; s++) {
                            nextStrainIds[slotBase + s] = EMPTY_STRAIN;
                            nextStrainLoads[slotBase + s] = 0;
                        }
                        const histBase = i * 8;
                        for (let b = 0; b < 8; b++) {
                            nextStrainHist[histBase + b] = 0;
                        }
                        births++;
                    }
                }
            }
        }
    }

    // ─── Step 3: Within-host competition + recombination ───────────────
    // For every I cell with ≥ 2 active strain slots: apply replicator
    // dynamics to push above-average loads up and below-average down, prune
    // slots whose load falls below `min_strain_load`, renormalize the
    // remaining loads to sum to 1, then roll for recombination across two
    // active slots. Single-strain I cells skip the math entirely (their load
    // is already 1.0 on slot 0 by S→E invariant). Reads from start-of-tick
    // `strain_ids` / `strain_loads`; writes to `nextStrainIds` /
    // `nextStrainLoads`. Gated on useStrains because the single-strain
    // legacy path doesn't allocate registry / loads in any meaningful way.
    if (useStrains && strain_ids && strain_loads) {
        for (let i = 0; i < N; i++) {
            if (compartment[i] !== Compartment.I) continue;
            const slot0 = i * MAX_ACTIVE;

            // Read slot ids + loads from start-of-tick into a small local
            // working set. MAX_ACTIVE is 4 so plain locals (not a buffer)
            // keep things in registers.
            let n_active = 0;
            for (let s = 0; s < MAX_ACTIVE; s++) {
                const sid = strain_ids[slot0 + s];
                const sld = strain_loads[slot0 + s];
                if (sid !== EMPTY_STRAIN && sld > 0) n_active++;
            }
            if (n_active < 2) continue; // single-strain or empty: skip Step 3

            // Replicator dynamics. avgLoad = 1 / n_active because the
            // current loads sum to 1 across active slots by invariant.
            const avgLoad = 1 / n_active;
            let sumAfter = 0;
            for (let s = 0; s < MAX_ACTIVE; s++) {
                const sid = strain_ids[slot0 + s];
                if (sid === EMPTY_STRAIN) {
                    nextStrainLoads[slot0 + s] = 0;
                    continue;
                }
                const old = strain_loads[slot0 + s];
                if (old <= 0) {
                    // Stale id with zero load — treat as empty.
                    nextStrainIds[slot0 + s] = EMPTY_STRAIN;
                    nextStrainLoads[slot0 + s] = 0;
                    continue;
                }
                let updated = old * (1 + compStrength * (old - avgLoad));
                if (updated < 0) updated = 0;
                // Pruning: below threshold → drop. Count the prune so the
                // caller can surface it as a stat.
                if (updated < minLoad) {
                    nextStrainIds[slot0 + s] = EMPTY_STRAIN;
                    nextStrainLoads[slot0 + s] = 0;
                    prunes++;
                    continue;
                }
                nextStrainLoads[slot0 + s] = updated;
                sumAfter += updated;
            }

            // Renormalize active loads so the cell sums to 1. If pruning
            // wiped every slot (rare — would require all loads to start
            // below minLoad, which the previous tick's invariant disallows)
            // sumAfter is 0 and we leave the cell with an empty slot list;
            // step 5's I→{R, D} branch will handle that cell as having no
            // active strain (no bloom set on recovery).
            if (sumAfter > 0) {
                const invSum = 1 / sumAfter;
                for (let s = 0; s < MAX_ACTIVE; s++) {
                    if (nextStrainIds[slot0 + s] !== EMPTY_STRAIN) {
                        nextStrainLoads[slot0 + s] *= invSum;
                    }
                }
            }

            // Recombination roll. We re-count active slots post-prune so
            // the two-parent pick draws from the surviving set.
            if (recombRate > 0 && r() < recombRate) {
                // Collect surviving slot indices (≤ MAX_ACTIVE).
                let aSlot = -1, bSlot = -1, count = 0;
                for (let s = 0; s < MAX_ACTIVE; s++) {
                    if (nextStrainIds[slot0 + s] !== EMPTY_STRAIN) {
                        count++;
                        if (count === 1) aSlot = s;
                        else if (count === 2) {
                            bSlot = s;
                            // Don't break — we want the count for the pick
                            // below. With MAX_ACTIVE=4 this is at most two
                            // extra iterations.
                        }
                    }
                }
                if (count >= 2) {
                    // Uniform-random pick of two distinct slots from the
                    // active set. For count > 2, replace bSlot with one of
                    // the later actives uniformly. For count == 2, aSlot
                    // and bSlot are already correct.
                    if (count > 2) {
                        // Reservoir-style: pick aIdx in [0, count), bIdx in
                        // [0, count - 1) shifted past aIdx.
                        const aIdx = (r() * count) | 0;
                        let bIdx = (r() * (count - 1)) | 0;
                        if (bIdx >= aIdx) bIdx++;
                        // Convert to slot positions.
                        let walk = 0, found = 0;
                        aSlot = -1; bSlot = -1;
                        for (let s = 0; s < MAX_ACTIVE; s++) {
                            if (nextStrainIds[slot0 + s] === EMPTY_STRAIN) continue;
                            if (walk === aIdx) aSlot = s;
                            if (walk === bIdx) bSlot = s;
                            walk++;
                            if (aSlot >= 0 && bSlot >= 0) { found = 1; break; }
                        }
                        if (!found) {
                            aSlot = -1; bSlot = -1; // defensive — shouldn't hit
                        }
                    }
                    if (aSlot >= 0 && bSlot >= 0) {
                        const idA = nextStrainIds[slot0 + aSlot];
                        const idB = nextStrainIds[slot0 + bSlot];
                        const newId = recombineStrains(strainRegistry, idA, idB, r, tickIdx);
                        if (typeof newId === 'number' && newId !== -1 && newId !== EMPTY_STRAIN) {
                            // Slot placement: prefer an empty slot. If none,
                            // evict the lowest-load slot (likely a parent;
                            // that's fine — the hybrid replaces it).
                            let hostSlot = -1;
                            for (let s = 0; s < MAX_ACTIVE; s++) {
                                if (nextStrainIds[slot0 + s] === EMPTY_STRAIN) {
                                    hostSlot = s;
                                    break;
                                }
                            }
                            if (hostSlot === -1) {
                                let minLd = Infinity;
                                for (let s = 0; s < MAX_ACTIVE; s++) {
                                    const ld = nextStrainLoads[slot0 + s];
                                    if (ld < minLd) {
                                        minLd = ld;
                                        hostSlot = s;
                                    }
                                }
                            }
                            if (hostSlot >= 0) {
                                // Insert with coDelta load, scale existing
                                // loads down to make room, then renormalize.
                                // Existing-load sum excludes the host slot
                                // (since we're overwriting it).
                                let existingSum = 0;
                                for (let s = 0; s < MAX_ACTIVE; s++) {
                                    if (s === hostSlot) continue;
                                    if (nextStrainIds[slot0 + s] !== EMPTY_STRAIN) {
                                        existingSum += nextStrainLoads[slot0 + s];
                                    }
                                }
                                nextStrainIds[slot0 + hostSlot] = newId;
                                nextStrainLoads[slot0 + hostSlot] = coDelta;
                                if (existingSum > 0) {
                                    const scale = (1 - coDelta) / existingSum;
                                    for (let s = 0; s < MAX_ACTIVE; s++) {
                                        if (s === hostSlot) continue;
                                        if (nextStrainIds[slot0 + s] !== EMPTY_STRAIN) {
                                            nextStrainLoads[slot0 + s] *= scale;
                                        }
                                    }
                                } else {
                                    // Hybrid is the only remaining strain;
                                    // give it the full load to keep the
                                    // sum-to-1 invariant.
                                    nextStrainLoads[slot0 + hostSlot] = 1;
                                }
                                recombinations++;
                            }
                        }
                    }
                }
            }
        }
    }

    // ─── Step 6 (pre-pass): Hospital allocation ─────────────────────────────
    // Deterministic row-major assignment of H status to I cells, capped at
    // floor(h_capacity_frac * W * H) beds. Q-flagged I cells are excluded from
    // the queue entirely (quarantine takes precedence — they don't consume a
    // bed). Cells that were H last tick but are no longer I have their H
    // cleared here (we re-derive H from current I cells; non-I cells get any
    // stale H stripped). Q status is preserved across all cell types.
    //
    // Overflow semantics (per contract): an I cell is "overflow" iff its
    // compartment is I, its post-allocation status is not H, and the
    // candidate pool (non-Q I cells) exceeded capacity. Q-flagged I cells
    // are also treated as overflow for mortality purposes — they wanted
    // safety, didn't get it.
    //
    // Output: nextStatus reflects post-allocation H assignment. Step 5 reads
    // it to pick the I-transition rate modifiers, and clears H on cells that
    // leave I via recovery/death.
    const cap = Math.floor(h_capacity_frac * N);
    // First pass: count I cells eligible for a bed (compartment I, not Q).
    let iQueue = 0;
    for (let i = 0; i < N; i++) {
        if (compartment[i] === Compartment.I && status[i] !== Status.Q) iQueue++;
    }
    const overflowRegime = iQueue > cap;
    let bedsLeft = cap;
    for (let i = 0; i < N; i++) {
        const c0 = compartment[i];
        const s0 = status[i];
        if (c0 === Compartment.I) {
            if (s0 === Status.Q) {
                // Quarantined infectious: never hospitalized. Q persists.
                // Treated as overflow for mortality regardless of capacity.
                nextStatus[i] = Status.Q;
                hOverflow++;
            } else if (bedsLeft > 0) {
                nextStatus[i] = Status.H;
                bedsLeft--;
                // Newly assigned only if start-of-tick status wasn't already H.
                if (s0 !== Status.H) hAssigned++;
            } else {
                // No bed left — overflow regime is true by definition here.
                nextStatus[i] = Status.NONE;
                hOverflow++;
            }
        } else if (s0 === Status.H) {
            // Stale H on a non-I cell (e.g. left I last tick without clearing).
            // Strip it; Q would have been preserved by the s0 !== H branches.
            nextStatus[i] = Status.NONE;
        }
        // Non-I cells without H stay as-is (Q preserved, NONE preserved).
    }

    // Combined rates for I cells. We sample once against (γ_eff + μ_eff) and
    // split the outcome — mutually exclusive in a single tick. The effective
    // rates depend on this cell's post-allocation H status / overflow flag.
    // Per-cell μ then gets multiplied by age-severity and health-severity
    // factors inside the I-branch.
    const iLeaveBaseGamma = gamma;
    const iLeaveBaseMu    = mu;
    const iLeaveHGamma    = gamma * h_recover_mult;
    const iLeaveHMu       = mu * h_mortality_mult;
    const iLeaveOverGamma = gamma;
    const iLeaveOverMu    = mu * h_overflow_mortality_mult;

    // ─── Steps 4 + 5 in a single pass ───────────────────────────────────
    // Reading from `compartment` / `flags` / `age` / `health` (start-of-tick)
    // and writing to `next` / `nextFlags` / `nextHealth`. Order is row-major;
    // transitions are commutative with respect to read order because we
    // never read `next`.
    //
    // Transmission helper: returns `{infected, pick}` where `infected` is the
    // result of the per-cell roll and `pick` is the source strain ID (or
    // EMPTY_STRAIN if no strain is attributable / useStrains is false).
    //
    // Both the S→E branch and the I-cell coinfection branch use this. The
    // math is the same survival-product / weighted-pick that Phase 7 ran on
    // S cells alone — extended to (a) aggregate over all source slots per
    // neighbor for the effective β, and (b) do a two-stage weighted pick
    // (edge, then in-neighbor slot) for strain attribution.
    //
    // The helper assumes the caller has already verified the cell should be
    // a target (S → always; I → only when the cell stayed I after step 5).
    function pickIncomingStrain(qq, rr, ii) {
        const nslist = neighbors(qq, rr, topology, W, H);
        let prodSurvive = 1.0;
        let anyContrib = false;
        const edgeWeights = useStrains ? _edgeWeightBuf : null;
        const edgeNbrIdx = useStrains ? _edgeNbrIdxBuf : null;
        const edgeStrains = useStrains ? _edgeStrainBuf : null;
        let edgeWeightSum = 0;
        for (let j = 0; j < nslist.length; j++) {
            const nb = nslist[j];
            const ni = nb.r * W + nb.q;
            const nc = compartment[ni];
            const nf = flags[ni];
            const nstat = status[ni];

            let w = 0;
            if (nc === Compartment.I) {
                w = 1.0;
            } else if (nc === Compartment.R && t.C && (nf & Flag.CARRIER)) {
                w = c_transmit_mult;
            } else if (nc === Compartment.D && t.F && (nf & Flag.F_CORPSE)) {
                w = f_transmit_mult;
            }
            if (w > 0 && nstat === Status.Q) {
                w *= q_transmit_mult;
            }

            if (w > 0) {
                let edgeBeta = 0;
                let sawAnyStrain = false;
                let attributableId = EMPTY_STRAIN;
                if (useStrains && strain_ids && strain_loads) {
                    const nbase = ni * MAX_ACTIVE;
                    for (let s = 0; s < MAX_ACTIVE; s++) {
                        const sid = strain_ids[nbase + s];
                        if (sid === EMPTY_STRAIN) continue;
                        const sld = strain_loads[nbase + s];
                        if (sld <= 0) continue;
                        sawAnyStrain = true;
                        let strainBeta = beta;
                        const sParams = getStrain(strainRegistry, sid);
                        if (sParams && typeof sParams.beta === 'number') {
                            strainBeta = sParams.beta;
                        }
                        let slotContrib = strainBeta * sld;
                        if (xImm > 0 && strain_hist
                            && bloomHas(strain_hist, ii, sid)) {
                            slotContrib *= (1 - xImm);
                        }
                        edgeBeta += slotContrib;
                        if (attributableId === EMPTY_STRAIN) attributableId = sid;
                    }
                }
                if (!sawAnyStrain) edgeBeta = beta;
                let pStep = edgeBeta * w;
                const clamped = pStep > 1 ? 1 : (pStep < 0 ? 0 : pStep);
                prodSurvive *= (1 - clamped);
                anyContrib = true;
                if (useStrains) {
                    edgeWeights[j] = clamped;
                    edgeNbrIdx[j] = ni;
                    edgeStrains[j] = attributableId;
                    edgeWeightSum += clamped;
                }
            } else if (useStrains) {
                edgeWeights[j] = 0;
                edgeNbrIdx[j] = -1;
                edgeStrains[j] = EMPTY_STRAIN;
            }
        }
        if (!anyContrib) return { infected: false, pick: EMPTY_STRAIN };

        let pInf = 1 - prodSurvive;
        if (status[ii] === Status.Q) {
            pInf *= q_susceptibility_mult;
        }
        const aN = Math.min(1, age[ii] / safeMaxAge);
        pInf *= (1 + ageSuscDelta * aN);
        if (pInf > 1) pInf = 1;
        else if (pInf < 0) pInf = 0;
        if (r() >= pInf) return { infected: false, pick: EMPTY_STRAIN };

        let pick = EMPTY_STRAIN;
        if (useStrains) {
            let pickedNi = -1;
            if (edgeWeightSum > 0) {
                let roll = r() * edgeWeightSum;
                let picked = false;
                for (let j = 0; j < nslist.length; j++) {
                    const w = edgeWeights[j];
                    if (w <= 0) continue;
                    roll -= w;
                    if (roll <= 0) {
                        pickedNi = edgeNbrIdx[j];
                        pick = edgeStrains[j];
                        picked = true;
                        break;
                    }
                }
                if (!picked) {
                    for (let j = nslist.length - 1; j >= 0; j--) {
                        if (edgeWeights[j] > 0) {
                            pickedNi = edgeNbrIdx[j];
                            pick = edgeStrains[j];
                            break;
                        }
                    }
                }
            }
            // In-neighbor slot pick by (β_s · load_s · xImm-factor).
            if (pickedNi >= 0 && strain_ids && strain_loads) {
                const nbase = pickedNi * MAX_ACTIVE;
                let slotWeightSum = 0;
                for (let s = 0; s < MAX_ACTIVE; s++) {
                    const sid = strain_ids[nbase + s];
                    if (sid === EMPTY_STRAIN) continue;
                    const sld = strain_loads[nbase + s];
                    if (sld <= 0) continue;
                    let bS = beta;
                    const sParams = getStrain(strainRegistry, sid);
                    if (sParams && typeof sParams.beta === 'number') bS = sParams.beta;
                    let sw = bS * sld;
                    if (xImm > 0 && strain_hist
                        && bloomHas(strain_hist, ii, sid)) {
                        sw *= (1 - xImm);
                    }
                    slotWeightSum += sw;
                }
                if (slotWeightSum > 0) {
                    let roll = r() * slotWeightSum;
                    let picked = false;
                    let lastValid = EMPTY_STRAIN;
                    for (let s = 0; s < MAX_ACTIVE; s++) {
                        const sid = strain_ids[nbase + s];
                        if (sid === EMPTY_STRAIN) continue;
                        const sld = strain_loads[nbase + s];
                        if (sld <= 0) continue;
                        let bS = beta;
                        const sParams = getStrain(strainRegistry, sid);
                        if (sParams && typeof sParams.beta === 'number') bS = sParams.beta;
                        let sw = bS * sld;
                        if (xImm > 0 && strain_hist
                            && bloomHas(strain_hist, ii, sid)) {
                            sw *= (1 - xImm);
                        }
                        lastValid = sid;
                        roll -= sw;
                        if (roll <= 0) {
                            pick = sid;
                            picked = true;
                            break;
                        }
                    }
                    if (!picked && lastValid !== EMPTY_STRAIN) pick = lastValid;
                }
            }
            // Mutation roll on the picked strain.
            if (pick !== EMPTY_STRAIN && mutRate > 0 && r() < mutRate) {
                const mutId = mutateStrain(
                    strainRegistry, pick, mutStrength, r, tickIdx
                );
                if (typeof mutId === 'number' && mutId !== EMPTY_STRAIN && mutId !== -1) {
                    pick = mutId;
                }
            }
        }
        return { infected: true, pick };
    }

    for (let row = 0; row < H; row++) {
        const rowBase = row * W;
        for (let q = 0; q < W; q++) {
            const i = rowBase + q;
            const c = compartment[i];
            const f = flags[i];

            switch (c) {
                case Compartment.I: {
                    // Step 5: I → {R, D}. Effective γ/μ depend on the
                    // post-allocation H status set in the pre-pass. Then μ
                    // is multiplied by age-severity and health-severity:
                    //   age_factor    = 1 + (age_severity_mult - 1)
                    //                       × min(1, age / mortality_max_age)
                    //   health_factor = 1 + (health_mortality_mult - 1)
                    //                       × (1 - health)
                    // Combined iLeaveRate = γ_eff + μ_eff*age_factor*health_factor,
                    // clamped to ≤ 1. After leaving I, H clears; Q persists.
                    const ns = nextStatus[i];
                    let gammaEff, muEff;
                    if (ns === Status.H) {
                        gammaEff = iLeaveHGamma;
                        muEff    = iLeaveHMu;
                    } else if (ns === Status.Q || overflowRegime) {
                        gammaEff = iLeaveOverGamma;
                        muEff    = iLeaveOverMu;
                    } else {
                        // Fallback baseline; not reached under normal flow.
                        gammaEff = iLeaveBaseGamma;
                        muEff    = iLeaveBaseMu;
                    }
                    const aNorm = Math.min(1, age[i] / safeMaxAge);
                    const ageFactor = 1 + ageSevDelta * aNorm;
                    const hFactor = 1 + healthMortDelta * (1 - health[i]);
                    muEff = muEff * ageFactor * hFactor;

                    let leaveRate = gammaEff + muEff;
                    if (leaveRate > 1) leaveRate = 1;
                    const recoverShare = leaveRate > 0 ? gammaEff / (gammaEff + muEff) : 0;

                    if (r() < leaveRate) {
                        if (r() < recoverShare) {
                            next[i] = Compartment.R;
                            // Phase 7/8: recovery confers strain-specific
                            // immunity to ALL strains the cell was carrying.
                            // Loop over every active slot and bloom-set its
                            // strain ID, then clear ids + loads.
                            if (useStrains) {
                                const slot0 = i * MAX_ACTIVE;
                                if (strain_ids) {
                                    for (let s = 0; s < MAX_ACTIVE; s++) {
                                        const sid = strain_ids[slot0 + s];
                                        if (sid !== EMPTY_STRAIN) {
                                            bloomSet(nextStrainHist, i, sid);
                                        }
                                    }
                                }
                                for (let s = 0; s < MAX_ACTIVE; s++) {
                                    nextStrainIds[slot0 + s] = EMPTY_STRAIN;
                                    nextStrainLoads[slot0 + s] = 0;
                                }
                            }
                            iToR++;
                        } else {
                            next[i] = Compartment.D;
                            // Death via infection: F flag is the existing
                            // F_CORPSE behavior — this step does not set F.
                            // (Preset / strain-level rules attach F elsewhere.)
                            nextHealth[i] = 0;
                            // Dead cells don't carry an active strain. We do
                            // NOT set the bloom — the dead don't accrue
                            // immunity memory.
                            if (useStrains) {
                                const slot0 = i * MAX_ACTIVE;
                                for (let s = 0; s < MAX_ACTIVE; s++) {
                                    nextStrainIds[slot0 + s] = EMPTY_STRAIN;
                                    nextStrainLoads[slot0 + s] = 0;
                                }
                            }
                            iToD++;
                        }
                        // Cell left I — clear H (if any). Q persists.
                        if (nextStatus[i] === Status.H) {
                            nextStatus[i] = Status.NONE;
                        }
                    } else if (useStrains) {
                        // Phase 8: cell stayed I. Roll for coinfection by a
                        // neighbor's strain. Skipped under single-strain
                        // legacy mode — coinfection is meaningless there.
                        const tx = pickIncomingStrain(q, row, i);
                        if (tx.infected && tx.pick !== EMPTY_STRAIN) {
                            const slot0 = i * MAX_ACTIVE;
                            const pick = tx.pick;
                            // Cross-immunity gate: bloom hit ⇒ skip. The
                            // per-slot xImm scaling in pickIncomingStrain
                            // softens this probabilistically, but the
                            // contract is to also hard-skip when the bloom
                            // already records exposure.
                            let blocked = false;
                            if (xImm > 0 && strain_hist
                                && bloomHas(strain_hist, i, pick)) {
                                blocked = true;
                            }
                            // Already-present check: no-op if pick is in
                            // any active slot of the target.
                            if (!blocked) {
                                for (let s = 0; s < MAX_ACTIVE; s++) {
                                    if (nextStrainIds[slot0 + s] === pick) {
                                        blocked = true;
                                        break;
                                    }
                                }
                            }
                            if (!blocked) {
                                // Slot placement: empty first; else evict
                                // the lowest-load existing slot.
                                let hostSlot = -1;
                                for (let s = 0; s < MAX_ACTIVE; s++) {
                                    if (nextStrainIds[slot0 + s] === EMPTY_STRAIN) {
                                        hostSlot = s;
                                        break;
                                    }
                                }
                                if (hostSlot === -1) {
                                    let minLd = Infinity;
                                    for (let s = 0; s < MAX_ACTIVE; s++) {
                                        const ld = nextStrainLoads[slot0 + s];
                                        if (ld < minLd) {
                                            minLd = ld;
                                            hostSlot = s;
                                        }
                                    }
                                }
                                if (hostSlot >= 0) {
                                    // Sum existing loads (excluding host)
                                    // → scale them by (1 - coDelta) /
                                    // existingSum, then insert pick at
                                    // load coDelta. If host eviction left
                                    // nothing else, hybrid gets full load.
                                    let existingSum = 0;
                                    for (let s = 0; s < MAX_ACTIVE; s++) {
                                        if (s === hostSlot) continue;
                                        if (nextStrainIds[slot0 + s] !== EMPTY_STRAIN) {
                                            existingSum += nextStrainLoads[slot0 + s];
                                        }
                                    }
                                    nextStrainIds[slot0 + hostSlot] = pick;
                                    if (existingSum > 0) {
                                        const scale = (1 - coDelta) / existingSum;
                                        for (let s = 0; s < MAX_ACTIVE; s++) {
                                            if (s === hostSlot) continue;
                                            if (nextStrainIds[slot0 + s] !== EMPTY_STRAIN) {
                                                nextStrainLoads[slot0 + s] *= scale;
                                            }
                                        }
                                        nextStrainLoads[slot0 + hostSlot] = coDelta;
                                    } else {
                                        nextStrainLoads[slot0 + hostSlot] = 1;
                                    }
                                    coinfections++;
                                }
                            }
                        }
                    }
                    break;
                }
                case Compartment.E: {
                    // Step 5: E → I. Two paths depending on LATENT flag.
                    const isLatent = t.L && (f & Flag.LATENT) !== 0;
                    if (isLatent) {
                        // Slow reactivation; clears the LATENT flag on success.
                        if (r() < l_reactivate) {
                            next[i] = Compartment.I;
                            nextFlags[i] = f & ~Flag.LATENT;
                            lReact++;
                            eToI++;
                        }
                    } else {
                        // Default σ progression (also covers L-flagged E
                        // when toggles.L is false — toggle off = ignore flag).
                        if (r() < sigma) {
                            next[i] = Compartment.I;
                            eToI++;
                        }
                    }
                    break;
                }
                case Compartment.S: {
                    // Step 4: transmission. See `pickIncomingStrain` above for
                    // the per-neighbor weight + strain-aware β aggregation +
                    // two-stage weighted pick (edge, then slot) + mutation
                    // roll. On infection success, set the cell to E with
                    // slot 0 carrying the picked strain at load 1.0 and all
                    // other slots cleared.
                    const tx = pickIncomingStrain(q, row, i);
                    if (tx.infected) {
                        next[i] = Compartment.E;
                        if (useStrains) {
                            const slot0 = i * MAX_ACTIVE;
                            nextStrainIds[slot0] = tx.pick;
                            nextStrainLoads[slot0] = tx.pick !== EMPTY_STRAIN ? 1.0 : 0;
                            for (let s = 1; s < MAX_ACTIVE; s++) {
                                nextStrainIds[slot0 + s] = EMPTY_STRAIN;
                                nextStrainLoads[slot0 + s] = 0;
                            }
                        }
                        sToE++;
                    }
                    break;
                }
                case Compartment.M: {
                    // Step 5: maternal immunity decay. Only auto-decays when
                    // the M mechanic is enabled.
                    if (t.M && r() < m_decay) {
                        next[i] = Compartment.S;
                        mToS++;
                    }
                    break;
                }
                case Compartment.D: {
                    // Step 5: F-flag decay on corpses, then D→EMPTY
                    // disposal (only when F is not set — F-flagged corpses
                    // hang around until F decays). F decay runs first; the
                    // simultaneous-update read of `f` means an F-flagged
                    // corpse this tick is not eligible for disposal even
                    // if F clears here.
                    if (t.F && (f & Flag.F_CORPSE) && r() < f_decay) {
                        nextFlags[i] = f & ~Flag.F_CORPSE;
                        fDecay++;
                    } else if (!(f & Flag.F_CORPSE) && r() < d_disposal) {
                        // Plain D (no F flag): disposal.
                        next[i] = Compartment.EMPTY;
                        nextFlags[i] = Flag.NONE;
                        nextStatus[i] = Status.NONE;
                        nextHealth[i] = 0;
                        nextAge[i] = 0;
                        dToEmpty++;
                    }
                    break;
                }
                // R, V, Z, EMPTY: untouched in steps 4/5.
                default:
                    break;
            }
        }
    }

    // ─── Step 7: Health degradation ─────────────────────────────────────
    // I cells lose health_degrade_per_tick health, clamped to 0. Reads
    // start-of-tick compartment so cells that transitioned out of I this
    // tick (recovered/died) skip this pass — their nextHealth is already
    // correct (R preserves health; D set to 0 above).
    if (health_degrade_per_tick > 0) {
        for (let i = 0; i < N; i++) {
            if (compartment[i] === Compartment.I) {
                // Only degrade if the cell is still I after step 5 — if it
                // recovered/died, its nextHealth is already set.
                if (next[i] === Compartment.I) {
                    let h = nextHealth[i] - health_degrade_per_tick;
                    if (h < 0) h = 0;
                    nextHealth[i] = h;
                }
            }
        }
    }

    // ─── Step 8: Spontaneous mortality (age-driven) ─────────────────────
    // Per-cell roll. Exempt: EMPTY, D, Z. Probability is a linear interp
    // between mortality_baseline (age 0) and mortality_age_max (age ≥
    // mortality_max_age). On death: compartment → D (no F flag set —
    // natural death is not an infectious corpse), status → NONE, health
    // → 0. Reads start-of-tick compartment to decide eligibility, but
    // writes only land if the cell hasn't already been written to D / Z /
    // EMPTY by a previous step (simultaneous-update semantics — we
    // overwrite freely; the conservation invariant is preserved because
    // every overwrite is still one cell → one compartment).
    if (mortDelta > 0 || mortality_baseline > 0) {
        for (let i = 0; i < N; i++) {
            const c = compartment[i];
            if (c === Compartment.EMPTY || c === Compartment.D || c === Compartment.Z) continue;
            const aNorm = Math.min(1, age[i] / safeMaxAge);
            const pDie = mortality_baseline + mortDelta * aNorm;
            if (pDie > 0 && r() < pDie) {
                // Skip if step 5 already moved this cell to D / EMPTY —
                // double-counting an age-out on top of an iToD would
                // inflate the D count by not actually changing anything,
                // but it would also incorrectly bump the ageOut counter.
                if (next[i] !== Compartment.D && next[i] !== Compartment.EMPTY) {
                    next[i] = Compartment.D;
                    nextStatus[i] = Status.NONE;
                    nextHealth[i] = 0;
                    // Preserve nextFlags (e.g. a vaccinated cell that age-outs
                    // keeps any non-F flags it had; F isn't set here).
                    // Strip F just in case some prior step set it on an
                    // alive cell — shouldn't happen, but be defensive.
                    nextFlags[i] = nextFlags[i] & ~Flag.F_CORPSE;
                    if (useStrains) {
                        const slot0 = i * MAX_ACTIVE;
                        for (let s = 0; s < MAX_ACTIVE; s++) {
                            nextStrainIds[slot0 + s] = EMPTY_STRAIN;
                            nextStrainLoads[slot0 + s] = 0;
                        }
                    }
                    ageOut++;
                }
            }
        }
    }

    // ─── Step 9: Z dynamics ─────────────────────────────────────────────
    // Single pass, reads from start-of-tick `compartment` and writes to
    // `next`. Z writes overwrite earlier writes (transmission / I→R / I→D
    // / D→cleared-F / disposal / age-out) — "Z wins" by design.
    //
    // Multiple Z neighbors converting the same target: each Z rolls
    // independently against the target. Effective per-tick conversion
    // probability is 1 - (1 - z_infect)^k, matching the spec.
    if (t.Z) {
        // Local helper to wipe the strain slot for any cell converting into
        // Z (or otherwise leaving its disease state via the Z dynamics).
        // Z is its own pseudo-strain at a fixed slot — it doesn't participate
        // in the registry's cross-immunity, so we drop any active strain ID.
        const clearStrainSlot = (idx) => {
            if (!useStrains) return;
            const slot0 = idx * MAX_ACTIVE;
            for (let s = 0; s < MAX_ACTIVE; s++) {
                nextStrainIds[slot0 + s] = EMPTY_STRAIN;
                nextStrainLoads[slot0 + s] = 0;
            }
        };
        for (let row = 0; row < H; row++) {
            const rowBase = row * W;
            for (let q = 0; q < W; q++) {
                const i = rowBase + q;
                const c = compartment[i];

                if (c === Compartment.D) {
                    if (r() < dz_dead) {
                        next[i] = Compartment.Z;
                        clearStrainSlot(i);
                        dToZ++;
                    }
                } else if (c === Compartment.I) {
                    // "Not already converted" — if transmission/transitions
                    // moved this cell elsewhere (R, D) we still overwrite
                    // because we read from start-of-tick compartment. Z wins.
                    if (r() < dz_alive) {
                        next[i] = Compartment.Z;
                        clearStrainSlot(i);
                        iToZ++;
                    }
                } else if (c === Compartment.Z) {
                    // Exhaustion: count start-of-tick Z neighbors.
                    const ns = neighbors(q, row, topology, W, H);
                    let zCount = 0;
                    for (let j = 0; j < ns.length; j++) {
                        const nb = ns[j];
                        if (compartment[nb.r * W + nb.q] === Compartment.Z) zCount++;
                    }
                    if (zCount >= z_exhaust_threshold && r() < z_exhaust) {
                        next[i] = Compartment.D;
                        // Strain slot already empty on a Z source — defensive
                        // no-op here, but matches the I→D / age-out pattern.
                        clearStrainSlot(i);
                        zExhaust++;
                    }
                    // Infection: each Z rolls independently against every
                    // non-Z, non-EMPTY neighbor.
                    for (let j = 0; j < ns.length; j++) {
                        const nb = ns[j];
                        const ni = nb.r * W + nb.q;
                        const nc = compartment[ni];
                        if (nc === Compartment.Z || nc === Compartment.EMPTY) continue;
                        if (r() < z_infect) {
                            // Only count as a new infection if the target
                            // wasn't already turned by another Z this tick.
                            if (next[ni] !== Compartment.Z) {
                                zInfect++;
                            }
                            next[ni] = Compartment.Z;
                            clearStrainSlot(ni);
                        }
                    }
                }
            }
        }
    }

    // ─── Step 10: Animal dynamics + spillover ───────────────────────────
    // Animal SIR on the same hex grid as the human compartment, with
    // bidirectional spillover (animal I → human S→E with strain α;
    // human I → animal S→I).
    //
    // Reads from start-of-tick `animal[i]` and `compartment[i]`; writes
    // to `nextAnimal` and (for spillover) `next` + strain scratch. Cells
    // with mask=0 are skipped — they stay VOID by construction.
    //
    // Transitions:
    //   VOID — stays VOID (no repopulation in phase 9)
    //   S    — count infected animal neighbors k; p_inf = 1-(1-β_a)^k.
    //          On hit → I. Reverse spillover: if co-located human is I
    //          with an active strain (slot 0), roll reverse_spillover_rate
    //          → I (precedes the neighbor roll; spillover beats both).
    //   I    — roll (γ_a + μ_a) to leave; split γ/(γ+μ) → R else D.
    //          Spillover: regardless of transition, if co-located human is
    //          S, roll spillover_rate → human becomes E with strain α
    //          (slot 0, load 1.0). Bloom check: if target human's bloom
    //          records α, spillover is blocked (cross-immunity).
    //   R    — stays R (no waning in phase 9)
    //   D    — roll animal_d_disposal → VOID
    //
    // Step 10 runs AFTER Z dynamics so Z-overwrites of the human compartment
    // are honored — an I human that was just zombified is not S anymore and
    // won't be spilled over to. Spillover writes target the same `next`
    // buffer that step 9 wrote to (simultaneous-update read of `compartment`
    // is still consistent — only the write side differs).
    if (animal) {
        const ab = animal_beta > 0 ? (animal_beta < 1 ? animal_beta : 1) : 0;
        const ag = animal_gamma > 0 ? (animal_gamma < 1 ? animal_gamma : 1) : 0;
        const am = animal_mu > 0 ? (animal_mu < 1 ? animal_mu : 1) : 0;
        const adisp = animal_d_disposal > 0 ? (animal_d_disposal < 1 ? animal_d_disposal : 1) : 0;
        const spillP = spillover_rate > 0 ? (spillover_rate < 1 ? spillover_rate : 1) : 0;
        const revSpillP = reverse_spillover_rate > 0
            ? (reverse_spillover_rate < 1 ? reverse_spillover_rate : 1)
            : 0;
        const mask = grid.mask;
        for (let row = 0; row < H; row++) {
            const rowBase = row * W;
            for (let q = 0; q < W; q++) {
                const i = rowBase + q;
                if (mask && mask[i] === 0) continue;
                const a = animal[i];
                if (a === Animal.VOID) continue;

                if (a === Animal.S) {
                    // Reverse spillover first: a co-located infectious
                    // human can hand the bug back to the animal. We check
                    // start-of-tick human state. Active strain required —
                    // slot 0 holds the cell's primary strain; the animal
                    // layer doesn't track which strain it carries, so we
                    // just need *some* strain to be present.
                    let infected = false;
                    if (revSpillP > 0 && compartment[i] === Compartment.I) {
                        let hasStrain = true; // single-strain mode: assume I implies infectious
                        if (useStrains && strain_ids) {
                            hasStrain = strain_ids[i * MAX_ACTIVE] !== EMPTY_STRAIN;
                        }
                        if (hasStrain && r() < revSpillP) {
                            nextAnimal[i] = Animal.I;
                            reverseSpillovers++;
                            animalSToI++;
                            infected = true;
                        }
                    }
                    if (!infected && ab > 0) {
                        const ns = neighbors(q, row, topology, W, H);
                        let k = 0;
                        for (let j = 0; j < ns.length; j++) {
                            const nb = ns[j];
                            if (animal[nb.r * W + nb.q] === Animal.I) k++;
                        }
                        if (k > 0) {
                            const pInf = 1 - Math.pow(1 - ab, k);
                            if (r() < pInf) {
                                nextAnimal[i] = Animal.I;
                                animalSToI++;
                            }
                        }
                    }
                } else if (a === Animal.I) {
                    // Combined leave-I roll (γ_a + μ_a). Split by share.
                    let leaveRate = ag + am;
                    if (leaveRate > 1) leaveRate = 1;
                    if (leaveRate > 0 && r() < leaveRate) {
                        const recoverShare = (ag + am) > 0 ? ag / (ag + am) : 0;
                        if (r() < recoverShare) {
                            nextAnimal[i] = Animal.R;
                            animalIToR++;
                        } else {
                            nextAnimal[i] = Animal.D;
                            animalIToD++;
                        }
                    }
                    // Spillover: independent of whether the animal stayed
                    // I or transitioned this tick. If the co-located
                    // human is S, roll spillover_rate → human E with
                    // strain α. Bloom check: skip if target already has
                    // immunity memory for α (cross-immunity gate).
                    if (spillP > 0 && compartment[i] === Compartment.S
                        && next[i] === Compartment.S) {
                        let blocked = false;
                        if (useStrains && xImm > 0 && strain_hist
                            && bloomHas(strain_hist, i, 0)) {
                            blocked = true;
                        }
                        if (!blocked && r() < spillP) {
                            next[i] = Compartment.E;
                            if (useStrains) {
                                const slot0 = i * MAX_ACTIVE;
                                nextStrainIds[slot0] = 0; // strain α (founder)
                                nextStrainLoads[slot0] = 1.0;
                                for (let s = 1; s < MAX_ACTIVE; s++) {
                                    nextStrainIds[slot0 + s] = EMPTY_STRAIN;
                                    nextStrainLoads[slot0 + s] = 0;
                                }
                            }
                            spillovers++;
                        }
                    }
                } else if (a === Animal.D) {
                    if (adisp > 0 && r() < adisp) {
                        nextAnimal[i] = Animal.VOID;
                        animalDisposed++;
                    }
                }
                // Animal.R: stays R (no waning in phase 9).
            }
        }
    }

    // Atomic swap: scratch becomes the new arrays; the old start-of-tick
    // arrays become the next scratch. No allocation. Strain buffers swap
    // alongside the others when the grid carries them — otherwise we keep
    // the scratch around for the next tick to reuse.
    grid.compartment = next;
    grid.flags = nextFlags;
    grid.status = nextStatus;
    grid.age = nextAge;
    grid.health = nextHealth;
    _scratch = compartment;
    _flagScratch = flags;
    _statusScratch = status;
    _ageScratch = age;
    _healthScratch = health;
    if (strain_ids) {
        grid.strain_ids = nextStrainIds;
        _strainIdsScratch = strain_ids;
    }
    if (strain_loads) {
        grid.strain_loads = nextStrainLoads;
        _strainLoadsScratch = strain_loads;
    }
    if (strain_hist) {
        grid.strain_hist = nextStrainHist;
        _strainHistScratch = strain_hist;
    }
    if (animal) {
        grid.animal = nextAnimal;
        _animalScratch = animal;
    }

    // Conservation invariants:
    //   - every cell still has exactly one compartment value in [0, 8]
    //   - status values stay in [0, 2]
    //   - H is only attached to current I cells (cleared on departure)
    //   - Q persists across compartment changes (behavioral, not disease)
    //   - age ∈ [0, UINT16_MAX]; EMPTY cells have age 0
    //   - health ∈ [0, 1]

    return {
        sToE, eToI, iToR, iToD,
        mToS, lReact, fDecay,
        dToZ, iToZ, zInfect, zExhaust,
        hAssigned, hOverflow,
        births, ageOut, dToEmpty,
        coinfections, recombinations, prunes,
        spillovers, reverseSpillovers,
        animalSToI, animalIToR, animalIToD,
        animalDisposed
    };
}
