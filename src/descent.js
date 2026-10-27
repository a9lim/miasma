// descent.js — who infected whom, kept as live state.
//
// Every infection is an event: (cell, source, direction, tick), pointing at
// its parent, the event of the case that infected it. The tick logs a
// transmission into S, R or V, a Z's conversion, exposure or infectious kill,
// and spillover from the cell's own animal; the seed brush (and the opening's
// seeds, which go through it) logs a case placed by hand. A latent cell's
// transformation (L → Z, the Immunoediting reading) founds a clone, a new
// replicating thing whose conversions are its own, so it starts a tree of its
// own; a Z made from an I cell or a corpse (the zombie reading) is the same
// case going on. A coinfection adds a strain to a case that already has its
// event, so it is not one. Events live in a ring over WINDOW days counted back
// from the newest event, the isochrones' clock, so a finished outbreak keeps
// its tree and nothing older is kept. Nothing is exported or replayed.
//
// Each cell holds, for the infection it carries, its event's serial (`evt`,
// −1 for none), its tree (`tree`) and its generation (`gen`); a new infection
// reads its source's for its parent, tree and generation. A neighbour reads
// them, so the tick defers its writes to `settle`, which runs after the swap:
// a source infected again in the same tick still passes on the infection it
// held at the start of it. Trees and generations are kept per cell, not on
// the events, so a tree stays whole after its oldest events leave the window
// (an immortal clone, an endemic chain); only the drawing and the parent
// links are the window's.
//
// A case is open while its cell incubates or can pass on that infection: E, I,
// Z, a carrier R, an F-corpse. It closes when the cell leaves those states or
// takes a new infection; its children are then final. The closures of the
// last RE_DAYS give Re by counting (children per closed case), and a tree
// closes when its last case does, with its size.
//
// Descendants are counted when the plate draws them: children always have
// later serials than their parents, so one sweep from the newest event back
// sums every subtree.

import { Compartment, Flag } from './config.js';
import { FADE_DAYS } from './isochrones.js';

/** Sources that are not a cell: a case placed by hand, spillover from the cell's animal, a transformation. */
export const SRC_INTRO = -2, SRC_ANIMAL = -3, SRC_TRANSFORM = -4;
/** No direction: the source is not a neighbour. */
export const NO_DIR = 6;
/** Days of events kept, back from the newest. */
export const WINDOW = FADE_DAYS;
/** Days of closed cases behind Re by counting. */
export const RE_DAYS = 30;

const DAY_RING = 32;          // ≥ RE_DAYS, a power of two
const TREE_RING = 16384;      // closed trees remembered (size, tick, source)
const KIDS_MAX = 65535, GEN_MAX = 65535;

/** True while a cell in this state still holds an infection that can spread or is incubating. */
export function openState(c, f, tC, tF) {
    return c === Compartment.E || c === Compartment.I || c === Compartment.Z
        || (c === Compartment.R && tC && (f & Flag.CARRIER) !== 0)
        || (c === Compartment.D && tF && (f & Flag.F_CORPSE) !== 0);
}

const grow = (a, T) => { const b = new T(a.length * 2); b.set(a); return b; };

export class Descent {
    /** @param {number} N cells in the grid's storage */
    constructor(N) {
        this.evt = new Int32Array(N).fill(-1);
        this.tree = new Int32Array(N).fill(-1);
        this.gen = new Uint16Array(N);
        this.base = 0;          // oldest serial kept
        this.head = 0;          // next serial
        this.mark = 0;          // first serial the next settle writes into the cells
        this.now = 0;           // the last tick settled; a case placed by hand takes it
        this.latest = 0;        // the newest event's tick
        this.alloc(1 << 12);
        // the open cases: serial, cell and tree (the event may leave the window first)
        this.openS = new Int32Array(1 << 10);
        this.openC = new Int32Array(1 << 10);
        this.openT = new Int32Array(1 << 10);
        this.nOpen = 0;
        // the trees with a case open: size, open cases, the root's serial, its source if not a cell (else 0)
        this.tSize = new Int32Array(1 << 8);
        this.tOpen = new Int32Array(1 << 8);
        this.tRoot = new Int32Array(1 << 8);
        this.tSrc = new Int8Array(1 << 8);
        this.tFree = [];
        this.tNext = 0;
        this.dayN = new Int32Array(DAY_RING);
        this.dayKids = new Int32Array(DAY_RING);
        this.dayTag = new Int32Array(DAY_RING).fill(-1);
        this.treeSize = new Int32Array(TREE_RING);
        this.treeTick = new Int32Array(TREE_RING);
        this.treeSrc = new Int8Array(TREE_RING);
        this.trees = 0;         // closed trees ever; the ring holds the last TREE_RING
        this.intros = 0;        // cases placed by hand since the world was built
    }

