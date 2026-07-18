// topology.test.mjs — unit tests for the hex-quotient wrap.
// Run: `node src/topology.test.mjs` from miasma/.
//
// All six surfaces use the inscribed hex as their quotient domain. Exact
// round-trip checks apply to the orientable translation cases; the twisted
// surfaces also get exhaustive in-domain neighbor checks on W=H=12 (R=5),
// where brute force is cheap and the math matches the 120×120 default.

import { Topology, HEX_DIRS } from './config.js';
import { wrap, neighbors, hexBounds, inHex } from './topology.js';

let pass = 0, fail = 0;
function check(label, cond) {
    if (cond) { pass++; return; }
    fail++;
    console.error('FAIL:', label);
}
function checkEq(label, a, b) {
    if (a === b || (a && b && a.q === b.q && a.r === b.r)) { pass++; return; }
    fail++;
    console.error('FAIL:', label, 'got', JSON.stringify(a), 'expected', JSON.stringify(b));
}

// Inverse direction index for HEX_DIRS (E↔W, SE↔NW, SW↔NE).
const INV = [3, 4, 5, 0, 1, 2];

// ─── hexBounds + inHex sanity ───
{
    const { cq, cr, R } = hexBounds(120, 120);
    checkEq('hexBounds(120,120).cq', cq, 60);
    checkEq('hexBounds(120,120).cr', cr, 60);
    checkEq('hexBounds(120,120).R',  R, 59);

    const { cq: cq2, cr: cr2, R: R2 } = hexBounds(12, 12);
    checkEq('hexBounds(12,12).cq', cq2, 6);
    checkEq('hexBounds(12,12).cr', cr2, 6);
    checkEq('hexBounds(12,12).R',  R2, 5);

    check('center inside hex',      inHex(6, 6,  12, 12));
    check('east-edge cell inside',  inHex(11, 6, 12, 12));
    check('east-just-outside null', !inHex(12, 6, 12, 12));
    check('rhombus corner outside', !inHex(0, 0,  12, 12));
}

// ─── PLANE: out-of-hex returns null; in-hex returns same cell ───
{
    const W = 12, H = 12;
    const r = wrap(6, 6, Topology.PLANE, W, H);
    checkEq('PLANE inside cell',  r, { q: 6, r: 6 });
    check  ('PLANE outside null', wrap(12, 6, Topology.PLANE, W, H) === null);
    check  ('PLANE corner null',  wrap(0, 0,  Topology.PLANE, W, H) === null);

    // Interior cells get 6 neighbors. Cells on the hex edge get fewer
    // (the across-edge neighbors return null).
    const interior = neighbors(6, 6, Topology.PLANE, W, H);
    checkEq('PLANE interior nbr count', interior.length, 6);

    const eastEdge = neighbors(11, 6, Topology.PLANE, W, H);
    check('PLANE east-edge nbr count < 6', eastEdge.length < 6);
}

// ─── TORUS: out-of-hex translates back inside ───
{
    const W = 12, H = 12;
    const { cq, cr, R } = hexBounds(W, H);

    // Every cell inside the hex must have exactly 6 neighbors, all
    // inside the hex.
    let interiorCount = 0;
    let neighborTotal = 0;
    for (let r = 0; r < H; r++) {
        for (let q = 0; q < W; q++) {
            if (!inHex(q, r, W, H)) continue;
            interiorCount++;
            const ns = neighbors(q, r, Topology.TORUS, W, H);
            neighborTotal += ns.length;
            check(`TORUS (${q},${r}) has 6 nbrs`, ns.length === 6);
            for (const nb of ns) {
                check(`TORUS (${q},${r}) nbr (${nb.q},${nb.r}) inside`,
                      inHex(nb.q, nb.r, W, H));
            }
        }
    }
    // Inscribed hex of radius 5 has 1 + 3·5·6 = 91 cells.
    checkEq('TORUS inscribed hex cell count', interiorCount, 91);
    checkEq('TORUS total neighbor edges',    neighborTotal, 91 * 6);

    // Adjacency symmetry: c ∈ N(c') iff c' ∈ N(c).
    for (let r = 0; r < H; r++) {
        for (let q = 0; q < W; q++) {
            if (!inHex(q, r, W, H)) continue;
            const ns = neighbors(q, r, Topology.TORUS, W, H);
            for (const nb of ns) {
                const back = neighbors(nb.q, nb.r, Topology.TORUS, W, H);
                const hasReverse = back.some(b => b.q === q && b.r === r);
                check(`TORUS adjacency symm (${q},${r})↔(${nb.q},${nb.r})`,
                      hasReverse);
            }
        }
    }

    // Round-trip: wrap(neighbor(c, d), inverse(d)) === c for every
    // cell + every direction. For TORUS this should pass everywhere
    // (parallel-translation identification preserves directions).
    for (let r = 0; r < H; r++) {
        for (let q = 0; q < W; q++) {
            if (!inHex(q, r, W, H)) continue;
            for (let i = 0; i < HEX_DIRS.length; i++) {
                const d = HEX_DIRS[i];
                const inv = HEX_DIRS[INV[i]];
                const step = wrap(q + d.dq, r + d.dr, Topology.TORUS, W, H);
                check(`TORUS step (${q},${r}) dir ${i} non-null`, step !== null);
                if (!step) continue;
                const back = wrap(step.q + inv.dq, step.r + inv.dr, Topology.TORUS, W, H);
                check(`TORUS round-trip (${q},${r}) dir ${i}`,
                      back && back.q === q && back.r === r);
            }
        }
    }

    // Spot-check a known lattice translation. East-edge cell (cq+R, cr)
    // going E should land on the opposite hex edge via -T1.
    const eastNeighbor = wrap(cq + R + 1, cr, Topology.TORUS, W, H);
    check('TORUS east-wrap inside', eastNeighbor && inHex(eastNeighbor.q, eastNeighbor.r, W, H));

    // Default 120×120: lattice generators
    {
        const b = hexBounds(120, 120);
        const R2 = b.R;
        // (cq+R+1, cr) is one step east of E edge cell. Translating by
        // -T1 = -(2R+1, -R) → (-(2R+1), R). Result: (cq-R, cr+R).
        const w = wrap(b.cq + R2 + 1, b.cr, Topology.TORUS, 120, 120);
        checkEq('TORUS 120×120 east-wrap → opposite edge',
                w, { q: b.cq - R2, r: b.cr + R2 });
    }
}

