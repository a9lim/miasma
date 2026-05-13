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
        // VOID = 0 means no animal in this cell. dynamics.initializeAnimals()
        // seeds S animals at density. mask=0 cells must remain VOID.
        this.animal = new Uint8Array(N);
        this.animal.fill(Animal.VOID);
        // Shape mask: 1 = inside the simulated world, 0 = outside (void).
        // Default to all-inside; dynamics.applyHexMask() carves a regular
        // hexagon out of the axial-coord rhombus storage. mask=0 cells are
        // skipped by render / stats / births / clicks so the visible world
        // looks like a hexagon instead of a rhombus.
        this.mask = new Uint8Array(N);
        this.mask.fill(1);

        // Strain state — stubs for Phase 7. Slot count fixed by config.
        const slots = DEFAULTS.maxActiveStrains;
        this.strain_ids   = new Uint16Array(N * slots);
        this.strain_loads = new Float32Array(N * slots);
        this.strain_hist  = new Uint8Array(N * 8); // 64-bit packed bloom (Phase 7)
        const vaxSlots = DEFAULTS.maxVax;
        this.vax_strains  = new Uint16Array(N * vaxSlots);
        this.vax_ages     = new Uint16Array(N * vaxSlots);

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

    /** Iterate every cell. `fn(q, r, i)`. */
    forEach(fn) {
        for (let r = 0; r < this.H; r++) {
            for (let q = 0; q < this.W; q++) {
                fn(q, r, r * this.W + q);
            }
        }
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

/** Six vertex offsets for flat-top hex of given size. */
export function hexCorners(cx, cy, size) {
    const out = [];
    for (let i = 0; i < 6; i++) {
        // Flat-top: start at -30°, step by 60°.
        const angle = Math.PI / 180 * (60 * i - 30);
        out.push({
            x: cx + size * Math.cos(angle),
            y: cy + size * Math.sin(angle)
        });
    }
    return out;
}