    alloc(cap) {
        const old = this.cap ? this : null, oldMask = this.mask;
        this.cap = cap; this.mask = cap - 1;
        const fields = [['cell', Int32Array], ['src', Int32Array], ['parent', Int32Array], ['tick', Int32Array],
            ['tid', Int32Array], ['kids', Uint16Array], ['depth', Uint16Array], ['dir', Uint8Array], ['closed', Uint8Array]];
        const next = {};
        for (const [k, T] of fields) next[k] = new T(cap);
        if (old) {
            for (let s = this.base; s < this.head; s++) {
                const a = s & oldMask, b = s & this.mask;
                for (const [k] of fields) next[k][b] = old[k][a];
            }
        }
        Object.assign(this, next);
        this.desc = new Int32Array(cap);
    }

    newTree(root, src) {
        let t = this.tFree.length ? this.tFree.pop() : this.tNext++;
        if (t >= this.tSize.length) {
            this.tSize = grow(this.tSize, Int32Array); this.tOpen = grow(this.tOpen, Int32Array);
            this.tRoot = grow(this.tRoot, Int32Array); this.tSrc = grow(this.tSrc, Int8Array);
        }
        this.tSize[t] = 0; this.tOpen[t] = 0; this.tRoot[t] = root; this.tSrc[t] = src < 0 ? src : 0;
        return t;
    }

    // A new event; its serial. `parent` is a valid serial or −1, `tree` the
    // source's tree or −1 for a new one, `gen` its generation.
    push(cell, src, dir, tick, parent, tree, gen) {
        if (this.head - this.base >= this.cap) this.alloc(this.cap * 2);
        const s = this.head++, k = s & this.mask;
        this.cell[k] = cell; this.src[k] = src; this.dir[k] = dir;
        this.tick[k] = tick; this.closed[k] = 0; this.kids[k] = 0;
        this.parent[k] = parent; this.depth[k] = gen;
        if (parent >= 0) { const pk = parent & this.mask; if (this.kids[pk] < KIDS_MAX) this.kids[pk]++; }
        const t = tree >= 0 && this.tOpen[tree] > 0 ? tree : this.newTree(s, src);
        this.tid[k] = t; this.tSize[t]++; this.tOpen[t]++;
        if (tick > this.latest) this.latest = tick;
        if (this.nOpen === this.openS.length) { this.openS = grow(this.openS, Int32Array); this.openC = grow(this.openC, Int32Array); this.openT = grow(this.openT, Int32Array); }
        this.openS[this.nOpen] = s; this.openC[this.nOpen] = cell; this.openT[this.nOpen] = t; this.nOpen++;
        return s;
    }

    /** The live event behind cell i's infection, or −1. */
    eventAt(i) {
        const e = this.evt[i];
        return e >= this.base && e < this.head ? e : -1;
    }

    /**
     * An infection in the tick: `cell` caught it from `src` (a cell, or
     * SRC_ANIMAL or SRC_TRANSFORM), across direction `dir` of `cell` (NO_DIR
     * when the source is not a neighbour). The cell's fields are written at
     * the next settle.
     */
    infect(cell, src, dir, tick) {
        if (src < 0) return this.push(cell, src, dir, tick, -1, -1, 0);
        const g = this.gen[src];
        return this.push(cell, src, dir, tick, this.eventAt(src), this.tree[src], g < GEN_MAX ? g + 1 : g);
    }

    /**
     * A case placed by hand on cell i between ticks; written at once. A cell
     * already placed by hand since the last tick keeps its event, so a
     * stroke that crosses a cell twice logs it once.
     */
    introduce(i) {
        const e = this.eventAt(i);
        if (e >= this.mark && this.src[e & this.mask] === SRC_INTRO) return e;
        const s = this.push(i, SRC_INTRO, NO_DIR, this.now, -1, -1, 0);
        this.evt[i] = s; this.tree[i] = this.tid[s & this.mask]; this.gen[i] = 0;
        this.intros++;
        return s;
    }

