// caption.js — what the plate says about itself: the live figure caption
// under the scene and the rows of the Reference cartouche on it.

import { ViewMode } from './config.js';
import { SURFACES } from './topology.js';
import { strainStyle } from './strain-style.js';
import { HISTOLOGY_ROWS } from './histology.js';
import { ISO_STEP } from './isochrones.js';
import { getPreset } from './presets.js';
import { agDist } from './immunity.js';

const NUMBER = new Intl.NumberFormat('en-US');
const fmt = (n) => NUMBER.format(Math.round(n));

// One sentence per surface on what its edges do.
const SURFACE_NOTE = {
    plane: 'On the plane every edge is a shore, so the wave stops where the world ends.',
    torus: 'On the torus every pair of edges is glued straight, so a wave that leaves one edge comes back from its partner.',
    klein: 'On the Klein bottle the one- and two-chevron pairs are glued with a twist, so their copies are mirrored; the circled corners are cone points.',
    rp2: 'On the projective plane every pair is glued with a twist, so every copy is mirrored; the circled corners carry the curvature it cannot avoid.'
};

const BRUSH_CELLS = [1, 7, 19];

// Bond percolation threshold of the triangular lattice, the hex cells'
// adjacency graph.
const P_C = 2 * Math.sin(Math.PI / 18);
const pct = (x) => `${Math.round(100 * x)}%`;

/** Chance an infectious cell infects a given neighbour before leaving I (geometric stay). */
export function edgeT(beta, exit) {
    return 1 - exit * (1 - beta) / (1 - (1 - exit) * (1 - beta));
}

/** β at which edgeT reaches the percolation threshold, for exit rate `exit`. */
export function criticalBeta(exit) {
    let lo = 0, hi = 1;
    for (let k = 0; k < 50; k++) { const m = (lo + hi) / 2; if (edgeT(m, exit) < P_C) lo = m; else hi = m; }
    return lo;
}

/**
 * The running preset's measured sentence (presets.js `measure`), or ''. ctx:
 * { params, history, strains, reached, active, unvax0, prevalence() }.
 */
export function presetMeasure(sim, s, ctx) {
    const p = sim.presetKey ? getPreset(sim.presetKey) : null;
    if (!p || !p.measure || !ctx) return '';
    const P = ctx.params, h = ctx.history;
    switch (p.measure) {
        case 'threshold': {
            const bc = criticalBeta(P.gamma + P.mu);
            return `β ${P.beta.toFixed(3)}, ${(P.beta / bc).toFixed(1)}× the critical β of about ${bc.toFixed(3)}; ${pct(ctx.reached / ctx.active)} of cells reached.`;
        }
        case 'herd': {
            const r0 = 6 * edgeT(P.beta, P.gamma + P.mu);
            const reached = ctx.unvax0 ? Math.min(1, ctx.reached / ctx.unvax0) : 0;
            return `Coverage ${pct(P.vax_coverage)}, against a lattice threshold near 50% and ${pct(1 - 1 / r0)} by 1 − 1/R₀; ${pct(reached)} of the unvaccinated reached.`;
        }
        case 'drift': {
            const prev = ctx.prevalence(), reg = ctx.strains;
            if (!prev.length) return 'No strain circulating.';
            const dom = prev[0].id;
            let travelled = 0;
            for (let id = dom; reg.parent[id] !== null && reg.parent[id] !== undefined;) {
                const q = reg.parent[id];
                travelled += agDist(reg.ag_x[q], reg.ag_y[q], reg.ag_x[id], reg.ag_y[id]);
                id = q;
            }
            let g = 0, w = 0;
            for (const r of prev) { g += r.count * (reg.gen[r.id] | 0); w += r.count; }
            const years = Math.max(sim.tick, 1) / 365;
            return `Strain ${reg.names[dom]} leads, ${travelled.toFixed(1)} antigenic units from α along its descent (${(travelled / years).toFixed(1)} a year); carriers average ${Math.round(g / w)} generations.`;
        }
        case 'spillover': {
            const hh = h.sum('sToE', 30), sp = h.sum('spill', 30), rem = h.sum('iToR', 30) + h.sum('iToD', 30);
            if (!rem && !sp) return 'No human cases this month.';
            const re = rem ? (hh / rem).toFixed(2) : '–';
            return `Human-to-human Re ${re}; ${pct(sp / Math.max(1, sp + hh))} of this month's human cases came from the reservoir.`;
        }
        case 'immunoediting':
        case 'zombie': {
            const then = h.ago('zPop', 100), now = s.Z;
            const trend = Number.isFinite(then) && then > 0
                ? `, ${now >= then ? 'up' : 'down'} ${pct(Math.abs(now - then) / then)} in 100 days`
                : '';
            return p.measure === 'zombie'
                ? `Fight-back ${P.z_die_fighting.toFixed(3)}: zombies${trend || ' holding'}, against ${fmt(s.S + s.E + s.I + s.R + s.V + s.M)} living.`
                : `Surveillance ${P.z_die_fighting.toFixed(3)}: transformed cells${trend || ' holding'}.`;
        }
        default: return '';
    }
}

