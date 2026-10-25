// isochrones-worker.js — builds the isochrones off the main thread.
//
// isochrones.js posts the arrival field and the compartments (for the empty
// cells the lines pass through) with the surface; the worker smooths,
// pads and contours them (buildContours) and hands back the padded field and
// the segments, transferred rather than copied. The world's active cells come
// with the first job of each world and are kept.

import { buildContours } from './isochrones.js';

const bufs = {};
let act = null;

self.onmessage = (e) => {
    const job = e.data;
    if (job.act) act = job.act;
    job.act = act;
    const r = buildContours(job, bufs);
    const transfer = [];
    if (r.padded) { transfer.push(r.padded.buffer); bufs.padded = null; }
    for (const c of r.contours) {
        transfer.push(c.segs.buffer);
        if (c.runLen) transfer.push(c.runLen.buffer);
    }
    self.postMessage({ gen: job.gen, padded: r.padded, side: r.side, maxLevel: r.maxLevel, latest: r.latest, contours: r.contours }, transfer);
};