    /** Undo of a stroke: drop the cases it placed (no tick has run since; each began its own tree). */
    truncate(serial) {
        if (serial >= this.head) return;
        while (this.nOpen > 0 && this.openS[this.nOpen - 1] >= serial) {
            const t = this.openT[--this.nOpen];
            this.tOpen[t] = 0; this.tFree.push(t);
        }
        this.intros -= this.head - Math.max(serial, this.base);
        this.head = Math.max(serial, this.base);
    }

    /** Redo of a stroke: its cases come back, open as they were. */
    extend(serial) {
        for (let s = this.head; s < serial; s++) {
            const k = s & this.mask, t = this.tid[k], f = this.tFree.lastIndexOf(t);
            if (f >= 0) this.tFree.splice(f, 1);
            this.tOpen[t] = 1; this.tSize[t] = 1;
            if (this.nOpen === this.openS.length) { this.openS = grow(this.openS, Int32Array); this.openC = grow(this.openC, Int32Array); this.openT = grow(this.openT, Int32Array); }
            this.openS[this.nOpen] = s; this.openC[this.nOpen] = this.cell[k]; this.openT[this.nOpen] = t; this.nOpen++;
        }
        if (serial > this.head) { this.intros += serial - this.head; this.head = serial; }
    }

    /**
     * After the tick's swap: write the tick's events into the cells, close the
     * cases that ended (and the trees they ended), and drop events older than
     * the window.
     */
    settle(grid, tick, tC, tF) {
        const m = this.mask, evt = this.evt;
        for (let s = this.mark; s < this.head; s++) {
            const k = s & m, c = this.cell[k];
            evt[c] = s; this.tree[c] = this.tid[k]; this.gen[c] = this.depth[k];
        }
        this.mark = this.head;
        this.now = tick;
        const comp = grid.compartment, flags = grid.flags;
        const b = tick & (DAY_RING - 1);
        if (this.dayTag[b] !== tick) { this.dayTag[b] = tick; this.dayN[b] = 0; this.dayKids[b] = 0; }
        let n = 0;
        for (let j = 0; j < this.nOpen; j++) {
            const s = this.openS[j], c = this.openC[j], t = this.openT[j];
            if (evt[c] === s && openState(comp[c], flags[c], tC, tF)) {
                this.openS[n] = s; this.openC[n] = c; this.openT[n] = t; n++;
                continue;
            }
            // a case open longer than the window closes uncounted: its children are gone with it
            if (s >= this.base) {
                const k = s & m;
                this.closed[k] = 1;
                this.dayN[b]++;
                this.dayKids[b] += this.kids[k];
            }
            if (--this.tOpen[t] === 0) {
                const r = this.trees++ & (TREE_RING - 1);
                this.treeSize[r] = this.tSize[t];
                this.treeTick[r] = tick;
                this.treeSrc[r] = this.tSrc[t];
                this.tFree.push(t);
            }
        }
        this.nOpen = n;
        const oldest = this.latest - WINDOW;
        while (this.base < this.head && this.tick[this.base & m] < oldest) this.base++;
        if (this.mark < this.base) this.mark = this.base;
    }

    /** Children per case closed over the last `days`, or NaN with none closed. */
    reCounted(days = RE_DAYS) {
        let n = 0, kids = 0;
        for (let b = 0; b < DAY_RING; b++) {
            const tag = this.dayTag[b];
            if (tag > this.now - days && tag <= this.now) { n += this.dayN[b]; kids += this.dayKids[b]; }
        }
        return n > 0 ? kids / n : NaN;
    }

    /** Open cases, the trees they belong to, and the newest generation among them. */
    summary() {
        const trees = new Set();
        let generation = 0;
        for (let j = 0; j < this.nOpen; j++) {
            trees.add(this.openT[j]);
            const g = this.gen[this.openC[j]];
            if (g > generation) generation = g;
        }
        return { open: this.nOpen, trees: trees.size, generation, events: this.head - this.base };
    }

    /** The size so far of the largest tree with a case still open, of those rooted at source `src` if given (0 for none). */
    growing(src) {
        let best = 0;
        for (let j = 0; j < this.nOpen; j++) {
            const t = this.openT[j];
            if (src !== undefined && this.tSrc[t] !== src) continue;
            if (this.tSize[t] > best) best = this.tSize[t];
        }
        return best;
    }

    /** The most cases open at once in one tree, of those rooted at source `src` if given: a clone's living cells. */
    largestNow(src) {
        let best = 0;
        for (let j = 0; j < this.nOpen; j++) {
            const t = this.openT[j];
            if (src !== undefined && this.tSrc[t] !== src) continue;
            if (this.tOpen[t] > best) best = this.tOpen[t];
        }
        return best;
    }

