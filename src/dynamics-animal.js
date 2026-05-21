// dynamics-animal.js — reservoir demography, animal SIR, and spillover.
//
// This module owns Step 10 of the tick order. It mutates the next-state
// buffers supplied by dynamics.js and returns transition counters; the main
// tick orchestrator keeps the global step order visible.

import { Animal, Compartment } from './config.js';
import { bloomHas, EMPTY_STRAIN } from './strains.js';

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
    if (!animal) return ZERO_COUNTS;

    const {
        active,
        activeCount,
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
        params,
        rng,
        useStrains,
        strainRegistry,
        maxActive,
        uint16Max,
        xImm
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

    // 10a — Aging.
    for (let ak = 0; ak < activeCount; ak++) {
        const i = active ? active[ak] : ak;
        if (animal[i] === Animal.VOID) {
            nextAnimalAge[i] = 0;
        } else {
            const aa = animal_age ? animal_age[i] : 0;
            nextAnimalAge[i] = aa < uint16Max ? aa + 1 : uint16Max;
        }
    }

    // 10b — Births.
    if (aBirthRate > 0 && aBirthThresh > 0) {
        for (let ak = 0; ak < activeCount; ak++) {
            const i = active ? active[ak] : ak;
            if (animal[i] !== Animal.VOID) continue;
            const nbase = i * 6;
            let count = 0;
            for (let d = 0; d < 6; d++) {
                const ni = nbrIdx[nbase + d];
                if (ni < 0) continue;
                const na = animal[ni];
                if (na !== Animal.VOID && na !== Animal.D) count++;
            }
            if (count >= aBirthThresh) {
                const pBirth = 1 - Math.pow(1 - aBirthRate, count);
                if (rng() < pBirth) {
                    nextAnimal[i] = Animal.S;
                    nextAnimalAge[i] = 0;
                    nextAnimalStrain[i] = EMPTY_STRAIN;
                    animalBirths++;
                }
            }
        }
    }

    // 10c — SIR transitions + bidirectional spillover.
    for (let ak = 0; ak < activeCount; ak++) {
        const i = active ? active[ak] : ak;
        const a = animal[i];
        if (a === Animal.VOID) continue;

        if (a === Animal.S) {
            let infected = false;
            if (revSpillP > 0 && compartment[i] === Compartment.I) {
                let humanSid = 0;
                let hasStrain = true;
                if (useStrains && strain_ids) {
                    humanSid = strain_ids[i * maxActive];
                    hasStrain = humanSid !== EMPTY_STRAIN;
                }
                if (hasStrain && rng() < revSpillP) {
                    nextAnimal[i] = Animal.I;
                    nextAnimalStrain[i] = humanSid;
                    reverseSpillovers++;
                    animalSToI++;
                    infected = true;
                }
            }
            if (!infected) {
                const nbase = i * 6;
                let pNot = 1;
                let kInf = 0;
                let chosenSid = EMPTY_STRAIN;
                for (let d = 0; d < 6; d++) {
                    const ni = nbrIdx[nbase + d];
                    if (ni < 0) continue;
                    if (animal[ni] !== Animal.I) continue;
                    const nsid = animal_strain ? animal_strain[ni] : EMPTY_STRAIN;
                    const nb = animalBetaOf(nsid);
                    if (nb <= 0) continue;
                    pNot *= (1 - nb);
                    kInf++;
                    if (rng() * kInf < 1) chosenSid = nsid;
                }
                if (kInf > 0 && rng() < (1 - pNot)) {
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
                let blocked = false;
                if (useStrains && xImm > 0 && strain_hist
                    && bloomHas(strain_hist, i, spillSid)) {
                    blocked = true;
                }
                if (!blocked && rng() < spillP) {
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
                nextAnimalAge[i] = 0;
                nextAnimalStrain[i] = EMPTY_STRAIN;
                animalDisposed++;
            }
        }
    }

    // 10d — Age-driven natural mortality.
    if (aMortBase > 0 || aMortDelta > 0) {
        for (let ak = 0; ak < activeCount; ak++) {
            const i = active ? active[ak] : ak;
            const a = animal[i];
            if (a !== Animal.S && a !== Animal.I && a !== Animal.R) continue;
            const aa = animal_age ? animal_age[i] : 0;
            const aNorm = aa < aSafeMaxAge ? aa / aSafeMaxAge : 1;
            const pDie = aMortBase + aMortDelta * aNorm;
            if (pDie > 0 && rng() < pDie) {
                if (nextAnimal[i] !== Animal.D && nextAnimal[i] !== Animal.VOID) {
                    nextAnimal[i] = Animal.D;
                    nextAnimalStrain[i] = EMPTY_STRAIN;
                    animalAgeOut++;
                }
            }
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
