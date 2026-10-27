// spirals.mjs — does a recurring wave hold spirals on Miasma's surfaces?
//
// A stripped excitable medium on the real gluing (topology.js), not the tick:
// S → I by neighbour contact (β per infectious neighbour, scaled by the
// recovered cell's susceptibility), I → R at rate γ (geometric stay), and
// immunity that wanes by one of three rules:
//   memoryless  R → S at rate 1/τ
//   fade        susceptibility 1 − exp(−Δt/τ) from the day of recovery
//   hold:H      no susceptibility for H days, then 1 − exp(−(Δt − H)/(τ − H))
// It starts from a random mix (2% I, 48% R at random ages, the rest S) and
// counts spiral cores at the end: each cell's phase is its time since its last
// infection over the cycle (1/γ + τ), smoothed as a unit vector over two rings
// of neighbours inside the world hexagon, and the winding of that phase is
// summed around every lattice triangle inside the hexagon, so charges are
// counted in the hexagon's own orientation (a disk). Cores whose triangles
// straddle the rim are missed, which is why a total can come out odd.
// ROADMAP.md (2.4, recurrence) cites what this prints. Measured 2026-10-27,
// R 89, 1,500 days, τ 40, β 0.35, γ 0.2, seed 1 on the torus: memoryless,
// fade and hold:20 give noise (494, 106 and 228 cores), hold:30 ragged
// spirals (40), hold:36 clean ones (10). With hold:36 the net charge over
// seeds 1–6 was 0 0 1 0 0 0 on the torus, 0 −2 −1 1 0 0 on the Klein bottle
// and 0 0 2 1 0 0 on RP². That is not yet evidence for the parity rule: the
// noisy rules also net ±2 on the torus (memoryless −2, hold:30 +2), so the
// rim's missed cores swamp it. A detector that follows cores through the
// gluing is the next step.
//
// usage: node tools/spirals.mjs [rule=hold:36] [surface=klein] [R=89] [days=1500] [seed=1] [out.png]

import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { getNeighborTable, inHex } from '../src/topology.js';
import { topoFromString } from '../src/config.js';

const [ruleS = 'hold:36', surfS = 'klein', Rs = '89', daysS = '1500', seedS = '1', out = ''] = process.argv.slice(2);
const [rule, holdS] = ruleS.split(':');
const R = +Rs, W = 2 * R + 2, H = W, DAYS = +daysS;
const BETA = 0.35, GAMMA = 0.2, TAU = 40, HOLD = +(holdS || 36);

let s = +seedS >>> 0;
const rnd = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

const S = 0, I = 1, REC = 2;
const { idx: nb } = getNeighborTable(W, H, topoFromString(surfS));
const cells = [];
for (let r = 0; r < H; r++) for (let q = 0; q < W; q++) if (inHex(q, r, W, H)) cells.push(r * W + q);
const N = W * H;
const st = new Uint8Array(N), rec = new Float32Array(N), inf = new Float32Array(N).fill(-1e4);
for (const i of cells) {
    const u = rnd();
    st[i] = u < 0.02 ? I : (u < 0.5 ? REC : S);
    if (st[i] === I) inf[i] = 0;
    if (st[i] === REC) { rec[i] = -Math.floor(rnd() * TAU); inf[i] = rec[i] - 5; }
}

function susceptibility(i, t) {
    if (st[i] === S) return 1;
    if (st[i] !== REC) return 0;
    const dt = t - rec[i];
    if (rule === 'fade') return 1 - Math.exp(-dt / TAU);
    if (rule === 'hold') return dt <= HOLD ? 0 : 1 - Math.exp(-(dt - HOLD) / (TAU - HOLD));
    return 0;
}

const nst = new Uint8Array(N), nrec = new Float32Array(N), ninf = new Float32Array(N);
let day = 0;
for (let t = 1; t <= DAYS; t++) {
    nst.set(st); nrec.set(rec); ninf.set(inf);
    let infectious = 0;
    for (const i of cells) {
        if (st[i] === I) { infectious++; if (rnd() < GAMMA) { nst[i] = REC; nrec[i] = t; } continue; }
        if (st[i] === REC && rule === 'memoryless') { if (rnd() < 1 / TAU) nst[i] = S; continue; }
        const sg = susceptibility(i, t);
        if (sg <= 0) continue;
        let survive = 1;
        for (let d = 0; d < 6; d++) { const j = nb[i * 6 + d]; if (j >= 0 && st[j] === I) survive *= 1 - BETA * sg; }
        if (survive < 1 && rnd() < 1 - survive) { nst[i] = I; ninf[i] = t; }
    }
    st.set(nst); rec.set(nrec); inf.set(ninf); day = t;
    if (infectious === 0) break;
}

