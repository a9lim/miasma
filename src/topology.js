// topology.js — hex-quotient topology for 6 manifolds.
//
// Miasma's simulated world is the *inscribed regular hexagon* carved out
// of the W×H axial-coord rhombus by `applyHexMask` (center (cq, cr),
// radius R = min(cq, cr, W-1-cq, H-1-cr)). The cells outside the hex
// (mask=0) are inert. Topology identifications happen at the SIX HEX
// EDGES of this inscribed hexagon — not at the four rhombus edges —
// because that's where the simulated world's boundary actually is.
//
// Phase 10 ships PLANE and TORUS as proper hex-quotients. The four
// non-orientable / partial-quotient variants (CYLINDER, MÖBIUS, KLEIN,
// RP²) fall back to TORUS as placeholders pending Phase 14, where the
// hex-edge twist-design questions get their own pass.
//
// Hex tessellation lattice (centered at the inscribed-hex center):
//   T1 = (2R+1, -R)   — one of three 60°-separated lattice generators
//   T2 = ( R,  R+1)   — R60(T1)
//   T3 = (-(R+1), 2R+1) — R60(T2); equals -(T1+T2) up to symmetry
// These generate the sub-lattice of axial coords with index
// 1 + 3R(R+1) = the cell count of one hex tile. Translating by any
// (a*T1 + b*T2) maps the inscribed hex to an adjacent hex tile in the
// hex tessellation of the plane.
//
// For TORUS: a cell outside the inscribed hex is identified with its
// (unique) representative inside the hex, found by subtracting some
// (a*T1 + b*T2). For neighbor lookups across the hex boundary we only
// need (a, b) ∈ {-1, 0, 1}² — 9 candidates — since the offset is at
// most one cell.

import { Topology, HEX_DIRS } from './config.js';

/** Always-positive modulo. */
function mod(a, n) {
    return ((a % n) + n) % n;
}

/** Cube-coord distance from (dq, dr) to origin. */
function cubeDist(dq, dr) {
    const ds = -dq - dr;
    const adq = dq < 0 ? -dq : dq;
    const adr = dr < 0 ? -dr : dr;
    const ads = ds < 0 ? -ds : ds;
    return adq > adr ? (adq > ads ? adq : ads) : (adr > ads ? adr : ads);
}

/** Inscribed-hex geometry for a W×H axial rhombus. Mirrors applyHexMask. */
export function hexBounds(W, H) {
    const cq = Math.floor(W / 2);
    const cr = Math.floor(H / 2);
    const R  = Math.min(cq, cr, W - 1 - cq, H - 1 - cr);
    return { cq, cr, R };
}

/** True iff (q, r) is inside the inscribed hexagon. */
export function inHex(q, r, W, H) {
    const { cq, cr, R } = hexBounds(W, H);
    return cubeDist(q - cq, r - cr) <= R;
}

/**
 * Translate (q, r) by the hex-tessellation lattice vector that lands
 * inside the inscribed hex centered at (cq, cr) with radius R. Returns
 * { q, r } or null if no candidate within ±1 of (T1, T2) works (should
 * not happen for cells within 1 step of the hex boundary).
 */
function translateToHex(q, r, cq, cr, R) {
    const t1q = 2 * R + 1, t1r = -R;
    const t2q = R,         t2r = R + 1;
    let bestQ = q, bestR = r;
    let bestDist = cubeDist(q - cq, r - cr);
    if (bestDist <= R) return { q: bestQ, r: bestR };
    // Try a, b ∈ {-1, 0, 1} — 9 candidates. Picks the lattice translate
    // landing inside (or closest to inside, as a safety fallback).
    for (let a = -1; a <= 1; a++) {
        for (let b = -1; b <= 1; b++) {
            if (a === 0 && b === 0) continue;
            const qp = q - a * t1q - b * t2q;
            const rp = r - a * t1r - b * t2r;
            const d  = cubeDist(qp - cq, rp - cr);
            if (d < bestDist) {
                bestDist = d;
                bestQ = qp;
                bestR = rp;
                if (d <= R) return { q: bestQ, r: bestR };
            }
        }
    }
    return bestDist <= R ? { q: bestQ, r: bestR } : null;
}

