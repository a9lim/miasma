// strain-extinction.js — tombstone registry strains no cells still carry.

import { DEFAULTS } from './config.js';
import { EMPTY_STRAIN, markExtinct, strainCount, unmarkExtinct } from './strains.js';

export const EXTINCTION_SWEEP_INTERVAL = 30;

let aliveBitsScratch = new Uint8Array(0);

export function runExtinctionSweep(grid, strainRegistry, tickIdx) {
    if (!strainRegistry || (tickIdx % EXTINCTION_SWEEP_INTERVAL) !== 0) return;
    const sCount = strainCount(strainRegistry);
    if (sCount <= 0) return;

    if (aliveBitsScratch.length < sCount) {
        aliveBitsScratch = new Uint8Array(sCount);
    } else {
        aliveBitsScratch.fill(0, 0, sCount);
    }
    const aliveBits = aliveBitsScratch;
    const activeIds = grid.strain_ids;
    if (activeIds) {
        const total = grid.W * grid.H * DEFAULTS.maxActiveStrains;
        for (let k = 0; k < total; k++) {
            const sid = activeIds[k];
            if (sid !== EMPTY_STRAIN && sid < sCount) {
                aliveBits[sid] = 1;
            }
        }
    }

    for (let id = 1; id < sCount; id++) {
        const alive = aliveBits[id] === 1;
        const tombstoned = !!strainRegistry.extinct[id];
        if (!alive && !tombstoned) {
            markExtinct(strainRegistry, id, tickIdx);
        } else if (alive && tombstoned) {
            unmarkExtinct(strainRegistry, id);
        }
    }
}
