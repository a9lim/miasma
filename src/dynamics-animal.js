// dynamics-animal.js — reservoir demography, animal SIR, and spillover.
//
// This module owns Step 10 of the tick order. It mutates the next-state
// buffers supplied by dynamics.js and returns transition counters; the main
// tick orchestrator keeps the global step order visible.

import { Animal, Compartment } from './config.js';
import { EMPTY_STRAIN, hostPick, isMixed } from './strains.js';
import { susceptibility } from './immunity.js';
import { nextSuccess } from './prng.js';

const ZERO_COUNTS = Object.freeze({
    spillovers: 0,
    reverseSpillovers: 0,
    animalSToI: 0,
    animalIToR: 0,
    animalIToD: 0,
    animalDisposed: 0,
    animalBirths: 0,
    animalAgeOut: 0
});

export function runAnimalDynamics(ctx) {
    const animal = ctx.animal;
    // No animal anywhere: nothing below can happen (births need living neighbours).
    if (!animal || !ctx.present) return ZERO_COUNTS;

    const {
        act,
        activeCount,
        animal_age,
        animal_strain,
        compartment,
        strain_ids,
        strain_loads,
        mem,
        next,
        nextAnimal,
        nextAnimalStrain,
        nextStrainIds,
        nextStrainLoads,
        animalNb,
        nearAnimal,
        stamp,
        nbrIdx,
        params,
        rng,
        useStrains,
        strainRegistry,
        maxActive,
        uint16Max,
        cInf,
        vaxEff
    } = ctx;

    const {
        animal_beta, animal_gamma, animal_mu, animal_d_disposal,
        animal_birth_rate, animal_birth_threshold,
        animal_mortality_baseline, animal_mortality_age_max, animal_max_age,
        spillover_rate, reverse_spillover_rate
    } = params;

    let spillovers = 0;
    let reverseSpillovers = 0;
    let animalSToI = 0;
    let animalIToR = 0;
    let animalIToD = 0;
    let animalDisposed = 0;
    let animalBirths = 0;
    let animalAgeOut = 0;

    const reg = useStrains ? strainRegistry : null;
    const regLenA = reg && reg.animal_beta ? reg.animal_beta.length : 0;
    const animalBetaOf = (sid) => {
        const v = (reg && sid !== EMPTY_STRAIN && sid < regLenA)
            ? reg.animal_beta[sid] : animal_beta;
        return v > 0 ? (v < 1 ? v : 1) : 0;
    };
    const animalGammaOf = (sid) => {
        const v = (reg && sid !== EMPTY_STRAIN && sid < regLenA)
            ? reg.animal_gamma[sid] : animal_gamma;
        return v > 0 ? (v < 1 ? v : 1) : 0;
    };
    const animalMuOf = (sid) => {
        const v = (reg && sid !== EMPTY_STRAIN && sid < regLenA)
            ? reg.animal_mu[sid] : animal_mu;
        return v > 0 ? (v < 1 ? v : 1) : 0;
    };
    const adisp = animal_d_disposal > 0 ? (animal_d_disposal < 1 ? animal_d_disposal : 1) : 0;
    const spillP = spillover_rate > 0 ? (spillover_rate < 1 ? spillover_rate : 1) : 0;
    const revSpillP = reverse_spillover_rate > 0
        ? (reverse_spillover_rate < 1 ? reverse_spillover_rate : 1)
        : 0;
    const aBirthRate = animal_birth_rate > 0 ? (animal_birth_rate < 1 ? animal_birth_rate : 1) : 0;
    const aBirthThresh = animal_birth_threshold | 0;
    const aMortBase = animal_mortality_baseline > 0 ? animal_mortality_baseline : 0;
    const aMortMax = animal_mortality_age_max > 0 ? animal_mortality_age_max : 0;
    const aMortDelta = aMortMax - aMortBase;
    const aSafeMaxAge = animal_max_age > 0 ? animal_max_age : 1;

    // 10a — Aging runs last, in place (below), after 10d's read of the age.

    // A sweep over the animals: each cell's count of living animal neighbours
    // for 10b (scattered from the living animals, which are far fewer than
    // the empty cells that would otherwise each count theirs), and a stamp on
    // every neighbour of an infectious animal, so 10c's susceptible animals
    // look for a source only where there is one.
    const animalBirthsOn = aBirthRate > 0 && aBirthThresh > 0;
    if (animalBirthsOn) animalNb.fill(0);
    for (let ak = 0; ak < activeCount; ak++) {
        const i = act[ak];
        const a = animal[i];
        if (a === Animal.VOID || a === Animal.D) continue;
        const nbase = i * 6;
        if (animalBirthsOn) {
            for (let d = 0; d < 6; d++) {
                const ni = nbrIdx[nbase + d];
                if (ni >= 0) animalNb[ni]++;
            }
        }
        if (a === Animal.I) {
            for (let d = 0; d < 6; d++) {
                const ni = nbrIdx[nbase + d];
                if (ni >= 0) nearAnimal[ni] = stamp;
            }
        }
    }

    // 10b — Births (a VOID cell with ≥ animal_birth_threshold living animal
    // neighbours), in the same pass as
    // 10c — SIR transitions + bidirectional spillover.
    for (let ak = 0; ak < activeCount; ak++) {
        const i = act[ak];
        const a = animal[i];
        if (a === Animal.VOID) {
            const count = animalBirthsOn ? animalNb[i] : 0;
            if (count >= aBirthThresh && count > 0) {
                const pBirth = 1 - Math.pow(1 - aBirthRate, count);
                if (rng() < pBirth) {
                    nextAnimal[i] = Animal.S;
                    nextAnimalStrain[i] = EMPTY_STRAIN;
                    animalBirths++;
                }
            }
            continue;
        }

        if (a === Animal.S) {
            let infected = false;
            if (revSpillP > 0 && compartment[i] === Compartment.I) {
                // The human's strain: slot 0's, or for a coinfected human
                // one drawn by load from the uniform that rolled the spill.
                let humanSid = 0;
                let hasStrain = true;
                let mixed = false;
                if (useStrains && strain_ids) {
                    humanSid = strain_ids[i * maxActive];
                    mixed = isMixed(strain_ids, strain_loads, i * maxActive, maxActive);
                    hasStrain = mixed || humanSid !== EMPTY_STRAIN;
                }
                const u = hasStrain ? rng() : 1;
                if (u < revSpillP) {
                    if (mixed) humanSid = hostPick(strain_ids, strain_loads, i * maxActive, maxActive, null, u / revSpillP);
                    nextAnimal[i] = Animal.I;
                    nextAnimalStrain[i] = humanSid;
                    reverseSpillovers++;
                    animalSToI++;
                    infected = true;
                }
            }
            if (!infected && nearAnimal[i] === stamp) {
                const nbase = i * 6;
                let pNot = 1;
                let kInf = 0;
                for (let d = 0; d < 6; d++) {
                    const ni = nbrIdx[nbase + d];
                    if (ni < 0) continue;
                    if (animal[ni] !== Animal.I) continue;
                    const nb = animalBetaOf(animal_strain ? animal_strain[ni] : EMPTY_STRAIN);
                    if (nb <= 0) continue;
                    pNot *= (1 - nb);
                    kInf++;
                }
                if (kInf > 0 && rng() < (1 - pNot)) {
                    // The strain comes from one of the transmitting
                    // neighbours, uniformly.
                    let pick = (rng() * kInf) | 0, chosenSid = EMPTY_STRAIN;
                    for (let d = 0; d < 6; d++) {
                        const ni = nbrIdx[nbase + d];
                        if (ni < 0 || animal[ni] !== Animal.I) continue;
                        const nsid = animal_strain ? animal_strain[ni] : EMPTY_STRAIN;
                        if (animalBetaOf(nsid) <= 0) continue;
                        if (pick-- === 0) { chosenSid = nsid; break; }
                    }
                    nextAnimal[i] = Animal.I;
                    nextAnimalStrain[i] = chosenSid;
                    animalSToI++;
                }
            }
        } else if (a === Animal.I) {
            const sid = animal_strain ? animal_strain[i] : EMPTY_STRAIN;
            const ag = animalGammaOf(sid);
            const am = animalMuOf(sid);
            let leaveRate = ag + am;
            if (leaveRate > 1) leaveRate = 1;
            if (leaveRate > 0 && rng() < leaveRate) {
                const recoverShare = (ag + am) > 0 ? ag / (ag + am) : 0;
                if (rng() < recoverShare) {
                    nextAnimal[i] = Animal.R;
                    nextAnimalStrain[i] = EMPTY_STRAIN;
                    animalIToR++;
                } else {
                    nextAnimal[i] = Animal.D;
                    nextAnimalStrain[i] = EMPTY_STRAIN;
                    animalIToD++;
                }
            }
            if (spillP > 0 && compartment[i] === Compartment.S
                && next[i] === Compartment.S) {
                let spillSid = sid;
                if (!useStrains || spillSid === EMPTY_STRAIN) spillSid = 0;
                // Prior immunity scales the spillover by the human's
                // susceptibility to the animal's strain (immunity.js).
                const reg = strainRegistry;
                const susc = useStrains && mem && mem.n[i] > 0 && spillSid < reg.ag_x.length
                    ? susceptibility(mem, i, reg.ag_x[spillSid], reg.ag_y[spillSid], cInf, vaxEff)
                    : 1;
                if (rng() < spillP * susc) {
                    next[i] = Compartment.E;
                    if (useStrains) {
                        const slot0 = i * maxActive;
                        nextStrainIds[slot0] = spillSid;
                        nextStrainLoads[slot0] = 1.0;
                        for (let s = 1; s < maxActive; s++) {
                            nextStrainIds[slot0 + s] = EMPTY_STRAIN;
                            nextStrainLoads[slot0 + s] = 0;
                        }
                    }
                    spillovers++;
                }
            }
        } else if (a === Animal.D) {
            if (adisp > 0 && rng() < adisp) {
                nextAnimal[i] = Animal.VOID;
                nextAnimalStrain[i] = EMPTY_STRAIN;
                animalDisposed++;
            }
        }
    }

    // 10d — Age-driven natural mortality, rolled by skipping: candidates at
    // the highest rate any age has, each kept with its own rate over that one.
    const aMortP = Math.min(1, Math.max(aMortBase, aMortBase + aMortDelta));
    if (aMortP > 0) {
        const lq = Math.log1p(-aMortP);
        for (let ak = nextSuccess(-1, lq, rng); ak < activeCount; ak = nextSuccess(ak, lq, rng)) {
            const i = act[ak];
            const a = animal[i];
            if (a !== Animal.S && a !== Animal.I && a !== Animal.R) continue;
            const aa = animal_age ? animal_age[i] : 0;
            const aNorm = aa < aSafeMaxAge ? aa / aSafeMaxAge : 1;
            const pDie = Math.min(1, aMortBase + aMortDelta * aNorm);
            if (pDie > 0 && rng() * aMortP < pDie) {
                if (nextAnimal[i] !== Animal.D && nextAnimal[i] !== Animal.VOID) {
                    nextAnimal[i] = Animal.D;
                    nextAnimalStrain[i] = EMPTY_STRAIN;
                    animalAgeOut++;
                }
            }
        }
    }

    // 10a — Aging, in place: an animal present at the start of the tick and
    // still present ages by 1; a newborn or a disposed carcass is age 0.
    if (animal_age) {
        for (let ak = 0; ak < activeCount; ak++) {
            const i = act[ak];
            if (animal[i] === Animal.VOID || nextAnimal[i] === Animal.VOID) animal_age[i] = 0;
            else if (animal_age[i] < uint16Max) animal_age[i]++;
        }
    }

    return {
        spillovers,
        reverseSpillovers,
        animalSToI,
        animalIToR,
        animalIToD,
        animalDisposed,
        animalBirths,
        animalAgeOut
    };
}