// ─── Phase 14: non-orientable hex-quotients ───────────────────────────────
//
// The inscribed hex has 3 pairs of opposite edges. Each pair admits an
// identification (translation, reflection, antipodal). We pick a canonical
// "Pair 1" (the dq=±R faces, E-NE ↔ W-SW edges) for the partial quotients
// because lattice T1 = (2R+1, -R) translates that pair directly. The full
// quotients (KLEIN, TORUS) tile all three pairs.
//
// Helpers below take a cell that's outside the hex and return either a
// {q, r} inside the hex (per the topology's identification rule) or null
// when no rule applies.
//
// **CYLINDER**: identify Pair 1 by parallel translation (subtract T1 or
//   add T1). Other faces stay PLANE.
//
// **RP²**: every outside cell maps to its central antipode (2*(c) - p),
//   which lands either inside the hex or further outside on the opposite
//   face — chain through translateToHex if needed.
//
// **MÖBIUS**: identify Pair 1 by reflection ("twist"). The reflection
//   reverses the parameter along the edge: (cq + R + 1, cr + dr_out) →
//   (cq - R, cr - 1 - dr_out). The other two pairs stay PLANE.
//
// **KLEIN**: Pair 1 reflects (möbius twist), Pair 2 (dr=±R faces, NE-NW
//   ↔ SW-SE edges) translates by ±T2. Pair 3 stays PLANE.
//
// At hex corners multiple identifications meet. For partial quotients we
// enumerate candidate edges and pick the one whose target lands inside;
// otherwise return null. For RP², the antipode + lattice composition
// always lands inside for cells within 1 step of the boundary.

/** Which inscribed-hex edge is (q, r) "just past"? Returns 0–5 or -1 if
 * the cell isn't on any single-edge boundary. Edge indexing follows the
 * cube-axis saturating direction:
 *   0: dq = +(R+1)  (E-NE edge)
 *   1: dq = -(R+1)  (W-SW edge)
 *   2: dr = +(R+1)  (SW-SE edge)
 *   3: dr = -(R+1)  (NE-NW edge)
 *   4: ds = +(R+1)  (NW-W edge)   ds = -dq - dr
 *   5: ds = -(R+1)  (SE-E edge)
 */
function outsideEdge(dq, dr) {
    const ds = -dq - dr;
    // For 1-step-outside cells, exactly one of dq, dr, ds is ±(R+1).
    // Use absolute-max signature.
    return null; // caller doesn't need this anymore — left as a stub for
                 // future code paths that want to identify which face.
}

// Reflect (q, r) through the center of the inscribed hex. Involutive.
function antipode(q, r, cq, cr) {
    return { q: 2 * cq - q, r: 2 * cr - r };
}

// Translate by Pair 1's lattice vector: ±T1 = ±(2R+1, -R). Returns null
// if the result is not inside the hex. `dir`: +1 or -1.
function translateT1(q, r, cq, cr, R, dir) {
    const t1q = 2 * R + 1;
    const t1r = -R;
    const qp = q - dir * t1q;
    const rp = r - dir * t1r;
    if (cubeDist(qp - cq, rp - cr) <= R) return { q: qp, r: rp };
    return null;
}

// Translate by Pair 2's lattice vector: ±T2 = ±(R, R+1).
function translateT2(q, r, cq, cr, R, dir) {
    const t2q = R;
    const t2r = R + 1;
    const qp = q - dir * t2q;
    const rp = r - dir * t2r;
    if (cubeDist(qp - cq, rp - cr) <= R) return { q: qp, r: rp };
    return null;
}

// CYLINDER: identify Pair 1 by parallel translation. Returns the translated
// cell if inside the hex, else null (the other two pairs are PLANE).
function wrapCylinder(q, r, cq, cr, R) {
    // Try both directions of the Pair 1 lattice.
    let p = translateT1(q, r, cq, cr, R, +1);
    if (p) return p;
    p = translateT1(q, r, cq, cr, R, -1);
    if (p) return p;
    return null;
}

