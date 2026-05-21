// grid.js — hex axial-coord grid with SoA typed-array cell storage.
// Phase 1: all cells initialized to compartment S. Strain state arrays
// are stubbed (zero-filled) — populated in Phase 7+.

import { Animal, Compartment, Status, Flag, DEFAULTS, SQRT3 } from './config.js';

export class Grid {
    /** @param {number} W @param {number} H */
    constructor(W = DEFAULTS.W, H = DEFAULTS.H) {
        this.W = W;
        this.H = H;
        const N = W * H;

        // Per-cell state — Structure-of-Arrays for cache locality.
        this.compartment = new Uint8Array(N);
        this.status      = new Uint8Array(N);
        this.flags       = new Uint8Array(N);
        this.age         = new Uint16Array(N);
        this.health      = new Float32Array(N);
        // Phase 9: per-cell animal state (vector/reservoir layer). Orthogonal
        // to the human compartment — same indexing, independent dynamics.
        // VOID = 0 means no animal in this cell. initialization.initializeAnimals()
        // seeds S animals at density. mask=0 cells must remain VOID.
        this.animal = new Uint8Array(N);
        this.animal.fill(Animal.VOID);
        // Phase 17: animal demography. animal_age mirrors the human `age`
        // layer (ticks since birth, drives age-ramped natural mortality);
        // animal_strain records which strain an infectious animal carries so
        // per-strain animal_beta/gamma/mu can be read from the registry.
        // animal_strain is 0xFFFF (EMPTY_STRAIN) when the animal carries no
        // strain — VOID/S/R/D cells. Set on S→I, kept while infectious.
        this.animal_age    = new Uint16Array(N);
        this.animal_strain = new Uint16Array(N);
        this.animal_strain.fill(0xFFFF);
        // Shape mask: 1 = inside the simulated world, 0 = outside (void).
        // Default to all-inside; initialization.applyHexMask() carves a regular
        // hexagon out of the axial-coord rhombus storage. mask=0 cells are
        // skipped by render / stats / births / clicks so the visible world
        // looks like a hexagon instead of a rhombus.
        this.mask = new Uint8Array(N);
        this.mask.fill(1);
        this.activeIndices = null;
        this.activeCount = N;

        // Strain state — stubs for Phase 7. Slot count fixed by config.
        const slots = DEFAULTS.maxActiveStrains;
        this.strain_ids   = new Uint16Array(N * slots);
        this.strain_loads = new Float32Array(N * slots);
        this.strain_hist  = new Uint8Array(N * 8); // 64-bit packed bloom (Phase 7)
        // Initialize all cells to S (Uint8Array already zero-filled, S === 0,
        // but be explicit for future-proofing).
        this.compartment.fill(Compartment.S);
        this.status.fill(Status.NONE);
        this.flags.fill(Flag.NONE);
        // strain_ids: 0xFFFF marks empty slot.
        this.strain_ids.fill(0xFFFF);
    }

    /** Linear array index for (q, r). No bounds check — callers must validate. */
    idx(q, r) {
        return r * this.W + q;
    }

    /** Read cell view as plain object. */
    cellAt(q, r) {
        const i = this.idx(q, r);
        return {
            q, r,
            compartment: this.compartment[i],
            status:      this.status[i],
            flags:       this.flags[i],
            age:         this.age[i],
            health:      this.health[i]
        };
    }

    /**
     * Mutate cell fields. `value` is a partial object of any of the
     * tracked fields (compartment, status, flags, age, health).
     */
    setCell(q, r, value) {
        const i = this.idx(q, r);
        if (value.compartment !== undefined) this.compartment[i] = value.compartment;
        if (value.status      !== undefined) this.status[i]      = value.status;
        if (value.flags       !== undefined) this.flags[i]       = value.flags;
        if (value.age         !== undefined) this.age[i]         = value.age;
        if (value.health      !== undefined) this.health[i]      = value.health;
    }
}

// ─── Axial-coordinate helpers (flat-top hex) ───
// Mirrors gerry/src/hex-math.js but parameterized by hexSize (so render.js
// can scale without changing config constants).

/** Axial (q, r) → pixel center for flat-top hexes. */
export function hexToPixel(q, r, size) {
    const w = SQRT3 * size;
    const h = 1.5 * size;
    return { x: w * (q + r / 2), y: h * r };
}

/** Pixel (x, y) → fractional axial coords (flat-top). */
export function pixelToAxialFractional(x, y, size) {
    const r = y / (1.5 * size);
    const q = x / (SQRT3 * size) - r / 2;
    return { q, r };
}

/** Round fractional cube coords to nearest integer cube coords. */
export function cubeRound(x, y, z) {
    let rx = Math.round(x);
    let ry = Math.round(y);
    let rz = Math.round(z);
    const dx = Math.abs(rx - x);
    const dy = Math.abs(ry - y);
    const dz = Math.abs(rz - z);
    if (dx > dy && dx > dz)      rx = -ry - rz;
    else if (dy > dz)            ry = -rx - rz;
    else                         rz = -rx - ry;
    return { x: rx, y: ry, z: rz };
}

/** Pixel (x, y) → integer axial (q, r). */
export function pixelToAxial(x, y, size) {
    const frac = pixelToAxialFractional(x, y, size);
    // Convert axial → cube, round, convert back.
    const cx = frac.q;
    const cz = frac.r;
    const cy = -cx - cz;
    const rounded = cubeRound(cx, cy, cz);
    return { q: rounded.x, r: rounded.z };
}
