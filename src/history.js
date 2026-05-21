// history.js — allocation-free transition-count ring buffer.

export function createTransitionHistory(capacity) {
    const cap = capacity | 0;
    return {
        cap,
        sToE:  new Uint32Array(cap),
        eToI:  new Uint32Array(cap),
        iToR:  new Uint32Array(cap),
        iToD:  new Uint32Array(cap),
        head:  0,
        length: 0,
        clear() {
            this.head = 0;
            this.length = 0;
        },
        push(s, e, r, d) {
            const i = this.head;
            this.sToE[i] = s;
            this.eToI[i] = e;
            this.iToR[i] = r;
            this.iToD[i] = d;
            this.head = (i + 1) % this.cap;
            if (this.length < this.cap) this.length++;
        }
    };
}