// ─── Cores, counted in the hexagon's orientation ───
const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const inside = (q, r) => q >= 0 && q < W && r >= 0 && r < H && inHex(q, r, W, H);
const PERIOD = 1 / GAMMA + TAU;
const px = new Float64Array(N), py = new Float64Array(N);
for (const i of cells) {
    const f = Math.min((day - inf[i]) / PERIOD, 0.97);
    px[i] = Math.cos(2 * Math.PI * f); py[i] = Math.sin(2 * Math.PI * f);
}
const phase = new Float64Array(N);
for (const i of cells) {
    const q = i % W, r = (i / W) | 0;
    let x = px[i], y = py[i];
    for (let k = 1; k <= 2; k++) for (const [dq, dr] of DIRS) {
        const qq = q + k * dq, rr = r + k * dr;
        if (inside(qq, rr)) { x += px[rr * W + qq]; y += py[rr * W + qq]; }
    }
    phase[i] = Math.atan2(y, x);
}
const turn = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a <= -Math.PI) a += 2 * Math.PI; return a; };
let plus = 0, minus = 0;
const cores = [];
for (const i of cells) {
    const q = i % W, r = (i / W) | 0;
    for (const tri of [[[0, 0], [1, 0], [0, 1]], [[0, 0], [0, 1], [-1, 1]]]) {
        const pts = tri.map(([dq, dr]) => [q + dq, r + dr]);
        if (!pts.every(([a, b]) => inside(a, b))) continue;
        const [a, b, c] = pts.map(([qq, rr]) => phase[rr * W + qq]);
        const k = Math.round((turn(b - a) + turn(c - b) + turn(a - c)) / (2 * Math.PI));
        if (k > 0) plus += k; else if (k < 0) minus -= k;
        if (k) cores.push([q, r, k]);
    }
}
console.log(JSON.stringify({ rule: ruleS, surface: surfS, seed: +seedS, day, net: plus - minus, plus, minus }));

// ─── Optional picture: I red, R graded by age, cores ringed (+ prussian, − viridian) ───
if (out) {
    const SC = 3, X0 = R / 2 + 1;
    const Wp = Math.ceil((W - R) * SC) + 4, Hp = Math.ceil(H * 0.866 * SC) + 4;
    const img = new Uint8Array(Wp * Hp * 3).fill(252);
    const put = (x, y, c) => { if (x < 0 || y < 0 || x >= Wp || y >= Hp) return; const p = (y * Wp + x) * 3; img[p] = c[0]; img[p + 1] = c[1]; img[p + 2] = c[2]; };
    const at = (q, r) => [Math.round((q + r / 2 - X0) * SC), Math.round(r * 0.866 * SC)];
    for (const i of cells) {
        const [x, y] = at(i % W, (i / W) | 0);
        let c = [246, 246, 244];
        if (st[i] === I) c = [152, 52, 50];
        else if (st[i] === REC) { const g = Math.round(90 + 150 * Math.min(1, (day - rec[i]) / TAU)); c = [g, g, g]; }
        for (let dy = 0; dy < SC; dy++) for (let dx = 0; dx < SC; dx++) put(x + dx, y + dy, c);
    }
    for (const [q, r, k] of cores) {
        const [x, y] = at(q, r), c = k > 0 ? [52, 115, 163] : [49, 123, 85];
        for (let a = 0; a < 32; a++) {
            const th = a / 32 * 2 * Math.PI;
            for (const rad of [5, 6]) put(Math.round(x + 1 + rad * Math.cos(th)), Math.round(y + 1 + rad * Math.sin(th)), c);
        }
    }
    const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c; });
    const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
    const chunk = (type, data) => {
        const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
        const body = Buffer.concat([Buffer.from(type), data]);
        const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
        return Buffer.concat([len, body, sum]);
    };
    const raw = Buffer.alloc((Wp * 3 + 1) * Hp);
    for (let y = 0; y < Hp; y++) Buffer.from(img.buffer, y * Wp * 3, Wp * 3).copy(raw, y * (Wp * 3 + 1) + 1);
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(Wp, 0); ihdr.writeUInt32BE(Hp, 4); ihdr[8] = 8; ihdr[9] = 2;
    writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
