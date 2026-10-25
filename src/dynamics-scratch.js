// dynamics-scratch.js — reusable next-state buffers for one tick.
//
// The integrator double-buffers the fields a cell reads off its neighbours
// (compartment, flags, status, strain slots, the animal and its strain):
// dynamics.js reads the grid's start-of-tick arrays, writes into these scratch
// arrays, swaps them onto the grid, then recycles the old start arrays as the
// next scratch set. Fields only a cell's own update reads (age, health, immune
// memory, the animal's age) are updated in place, after their last read.
//
// `near` and `contact` are per-cell stamps: a cell whose `near` equals the
// tick's `stamp` has a transmitting neighbour this tick, one whose `contact`
// does is a case or a case's neighbour (contact tracing). Stamping avoids
// clearing them. The lists hold cell indices the tick collects as it goes
// (I cells, AUTO_Q cells, contacts); `animalNb` counts living animal
// neighbours for reservoir births, and `nearAnimal` stamps the neighbours of
// infectious animals.

let _comp = null, _flags = null, _status = null;
let _ids = null, _loads = null;
let _animal = null, _animalStrain = null;
let _near = null, _contact = null, _stamp = 0;
let _iList = null, _autoQList = null, _contactList = null, _animalNb = null, _nearAnimal = null;

export function ensureTickScratch(N, maxActive) {
    if (_comp === null || _comp.length !== N) {
        _comp = new Uint8Array(N);
        _flags = new Uint8Array(N);
        _status = new Uint8Array(N);
        _animal = new Uint8Array(N);
        _animalStrain = new Uint16Array(N);
        _near = new Uint32Array(N);
        _contact = new Uint32Array(N);
        _iList = new Int32Array(N);
        _autoQList = new Int32Array(N);
        _contactList = new Int32Array(N);
        _animalNb = new Uint8Array(N);
        _nearAnimal = new Uint32Array(N);
        _stamp = 0;
    }
    const idsLen = N * maxActive;
    if (_ids === null || _ids.length !== idsLen) {
        _ids = new Uint16Array(idsLen);
        _loads = new Float32Array(idsLen);
    }
    if (++_stamp === 0xFFFFFFFF) { _near.fill(0); _contact.fill(0); _nearAnimal.fill(0); _stamp = 1; }
    return {
        compartment: _comp, flags: _flags, status: _status,
        strainIds: _ids, strainLoads: _loads,
        animal: _animal, animalStrain: _animalStrain,
        near: _near, contact: _contact, stamp: _stamp,
        iList: _iList, autoQList: _autoQList, contactList: _contactList,
        animalNb: _animalNb, nearAnimal: _nearAnimal
    };
}

export function recycleTickScratch(arrays) {
    _comp = arrays.compartment;
    _flags = arrays.flags;
    _status = arrays.status;
    if (arrays.strainIds) _ids = arrays.strainIds;
    if (arrays.strainLoads) _loads = arrays.strainLoads;
    if (arrays.animal) _animal = arrays.animal;
    if (arrays.animalStrain) _animalStrain = arrays.animalStrain;
}
