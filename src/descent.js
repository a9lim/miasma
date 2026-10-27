// descent.js — who infected whom, kept as live state.
//
// Every infection is an event: (cell, source, direction, tick), pointing at
// its parent, the event of the case that infected it. The tick
// logs a transmission into S, R or V, a Z's conversion, exposure or infectious
// kill, and spillover from the cell's own animal; the seed brush (and the
// opening's seeds, which go through it) logs a case placed by hand. A
// coinfection adds a strain to a case that already has its event, so it is not
// one. Events live in a ring over WINDOW days counted back from the newest
// event, the isochrones' clock, so a finished outbreak keeps its tree and
// nothing older is kept. Nothing is exported or replayed.
//
// Each cell holds the serial of the event behind the infection it carries
// (`evt`, −1 for none); a new infection finds its parent there. A neighbour
// reads it, so the tick defers its writes to `settle`, which runs after the
// swap: a source infected again in the same tick still passes on the
// infection it held at the start of it.
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

/** Sources that are not a cell: a case placed by hand, spillover from the cell's animal. */
export const SRC_INTRO = -2, SRC_ANIMAL = -3;
/** No direction: the source is not a neighbour. */
export const NO_DIR = 6;
/** Days of events kept, back from the newest. */
export const WINDOW = FADE_DAYS;
/** Days of closed cases behind Re by counting. */
export const RE_DAYS = 30;

const DAY_RING = 32;          // ≥ RE_DAYS, a power of two
const TREE_RING = 4096;       // closed trees remembered (size, tick)
const KIDS_MAX = 65535, DEPTH_MAX = 65535;

/** True while a cell in this state still holds an infection that can spread or is incubating. */
export function openState(c, f, tC, tF) {
    return c === Compartment.E || c === Compartment.I || c === Compartment.Z
        || (c === Compartment.R && tC && (f & Flag.CARRIER) !== 0)
        || (c === Compartment.D && tF && (f & Flag.F_CORPSE) !== 0);
}

export class Descent {
    /** @param {number} N cells in the grid's storage */
    constructor(N) {
        this.evt = new Int32Array(N).fill(-1);
        this.base = 0;          // oldest serial kept
        this.head = 0;          // next serial
        this.mark = 0;          // first serial the next settle writes into `evt`
        this.now = 0;           // the last tick settled; a case placed by hand takes it
        this.latest = 0;        // the newest event's tick
        this.alloc(1 << 12);
        this.openList = new Int32Array(1 << 10);
        this.nOpen = 0;
        this.dayN = new Int32Array(DAY_RING);
        this.dayKids = new Int32Array(DAY_RING);
        this.dayTag = new Int32Array(DAY_RING).fill(-1);
        this.treeSize = new Int32Array(TREE_RING);
        this.treeTick = new Int32Array(TREE_RING);
        this.trees = 0;         // closed trees ever; the ring holds the last TREE_RING
    }