    /** Fill `desc` (by slot) with every kept event's descendants still in the window. */
    countDescendants() {
        const m = this.mask, desc = this.desc, parent = this.parent, base = this.base;
        for (let s = base; s < this.head; s++) desc[s & m] = 0;
        for (let s = this.head - 1; s >= base; s--) {
            const p = parent[s & m];
            if (p >= base) desc[p & m] += 1 + desc[s & m];
        }
        return desc;
    }
}

// ─── The Descent view's texel ───
// One rgba32uint texel per cell: a half-stroke from the cell's centre to the
// midpoint of each of its six edges (x, y, z: two edges each, the even one in
// the low 16 bits), and a root mark (w). A stroke is drawn in two halves, each
// in its own cell's frame, so one that crosses a glued edge meets itself
// there. Each 16 bits: weight (8: 0 none, else 1 + 16·log₂(1 + descendants),
// at most 255), fade (6: 1 − (age / WINDOW)², in 63rds), ink (2: 0 graphite,
// 1 the disease for a case still incubating or infectious, 2 the zombie's for
// a live Z). The root mark's high 16 bits are its kind (1 placed by hand, 2
// spillover, 3 a transformation). Where several events cross one edge, the most prominent
// (weight × fade) is drawn.
export const ROOT_INTRO = 1, ROOT_ANIMAL = 2, ROOT_TRANSFORM = 3;

// weight by descendants (below WEIGHT_TABLE) and fade by age, tabulated
const WEIGHT_TABLE = 4096;
const weightOf = (n) => 1 + Math.min(254, Math.round(16 * Math.log2(1 + n)));
const WEIGHTS = Uint8Array.from({ length: WEIGHT_TABLE }, (_, n) => weightOf(n));
const FADES = Uint8Array.from({ length: WINDOW + 1 }, (_, a) => Math.round(63 * Math.max(0, 1 - (a / WINDOW) * (a / WINDOW))));

/**
 * Pack the strokes into `out` (Uint32Array of W·H·4). `back` is the
 * neighbour table's back-direction table (topology.js getNeighborTable).
 */
export function packDescent(d, grid, back, out) {
    out.fill(0);
    const m = d.mask, desc = d.countDescendants(), comp = grid.compartment, evt = d.evt;
    const cellOf = d.cell, srcOf = d.src, dirOf = d.dir, tickOf = d.tick, closed = d.closed, latest = d.latest;
    for (let s = d.base; s < d.head; s++) {
        const k = s & m;
        const age = latest - tickOf[k];
        const fade = age <= WINDOW ? FADES[age] : 0;
        if (fade === 0) continue;
        const t = cellOf[k], n = desc[k];
        let ink = 0;
        if (!closed[k] && evt[t] === s) {
            const c = comp[t];
            if (c === Compartment.E || c === Compartment.I) ink = 1;
            else if (c === Compartment.Z) ink = 2;
        }
        const w = n < WEIGHT_TABLE ? WEIGHTS[n] : weightOf(n);
        const v = w | (fade << 8) | (ink << 14), p = w * fade;
        const src = srcOf[k];
        if (src >= 0) {
            const dir = dirOf[k];
            if (dir >= 6) continue;
            // the half in the target cell, then the half in the source
            let o = t * 4 + (dir >> 1), sh = (dir & 1) << 4, cur = (out[o] >>> sh) & 0xFFFF;
            if (p > (cur & 255) * ((cur >> 8) & 63)) out[o] = ((out[o] & ~(0xFFFF << sh)) | (v << sh)) >>> 0;
            const bd = back[t * 6 + dir];
            if (bd < 0) continue;
            o = src * 4 + (bd >> 1); sh = (bd & 1) << 4; cur = (out[o] >>> sh) & 0xFFFF;
            if (p > (cur & 255) * ((cur >> 8) & 63)) out[o] = ((out[o] & ~(0xFFFF << sh)) | (v << sh)) >>> 0;
        } else {
            const o = t * 4 + 3, cur = out[o] & 0xFFFF;
            const kind = src === SRC_ANIMAL ? ROOT_ANIMAL : src === SRC_TRANSFORM ? ROOT_TRANSFORM : ROOT_INTRO;
            if (p > (cur & 255) * ((cur >> 8) & 63)) out[o] = (v | (kind << 16)) >>> 0;
        }
    }
    return out;
}
