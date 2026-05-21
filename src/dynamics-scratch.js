// dynamics-scratch.js — reusable next-state buffers for one tick.
//
// The integrator double-buffers typed arrays: dynamics.js reads the grid's
// start-of-tick arrays, writes into these scratch arrays, swaps them onto the
// grid, then recycles the old start arrays as the next scratch set.

let _scratch = null;
let _flagScratch = null;
let _statusScratch = null;
let _ageScratch = null;
let _healthScratch = null;
let _strainIdsScratch = null;
let _strainLoadsScratch = null;
let _strainHistScratch = null;
let _animalScratch = null;
let _animalAgeScratch = null;
let _animalStrainScratch = null;

export function ensureTickScratch(N, maxActive) {
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
    const idsLen = N * maxActive;
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
    if (_animalAgeScratch === null || _animalAgeScratch.length !== N) {
        _animalAgeScratch = new Uint16Array(N);
    }
    if (_animalStrainScratch === null || _animalStrainScratch.length !== N) {
        _animalStrainScratch = new Uint16Array(N);
    }
    return {
        compartment: _scratch,
        flags: _flagScratch,
        status: _statusScratch,
        age: _ageScratch,
        health: _healthScratch,
        strainIds: _strainIdsScratch,
        strainLoads: _strainLoadsScratch,
        strainHist: _strainHistScratch,
        animal: _animalScratch,
        animalAge: _animalAgeScratch,
        animalStrain: _animalStrainScratch
    };
}

export function recycleTickScratch(arrays) {
    _scratch = arrays.compartment;
    _flagScratch = arrays.flags;
    _statusScratch = arrays.status;
    _ageScratch = arrays.age;
    _healthScratch = arrays.health;
    if (arrays.strainIds) _strainIdsScratch = arrays.strainIds;
    if (arrays.strainLoads) _strainLoadsScratch = arrays.strainLoads;
    if (arrays.strainHist) _strainHistScratch = arrays.strainHist;
    if (arrays.animal) _animalScratch = arrays.animal;
    if (arrays.animalAge) _animalAgeScratch = arrays.animalAge;
    if (arrays.animalStrain) _animalStrainScratch = arrays.animalStrain;
}
