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
    let a = s | 0;
    return function mulberry32() {
        a = (a + 0x6D2B79F5) | 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