/** The live caption under the plate. */
export function plateCaption(sim, s, reff, strains, paint, histology, narrow, ctx) {
    const measure = presetMeasure(sim, s, ctx);
    const key = SURFACES[sim.topology].key, day = `Day ${fmt(sim.tick)}.`;
    const re = Number.isFinite(reff) ? ` Observed Re ${reff.toFixed(2)}.` : '';
    let body;
    if (histology) {
        body = `${day} ${fmt(s.Z)} transformed cells, ${fmt(s.D)} necrotic, ${fmt(s.I)} with viral inclusions, ${fmt(s.E)} carrying the provirus.`;
        if (narrow) return `${day} ${measure || `${fmt(s.Z)} transformed, ${fmt(s.D)} necrotic. H&E section.`}`;
        body += measure ? ' ' + measure : ' The same lattice read at the scale of cells, stained with haematoxylin and eosin; the scale bar is in micrometres.';
        return body;
    } else if (sim.viewMode === ViewMode.STRAIN) {
        body = `${day} ${fmt(s.E + s.I + s.Z)} carriers, each hatched at the angle of its dominant strain.${re}`;
    } else if (sim.viewMode === ViewMode.AGE) {
        body = `${day} Age of every living cell, from pale (newborn) to dark (the oldest alive).`;
    } else if (sim.viewMode === ViewMode.HEALTH) {
        body = `${day} Health of every living cell, from pale (frail) to dark (well).`;
    } else if (sim.viewMode === ViewMode.STATUS) {
        body = `${day} Crosses are hospital beds, outlines are quarantine; everything else is muted.`;
    } else if (sim.viewMode === ViewMode.IMMUNITY) {
        const im = sim.immunity;
        body = `${day} Immunity to strain ${im ? im.name : 'α'}, from pale (unprotected) to dark (protected); it falls off with each cell's antigenic distance from what it remembers.`;
    } else {
        const parts = [`${fmt(s.I)} infectious`, `${fmt(s.E)} exposed`, `${fmt(s.R)} recovered`, `${fmt(s.D)} dead`];
        if (s.V) parts.push(`${fmt(s.V)} vaccinated`);
        if (s.Z) parts.push(`${fmt(s.Z)} ${'zombies'}`);
        body = `${day} ${parts.join(', ')}.${re}` + (measure ? ' ' + measure : ` Contours mark the wave every ${ISO_STEP} days.`);
    }
    if (narrow) {
        // phones: the counts and the surface, or the measured number, in two lines
        if (sim.viewMode !== ViewMode.COMPARTMENT) return body.split('. ').slice(0, 2).join('. ').replace(/\.?$/, '.');
        if (measure) return `${day} ${fmt(s.I)} infectious. ${measure}`;
        return `${day} ${fmt(s.I)} infectious, ${fmt(s.E)} exposed, ${fmt(s.R)} recovered, ${fmt(s.D)} dead${s.V ? `, ${fmt(s.V)} vaccinated` : ''}, on a ${SURFACES[sim.topology].name}.`;
    }
    let tail = measure && sim.viewMode === ViewMode.COMPARTMENT ? '' : ' ' + SURFACE_NOTE[key];
    const mode = paint ? paint.getMode() : 'seed';
    if (mode === 'seed') tail += SURFACES[sim.topology].closed ? ' Click to seed a case, on the faded copies too.' : ' Click to seed a case.';
    else if (mode !== 'none') tail += ` Painting: ${mode}, ${BRUSH_CELLS[paint.getBrushSize()] || ''} cells a dab.`;
    return body + tail;
}

/** Rows of the Reference cartouche for the current view. */
export function plateLegend(sim, s, toggles, histology, topStrains, reg) {
    const S = SURFACES[sim.topology], edges = [];
    if (S.closed) edges.push({ kind: 'G', label: 'Glued edge' });
    else edges.push({ kind: 'shore', label: 'Shore' });
    if (S.closed && S.key !== 'torus') edges.push({ kind: 'cone', label: 'Cone point' });
    if (histology) return HISTOLOGY_ROWS.concat(edges);
    const rows = [];
    switch (sim.viewMode) {
        case ViewMode.STRAIN: {
            for (const p of (topStrains || []).slice(0, 5)) {
                const st = strainStyle(reg, p.id);
                rows.push({ kind: 'H#', ink: st.ink, angle: st.angle, label: `Strain ${p.name}, ${p.fraction < 0.01 ? '<1' : Math.round(p.fraction * 100)}%` });
            }
            if (!rows.length) rows.push({ kind: 'S', label: 'No carriers' });
            if (s.V) rows.push({ kind: 'V', label: 'Vaccinated' });   // its hatching is drawn in this view too
            break;
        }
        case ViewMode.AGE: rows.push({ kind: 'ramp', ink: _themePalette().inks.umber, label: 'Age, newborn to oldest' }); break;
        case ViewMode.HEALTH: rows.push({ kind: 'ramp', ink: _themePalette().inks.viridian, label: 'Health, frail to well' }); break;
        case ViewMode.IMMUNITY: rows.push({ kind: 'ramp', ink: _themePalette().inks.prussian, label: 'Immunity, none to full' }); break;
        case ViewMode.STATUS:
            rows.push({ kind: '+', label: 'Hospitalized' }, { kind: 'Q', label: 'Quarantined' });
            break;
        default:
            rows.push({ kind: 'I', label: 'Infectious' }, { kind: 'E', label: 'Exposed' }, { kind: 'R', label: 'Recovered' });
            if (toggles.V || s.V) rows.push({ kind: 'V', label: 'Vaccinated' });
            rows.push({ kind: 'D', label: 'Deaths' });
            if (s.M) rows.push({ kind: 'M', label: 'Newborn, immune' });
            if (toggles.Z || s.Z) rows.push({ kind: 'Z', label: 'Zombie' });
            if (s.statusH || s.statusQ) rows.push({ kind: 'Q', label: 'Quarantine cordon' });
            rows.push({ kind: 'L', label: `Arrival, every ${ISO_STEP} days` });
    }
    if (toggles.animalDisplay !== 'off' && s.animalTotal) rows.push({ kind: 'A', label: 'Reservoir animal' });
    return rows.concat(edges);
}
