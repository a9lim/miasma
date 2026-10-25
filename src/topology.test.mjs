// topology.test.mjs — unit tests for the four surfaces.
// Run: `node src/topology.test.mjs` from miasma/.
//
// Every surface glues the edges of the inscribed hex. The tests check the
// lattice geometry (bounds, PLANE nulls, TORUS translation round-trips), then
// treat each glued table as a cell complex (cells, cell-edges, cell-vertices)
// and check symmetry, χ, orientability and the cone points at the corners,
// on W=H=12 (R=5) and 120×120 (R=59). The last block re-checks
// the lemma behind the Klein fallback: the hexagon of cells tiles the plane
// by translation in exactly two (mirror-image) ways.

import { Topology, HEX_DIRS } from './config.js';
import { wrap, neighbors, hexBounds, inHex, buildComplex, edgeGluings, SURFACES } from './topology.js';

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

    // 120×120: lattice generators
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

// ─── Surfaces as cell complexes ───
// Faces are cells, edges are cell-edges, vertices are cell-vertices. Corner j
// of cell i sits between its directions j and j+1; gluing a cell-edge
// identifies the corners at its two ends with the neighbor's, reversed when
// the crossing flips orientation. χ = V − E + F, and the cone angle at a
// vertex is 120° times the number of cell corners that meet there.
function complexStats(cx) {
    const { N, nb, back, flip } = cx;
    let asym = 0, open = 0, self = 0, dupCells = 0, edges = 0;
    for (let i = 0; i < N; i++) {
        const seen = new Set();
        let dup = false;
        for (let d = 0; d < 6; d++) {
            const s = i * 6 + d, j = nb[s];
            if (j < 0) { open++; edges++; continue; }
            if (j === i) self++;
            if (seen.has(j)) dup = true;
            seen.add(j);
            const bd = back[s];
            if (nb[j * 6 + bd] !== i || back[j * 6 + bd] !== d || flip[j * 6 + bd] !== flip[s]) asym++;
            if (j > i || (j === i && bd > d)) edges++;
        }
        if (dup) dupCells++;
    }
    const P = new Int32Array(N * 6);
    for (let k = 0; k < P.length; k++) P[k] = k;
    const find = (x) => { while (P[x] !== x) { P[x] = P[P[x]]; x = P[x]; } return x; };
    const unite = (a, b) => { a = find(a); b = find(b); if (a !== b) P[a] = b; };
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < 6; j++) {
            const s = i * 6 + j, n = nb[s];
            if (n >= 0) unite(s, n * 6 + (flip[s] ? back[s] : (back[s] + 5) % 6));
            const s1 = i * 6 + (j + 1) % 6, m = nb[s1];
            if (m >= 0) unite(s, m * 6 + (flip[s1] ? (back[s1] + 5) % 6 : back[s1]));
        }
    }
    const size = new Map();
    for (let k = 0; k < P.length; k++) { const r = find(k); size.set(r, (size.get(r) || 0) + 1); }
    const vertices = {};
    for (const v of size.values()) vertices[v] = (vertices[v] || 0) + 1;
    const o = new Int8Array(N);
    let orientable = true;
    o[0] = 1;
    const stack = [0];
    while (stack.length) {
        const i = stack.pop();
        for (let d = 0; d < 6; d++) {
            const j = nb[i * 6 + d];
            if (j < 0) continue;
            const want = flip[i * 6 + d] ? -o[i] : o[i];
            if (!o[j]) { o[j] = want; stack.push(j); } else if (o[j] !== want) orientable = false;
        }
    }
    return { asym, open, self, dupCells, chi: size.size - edges + N, orientable, vertices };
}

// Cone points: vertex classes with other than three cell corners.
const closedCones = (vertices) => Object.entries(vertices)
    .filter(([k]) => k !== '3').map(([k, v]) => `${k * 120}°×${v}`).sort().join(' ');

