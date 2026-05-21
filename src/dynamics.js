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
//  10. Animal dyn.  — delegated to dynamics-animal.js: animal SIR (S→I via
//                     animal neighbors, I→{R,D}, D→VOID disposal) plus
//                     strain-aware bidirectional spillover.
// Z writes overwrite anything earlier steps wrote (intentional: "Z wins").
// Animal dynamics run AFTER Z so Z's conversion of an I human into Z cannot
// then spillover-flow to its co-located animal within the same tick.

import { Animal, Compartment, DEFAULTS, Flag, Status } from './config.js';
import { DEFAULT_PARAMS } from './default-params.js';
import { DEFAULT_TOGGLES } from './default-toggles.js';
import { getNeighborTable } from './topology.js';
import { runExtinctionSweep } from './strain-extinction.js';
import { runAnimalDynamics } from './dynamics-animal.js';
import { ensureTickScratch, recycleTickScratch } from './dynamics-scratch.js';
import {
    bloomHas,
    bloomSet,
    EMPTY_STRAIN,
    mutateStrain,
    recombineStrains
} from './strains.js';

const MAX_ACTIVE = DEFAULTS.maxActiveStrains;

export { DEFAULT_PARAMS };

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
 *   dToZ:number, iToZ:number, lToZ:number,
 *   zInfect:number, zExhaust:number,
 *   zFightKill:number, zFightInfect:number, zFightExpose:number,
 *   zDieFighting:number, zDieNatural:number,
 *   hAssigned:number, hOverflow:number,
 *   births:number, ageOut:number, dToEmpty:number,
 *   coinfections:number, recombinations:number, prunes:number,
 *   spillovers:number, reverseSpillovers:number,
 *   animalSToI:number, animalIToR:number, animalIToD:number,
 *   animalDisposed:number, animalBirths:number, animalAgeOut:number,
 *   vaxRollout:number, autoQuarantined:number
 * }}
 */
