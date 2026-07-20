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
