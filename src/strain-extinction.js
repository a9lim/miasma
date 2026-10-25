// strain-extinction.js — tombstone strains nothing carries; reclaim dead branches.
//
// Every EXTINCTION_SWEEP_INTERVAL ticks: a strain absent from every human
// strain slot (memory slot 0 included) and every animal is tombstoned, and a
// tombstoned strain that reappears is restored. Then a tombstoned strain that
// no living strain descends from (through either parent) is reclaimed, so its
// id can be reused; cells remember antigens, not ids, so nothing else points
// at it, and the phylogeny draws only living strains and their ancestors.
// A dead ancestor with a single descendant line is spliced out of `parent`
// (its child takes its parent) and reclaimed too: the tree keeps its branch
// points and every birth time, and the registry holds about two slots per
// living strain however long the run.

import { DEFAULTS } from './config.js';
import { EMPTY_STRAIN, markExtinct, reclaimStrain, strainCount, unmarkExtinct } from './strains.js';

export const EXTINCTION_SWEEP_INTERVAL = 30;

let aliveBitsScratch = new Uint8Array(0);
let neededScratch = new Uint8Array(0);
let kidsScratch = new Uint16Array(0);
let p2Scratch = new Uint8Array(0);

export function runExtinctionSweep(grid, strainRegistry, tickIdx) {
    if (!strainRegistry || (tickIdx % EXTINCTION_SWEEP_INTERVAL) !== 0) return;
    const reg = strainRegistry;
    const sCount = strainCount(reg);
    if (sCount <= 0) return;

    if (aliveBitsScratch.length < sCount) {
        aliveBitsScratch = new Uint8Array(sCount);
        neededScratch = new Uint8Array(sCount);
        kidsScratch = new Uint16Array(sCount);
        p2Scratch = new Uint8Array(sCount);
    } else {
        aliveBitsScratch.fill(0, 0, sCount);
        neededScratch.fill(0, 0, sCount);
        kidsScratch.fill(0, 0, sCount);
        p2Scratch.fill(0, 0, sCount);
    }
    const aliveBits = aliveBitsScratch;
    const activeIds = grid.strain_ids;
    if (activeIds) {
        const total = grid.W * grid.H * DEFAULTS.maxActiveStrains;
        for (let k = 0; k < total; k++) {
            const sid = activeIds[k];
            if (sid !== EMPTY_STRAIN && sid < sCount) aliveBits[sid] = 1;
        }
    }
    const animalIds = grid.animal_strain;
    if (animalIds) {
        for (let k = 0; k < animalIds.length; k++) {
            const sid = animalIds[k];
            if (sid !== EMPTY_STRAIN && sid < sCount) aliveBits[sid] = 1;
        }
    }

    for (let id = 1; id < sCount; id++) {
        if (reg.freed[id]) continue;
        const alive = aliveBits[id] === 1;
        const tombstoned = !!reg.extinct[id];
        if (!alive && !tombstoned) {
            markExtinct(reg, id, tickIdx);
        } else if (alive && tombstoned) {
            unmarkExtinct(reg, id);
        }
    }

    // Mark every living strain's ancestry, through both parents; the rest of
    // the tombstoned strains are a dead branch.
    const needed = neededScratch;
    const stack = [];
    for (let id = 0; id < sCount; id++) {
        if (!reg.freed[id] && !reg.extinct[id]) stack.push(id);
    }
    while (stack.length) {
        const id = stack.pop();
        if (needed[id]) continue;
        needed[id] = 1;
        const p = reg.parent[id], p2 = reg.parents2[id];
        if (p !== null && p >= 0 && p < sCount && !needed[p]) stack.push(p);
        if (p2 !== null && p2 >= 0 && p2 < sCount && !needed[p2]) stack.push(p2);
    }
    // Splice: walk up from each kept strain past dead ancestors that have no
    // other kept child and are nobody's second parent.
    const kids = kidsScratch, p2 = p2Scratch;
    for (let id = 0; id < sCount; id++) {
        if (!needed[id]) continue;
        const p = reg.parent[id], q = reg.parents2[id];
        if (p !== null && p >= 0 && p < sCount) kids[p]++;
        if (q !== null && q >= 0 && q < sCount) p2[q] = 1;
    }
    for (let id = 0; id < sCount; id++) {
        if (!needed[id]) continue;
        let p = reg.parent[id];
        while (p !== null && p > 0 && needed[p] && reg.extinct[p] && kids[p] === 1 && !p2[p]) {
            needed[p] = 0;
            p = reg.parent[p];
            reg.parent[id] = p;
        }
    }
    for (let id = 1; id < sCount; id++) {
        if (!needed[id] && !reg.freed[id] && reg.extinct[id]) reclaimStrain(reg, id);
    }
}