for (const R of [5, 59]) {
    for (const topo of [Topology.PLANE, Topology.TORUS, Topology.KLEIN, Topology.RP2]) {
        const S = SURFACES[topo], tag = `${S.key} R=${R}`;
        const st = complexStats(buildComplex(topo, R));
        checkEq(`${tag} neighbors symmetric (one-way slots)`, st.asym, 0);
        checkEq(`${tag} χ`, st.chi, S.chi);
        checkEq(`${tag} orientable`, st.orientable, S.orientable);
        if (!S.closed) {
            checkEq(`${tag} open slots`, st.open, 12 * R + 6);
            continue;
        }
        checkEq(`${tag} every slot glued`, st.open, 0);
        if (topo === Topology.TORUS) {
            checkEq(`${tag} distinct-neighbor defects`, st.dupCells, 0);
            checkEq(`${tag} self-neighbors`, st.self, 0);
            checkEq(`${tag} cone points`, closedCones(st.vertices), '');
        } else if (topo === Topology.KLEIN) {
            // Fallback Klein: flat except a 240° and a 480° cone point. The two
            // cells around the 240° point are neighbors twice; every other cell
            // has six distinct neighbors.
            checkEq(`${tag} cells without six distinct neighbors`, st.dupCells, 2);
            checkEq(`${tag} self-neighbors`, st.self, 0);
            checkEq(`${tag} cone points`, closedCones(st.vertices), '240°×1 480°×1');
        } else {
            checkEq(`${tag} cone points`, closedCones(st.vertices), '120°×1 240°×2 480°×1');
        }
    }
}

// Six distinct neighbors per cell, through the public table at 120×120.
{
    const W = 120, H = 120;
    for (const topo of [Topology.TORUS, Topology.KLEIN]) {
        let bad = 0;
        for (let r = 0; r < H; r++) {
            for (let q = 0; q < W; q++) {
                if (!inHex(q, r, W, H)) continue;
                const ns = neighbors(q, r, topo, W, H);
                const keys = new Set(ns.map(n => n.q + ',' + n.r));
                if (ns.length !== 6 || keys.size !== 6 || keys.has(q + ',' + r)) bad++;
            }
        }
        checkEq(`${SURFACES[topo].key} 120×120 cells short of six distinct neighbors`, bad, topo === Topology.TORUS ? 0 : 2);
    }
}

