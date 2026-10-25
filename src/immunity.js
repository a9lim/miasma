// immunity.js — antigenic distance and per-cell immune memory.
//
// Every strain sits at a point (ag_x, ag_y) on a square torus ANTIGENIC_SIZE
// antigenic units around; distance is measured the shortest way, so drift
// never runs off the map and can come back to old antigens. Each cell
// remembers up to MEMORY_SLOTS antigens it has met (by infection or by
// vaccine), oldest first. Its susceptibility to a strain is
//
//   σ = 1 − max_k c_k · exp(−d_k)
//
// where d_k is the distance from the strain to memory k and c_k is the
// protection that kind of memory gives against an identical antigen
// (`immunity_strength` for infection, `vax_efficacy` for a vaccine). An empty
// memory gives σ = 1.

import { ANTIGENIC_SIZE, MEMORY_SLOTS, MemoryKind } from './config.js';

const S = ANTIGENIC_SIZE;
const K = MEMORY_SLOTS;
// A new antigen this close to a remembered one of the same kind refreshes it
// instead of taking a slot.
const MERGE_AU = 0.1;

/** Wrap a coordinate onto [0, ANTIGENIC_SIZE). */
export function agWrap(x) {
    const w = x - S * Math.floor(x / S);
    return w >= S ? 0 : w;
}

/** Signed shortest difference b − a along one axis, in (−S/2, S/2]. */
export function agDelta(a, b) {
    const d = b - a;
    return d - S * Math.round(d / S);
}

/** Shortest distance between two antigens. */
export function agDist(ax, ay, bx, by) {
    const dx = agDelta(ax, bx), dy = agDelta(ay, by);
    return Math.sqrt(dx * dx + dy * dy);
}

/** Midpoint of a and b along the shorter arc of one axis. */
export function agMid(a, b) {
    return agWrap(a + agDelta(a, b) / 2);
}

/**
 * Susceptibility of cell i to an antigen at (ax, ay). `mem` carries the
 * grid's memory arrays { x, y, kind, n }; cInf and cVax are the protections
 * an infection and a vaccine give against their own antigen.
 */
export function susceptibility(mem, i, ax, ay, cInf, cVax) {
    const n = mem.n[i];
    if (n === 0) return 1;
    const base = i * K;
    let protect = 0;
    for (let k = 0; k < n; k++) {
        const c = mem.kind[base + k] === MemoryKind.VACCINE ? cVax : cInf;
        if (c <= protect) continue;
        const p = c * Math.exp(-agDist(ax, ay, mem.x[base + k], mem.y[base + k]));
        if (p > protect) protect = p;
    }
    return 1 - protect;
}

/** Remember an antigen in cell i: merge with a near one of the same kind, else append, dropping the oldest when full. */
export function remember(mem, i, ax, ay, kind) {
    const base = i * K;
    const n = mem.n[i];
    for (let k = 0; k < n; k++) {
        if (mem.kind[base + k] === kind && agDist(ax, ay, mem.x[base + k], mem.y[base + k]) < MERGE_AU) return;
    }
    let slot = n;
    if (n === K) {
        for (let k = 1; k < K; k++) {
            mem.x[base + k - 1] = mem.x[base + k];
            mem.y[base + k - 1] = mem.y[base + k];
            mem.kind[base + k - 1] = mem.kind[base + k];
        }
        slot = K - 1;
    } else {
        mem.n[i] = n + 1;
    }
    mem.x[base + slot] = ax;
    mem.y[base + slot] = ay;
    mem.kind[base + slot] = kind;
}

/** Forget everything cell i remembered (a newborn, a new occupant). */
export function forget(mem, i) {
    mem.n[i] = 0;
}

/** The grid's memory arrays as one handle. */
export function memoryOf(grid) {
    return { x: grid.mem_x, y: grid.mem_y, kind: grid.mem_kind, n: grid.mem_n };
}
