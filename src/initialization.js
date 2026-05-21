// initialization.js — grid masking plus fresh human/animal seeding.

import { Animal, Compartment } from './config.js';
import { EMPTY_STRAIN } from './strains.js';
import { DEFAULT_PARAMS } from './default-params.js';

export function initializeGrid(grid) {
    applyHexMask(grid);

    const { compartment, mask, age, health, strain_ids, strain_loads, strain_hist } = grid;
    const N = compartment.length;
    if (strain_ids) strain_ids.fill(EMPTY_STRAIN);
    if (strain_loads) strain_loads.fill(0);
    if (strain_hist) strain_hist.fill(0);
    for (let i = 0; i < N; i++) {
        age[i] = 0;
        if (mask[i] === 0) {
            health[i] = 0;
            continue;
        }
        const c = compartment[i];
        health[i] = (c === Compartment.D || c === Compartment.EMPTY) ? 0 : 1.0;
    }
}

export function applyHexMask(grid) {
    const { W, H, mask, compartment, status, flags, age, health, animal } = grid;
    const cq = Math.floor(W / 2);
    const cr = Math.floor(H / 2);
    const R = Math.min(cq, cr, W - 1 - cq, H - 1 - cr);
    const active = new Int32Array(W * H);
    let activeCount = 0;
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
                active[activeCount++] = i;
            } else {
                mask[i] = 0;
                compartment[i] = Compartment.EMPTY;
                status[i] = 0;
                flags[i] = 0;
                age[i] = 0;
                health[i] = 0;
                if (animal) animal[i] = Animal.VOID;
            }
        }
    }
    grid.activeIndices = active.slice(0, activeCount);
    grid.activeCount = activeCount;
}

export function initializeAnimals(grid, params, rng) {
    const { animal, animal_age, animal_strain, mask } = grid;
    if (!animal) return;
    const p = params || DEFAULT_PARAMS;
    const r = rng || Math.random;
    const density = typeof p.animal_density === 'number'
        ? (p.animal_density < 0 ? 0 : (p.animal_density > 1 ? 1 : p.animal_density))
        : 0;
    const maxAge = typeof p.animal_max_age === 'number' && p.animal_max_age > 0
        ? p.animal_max_age
        : 2500;
    const N = animal.length;
    for (let i = 0; i < N; i++) {
        if (animal_age) animal_age[i] = 0;
        if (animal_strain) animal_strain[i] = EMPTY_STRAIN;
        if (mask && mask[i] === 0) {
            animal[i] = Animal.VOID;
            continue;
        }
        if (r() < density) {
            animal[i] = Animal.S;
            if (animal_age) animal_age[i] = (r() * maxAge) | 0;
        } else {
            animal[i] = Animal.VOID;
        }
    }
}