// ─── Edge isometries: the copies beyond each glued edge ───
for (const R of [5, 59]) {
    for (const topo of [Topology.TORUS, Topology.KLEIN, Topology.RP2]) {
        const gs = edgeGluings(topo, R), tag = `${SURFACES[topo].key} R=${R}`;
        for (let e = 0; e < 6; e++) {
            const g = gs[e];
            check(`${tag} edge ${e} has an isometry`, !!g);
            if (!g) continue;
            const [a, b, c, d] = g.m, det = a * d - b * c;
            checkEq(`${tag} edge ${e} kind/orientation`, det, g.kind === 'translate' ? 1 : -1);
            checkEq(`${tag} edge ${e} copy is adjacent`, cubeDist(g.v[0], g.v[1]), 2 * R + 1);
            const h = gs[g.partner];
            // g_partner ∘ g_e = identity: the partner's copy undoes this one.
            const x = [3, -7];
            const y = [a * x[0] + b * x[1] + g.v[0], c * x[0] + d * x[1] + g.v[1]];
            const z = [h.m[0] * y[0] + h.m[1] * y[1] + h.v[0], h.m[2] * y[0] + h.m[3] * y[1] + h.v[1]];
            check(`${tag} edge ${e} partner inverts`, z[0] === x[0] && z[1] === x[1]);
        }
        // Along each glued edge, away from the corners, the copy's isometry is
        // the slot gluing: the out-cell beyond c is the image of c's neighbor.
        const cx = buildComplex(topo, R);
        let off = 0;
        for (let i = 0; i < cx.N; i++) {
            const [q, r] = cx.cells[i];
            if (cubeDist(q, r) !== R) continue;
            for (let d = 0; d < 6; d++) {
                const pq = q + HEX_DIRS[d].dq, pr = r + HEX_DIRS[d].dr;
                if (cubeDist(pq, pr) <= R) continue;
                const near = [0, 1, 2, 3, 4, 5].filter(k => {
                    const g = gs[k];
                    return g && cubeDist(pq - g.v[0], pr - g.v[1]) <= R;
                });
                if (near.length !== 1 || cubeDist(pq, pr) !== R + 1) continue;
                // skip the two cells at each end of an edge (corner closings live there)
                const ends = [0, 1, 2, 3, 4, 5].some(k => cubeDist(q - R * HEX_DIRS[k].dq, r - R * HEX_DIRS[k].dr) <= 1);
                if (ends) continue;
                const g = gs[near[0]], c2 = cx.cells[cx.nb[i * 6 + d]];
                const [a, b, c, dd] = g.m;
                if (a * c2[0] + b * c2[1] + g.v[0] !== pq || c * c2[0] + dd * c2[1] + g.v[1] !== pr) off++;
            }
        }
        checkEq(`${tag} copies agree with the slot gluing along every edge`, off, 0);
    }
    const t = edgeGluings(Topology.TORUS, R);
    checkEq(`torus R=${R} NE copy is +T1`, t[5].v.join(), [2 * R + 1, -R].join());
    checkEq(`torus R=${R} SE copy is +T2`, t[0].v.join(), [R, R + 1].join());
    checkEq(`torus R=${R} S copy is +T3`, t[1].v.join(), [-R - 1, 2 * R + 1].join());
}

// ─── The lemma behind the Klein fallback ───
// The ring of cells around F can be covered by non-overlapping translates
// F + w (each disjoint from F) in exactly two ways: the lattice <T1, T2> and
// its mirror image, whose offset sets are disjoint. So every tiling of the
// plane by translates of F is one of those two lattices, every reflection of
// the cell lattice swaps them, and no glide can be a deck transformation: a
// defect-free gluing of F is always a torus.
for (const R of [2, 3, 5, 8]) {
    const ring = [], W = [];
    for (let q = -2 * R - 1; q <= 2 * R + 1; q++) {
        for (let r = -2 * R - 1; r <= 2 * R + 1; r++) {
            const k = cubeDist(q, r);
            if (k === R + 1) ring.push([q, r]);
            if (k === 2 * R + 1) W.push([q, r]);
        }
    }
    const covers = W.map(([wq, wr]) => ring.map(([q, r], i) => (cubeDist(q - wq, r - wr) <= R ? i : -1)).filter(i => i >= 0));
    const found = new Set();
    (function rec(chosen, covered) {
        const i = ring.findIndex((_, k) => !covered.has(k));
        if (i < 0) { found.add(chosen.map(k => W[k].join(',')).sort().join(' ')); return; }
        for (let k = 0; k < W.length; k++) {
            if (!covers[k].includes(i)) continue;
            if (chosen.some(j => cubeDist(W[j][0] - W[k][0], W[j][1] - W[k][1]) <= 2 * R)) continue;
            const next = new Set(covered);
            covers[k].forEach(x => next.add(x));
            rec([...chosen, k], next);
        }
    })([], new Set());
    checkEq(`R=${R} coverings of the ring around F`, found.size, 2);
    const [A, B] = [...found].map(s => new Set(s.split(' ')));
    check(`R=${R} the two coverings share no offset`, A && B && [...A].every(w => !B.has(w)));
    const T1 = [2 * R + 1, -R].join(',');
    check(`R=${R} one covering is the <T1, T2> lattice`, (A && A.has(T1)) || (B && B.has(T1)));
}

// ─── Inline cubeDist (mirrors topology.js). ───
function cubeDist(dq, dr) {
    const ds = -dq - dr;
    return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds));
}

// ─── Summary ───
console.log(`topology.test: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