    alloc(cap) {
        const old = this.cap ? this : null, oldMask = this.mask;
        this.cap = cap; this.mask = cap - 1;
        const fields = [['cell', Int32Array], ['src', Int32Array], ['parent', Int32Array], ['root', Int32Array],
            ['tick', Int32Array], ['size', Int32Array], ['open', Int32Array],
            ['kids', Uint16Array], ['depth', Uint16Array], ['dir', Uint8Array], ['closed', Uint8Array]];
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

    // A new event; its slot. `parent` is a valid serial or −1.
    push(cell, src, dir, tick, parent) {
        if (this.head - this.base >= this.cap) this.alloc(this.cap * 2);
        const s = this.head++, k = s & this.mask;
        this.cell[k] = cell; this.src[k] = src; this.dir[k] = dir;
        this.tick[k] = tick; this.closed[k] = 0; this.kids[k] = 0;
        this.parent[k] = parent;
        let root = s;
        if (parent >= 0) {
            const pk = parent & this.mask;
            root = this.root[pk];
            this.depth[k] = this.depth[pk] < DEPTH_MAX ? this.depth[pk] + 1 : DEPTH_MAX;
            if (this.kids[pk] < KIDS_MAX) this.kids[pk]++;
        } else this.depth[k] = 0;
        this.root[k] = root;
        if (root === s) { this.size[k] = 1; this.open[k] = 1; }
        else if (root >= this.base) { const rk = root & this.mask; this.size[rk]++; this.open[rk]++; }
        if (tick > this.latest) this.latest = tick;
        if (this.nOpen === this.openList.length) {
            const grown = new Int32Array(this.openList.length * 2);
            grown.set(this.openList);
            this.openList = grown;
        }
        this.openList[this.nOpen++] = s;
        return s;
    }

    /** The live event behind cell i's infection, or −1. */
    eventAt(i) {
        const e = this.evt[i];
        return e >= this.base && e < this.head ? e : -1;
    }

    /**
     * An infection in the tick: `cell` caught it from `src` (a cell, or
     * SRC_ANIMAL), across direction `dir` of `cell` (NO_DIR when the source is
     * not a neighbour). `evt[cell]` is written at the next settle.
     */
    infect(cell, src, dir, tick) {
        const parent = src >= 0 ? this.eventAt(src) : -1;
        return this.push(cell, src, dir, tick, parent);
    }

    /**
     * A case placed by hand on cell i between ticks; written at once. A cell
     * already placed by hand since the last tick keeps its event, so a
     * stroke that crosses a cell twice logs it once.
     */
    introduce(i) {
        const e = this.eventAt(i);
        if (e >= this.mark && this.src[e & this.mask] === SRC_INTRO) return e;
        const s = this.push(i, SRC_INTRO, NO_DIR, this.now, -1);
        this.evt[i] = s;
        return s;
    }

    /** Undo of a stroke: drop the cases it placed (no tick has run since). */
    truncate(serial) {
        if (serial >= this.head) return;
        this.head = Math.max(serial, this.base);
        while (this.nOpen > 0 && this.openList[this.nOpen - 1] >= this.head) this.nOpen--;
    }

    /** Redo of a stroke: its cases come back, open as they were. */
    extend(serial) {
        for (let s = this.head; s < serial; s++) {
            if (this.nOpen === this.openList.length) {
                const grown = new Int32Array(this.openList.length * 2);
                grown.set(this.openList);
                this.openList = grown;
            }
            this.openList[this.nOpen++] = s;
        }
        if (serial > this.head) this.head = serial;
    }

    /**
     * After the tick's swap: write the tick's events into `evt`, close the
     * cases that ended, and drop events older than the window.
     */
    settle(grid, tick, tC, tF) {
        const m = this.mask, evt = this.evt;
        for (let s = this.mark; s < this.head; s++) evt[this.cell[s & m]] = s;
        this.mark = this.head;
        this.now = tick;
        const comp = grid.compartment, flags = grid.flags;
        const b = tick & (DAY_RING - 1);
        if (this.dayTag[b] !== tick) { this.dayTag[b] = tick; this.dayN[b] = 0; this.dayKids[b] = 0; }
        let n = 0;
        for (let j = 0; j < this.nOpen; j++) {
            const s = this.openList[j];
            if (s < this.base) continue;
            const k = s & m, c = this.cell[k];
            if (evt[c] === s && openState(comp[c], flags[c], tC, tF)) { this.openList[n++] = s; continue; }
            this.closed[k] = 1;
            this.dayN[b]++;
            this.dayKids[b] += this.kids[k];
            const root = this.root[k];
            if (root >= this.base) {
                const rk = root & m;
                if (--this.open[rk] === 0) {
                    const t = this.trees++ & (TREE_RING - 1);
                    this.treeSize[t] = this.size[rk];
                    this.treeTick[t] = tick;
                }
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
        const roots = new Set();
        let generation = 0;
        for (let j = 0; j < this.nOpen; j++) {
            const k = this.openList[j] & this.mask;
            roots.add(this.root[k]);
            if (this.depth[k] > generation) generation = this.depth[k];
        }
        return { open: this.nOpen, trees: roots.size, generation, events: this.head - this.base };
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
// spillover). Where several events cross one edge, the most prominent
// (weight × fade) is drawn.
export const ROOT_INTRO = 1, ROOT_ANIMAL = 2;

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
            if (p > (cur & 255) * ((cur >> 8) & 63)) out[o] = (v | ((src === SRC_ANIMAL ? ROOT_ANIMAL : ROOT_INTRO) << 16)) >>> 0;
        }
    }
    return out;
}
