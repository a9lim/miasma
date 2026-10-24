// caption.js — what the plate says about itself: the live figure caption
// under the scene and the rows of the Reference cartouche on it.

import { ViewMode } from './config.js';
import { SURFACES } from './topology.js';
import { strainStyle } from './strain-style.js';
import { HISTOLOGY_ROWS } from './histology.js';
import { ISO_STEP } from './isochrones.js';

const fmt = (n) => Math.round(n).toLocaleString('en-US');

// One sentence per surface on what its edges do.
const SURFACE_NOTE = {
    plane: 'On the plane every edge is a shore, so the wave stops where the world ends.',
    torus: 'On the torus every pair of edges is glued straight, so a wave that leaves one edge comes back from its partner.',
    klein: 'On the Klein bottle the one- and two-chevron pairs are glued with a twist, so their copies are mirrored; the circled corners are cone points.',
    rp2: 'On the projective plane every pair is glued with a twist, so every copy is mirrored; the circled corners carry the curvature it cannot avoid.'
};

const BRUSH_CELLS = [1, 7, 19];

/** The live caption under the plate. */
export function plateCaption(sim, s, reff, strains, paint, histology, narrow) {
    const key = SURFACES[sim.topology].key, day = `Day ${fmt(sim.tick)}.`;
    const re = Number.isFinite(reff) ? ` Observed Re ${reff.toFixed(2)}.` : '';
    let body;
    if (histology) {
        body = `${day} ${fmt(s.Z)} transformed cells, ${fmt(s.D)} necrotic, ${fmt(s.I)} with viral inclusions, ${fmt(s.E)} carrying the provirus.`;
        body += ' The same lattice read at the scale of cells, stained with haematoxylin and eosin; the scale bar is in micrometres.';
        return body;
    } else if (sim.viewMode === ViewMode.STRAIN) {
        body = `${day} ${fmt(s.E + s.I + s.Z)} carriers, each hatched at the angle of its dominant strain.${re}`;
    } else if (sim.viewMode === ViewMode.AGE) {
        body = `${day} Age of every living cell, from pale (newborn) to dark (the oldest alive).`;
    } else if (sim.viewMode === ViewMode.HEALTH) {
        body = `${day} Health of every living cell, from pale (frail) to dark (well).`;
    } else if (sim.viewMode === ViewMode.STATUS) {
        body = `${day} Crosses are hospital beds, outlines are quarantine; everything else is muted.`;
    } else if (sim.viewMode === ViewMode.SUSCEPTIBILITY) {
        body = `${day} Susceptibility, from pale (exposed to many strains) to dark (never exposed).`;
    } else {
        const parts = [`${fmt(s.I)} infectious`, `${fmt(s.E)} exposed`, `${fmt(s.R)} recovered`, `${fmt(s.D)} dead`];
        if (s.V) parts.push(`${fmt(s.V)} vaccinated`);
        if (s.Z) parts.push(`${fmt(s.Z)} ${'zombies'}`);
        body = `${day} ${parts.join(', ')}.${re} Contours mark the wave every ${ISO_STEP} days.`;
    }
    if (narrow) {
        // phones: the counts and the surface, in two lines
        if (histology) return `${day} ${fmt(s.Z)} transformed, ${fmt(s.D)} necrotic, ${fmt(s.I)} with inclusions. H&E section.`;
        if (sim.viewMode !== ViewMode.COMPARTMENT) return body.split('. ').slice(0, 2).join('. ').replace(/\.?$/, '.');
        return `${day} ${fmt(s.I)} infectious, ${fmt(s.E)} exposed, ${fmt(s.R)} recovered, ${fmt(s.D)} dead${s.V ? `, ${fmt(s.V)} vaccinated` : ''}, on a ${SURFACES[sim.topology].name}.`;
    }
    let tail = ' ' + SURFACE_NOTE[key];
    const mode = paint ? paint.getMode() : 'seed';
    if (mode === 'seed') tail += SURFACES[sim.topology].closed ? ' Click to seed a case, on the faded copies too.' : ' Click to seed a case.';
    else if (mode !== 'none') tail += ` Painting: ${mode}, ${BRUSH_CELLS[paint.getBrushSize()] || ''} cells a dab.`;
    return body + tail;
}

/** Rows of the Reference cartouche for the current view. */
export function plateLegend(sim, s, toggles, histology, topStrains) {
    const S = SURFACES[sim.topology], edges = [];
    if (S.closed) edges.push({ kind: 'G', label: 'Glued edge' });
    else edges.push({ kind: 'shore', label: 'Shore' });
    if (S.closed && S.key !== 'torus') edges.push({ kind: 'cone', label: 'Cone point' });
    if (histology) return HISTOLOGY_ROWS.concat(edges);
    const rows = [];
    switch (sim.viewMode) {
        case ViewMode.STRAIN: {
            for (const p of (topStrains || []).slice(0, 5)) {
                const st = strainStyle(p.id);
                rows.push({ kind: 'H#', ink: st.ink, angle: st.angle, label: `Strain ${p.name}, ${p.fraction < 0.01 ? '<1' : Math.round(p.fraction * 100)}%` });
            }
            if (!rows.length) rows.push({ kind: 'S', label: 'No carriers' });
            break;
        }
        case ViewMode.AGE: rows.push({ kind: 'ramp', ink: _themePalette().inks.umber, label: 'Age, newborn to oldest' }); break;
        case ViewMode.HEALTH: rows.push({ kind: 'ramp', ink: _themePalette().inks.viridian, label: 'Health, frail to well' }); break;
        case ViewMode.SUSCEPTIBILITY: rows.push({ kind: 'ramp', ink: _themePalette().inks.prussian, label: 'Susceptibility' }); break;
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
