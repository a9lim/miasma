// initialization.js — grid masking, then a fresh population: people and
// animals at their steady-state ages, and the reservoir's seeding.

import { Animal, Compartment } from './config.js';
import { EMPTY_STRAIN } from './strains.js';
import { DEFAULT_PARAMS } from './default-params.js';

export function initializeGrid(grid) {
    applyHexMask(grid);

    const { compartment, mask, age, health, strain_ids, strain_loads, mem_n } = grid;
    const N = compartment.length;
    if (strain_ids) strain_ids.fill(EMPTY_STRAIN);
    if (strain_loads) strain_loads.fill(0);
    if (mem_n) mem_n.fill(0);
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

/**
 * The steady-state age of a population whose daily chance of natural death at
 * age a is h(a) = base + (max − base)·min(1, a / oldAge), as the tick rolls it,
 * with births replacing the dead: the share alive at age a is the chance of
 * surviving to it, ∏ (1 − h(k)) over k < a. Returns a sampler u ↦ age (the
 * inverse of that distribution's CDF, u uniform in [0, 1)), or null when
 * nothing dies, which has no steady state; such a world starts at age 0.
 */
export function steadyAge(base, max, oldAge) {
    const span = oldAge > 0 ? oldAge : 1, delta = max - base;
    if (!(Math.max(base, max) > 0)) return null;
    // up to where survival is negligible, or the age counter's cap
    const cdf = [];
    let S = 1, sum = 0;
    for (let a = 0; a < 0xFFFF && S > 1e-7; a++) {
        sum += S;
        cdf.push(sum);
        S *= 1 - Math.min(1, Math.max(0, base + delta * Math.min(1, a / span)));
    }
    const C = Float64Array.from(cdf), total = sum;
    return (u) => {
        const x = u * total;
        let lo = 0, hi = C.length - 1;
        while (lo < hi) { const m = (lo + hi) >> 1; if (C[m] > x) hi = m; else lo = m + 1; }
        return lo;
    };
}

/**
 * A fresh world's people and animals: every person takes an age from the
 * human steady state, then the reservoir is seeded at `animal_density`, a
 * fraction `animal_seed` of it infected, each animal at an age from its own
 * steady state. One draw per age, none where nothing dies.
 */
export function seedPopulation(grid, params, rng) {
    const p = params || DEFAULT_PARAMS;
    const r = rng || Math.random;
    const humanAge = steadyAge(p.mortality_baseline, p.mortality_age_max, p.mortality_max_age);
    if (humanAge) {
        const act = grid.activeIndices, comp = grid.compartment, age = grid.age;
        for (let k = 0; k < act.length; k++) {
            const i = act[k], c = comp[i];
            if (c !== Compartment.EMPTY && c !== Compartment.D) age[i] = humanAge(r());
        }
    }
    seedAnimals(grid, p, r);
}

function seedAnimals(grid, p, r) {
    const { animal, animal_age, animal_strain, mask } = grid;
    if (!animal) return;
    const density = typeof p.animal_density === 'number'
        ? (p.animal_density < 0 ? 0 : (p.animal_density > 1 ? 1 : p.animal_density))
        : 0;
    const animalAge = steadyAge(Math.max(0, p.animal_mortality_baseline), Math.max(0, p.animal_mortality_age_max), p.animal_max_age);
    const seed = p.animal_seed > 0 ? Math.min(1, p.animal_seed) : 0;
    const N = animal.length;
    for (let i = 0; i < N; i++) {
        if (animal_age) animal_age[i] = 0;
        if (animal_strain) animal_strain[i] = EMPTY_STRAIN;
        if (mask && mask[i] === 0) {
            animal[i] = Animal.VOID;
            continue;
        }
        if (r() < density) {
            // A fraction `animal_seed` starts infected with α: a reservoir
            // the disease already lives in.
            if (seed > 0 && r() < seed) {
                animal[i] = Animal.I;
                if (animal_strain) animal_strain[i] = 0;
            } else animal[i] = Animal.S;
            if (animal_age && animalAge) animal_age[i] = animalAge(r());
        } else {
            animal[i] = Animal.VOID;
        }
    }
}