export function tick(grid, params, toggles, topology, rng, strainRegistry, simTick) {
    const p = params || DEFAULT_PARAMS;
    const t = toggles || DEFAULT_TOGGLES;
    const r = rng || Math.random;
    const { W, H, compartment, flags, status, age, health, strain_ids, strain_loads, strain_hist, animal, animal_age, animal_strain } = grid;
    const N = W * H;
    const active = grid.activeIndices;
    const activeCount = active ? active.length : N;
    const useStrains = !!strainRegistry;
    const tickIdx = simTick | 0;

    // Neighbor index table — precomputed per (W,H,topology) and reused across
    // every tick. Replaces ~350k neighbors() allocations per tick with table
    // lookups. `nbrIdx[i*6 + d]` is the flat cell index of cell i's neighbor
    // in direction d (-1 when there's no neighbor at that edge under the
    // current topology).
    const nbrTable = getNeighborTable(W, H, topology);
    const nbrIdx = nbrTable.idx;

    const scratch = ensureTickScratch(N, MAX_ACTIVE);
    const next = scratch.compartment;
    const nextFlags = scratch.flags;
    const nextStatus = scratch.status;
    const nextAge = scratch.age;
    const nextHealth = scratch.health;
    const nextStrainIds = scratch.strainIds;
    const nextStrainLoads = scratch.strainLoads;
    const nextStrainHist = scratch.strainHist;
    const nextAnimal = scratch.animal;
    const nextAnimalAge = scratch.animalAge;
    const nextAnimalStrain = scratch.animalStrain;
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
    if (animal_age) nextAnimalAge.set(animal_age);
    else nextAnimalAge.fill(0);
    if (animal_strain) nextAnimalStrain.set(animal_strain);
    else nextAnimalStrain.fill(EMPTY_STRAIN);

    const {
        beta, sigma, gamma, mu,
        m_decay, l_seed, l_reactivate, l_transform, c_seed, c_transmit_mult, f_decay, f_transmit_mult,
        dz_dead, dz_alive,
        z_convert_unopposed, z_fight_kill, z_fight_infect, z_fight_expose,
        z_die_fighting, z_die_natural,
        z_exhaust_threshold, z_exhaust,
        h_capacity_frac, h_recover_mult, h_mortality_mult,
        h_overflow_mortality_mult, q_transmit_mult, q_susceptibility_mult,
        quarantine_trace_rate,
        d_disposal, birth_rate, birth_threshold, health_degrade_per_tick,
        mortality_baseline, mortality_age_max, mortality_max_age,
        age_susceptibility_mult, age_severity_mult, health_mortality_mult,
        mutation_rate, mutation_strength, cross_immunity_mult,
        coinfection_load_delta, competition_strength, recombination_rate,
        min_strain_load,
        vax_rollout_rate,
        r_susceptibility_mult, vax_efficacy
    } = p;
    // Clamp cross-immunity multiplier into [0, 1]; values outside the range
    // would invert the bloom check or push survival negative.
    const xImm = cross_immunity_mult > 1 ? 1 : (cross_immunity_mult < 0 ? 0 : cross_immunity_mult);
    // Reinfection / breakthrough multipliers, clamped to [0, 1]. R cells'
    // pInf is multiplied by rSuscMult; V cells' pInf is multiplied by
    // (1 - vaxEff). Defaults keep both mechanisms partially live; presets
    // that want textbook immunity override these values.
    const rSuscMult = r_susceptibility_mult > 1
        ? 1
        : (r_susceptibility_mult < 0 ? 0 : r_susceptibility_mult);
    const vaxEff = vax_efficacy > 1
        ? 1
        : (vax_efficacy < 0 ? 0 : vax_efficacy);
    // Clamp the seed-roll probabilities too.
    const lSeed = l_seed > 1 ? 1 : (l_seed < 0 ? 0 : l_seed);
    const cSeed = c_seed > 1 ? 1 : (c_seed < 0 ? 0 : c_seed);
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

    // ─── Phase A: per-strain field resolvers ─────────────────────────────
    //
    // After Phase A, most "rate" parameters live on the strain (registry
    // rows) instead of sim-wide. The seed strain α starts with the values
    // from `params` (via createRegistry(params)) but cells with later-born
    // strains read their own per-strain values.
    //
    // `sidOf(i)` returns the strain id at cell i's slot 0, or -1 if there
    // isn't one (useStrains=false, or slot 0 is empty / out of range).
    // Cells that carry "strain memory" without active infection (M from
    // R-parent, R-with-CARRIER, D-with-F_CORPSE, Z) keep slot 0 populated
    // with load=0 (or load=1 for Z, which is an active state). The
    // resolver returns that id for those cells too, so the relevant
    // per-strain rate (m_decay, c_transmit_mult, f_transmit_mult, f_decay,
    // dz_dead, z_*) reads off the right strain.
    //
    // `pickField(sid, fieldName, fallback)` reads reg[fieldName][sid] when
    // sid is valid, else falls back. We don't cache reg.<field> references
    // out here because the field accessed varies per call site and the
    // overhead is one indexed array read either way.
    const reg = strainRegistry;
    const regLen = useStrains ? reg.ids.length : 0;
    function sidOf(i) {
        if (!useStrains || !strain_ids) return -1;
        const sid = strain_ids[i * MAX_ACTIVE];
        if (sid === EMPTY_STRAIN || sid < 0 || sid >= regLen) return -1;
        return sid;
    }
    // Convenience: closure factories so call sites read like
    //   const gammaSrc = gammaOf(i);
    // and we don't repeat the same if/else inline. JS engines will inline
    // these in the hot path after a few tick iterations.
    const sigmaOf  = (i) => { const s = sidOf(i); return s >= 0 ? reg.sigma[s]  : sigma; };
    const gammaOf  = (i) => { const s = sidOf(i); return s >= 0 ? reg.gamma[s]  : gamma; };
    const muOf     = (i) => { const s = sidOf(i); return s >= 0 ? reg.mu[s]     : mu;    };
    const lReactOf = (i) => { const s = sidOf(i); return s >= 0 ? reg.l_reactivate[s] : l_reactivate; };
    const lTransformOf = (i) => { const s = sidOf(i); return s >= 0 ? reg.l_transform[s] : l_transform; };
    const cSeedOf  = (i) => { const s = sidOf(i); const v = s >= 0 ? reg.c_seed[s] : cSeed; return v > 1 ? 1 : (v < 0 ? 0 : v); };
    const fDecayOf = (i) => { const s = sidOf(i); return s >= 0 ? reg.f_decay[s] : f_decay; };
    const mDecayOf = (i) => { const s = sidOf(i); return s >= 0 ? reg.m_decay[s] : m_decay; };
    const dzDeadOf = (i) => { const s = sidOf(i); return s >= 0 ? reg.dz_dead[s] : dz_dead; };
    const dzAliveOf = (i) => { const s = sidOf(i); return s >= 0 ? reg.dz_alive[s] : dz_alive; };
    const zConvertOf = (i) => { const s = sidOf(i); return s >= 0 ? reg.z_convert_unopposed[s] : z_convert_unopposed; };
    const zFightKillOf = (i) => { const s = sidOf(i); return s >= 0 ? reg.z_fight_kill[s] : z_fight_kill; };
    const zFightInfectOf = (i) => { const s = sidOf(i); return s >= 0 ? reg.z_fight_infect[s] : z_fight_infect; };
    const zFightExposeOf = (i) => { const s = sidOf(i); return s >= 0 ? reg.z_fight_expose[s] : z_fight_expose; };
    const zDieFightOf = (i) => { const s = sidOf(i); return s >= 0 ? reg.z_die_fighting[s] : z_die_fighting; };
    const zDieNatOf = (i) => { const s = sidOf(i); return s >= 0 ? reg.z_die_natural[s] : z_die_natural; };
    const zExhaustOf = (i) => { const s = sidOf(i); return s >= 0 ? reg.z_exhaust[s] : z_exhaust; };
    const healthDegradeOf = (i) => { const s = sidOf(i); return s >= 0 ? reg.health_degrade_per_tick[s] : health_degrade_per_tick; };
    const healthMortMultOf = (i) => { const s = sidOf(i); return s >= 0 ? reg.health_mortality_mult[s] : health_mortality_mult; };
    // f_transmit_mult and c_transmit_mult are read at the *neighbor* side in
    // pickIncomingStrain (the transmitter). Same resolver, called with the
    // neighbor's index.
    const fTransmitMultOf = (i) => { const s = sidOf(i); return s >= 0 ? reg.f_transmit_mult[s] : f_transmit_mult; };
    const cTransmitMultOf = (i) => { const s = sidOf(i); return s >= 0 ? reg.c_transmit_mult[s] : c_transmit_mult; };
    // l_seed is special: it's "fraction of fresh exposures going latent"
    // and reads off the *incoming* picked strain (not the target cell's
    // existing slot 0). Called with the strain id directly, not a cell idx.
    const lSeedOfPick = (pickId) => {
        if (!useStrains || pickId === EMPTY_STRAIN || pickId < 0 || pickId >= regLen) return lSeed;
        const v = reg.l_seed[pickId];
        return v > 1 ? 1 : (v < 0 ? 0 : v);
    };

    let sToE = 0;
    let eToI = 0;
    let iToR = 0;
    let iToD = 0;
    let mToS = 0;
    let lReact = 0;
    let fDecay = 0;
    let dToZ = 0;
    let iToZ = 0;
    let lToZ = 0;            // E-with-LATENT → Z (oncoviral transformation)
    let zInfect = 0;         // any Z generation via neighbor encounter (convert + fight_infect→F path counted at conversion site)
    let zExhaust = 0;
    let zFightKill = 0;      // Z neighbor → target D (clean kill)
    let zFightInfect = 0;    // Z neighbor → target D + F-corpse
    let zFightExpose = 0;    // Z neighbor → target E
    let zDieFighting = 0;    // Z → D from being fought back
    let zDieNatural = 0;     // Z → D from natural decay (lifespan)
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
    let animalBirths = 0;
    let animalAgeOut = 0;
    let vaxRollout = 0;
    let autoQuarantined = 0; // cells traced into Q by auto-quarantine this tick

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
    for (let ak = 0; ak < activeCount; ak++) {
        const i = active ? active[ak] : ak;
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
    // success, the parent compartment determines the newborn:
    //   • At least one R parent  → M (maternal-antibody newborn — only R
    //     parents actually transferred antibodies). Gated on t.M; falls
    //     back to S when M is disabled.
    //   • All-S/E/I/V/M parents  → S (no antibodies to transfer).
    // We treat D as not contributing to neighbor count — corpses don't beget
    // newborns. Z is also excluded from neighbor count (no neighborly
    // procreation with the undead).
    if (birth_rate > 0 && birth_threshold > 0) {
        const newbornM = !!t.M; // gate the maternal-immunity newborn pathway
        for (let ak = 0; ak < activeCount; ak++) {
            const i = active ? active[ak] : ak;
            if (compartment[i] !== Compartment.EMPTY) continue;
            const nbase = i * 6;
            let count = 0;
            let rCount = 0;
            for (let d = 0; d < 6; d++) {
                const ni = nbrIdx[nbase + d];
                if (ni < 0) continue;
                const nc = compartment[ni];
                if (nc !== Compartment.EMPTY && nc !== Compartment.D && nc !== Compartment.Z) {
                    count++;
                    if (nc === Compartment.R) rCount++;
                }
            }
            if (count >= birth_threshold) {
                // 1 - (1 - birth_rate)^count
                const pBirth = 1 - Math.pow(1 - birth_rate, count);
                if (r() < pBirth) {
                    // Pick a parent uniformly from the inhabited neighbors.
                    // If that parent is R (and M is enabled), newborn carries
                    // maternal antibodies → M. Otherwise → S.
                    const parentIsR = newbornM && rCount > 0 &&
                        (r() * count) < rCount;
                    // Phase A: when becoming M we need to identify *which* R
                    // parent so we can copy its slot-0 strain id onto the M
                    // newborn (with load=0). m_decay then reads off the
                    // inherited strain.
                    let mStrainId = EMPTY_STRAIN;
                    if (parentIsR && useStrains && strain_ids) {
                        const pickIdx = (r() * rCount) | 0;
                        let seen = 0;
                        for (let d = 0; d < 6; d++) {
                            const ni = nbrIdx[nbase + d];
                            if (ni < 0) continue;
                            if (compartment[ni] !== Compartment.R) continue;
                            if (seen === pickIdx) {
                                const candidate = strain_ids[ni * MAX_ACTIVE];
                                if (candidate !== EMPTY_STRAIN
                                    && candidate >= 0 && candidate < regLen) {
                                    mStrainId = candidate;
                                }
                                break;
                            }
                            seen++;
                        }
                    }
                    next[i] = parentIsR ? Compartment.M : Compartment.S;
                    nextAge[i] = 0;
                    nextHealth[i] = 1.0;
                    nextFlags[i] = Flag.NONE;
                    nextStatus[i] = Status.NONE;
                    const slotBase = i * MAX_ACTIVE;
                    for (let s = 0; s < MAX_ACTIVE; s++) {
                        nextStrainIds[slotBase + s] = EMPTY_STRAIN;
                        nextStrainLoads[slotBase + s] = 0;
                    }
                    if (mStrainId !== EMPTY_STRAIN) {
                        nextStrainIds[slotBase] = mStrainId;
                        nextStrainLoads[slotBase] = 0;
                    }
                    const histBase = i * 8;
                    for (let b = 0; b < 8; b++) nextStrainHist[histBase + b] = 0;
                    births++;
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
        for (let ak = 0; ak < activeCount; ak++) {
            const i = active ? active[ak] : ak;
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
    // Gated on t.auto_hospital. When the hospital system is off: no beds are
    // assigned, every H status is stripped (stale H would keep granting the
    // recover/mortality bonus indefinitely), and overflowRegime stays false —
    // "no hospital system" means baseline γ/μ for all I cells, NOT a
    // grid-wide overflow mortality penalty. The Q-cell / overflow mortality
    // branch in Step 5 is gated on t.auto_hospital for the same reason.
    let overflowRegime = false;
    if (t.auto_hospital) {
        const cap = Math.floor(h_capacity_frac * N);
        // First pass: count I cells eligible for a bed (compartment I, not Q).
        let iQueue = 0;
        for (let ak = 0; ak < activeCount; ak++) {
            const i = active ? active[ak] : ak;
            if (compartment[i] === Compartment.I && status[i] !== Status.Q) iQueue++;
        }
        overflowRegime = iQueue > cap;
        let bedsLeft = cap;
        for (let ak = 0; ak < activeCount; ak++) {
            const i = active ? active[ak] : ak;
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
    } else {
        // Hospital system disabled — strip every H status (on I and non-I
        // cells alike). Q and NONE pass through untouched.
        for (let ak = 0; ak < activeCount; ak++) {
            const i = active ? active[ak] : ak;
            if (status[i] === Status.H) nextStatus[i] = Status.NONE;
        }
    }

    // Phase A: I cells now read γ/μ from their slot-0 strain, so the
    // single-tick precomputed iLeave* constants were dropped — the I
    // branch derives H / Q / overflow / baseline modifiers inline from
    // per-strain γ/μ. Costs one branch per I cell; mu/gamma access is
    // already a typed-array read regardless of where the constant
    // multiplier comes from.

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
    function pickIncomingStrain(ii) {
        const nbase = ii * 6;
        let prodSurvive = 1.0;
        let anyContrib = false;
        const edgeWeights = useStrains ? _edgeWeightBuf : null;
        const edgeNbrIdx = useStrains ? _edgeNbrIdxBuf : null;
        const edgeStrains = useStrains ? _edgeStrainBuf : null;
        let edgeWeightSum = 0;
        for (let d = 0; d < 6; d++) {
            const ni = nbrIdx[nbase + d];
            if (ni < 0) {
                if (useStrains) {
                    edgeWeights[d] = 0;
                    edgeNbrIdx[d] = -1;
                    edgeStrains[d] = EMPTY_STRAIN;
                }
                continue;
            }
            const nc = compartment[ni];
            const nf = flags[ni];
            const nstat = status[ni];

            let w = 0;
            if (nc === Compartment.I) {
                w = 1.0;
            } else if (nc === Compartment.R && t.C && (nf & Flag.CARRIER)) {
                // Per-strain: read the carrier's strain memory at slot 0
                // (kept populated with load=0 when I→R retained carrier
                // status). Falls back to params c_transmit_mult when the
                // slot is empty (legacy state or useStrains=false).
                w = cTransmitMultOf(ni);
            } else if (nc === Compartment.D && t.F && (nf & Flag.F_CORPSE)) {
                // Per-strain: F-corpse cells keep slot 0 = strain that
                // killed them (load=0 memory). f_transmit_mult reads off
                // that strain.
                w = fTransmitMultOf(ni);
            }
            if (w > 0 && nstat === Status.Q) {
                w *= q_transmit_mult;
            }

            if (w > 0) {
                let edgeBeta = 0;
                let sawAnyStrain = false;
                let attributableId = EMPTY_STRAIN;
                if (useStrains && strain_ids && strain_loads) {
                    const sbase = ni * MAX_ACTIVE;
                    for (let s = 0; s < MAX_ACTIVE; s++) {
                        const sid = strain_ids[sbase + s];
                        if (sid === EMPTY_STRAIN) continue;
                        const sld = strain_loads[sbase + s];
                        if (sld <= 0) continue;
                        sawAnyStrain = true;
                        const strainBeta = sid < regLen ? reg.beta[sid] : beta;
                        let slotContrib = strainBeta * sld;
                        if (xImm > 0 && strain_hist
                            && bloomHas(strain_hist, ii, sid)) {
                            slotContrib *= (1 - xImm);
                        }
                        edgeBeta += slotContrib;
                        if (attributableId === EMPTY_STRAIN) attributableId = sid;
                    }
                    // Memory-state neighbour fallback. R+CARRIER and
                    // D+F_CORPSE cells carry their strain at slot 0 with
                    // load=0 (Phase A memory-marker convention). The
                    // active-load scan above skipped that slot, so without
                    // this fallback the source's strain identity is lost —
                    // attributableId stays EMPTY_STRAIN, edgeBeta falls
                    // back to global β, and infections from carriers /
                    // F-corpses produce E cells with no strain at slot 0.
                    // That broke prevalence accounting (and per-strain
                    // dynamics downstream — σ, γ, μ all fall through to
                    // global values on the orphaned E cells). Treat the
                    // memory slot as a single-strain source at effective
                    // load 1.
                    if (!sawAnyStrain) {
                        const memSid = strain_ids[sbase];
                        if (memSid !== EMPTY_STRAIN) {
                            sawAnyStrain = true;
                            const strainBeta = memSid < regLen ? reg.beta[memSid] : beta;
                            let slotContrib = strainBeta;
                            if (xImm > 0 && strain_hist
                                && bloomHas(strain_hist, ii, memSid)) {
                                slotContrib *= (1 - xImm);
                            }
                            edgeBeta += slotContrib;
                            attributableId = memSid;
                        }
                    }
                }
                if (!sawAnyStrain) edgeBeta = beta;
                let pStep = edgeBeta * w;
                const clamped = pStep > 1 ? 1 : (pStep < 0 ? 0 : pStep);
                prodSurvive *= (1 - clamped);
                anyContrib = true;
                if (useStrains) {
                    edgeWeights[d] = clamped;
                    edgeNbrIdx[d] = ni;
                    edgeStrains[d] = attributableId;
                    edgeWeightSum += clamped;
                }
            } else if (useStrains) {
                edgeWeights[d] = 0;
                edgeNbrIdx[d] = -1;
                edgeStrains[d] = EMPTY_STRAIN;
            }
        }
        if (!anyContrib) return { infected: false, pick: EMPTY_STRAIN };

        let pInf = 1 - prodSurvive;
        if (status[ii] === Status.Q) {
            pInf *= q_susceptibility_mult;
        }
        // Compartment-level susceptibility multipliers. R cells (recovered
        // with broad infection-derived immunity) get rSuscMult; V cells
        // (vaccinated) get (1 - vaxEff). Per-strain
        // bloom-history scaling already happened above (slotContrib *=
        // (1 - xImm)) so a previously-seen strain is further suppressed.
        const tc = compartment[ii];
        if (tc === Compartment.R) {
            pInf *= rSuscMult;
        } else if (tc === Compartment.V) {
            pInf *= (1 - vaxEff);
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
                for (let d = 0; d < 6; d++) {
                    const w = edgeWeights[d];
                    if (w <= 0) continue;
                    roll -= w;
                    if (roll <= 0) {
                        pickedNi = edgeNbrIdx[d];
                        pick = edgeStrains[d];
                        picked = true;
                        break;
                    }
                }
                if (!picked) {
                    for (let d = 5; d >= 0; d--) {
                        if (edgeWeights[d] > 0) {
                            pickedNi = edgeNbrIdx[d];
                            pick = edgeStrains[d];
                            break;
                        }
                    }
                }
            }
            // In-neighbor slot pick by (β_s · load_s · xImm-factor).
            if (pickedNi >= 0 && strain_ids && strain_loads) {
                const sbase = pickedNi * MAX_ACTIVE;
                let slotWeightSum = 0;
                for (let s = 0; s < MAX_ACTIVE; s++) {
                    const sid = strain_ids[sbase + s];
                    if (sid === EMPTY_STRAIN) continue;
                    const sld = strain_loads[sbase + s];
                    if (sld <= 0) continue;
                    const bS = sid < regLen ? reg.beta[sid] : beta;
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
                        const sid = strain_ids[sbase + s];
                        if (sid === EMPTY_STRAIN) continue;
                        const sld = strain_loads[sbase + s];
                        if (sld <= 0) continue;
                        const bS = sid < regLen ? reg.beta[sid] : beta;
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

    for (let ak = 0; ak < activeCount; ak++) {
        const i = active ? active[ak] : ak;
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
                //
                // Phase A: γ, μ, health_mortality_mult are read from
                // the cell's slot-0 strain when present. The status-
                // pre-pass-derived modifiers (iLeaveHGamma etc) were
                // computed against sim-wide γ/μ — instead of
                // precomputing them we now derive H/Q/baseline branches
                // from per-strain γ/μ inline. Slightly more work per
                // I cell but the modifier branch is already cold.
                const sidI = sidOf(i);
                const gammaSrc = sidI >= 0 ? reg.gamma[sidI] : gamma;
                const muSrc    = sidI >= 0 ? reg.mu[sidI]    : mu;
                const hMortMult = sidI >= 0 ? reg.health_mortality_mult[sidI] : health_mortality_mult;
                const ns = nextStatus[i];
                let gammaEff, muEff;
                if (ns === Status.H) {
                    gammaEff = gammaSrc * h_recover_mult;
                    muEff    = muSrc    * h_mortality_mult;
                } else if (t.auto_hospital && (ns === Status.Q || overflowRegime)) {
                    gammaEff = gammaSrc;
                    muEff    = muSrc    * h_overflow_mortality_mult;
                } else {
                    // Baseline (non-H, non-Q, no overflow). Reached
                    // when capacity is plentiful and the cell isn't
                    // quarantined — or when the hospital system is off
                    // entirely (no system ⇒ no overflow penalty) —
                    // same as having no status modifier.
                    gammaEff = gammaSrc;
                    muEff    = muSrc;
                }
                const aNorm = Math.min(1, age[i] / safeMaxAge);
                const ageFactor = 1 + ageSevDelta * aNorm;
                const hFactor = 1 + (hMortMult - 1) * (1 - health[i]);
                muEff = muEff * ageFactor * hFactor;

                let leaveRate = gammaEff + muEff;
                if (leaveRate > 1) leaveRate = 1;
                const recoverShare = leaveRate > 0 ? gammaEff / (gammaEff + muEff) : 0;

                if (r() < leaveRate) {
                    if (r() < recoverShare) {
                        next[i] = Compartment.R;
                        // Carrier roll: per-strain c_seed read from
                        // the strain at slot 0. A fraction of
                        // recoveries leave with the C (chronic carrier)
                        // flag set, making them low-rate transmission
                        // sources via cTransmitMultOf in
                        // pickIncomingStrain. Gated on t.C so toggle-
                        // off disables the mechanic entirely.
                        const cSeedHere = cSeedOf(i);
                        const becameCarrier = (t.C && cSeedHere > 0 && r() < cSeedHere);
                        if (becameCarrier) {
                            nextFlags[i] = nextFlags[i] | Flag.CARRIER;
                        }
                        // Phase 7/8: recovery confers strain-specific
                        // immunity to ALL strains the cell was carrying.
                        // Loop over every active slot and bloom-set its
                        // strain ID, then clear loads + ids.
                        //
                        // Phase A: if the cell became a CARRIER, the
                        // strain at slot 0 is RETAINED with load=0 so
                        // cTransmitMultOf can read its per-strain
                        // transmit multiplier at the source side.
                        // Bloom is still set for all slots (recovery
                        // memory is independent of carrier memory).
                        if (useStrains) {
                            const slot0 = i * MAX_ACTIVE;
                            const carrierStrain = becameCarrier && strain_ids
                                ? strain_ids[slot0]
                                : EMPTY_STRAIN;
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
                            if (carrierStrain !== EMPTY_STRAIN) {
                                // Slot 0 = "I am a carrier of this
                                // strain" memory. load=0 keeps it out
                                // of replicator/recombination math.
                                nextStrainIds[slot0] = carrierStrain;
                                nextStrainLoads[slot0] = 0;
                            }
                        }
                        iToR++;
                    } else {
                        next[i] = Compartment.D;
                        // Death via infection: when the F (infectious-
                        // corpse) flag is enabled, mark the corpse as
                        // F-flagged. The f_decay path strips it after
                        // ~1/f_decay ticks. The F-flag is what gates
                        // D→Z conversion (step 9) — natural-cause
                        // corpses never zombify.
                        const becameFCorpse = !!t.F;
                        if (becameFCorpse) nextFlags[i] = nextFlags[i] | Flag.F_CORPSE;
                        nextHealth[i] = 0;
                        // Dead cells don't carry an active strain. We do
                        // NOT set the bloom — the dead don't accrue
                        // immunity memory.
                        //
                        // Phase A: F-corpse cells keep slot 0 = the
                        // strain that killed them (load=0 memory) so
                        // fTransmitMultOf, fDecayOf, and dzDeadOf can
                        // all resolve to the right strain at the
                        // F-corpse source side. Non-F deaths wipe
                        // slot 0 (natural corpses carry no payload).
                        if (useStrains) {
                            const slot0 = i * MAX_ACTIVE;
                            const fStrain = becameFCorpse && strain_ids
                                ? strain_ids[slot0]
                                : EMPTY_STRAIN;
                            for (let s = 0; s < MAX_ACTIVE; s++) {
                                nextStrainIds[slot0 + s] = EMPTY_STRAIN;
                                nextStrainLoads[slot0 + s] = 0;
                            }
                            if (fStrain !== EMPTY_STRAIN) {
                                nextStrainIds[slot0] = fStrain;
                                nextStrainLoads[slot0] = 0;
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
                    const tx = pickIncomingStrain(i);
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
                // Phase A: σ and l_reactivate read from this cell's
                // slot-0 strain (always set on E cells — they got
                // there via an S/R/V→E transition that set slot 0).
                const isLatent = t.L && (f & Flag.LATENT) !== 0;
                if (isLatent) {
                    // Slow reactivation; clears the LATENT flag on success.
                    if (r() < lReactOf(i)) {
                        next[i] = Compartment.I;
                        nextFlags[i] = f & ~Flag.LATENT;
                        lReact++;
                        eToI++;
                    }
                } else {
                    // Default σ progression (also covers L-flagged E
                    // when toggles.L is false — toggle off = ignore flag).
                    if (r() < sigmaOf(i)) {
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
                const tx = pickIncomingStrain(i);
                if (tx.infected) {
                    next[i] = Compartment.E;
                    // Latent roll: a fraction of fresh exposures enter
                    // with the L flag set, routing E→I through the slow
                    // l_reactivate path instead of σ. Gated on t.L so
                    // toggle-off disables the mechanic. Don't OR onto
                    // the carried-over flags byte — a fresh E has no
                    // prior flags worth preserving (S can't carry L/C/F).
                    // Phase A: l_seed reads off the incoming picked
                    // strain — TB-like strains can ship latent at high
                    // rate while flu-like strains skip the L pathway.
                    const lSeedS = lSeedOfPick(tx.pick);
                    if (t.L && lSeedS > 0 && r() < lSeedS) {
                        nextFlags[i] = Flag.LATENT;
                    } else {
                        nextFlags[i] = Flag.NONE;
                    }
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
            case Compartment.R: {
                // Reinfection. R cells are normally fully immune (default
                // r_susceptibility_mult = 0 would scale pInf to 0 inside
                // pickIncomingStrain. When the param is > 0 they become
                // partially susceptible: the bloom-filter cross-immunity
                // already softens contributions from previously-seen
                // strains via (1 - xImm), so reinfections favor strains
                // the cell hasn't seen — which is the right shape (novel
                // antigens slip past prior immunity at reduced rate).
                //
                // On breakthrough: R → E. Strain slots get the picked
                // strain at load 1; the bloom history is preserved (it's
                // a record of past exposures, not a clean slate).
                // Carrier flag (if any) clears — the cell is no longer
                // recovered.
                if (rSuscMult <= 0) break;
                const txR = pickIncomingStrain(i);
                if (txR.infected) {
                    next[i] = Compartment.E;
                    const lSeedR = lSeedOfPick(txR.pick);
                    if (t.L && lSeedR > 0 && r() < lSeedR) {
                        nextFlags[i] = Flag.LATENT;
                    } else {
                        nextFlags[i] = Flag.NONE;
                    }
                    if (useStrains) {
                        const slot0 = i * MAX_ACTIVE;
                        nextStrainIds[slot0] = txR.pick;
                        nextStrainLoads[slot0] = txR.pick !== EMPTY_STRAIN ? 1.0 : 0;
                        for (let s = 1; s < MAX_ACTIVE; s++) {
                            nextStrainIds[slot0 + s] = EMPTY_STRAIN;
                            nextStrainLoads[slot0 + s] = 0;
                        }
                    }
                    // Counted in sToE so observed Re (which divides by recent
                    // recovery counts) reflects all new infection events,
                    // not just S-derived ones. Same reasoning for V below.
                    sToE++;
                }
                break;
            }
            case Compartment.V: {
                // Vaccine breakthrough. V cells are normally fully
                // immune when vax_efficacy = 1 → pInf scaled to 0
                // inside pickIncomingStrain. When efficacy < 1, the
                // residual (1 - vaxEff) factor lets infection through.
                // Bloom history is preserved — vaccinated cells that
                // were previously R keep their cross-immunity record.
                //
                // Gated on t.V so toggle-off skips the case entirely
                // (and on vax_efficacy < 1 — perfect efficacy is a
                // free early-out).
                if (!t.V || vaxEff >= 1) break;
                const txV = pickIncomingStrain(i);
                if (txV.infected) {
                    next[i] = Compartment.E;
                    const lSeedV = lSeedOfPick(txV.pick);
                    if (t.L && lSeedV > 0 && r() < lSeedV) {
                        nextFlags[i] = Flag.LATENT;
                    } else {
                        nextFlags[i] = Flag.NONE;
                    }
                    if (useStrains) {
                        const slot0 = i * MAX_ACTIVE;
                        nextStrainIds[slot0] = txV.pick;
                        nextStrainLoads[slot0] = txV.pick !== EMPTY_STRAIN ? 1.0 : 0;
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
                // Phase A: per-strain m_decay reads off the mother's
                // strain inherited at birth (slot 0, load=0). Falls
                // back to params m_decay if no inherited strain.
                // Clear slot 0 on transition out of M (antibody memory
                // is gone once they decay).
                if (t.M && r() < mDecayOf(i)) {
                    next[i] = Compartment.S;
                    if (useStrains) {
                        const slot0 = i * MAX_ACTIVE;
                        nextStrainIds[slot0] = EMPTY_STRAIN;
                        nextStrainLoads[slot0] = 0;
                    }
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
                // Phase A: f_decay reads off the F-corpse's slot-0
                // strain (the strain that killed it). On flag clear,
                // also clear slot 0 — the corpse's strain memory was
                // only useful for f_transmit_mult / dz_dead lookups
                // while the F flag was active.
                if (t.F && (f & Flag.F_CORPSE) && r() < fDecayOf(i)) {
                    nextFlags[i] = f & ~Flag.F_CORPSE;
                    if (useStrains) {
                        const slot0 = i * MAX_ACTIVE;
                        nextStrainIds[slot0] = EMPTY_STRAIN;
                        nextStrainLoads[slot0] = 0;
                    }
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

    // ─── Step 7: Health degradation ─────────────────────────────────────
    // I cells lose health_degrade_per_tick health, clamped to 0. Reads
    // start-of-tick compartment so cells that transitioned out of I this
    // tick (recovered/died) skip this pass — their nextHealth is already
    // correct (R preserves health; D set to 0 above).
    //
    // Phase A: per-strain. Different strains can damage hosts at very
    // different rates (HIV vs flu). Read from the I cell's slot-0 strain.
    // Sim-wide health_degrade_per_tick === 0 still short-circuits the
    // whole pass — if α has 0 here AND no faster mutants are alive, the
    // pass is wasted work. We don't have alive-max-degrade tracking yet,
    // so just run the pass and let the per-cell roll degenerate to 0.
    for (let ak = 0; ak < activeCount; ak++) {
        const i = active ? active[ak] : ak;
        if (compartment[i] === Compartment.I && next[i] === Compartment.I) {
            const degrade = healthDegradeOf(i);
            if (degrade > 0) {
                let h = nextHealth[i] - degrade;
                if (h < 0) h = 0;
                nextHealth[i] = h;
            }
        }
    }

    // ─── Step 7.5: Vaccination rollout ──────────────────────────────────
    // Per-tick S/E/R/M → V conversion gated on t.V && t.vax_rollout. Models
    // a real-world vaccination campaign: even without painting, doses roll
    // out at `vax_rollout_rate` per eligible cell per tick. Reads from
    // `next[i]` (so a cell that recovered this tick is eligible immediately
    // on the next), writes to `next[i]` only if the cell is still S/E/R/M.
    // I and Z are intentionally not eligible — vaccinating an active
    // infection doesn't suppress it (sanitize handles that), and Z is its
    // own pathogen class. D/EMPTY are no-ops.
    //
    // Vaccinated cells get their strain slots and flags wiped (clean slate)
    // and their bloom-history is preserved (a vaccinated R cell keeps its
    // earned immunity record).
    if (t.V && t.vax_rollout && vax_rollout_rate > 0) {
        for (let ak = 0; ak < activeCount; ak++) {
            const i = active ? active[ak] : ak;
            const nc = next[i];
            if (nc !== Compartment.S && nc !== Compartment.E &&
                nc !== Compartment.R && nc !== Compartment.M) continue;
            if (r() < vax_rollout_rate) {
                next[i] = Compartment.V;
                nextFlags[i] = Flag.NONE;
                nextStatus[i] = Status.NONE;
                if (useStrains) {
                    const slot0 = i * MAX_ACTIVE;
                    for (let s = 0; s < MAX_ACTIVE; s++) {
                        nextStrainIds[slot0 + s] = EMPTY_STRAIN;
                        nextStrainLoads[slot0 + s] = 0;
                    }
                }
                vaxRollout++;
            }
        }
    }

    // ─── Step 7.6: Auto-quarantine (contact tracing) ────────────────────
    // Gated on t.auto_quarantine. Models contact tracing: an I cell (a
    // detected case) and every living quarantinable cell adjacent to an I
    // cell (a traced contact) is a quarantine candidate. Each un-quarantined
    // candidate is traced into Q with probability quarantine_trace_rate per
    // tick (imperfect detection) and tagged Flag.AUTO_Q so the release pass
    // can tell auto-set Q from manually-painted Q.
    //
    // Release: an AUTO_Q cell drops Q the tick it is no longer a case or a
    // contact (not I, no I neighbour). No timer — pure contact-tracing
    // steady state. Manually-painted Q (no AUTO_Q flag) is never touched.
    //
    // Reads next[] (post-transition compartment) so this tick's recoveries
    // and infections are reflected; writes nextStatus / nextFlags, so the
    // status change lands for next tick's transmission + hospital pre-pass
    // (same one-tick lag as Step 7.5 vax rollout).
    //
    // D / EMPTY / Z cells can't be quarantined — they pass through, and any
    // stale AUTO_Q they carry (e.g. a quarantined cell that just died) is
    // cleared. When the toggle is off, every auto-set Q is released so
    // flipping it off doesn't strand cells in quarantine.

    // Provenance-restore pass (runs regardless of the toggle). Step 5
    // compartment transitions overwrite nextFlags with compartment-specific
    // flag sets (LATENT / CARRIER / F_CORPSE) — an absolute write that
    // clobbers the AUTO_Q provenance bit. A cell that still carries
    // Status.Q but had AUTO_Q at start-of-tick is an orphaned auto-quarantine
    // (e.g. a quarantined S contact that caught the infection: S→E wipes its
    // flags). Re-mark it so the release / toggle-off logic below can still
    // recognise and clear it — without this it would stay quarantined
    // forever, even after the whole grid recovers. Cells that legitimately
    // left quarantine (vaccination clears Q + flags together) have
    // nextStatus !== Q and are correctly skipped.
    for (let ak = 0; ak < activeCount; ak++) {
        const i = active ? active[ak] : ak;
        if ((flags[i] & Flag.AUTO_Q) && nextStatus[i] === Status.Q &&
            !(nextFlags[i] & Flag.AUTO_Q)) {
            nextFlags[i] |= Flag.AUTO_Q;
        }
    }

    if (t.auto_quarantine) {
        for (let ak = 0; ak < activeCount; ak++) {
            const i = active ? active[ak] : ak;
            const c = next[i];
            const quarantinable = c === Compartment.S || c === Compartment.E ||
                c === Compartment.I || c === Compartment.R ||
                c === Compartment.V || c === Compartment.M;
            if (!quarantinable) {
                // Corpse / empty / zombie — strip any stale auto-set Q.
                if (nextFlags[i] & Flag.AUTO_Q) {
                    nextFlags[i] &= ~Flag.AUTO_Q;
                    if (nextStatus[i] === Status.Q) nextStatus[i] = Status.NONE;
                }
                continue;
            }
            // Case (I) or contact (adjacent to an I)?
            let isContact = (c === Compartment.I);
            if (!isContact) {
                const nbase = i * 6;
                for (let d = 0; d < 6; d++) {
                    const ni = nbrIdx[nbase + d];
                    if (ni >= 0 && next[ni] === Compartment.I) { isContact = true; break; }
                }
            }
            if (isContact) {
                // Acquire: only un-quarantined cells, imperfect detection.
                // Cells already Q (auto or manual) are left as-is.
                if (nextStatus[i] === Status.NONE && r() < quarantine_trace_rate) {
                    nextStatus[i] = Status.Q;
                    nextFlags[i] |= Flag.AUTO_Q;
                    autoQuarantined++;
                }
            } else if (nextFlags[i] & Flag.AUTO_Q) {
                // No longer a case or contact — release the auto-set Q.
                nextFlags[i] &= ~Flag.AUTO_Q;
                if (nextStatus[i] === Status.Q) nextStatus[i] = Status.NONE;
            }
        }
    } else {
        // Toggle off — release every auto-set Q. Manual Q is left alone.
        for (let ak = 0; ak < activeCount; ak++) {
            const i = active ? active[ak] : ak;
            if (nextFlags[i] & Flag.AUTO_Q) {
                nextFlags[i] &= ~Flag.AUTO_Q;
                if (nextStatus[i] === Status.Q) nextStatus[i] = Status.NONE;
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
        for (let ak = 0; ak < activeCount; ak++) {
            const i = active ? active[ak] : ak;
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
    // Five sub-mechanics, all gated on t.Z:
    //   (a) Spontaneous D → Z   — F-corpse reanimation at dz_dead
    //   (b) Spontaneous I → Z   — live cell zombification at dz_alive
    //   (c) E-with-L → Z        — oncoviral transformation at l_transform
    //                             (also gated on t.L so the pathway is inert
    //                             when LATENT flag is disabled wholesale)
    //   (d) Z natural decay      — Z → D per-tick at z_die_natural; gives a
    //                             finite lifespan (the macro reading)
    //   (e) Z encounter loop     — per (Z, non-Z neighbor) pair, single
    //                             uniform roll bucketed across four
    //                             mutually-exclusive target outcomes:
    //                               [0, z_fight_kill)                      → D
    //                               [z_fight_kill, +z_fight_infect)        → D + F_CORPSE
    //                               [..., +z_fight_expose)                 → E
    //                               [..., +z_convert_unopposed)            → Z
    //                               leftover                               → nothing
    //                             plus a separate roll for z_die_fighting
    //                             so the zombie can die in the same
    //                             encounter where it kills or converts.
    //                             First-affect-wins on the target side:
    //                             once a target's `next[ni]` differs from
    //                             its start-of-tick state, subsequent Zs
    //                             skip it (the human is dead, exposed, or
    //                             converted — there's no fight). This makes
    //                             P(target affected | k zombies) scale as
    //                             1 - P(nothing)^k as expected.
    //
    // Macro reading (zombie pandemic): high z_fight_*, finite lifespan via
    // z_die_natural, low z_convert_unopposed, F-spawn pathway active.
    // Micro reading (oncoviral): low z_fight_* (cells don't fight back; the
    // small nonzero rate represents NK / CTL immune surveillance), no
    // lifespan (transformed cells are immortal), high z_convert_unopposed
    // (clonal expansion), exhaust-by-crowding on for tumor-core necrosis,
    // L-spawn pathway via l_transform.
    if (t.Z) {
        // Phase A: Z is now strain-aware. Each Z cell carries the strain
        // that drove its conversion at slot 0 (load 1). All per-strain Z
        // rates (dz_*, z_*, l_transform) read off that strain.
        //
        // setZStrain: target becomes Z, slot 0 = srcStrain at load 1.
        // setMemoryStrain: target becomes D+F-corpse, slot 0 = srcStrain
        //   at load 0 — memory for f_transmit_mult / dz_dead / f_decay.
        // clearStrainSlot: target carries no strain payload (clean kill,
        //   Z→D from natural decay, encounter→D no-F, Z→D from exhaustion
        //   or fighting back).
        const clearStrainSlot = (idx) => {
            if (!useStrains) return;
            const slot0 = idx * MAX_ACTIVE;
            for (let s = 0; s < MAX_ACTIVE; s++) {
                nextStrainIds[slot0 + s] = EMPTY_STRAIN;
                nextStrainLoads[slot0 + s] = 0;
            }
        };
        const setZStrain = (idx, srcStrainId) => {
            if (!useStrains) return;
            const slot0 = idx * MAX_ACTIVE;
            nextStrainIds[slot0] = srcStrainId;
            nextStrainLoads[slot0] = srcStrainId !== EMPTY_STRAIN ? 1 : 0;
            for (let s = 1; s < MAX_ACTIVE; s++) {
                nextStrainIds[slot0 + s] = EMPTY_STRAIN;
                nextStrainLoads[slot0 + s] = 0;
            }
        };
        const setMemoryStrain = (idx, srcStrainId) => {
            if (!useStrains) return;
            const slot0 = idx * MAX_ACTIVE;
            nextStrainIds[slot0] = srcStrainId;
            nextStrainLoads[slot0] = 0;
            for (let s = 1; s < MAX_ACTIVE; s++) {
                nextStrainIds[slot0 + s] = EMPTY_STRAIN;
                nextStrainLoads[slot0 + s] = 0;
            }
        };
        // Read slot-0 strain id from start-of-tick state. Returns
        // EMPTY_STRAIN when there isn't one.
        const slot0Read = (idx) => {
            if (!useStrains || !strain_ids) return EMPTY_STRAIN;
            return strain_ids[idx * MAX_ACTIVE];
        };

        for (let ak = 0; ak < activeCount; ak++) {
            const i = active ? active[ak] : ak;
            const c = compartment[i];

            if (c === Compartment.D) {
                    // (a) F-corpse reanimation. Per-strain dz_dead reads
                    // off the F-corpse's slot-0 strain memory. Z inherits
                    // that strain at slot 0 with load 1.
                    if ((flags[i] & Flag.F_CORPSE) && r() < dzDeadOf(i)) {
                        const srcStrain = slot0Read(i);
                        next[i] = Compartment.Z;
                        setZStrain(i, srcStrain);
                        dToZ++;
                    }
                } else if (c === Compartment.I) {
                    // (b) Spontaneous live zombification. Per-strain
                    // dz_alive; Z inherits the I cell's strain.
                    if (r() < dzAliveOf(i)) {
                        const srcStrain = slot0Read(i);
                        next[i] = Compartment.Z;
                        setZStrain(i, srcStrain);
                        iToZ++;
                    }
                } else if (c === Compartment.E) {
                    // (c) L → Z transformation (oncoviral pathway). Per-
                    // strain l_transform; Z inherits the E cell's strain.
                    // Same-tick step 5 writes get clobbered (Z wins).
                    if (t.L && (flags[i] & Flag.LATENT) && r() < lTransformOf(i)) {
                        const srcStrain = slot0Read(i);
                        next[i] = Compartment.Z;
                        setZStrain(i, srcStrain);
                        nextFlags[i] = nextFlags[i] & ~Flag.LATENT;
                        lToZ++;
                    }
                } else if (c === Compartment.Z) {
                    // Phase A: every per-strain Z rate reads off the Z's
                    // own slot-0 strain. Resolve once per Z and reuse.
                    const zStrain = slot0Read(i);
                    const zHasStrain = (zStrain !== EMPTY_STRAIN
                        && zStrain >= 0 && zStrain < regLen);

                    // (d) Natural decay — per-strain.
                    const zDieNat = zHasStrain ? reg.z_die_natural[zStrain] : z_die_natural;
                    if (next[i] === Compartment.Z && zDieNat > 0 && r() < zDieNat) {
                        next[i] = Compartment.D;
                        nextFlags[i] = nextFlags[i] & ~Flag.F_CORPSE;
                        clearStrainSlot(i);
                        zDieNatural++;
                        continue;
                    }

                    const nbase = i * 6;

                    // (d.2) Exhaustion — per-strain z_exhaust; threshold
                    // stays sim-wide (integer cell count).
                    let zCount = 0;
                    for (let d = 0; d < 6; d++) {
                        const ni = nbrIdx[nbase + d];
                        if (ni < 0) continue;
                        if (compartment[ni] === Compartment.Z) zCount++;
                    }
                    const zExhaustRate = zHasStrain ? reg.z_exhaust[zStrain] : z_exhaust;
                    if (zCount >= z_exhaust_threshold && r() < zExhaustRate) {
                        next[i] = Compartment.D;
                        nextFlags[i] = nextFlags[i] & ~Flag.F_CORPSE;
                        clearStrainSlot(i);
                        zExhaust++;
                        continue;
                    }

                    // (e) Encounter loop. Per-strain bucket thresholds
                    // computed once per Z from its genome.
                    const fk = zHasStrain ? reg.z_fight_kill[zStrain]    : z_fight_kill;
                    const fi = zHasStrain ? reg.z_fight_infect[zStrain]  : z_fight_infect;
                    const fe = zHasStrain ? reg.z_fight_expose[zStrain]  : z_fight_expose;
                    const cv = zHasStrain ? reg.z_convert_unopposed[zStrain] : z_convert_unopposed;
                    const fkc = fk > 0 ? fk : 0;
                    const fic = fi > 0 ? fi : 0;
                    const fec = fe > 0 ? fe : 0;
                    const cvc = cv > 0 ? cv : 0;
                    const eSum = fkc + fic + fec + cvc;
                    const eScale = eSum > 1 ? 1 / eSum : 1;
                    const tKill    = fkc * eScale;
                    const tInfect  = tKill   + fic * eScale;
                    const tExpose  = tInfect + fec * eScale;
                    const tConvert = tExpose + cvc * eScale;
                    const zDieFightRate = zHasStrain ? reg.z_die_fighting[zStrain] : z_die_fighting;
                    // encounter→E latent-seed roll uses the Z's strain's
                    // l_seed (the exposure is to the Z's pathogen).
                    const zLSeedRaw = zHasStrain ? reg.l_seed[zStrain] : lSeed;
                    const zLSeed = zLSeedRaw > 1 ? 1 : (zLSeedRaw < 0 ? 0 : zLSeedRaw);

                    let zombieAlive = true;
                    for (let d = 0; d < 6; d++) {
                        const ni = nbrIdx[nbase + d];
                        if (ni < 0) continue;
                        const nc = compartment[ni];
                        if (nc === Compartment.Z || nc === Compartment.EMPTY || nc === Compartment.D) continue;

                        if (next[ni] === nc) {
                            const u = r();
                            if (u < tKill) {
                                // Clean kill — no F flag, no strain memory.
                                next[ni] = Compartment.D;
                                nextStatus[ni] = Status.NONE;
                                nextHealth[ni] = 0;
                                nextFlags[ni] = nextFlags[ni] & ~Flag.F_CORPSE;
                                clearStrainSlot(ni);
                                zFightKill++;
                            } else if (u < tInfect) {
                                // Kill + infect: D+F-corpse with strain
                                // memory = the Z's strain so subsequent
                                // f_transmit_mult / dz_dead / f_decay
                                // resolve correctly off the new corpse.
                                next[ni] = Compartment.D;
                                nextStatus[ni] = Status.NONE;
                                nextHealth[ni] = 0;
                                if (t.F) {
                                    nextFlags[ni] = nextFlags[ni] | Flag.F_CORPSE;
                                    setMemoryStrain(ni, zStrain);
                                } else {
                                    nextFlags[ni] = nextFlags[ni] & ~Flag.F_CORPSE;
                                    clearStrainSlot(ni);
                                }
                                zFightInfect++;
                            } else if (u < tExpose) {
                                // Bitten but escapes alive → E carrying
                                // the Z's strain. Subsequent E→I, E→Z,
                                // and l_reactivate all resolve off this
                                // strain. Bloom history preserved.
                                next[ni] = Compartment.E;
                                setZStrain(ni, zStrain);
                                nextFlags[ni] = (t.L && zLSeed > 0 && r() < zLSeed) ? Flag.LATENT : 0;
                                zFightExpose++;
                            } else if (u < tConvert) {
                                // Unopposed conversion → Z, inheriting
                                // the attacker's strain.
                                next[ni] = Compartment.Z;
                                setZStrain(ni, zStrain);
                                zInfect++;
                            }
                            // else: nothing happens this encounter.
                        }

                        // Zombie's fate roll — per-strain z_die_fighting.
                        if (zombieAlive && zDieFightRate > 0 && r() < zDieFightRate) {
                            next[i] = Compartment.D;
                            nextFlags[i] = nextFlags[i] & ~Flag.F_CORPSE;
                            clearStrainSlot(i);
                            zDieFighting++;
                            zombieAlive = false;
                            break;
                        }
                    }
            }
        }
    }

    // ─── Step 10: Animal dynamics + spillover ───────────────────────────
    // Delegated to dynamics-animal.js. Kept here in the orchestrator after
    // Z dynamics so Z-overwrites of the human compartment are honored before
    // any spillover writes land in `next`.
    const animalCounts = runAnimalDynamics({
        active,
        activeCount,
        animal,
        animal_age,
        animal_strain,
        compartment,
        strain_ids,
        strain_hist,
        next,
        nextAnimal,
        nextAnimalAge,
        nextAnimalStrain,
        nextStrainIds,
        nextStrainLoads,
        nbrIdx,
        params: p,
        rng: r,
        useStrains,
        strainRegistry,
        maxActive: MAX_ACTIVE,
        uint16Max: UINT16_MAX,
        xImm
    });
    spillovers += animalCounts.spillovers;
    reverseSpillovers += animalCounts.reverseSpillovers;
    animalSToI += animalCounts.animalSToI;
    animalIToR += animalCounts.animalIToR;
    animalIToD += animalCounts.animalIToD;
    animalDisposed += animalCounts.animalDisposed;
    animalBirths += animalCounts.animalBirths;
    animalAgeOut += animalCounts.animalAgeOut;

    // Atomic swap: scratch becomes the new arrays; the old start-of-tick
    // arrays become the next scratch. No allocation. Strain buffers swap
    // alongside the others when the grid carries them — otherwise we keep
    // the scratch around for the next tick to reuse.
    grid.compartment = next;
    grid.flags = nextFlags;
    grid.status = nextStatus;
    grid.age = nextAge;
    grid.health = nextHealth;
    if (strain_ids) {
        grid.strain_ids = nextStrainIds;
    }
    if (strain_loads) {
        grid.strain_loads = nextStrainLoads;
    }
    if (strain_hist) {
        grid.strain_hist = nextStrainHist;
    }
    if (animal) {
        grid.animal = nextAnimal;
    }
    if (animal_age) {
        grid.animal_age = nextAnimalAge;
    }
    if (animal_strain) {
        grid.animal_strain = nextAnimalStrain;
    }
    recycleTickScratch({
        compartment,
        flags,
        status,
        age,
        health,
        strainIds: strain_ids,
        strainLoads: strain_loads,
        strainHist: strain_hist,
        animal,
        animalAge: animal_age,
        animalStrain: animal_strain
    });

    // Conservation invariants:
    //   - every cell still has exactly one compartment value in [0, 8]
    //   - status values stay in [0, 2]
    //   - H is only attached to current I cells (cleared on departure)
    //   - Q persists across compartment changes (behavioral, not disease)
    //   - age ∈ [0, UINT16_MAX]; EMPTY cells have age 0
    //   - health ∈ [0, 1]

    runExtinctionSweep(grid, strainRegistry, tickIdx);

    return {
        sToE, eToI, iToR, iToD,
        mToS, lReact, fDecay,
        dToZ, iToZ, lToZ,
        zInfect, zExhaust,
        zFightKill, zFightInfect, zFightExpose,
        zDieFighting, zDieNatural,
        hAssigned, hOverflow,
        births, ageOut, dToEmpty,
        coinfections, recombinations, prunes,
        spillovers, reverseSpillovers,
        animalSToI, animalIToR, animalIToD,
        animalDisposed, animalBirths, animalAgeOut,
        vaxRollout, autoQuarantined
    };
}