// MÖBIUS: identify Pair 1 by reflective translation. The cube-coord
// "twist" reverses the perpendicular component along the edge.
// Concretely: a cell at (cq + R + 1, cr + dr_out) on the +dq face maps
// to (cq - R, cr - 1 - dr_out) on the -dq face. The pair of "translate
// then flip" steps is involutive.
//
// We approach it by: translate by ±T1 to bring the cell adjacent to the
// hex, then flip the perpendicular cube coord across the central axis.
function wrapMobius(q, r, cq, cr, R) {
    // Try both +T1 and -T1 directions. After translation, the cell sits
    // adjacent to the opposite face; the reflective twist flips its
    // along-edge coordinate.
    for (const dir of [+1, -1]) {
        const t1q = 2 * R + 1, t1r = -R;
        const qp = q - dir * t1q;
        const rp = r - dir * t1r;
        // The along-edge coordinate is dr_out (the r-offset from center).
        // Reflect it about the central axis: dr_in = -dr_out.
        const dq2 = qp - cq;
        const dr2 = rp - cr;
        // Twist: flip the r-perpendicular component while keeping dq.
        // This is the reflection that the hex-axial möbius identification
        // uses (vertical flip in axial coords).
        const tq = cq + dq2;
        const tr = cr - dr2 - dq2; // ensures cube q+r+s=0 holds after twist
        if (cubeDist(tq - cq, tr - cr) <= R) return { q: tq, r: tr };
    }
    return null;
}

// KLEIN: Pair 1 twist (Möbius), Pair 2 translates, Pair 3 stays PLANE.
// Try Möbius first, then T2 translation; return null if neither applies.
function wrapKlein(q, r, cq, cr, R) {
    const m = wrapMobius(q, r, cq, cr, R);
    if (m) return m;
    let p = translateT2(q, r, cq, cr, R, +1);
    if (p) return p;
    p = translateT2(q, r, cq, cr, R, -1);
    if (p) return p;
    return null;
}

// RP²: every boundary cell maps to its central antipode. If the antipode
// is still outside (mirror situation across the opposite face) chain
// through translateToHex to land inside.
function wrapRP2(q, r, cq, cr, R) {
    const a = antipode(q, r, cq, cr);
    if (cubeDist(a.q - cq, a.r - cr) <= R) return a;
    // Antipode landed on the opposite-face boundary cell. Try lattice
    // translations to bring it inside. Antipode + translation = the
    // antipodal identification on the boundary.
    return translateToHex(a.q, a.r, cq, cr, R);
}

/**
 * Wrap (q, r) according to topology. Returns {q, r} or null if the
 * point is outside the simulated world (the inscribed hexagon) under
 * a topology that doesn't identify it back inside.
 *
 * Phase 14 ships proper hex-quotients for CYLINDER, MÖBIUS, KLEIN, and
 * RP². The möbius reflection is the axial-coord vertical flip; klein
 * combines that with a Pair-2 translation; RP² is antipodal.
 */
export function wrap(q, r, topology, W, H) {
    const { cq, cr, R } = hexBounds(W, H);
    // Inside the inscribed hex → no identification needed regardless
    // of topology.
    if (cubeDist(q - cq, r - cr) <= R) return { q, r };

    switch (topology) {
        case Topology.PLANE:    return null;
        case Topology.TORUS:    return translateToHex(q, r, cq, cr, R);
        case Topology.CYLINDER: return wrapCylinder(q, r, cq, cr, R);
        case Topology.MOBIUS:   return wrapMobius(q, r, cq, cr, R);
        case Topology.KLEIN:    return wrapKlein(q, r, cq, cr, R);
        case Topology.RP2:      return wrapRP2(q, r, cq, cr, R);
        default:                return translateToHex(q, r, cq, cr, R);
    }
}

/** Up to 6 valid hex neighbors of (q, r) under the given topology. */
export function neighbors(q, r, topology, W, H) {
    const out = [];
    for (let i = 0; i < HEX_DIRS.length; i++) {
        const d = HEX_DIRS[i];
        const w = wrap(q + d.dq, r + d.dr, topology, W, H);
        if (w !== null) out.push(w);
    }
    return out;
}

// Re-export mod in case any consumer used the old internal helper.
export { mod };
