// Why Miasma's Klein bottle has cone points: the hexagon of cells F can't be
// glued into a flat Klein bottle.
//
// The ring of cells around F can be covered by non-overlapping translates
// F + w (each disjoint from F) in exactly two ways: the lattice <T1, T2> and
// its mirror image, whose offset sets are disjoint. So every tiling of the
// plane by translates of F is one of those two lattices, every reflection of
// the cell lattice swaps them, and no glide reflection can be a deck
// transformation: a defect-free gluing of F is always a torus. (An exhaustive
// search over every edge pairing and lattice isometry, 4864 complete gluings
// at R = 59, agreed.) RP², with χ = 1, can't be flat at all.
//
// usage: node tools/klein-lemma.mjs [radii=2,3,5,8]

const cubeDist = (dq, dr) => Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
const radii = (process.argv[2] || '2,3,5,8').split(',').map(Number);
let ok = true;
for (const R of radii) {
    const ring = [], W = [];
    for (let q = -2 * R - 1; q <= 2 * R + 1; q++) {
        for (let r = -2 * R - 1; r <= 2 * R + 1; r++) {
            const k = cubeDist(q, r);
            if (k === R + 1) ring.push([q, r]);
            if (k === 2 * R + 1) W.push([q, r]);
        }
    }
    const covers = W.map(([wq, wr]) => ring.map(([q, r], i) => (cubeDist(q - wq, r - wr) <= R ? i : -1)).filter((i) => i >= 0));
    const found = new Set();
    (function rec(chosen, covered) {
        const i = ring.findIndex((_, k) => !covered.has(k));
        if (i < 0) { found.add(chosen.map((k) => W[k].join(',')).sort().join(' ')); return; }
        for (let k = 0; k < W.length; k++) {
            if (!covers[k].includes(i)) continue;
            if (chosen.some((j) => cubeDist(W[j][0] - W[k][0], W[j][1] - W[k][1]) <= 2 * R)) continue;
            const next = new Set(covered);
            covers[k].forEach((x) => next.add(x));
            rec([...chosen, k], next);
        }
    })([], new Set());
    const [A, B] = [...found].map((s) => new Set(s.split(' ')));
    const T1 = [2 * R + 1, -R].join(',');
    const holds = found.size === 2 && [...A].every((w) => !B.has(w)) && (A.has(T1) || B.has(T1));
    ok &&= holds;
    console.log(`R=${R}: ${found.size} coverings of the ring around F${holds ? ', disjoint, one of them <T1, T2>' : ' — the lemma fails'}`);
}
process.exit(ok ? 0 : 1);
