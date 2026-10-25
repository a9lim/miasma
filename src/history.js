// history.js — allocation-free per-tick ring buffer: transition counts for
// observed Re, spillovers, and the Z census for the presets' measured numbers.

export function createTransitionHistory(capacity) {
    const cap = capacity | 0;
    return {
        cap,
        sToE:  new Uint32Array(cap),
        eToI:  new Uint32Array(cap),
        iToR:  new Uint32Array(cap),
        iToD:  new Uint32Array(cap),
        spill: new Uint32Array(cap),   // animal → human spillovers
        zPop:  new Uint32Array(cap),   // Z cells alive at the end of the tick
        head:  0,
        length: 0,
        clear() {
            this.head = 0;
            this.length = 0;
        },
        push(s, e, r, d, spill, z) {
            const i = this.head;
            this.sToE[i] = s;
            this.eToI[i] = e;
            this.iToR[i] = r;
            this.iToD[i] = d;
            this.spill[i] = spill | 0;
            this.zPop[i] = z | 0;
            this.head = (i + 1) % this.cap;
            if (this.length < this.cap) this.length++;
        },
        /** Sum of `key` over the last n ticks (fewer if the buffer is shorter). */
        sum(key, n) {
            const take = Math.min(n, this.length), arr = this[key];
            let total = 0;
            for (let k = 1; k <= take; k++) total += arr[(this.head - k + this.cap) % this.cap];
            return total;
        },
        /** Value of `key` n ticks ago (0 = the latest), or NaN. */
        ago(key, n) {
            if (n >= this.length) return NaN;
            return this[key][(this.head - 1 - n + this.cap) % this.cap];
        }
    };
}
