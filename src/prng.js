// prng.js — deterministic seed helper for reproducible runs.

export function makeRngFromLocation(locationObj) {
    const loc = locationObj || window.location;
    const params = new URLSearchParams(loc.search);
    const raw = params.get('seed');
    if (raw === null) return Math.random;

    let s = 0;
    for (let i = 0; i < raw.length; i++) {
        s = (Math.imul(s, 31) + raw.charCodeAt(i)) | 0;
    }
    // Shared mulberry32 generator (window.mulberry32 from /shared/utils.js).
    // Same seed → same sequence as the prior inline implementation.
    return mulberry32(s);
}

/**
 * Bernoulli trials by skipping: in a run of trials that each succeed with
 * chance p, the gap to the next success is geometric, so a rare roll made at
 * every cell costs one draw per success instead of one per cell. Returns the
 * position after `k` of the next success; `lq` is log(1 − p) (Math.log1p(-p)),
 * and −Infinity (p = 1) makes every position succeed.
 */
export function nextSuccess(k, lq, rng) {
    return lq === -Infinity ? k + 1 : k + 1 + Math.floor(Math.log(1 - rng()) / lq);
}