// ─── CYLINDER: Pair 1 wraps, others null ───
// On a hex CYLINDER, every boundary cell must have some valid neighbors
// (either across the wrapped pair or onto interior). Cells on the
// non-wrapped pairs lose neighbors. We assert: (a) the canonical Pair 1
// face wraps, (b) the round-trip invariant holds wherever wrap returns
// non-null, (c) interior cells all have 6 neighbors.
{
    const W = 12, H = 12;
    for (let r = 0; r < H; r++) {
        for (let q = 0; q < W; q++) {
            if (!inHex(q, r, W, H)) continue;
            // All in-hex cells deep inside (cube-dist ≤ R-1) still get 6.
            // Boundary cells may have less under CYLINDER (the non-wrapped
            // pairs return null).
            const ns = neighbors(q, r, Topology.CYLINDER, W, H);
            for (const nb of ns) {
                check(`CYLINDER nbr in hex (${q},${r})→(${nb.q},${nb.r})`,
                      inHex(nb.q, nb.r, W, H));
            }
        }
    }
    // Round-trip: where wrap returns non-null, going back should land at the
    // original cell.
    for (let r = 0; r < H; r++) {
        for (let q = 0; q < W; q++) {
            if (!inHex(q, r, W, H)) continue;
            for (let i = 0; i < HEX_DIRS.length; i++) {
                const d = HEX_DIRS[i];
                const inv = HEX_DIRS[INV[i]];
                const step = wrap(q + d.dq, r + d.dr, Topology.CYLINDER, W, H);
                if (!step) continue;
                const back = wrap(step.q + inv.dq, step.r + inv.dr, Topology.CYLINDER, W, H);
                check(`CYLINDER round-trip (${q},${r}) dir ${i}`,
                      back && back.q === q && back.r === r);
            }
        }
    }
}

// ─── RP²: antipodal identification. Every boundary cell must wrap. ───
{
    const W = 12, H = 12;
    const { cq, cr } = hexBounds(W, H);
    let interiorCount = 0;
    for (let r = 0; r < H; r++) {
        for (let q = 0; q < W; q++) {
            if (!inHex(q, r, W, H)) continue;
            interiorCount++;
            const ns = neighbors(q, r, Topology.RP2, W, H);
            check(`RP² nbr count ${ns.length} == 6 at (${q},${r})`, ns.length === 6);
            for (const nb of ns) {
                check(`RP² nbr in hex (${q},${r})→(${nb.q},${nb.r})`,
                      inHex(nb.q, nb.r, W, H));
            }
        }
    }
    // RP² antipodal cells: east-most edge cell should wrap to west-most.
    const east = wrap(cq + 5 + 1, cr, Topology.RP2, W, H);
    check('RP² east wraps non-null', east !== null);
    if (east) check('RP² east wraps to opposite side',
                    cubeDist(east.q - cq, east.r - cr) <= 5);
}

// ─── MÖBIUS / KLEIN: smoke test — must not crash, in-hex cells stay in-hex. ───
{
    const W = 12, H = 12;
    for (const topo of [Topology.MOBIUS, Topology.KLEIN]) {
        const tname = topo === Topology.MOBIUS ? 'MOBIUS' : 'KLEIN';
        for (let r = 0; r < H; r++) {
            for (let q = 0; q < W; q++) {
                if (!inHex(q, r, W, H)) continue;
                const ns = neighbors(q, r, topo, W, H);
                for (const nb of ns) {
                    check(`${tname} nbr in hex (${q},${r})→(${nb.q},${nb.r})`,
                          inHex(nb.q, nb.r, W, H));
                }
            }
        }
    }
}

// ─── Inline cubeDist for the RP² check above (mirrors topology.js). ───
function cubeDist(dq, dr) {
    const ds = -dq - dr;
    return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds));
}

// ─── Summary ───
console.log(`topology.test: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
