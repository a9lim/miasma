// caption.js — what the plate says about itself: the live figure caption
// under the scene (the day and the view's values, '·'-separated) and the
// rows of the Reference cartouche on it.

import { ViewMode } from './config.js';
import { SURFACES } from './topology.js';
import { strainStyle } from './strain-style.js';
import { HISTOLOGY_ROWS } from './histology.js';
import { ISO_STEP } from './isochrones.js';
import { getPreset, criticalBeta } from './presets.js';
import { agDist } from './immunity.js';
import { chainStats } from './chains.js';
import { SRC_TRANSFORM } from './descent.js';

const NUMBER = new Intl.NumberFormat('en-US');
const fmt = (n) => NUMBER.format(Math.round(n));
const pct = (x) => `${Math.round(100 * x)}%`;
const line = (parts) => parts.filter(Boolean).join(' · ');

// A count's change over the last 100 days, signed, or '' before there is one.
function trend(h, now) {
    const then = h.ago('zPop', 100);
    if (!(Number.isFinite(then) && then > 0)) return '';
    return `${now >= then ? '+' : '−'}${pct(Math.abs(now - then) / then)} in 100 days`;
}

/**
 * The running preset's measured values (presets.js `measure`), '·'-joined,
 * or ''. ctx: { params, history, strains, reached, active, unvax0,
 * prevalence() }.
 */
export function presetMeasure(sim, s, ctx) {
    const p = sim.presetKey ? getPreset(sim.presetKey) : null;
    if (!p || !p.measure || !ctx) return '';
    const P = ctx.params, h = ctx.history;
    switch (p.measure) {
        case 'threshold':
            return line([`β ${(P.beta / criticalBeta(P.gamma + P.mu)).toFixed(1)}× critical`, `${pct(ctx.reached / ctx.active)} reached`]);
        case 'herd':
            return `${pct(ctx.unvax0 ? Math.min(1, ctx.reached / ctx.unvax0) : 0)} of unvaccinated reached`;
        case 'drift': {
            const prev = ctx.prevalence(), reg = ctx.strains;
            if (!prev.length) return '';
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
            return line([`lead ${reg.names[dom]}`, `${travelled.toFixed(1)} AU travelled, ${(travelled / years).toFixed(1)} a year`, `generation ${Math.round(g / w)}`]);
        }
        case 'spillover': {
            // the chains closed over the last year (chains.js), the largest
            // still growing, and the share of human cases that spilled over
            const c = chainStats(ctx.descent), g = ctx.descent.growing();
            const hh = h.sum('sToE', 30), sp = h.sum('spill', 30);
            return line([c.n ? `mean chain ${c.mean.toFixed(1)}` : '', g > 0 ? `largest growing ${fmt(g)}` : '',
                sp + hh ? `${pct(sp / (sp + hh))} from the reservoir` : '']);
        }
        case 'immunoediting': {
            // and the clones (trees a transformation founded): the mean size
            // of those surveillance cleared over the last year, and the most
            // cells one holds now
            const t = trend(h, s.Z), c = chainStats(ctx.descent, SRC_TRANSFORM), g = ctx.descent.largestNow(SRC_TRANSFORM);
            return line([t ? `transformed ${t}` : '', c.n ? `cleared clones ${c.mean.toFixed(1)} cells` : '', g > 0 ? `largest clone ${fmt(g)}` : '']);
        }
        case 'zombie': {
            const t = trend(h, s.Z);
            return line([t && `zombies ${t}`, `${fmt(s.S + s.E + s.I + s.R + s.V + s.M)} living`]);
        }
        default: return '';
    }
}

// Re by the ratio of infections to removals, and by counting each closed
// case's children (descent.js).
function reText(reff, counted) {
    const c = Number.isFinite(counted);
    if (!Number.isFinite(reff)) return c ? `Re ${counted.toFixed(2)} by count` : '';
    return c ? `Re ${reff.toFixed(2)}, ${counted.toFixed(2)} by count` : `Re ${reff.toFixed(2)}`;
}

/**
 * The live caption under the plate: the day and the view's values, ending, in
 * the State view and the view the running preset's plate is drawn in, with
 * its measured values.
 */
export function plateCaption(sim, s, reff, histology, narrow, ctx) {
    const re = reText(reff, ctx && ctx.descent ? ctx.descent.reCounted() : NaN);
    const p = sim.presetKey ? getPreset(sim.presetKey) : null;
    const measure = p && (sim.viewMode === ViewMode.COMPARTMENT || sim.viewMode === p.view) ? presetMeasure(sim, s, ctx) : '';
    let parts;
    if (histology) {
        parts = [`${fmt(s.Z)} transformed`, `${fmt(s.D)} necrotic`];
        if (!narrow) parts.push(`${fmt(s.I)} inclusions`, `${fmt(s.E)} latent`);
        parts.push(measure);
    } else switch (sim.viewMode) {
        case ViewMode.STRAIN:
            parts = [`${fmt(s.E + s.I + s.Z)} carriers`, s.coinfected ? `${fmt(s.coinfected)} coinfected` : ''];
            parts.push(narrow && measure ? '' : re, measure);
            break;
        case ViewMode.DESCENT: {
            const d = ctx && ctx.descent ? ctx.descent.summary() : null;
            parts = d && d.open && !(narrow && measure) ? [`${fmt(d.trees)} ${d.trees === 1 ? 'tree' : 'trees'} growing`, `generation ${fmt(d.generation)}`] : [];
            parts.push(narrow && measure ? '' : re, measure);
            break;
        }
        case ViewMode.AGE: parts = [`mean age ${fmt(s.meanAge)} days`]; break;
        case ViewMode.HEALTH: parts = [`mean health ${s.meanHealth.toFixed(2)}`]; break;
        case ViewMode.STATUS: parts = [`${fmt(s.statusH)} in hospital`, `${fmt(s.statusQ)} in quarantine`]; break;
        case ViewMode.IMMUNITY: parts = [`immunity to ${sim.immunity ? sim.immunity.name : 'α'}`]; break;
        default: {
            parts = [`${fmt(s.I)} infectious`, `${fmt(s.E)} exposed`];
            if (!narrow || !measure) {
                parts.push(`${fmt(s.R)} recovered`, `${fmt(s.D)} dead`);
                if (s.V) parts.push(`${fmt(s.V)} vaccinated`);
                if (s.Z) parts.push(`${fmt(s.Z)} zombies`);
            }
            parts.push(narrow && measure ? '' : re, measure);
        }
    }
    return line([`Day ${fmt(sim.tick)}`, ...parts]);
}

/** Rows of the Reference cartouche for the current view; `focus` is the strain the Strain view's trunk follows. */
export function plateLegend(sim, s, toggles, histology, topStrains, reg, focus) {
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
            if (s.coinfected && topStrains.length > 1) {
                // a host's strains overlay, each as heavy as its load
                const a = strainStyle(reg, topStrains[0].id), b = strainStyle(reg, topStrains[1].id);
                rows.push({ kind: 'H2', marks: [a, b], label: 'Coinfected' });
            }
            if (s.V) rows.push({ kind: 'V', label: 'Vaccinated' });   // its hatching is drawn in this view too
            if (focus != null && reg.bornAt[focus] >= 0) rows.push({ kind: 'Tk', ink: strainStyle(reg, focus).ink, label: `Ancestry of ${reg.names[focus]}, by birthplace` });
            break;
        }
        case ViewMode.DESCENT:
            rows.push({ kind: 'Dl', label: 'Infection, weighted by descendants' }, { kind: 'Dt', label: 'Into a live case' });
            if (toggles.Z || s.Z) rows.push({ kind: 'Dz', label: toggles.L ? 'Into a transformed cell' : 'Into a zombie' });
            if (toggles.Z && toggles.L) rows.push({ kind: 'Dx', label: 'Transformed, a clone founded' });
            if (sim.grid.descent.intros) rows.push({ kind: 'Do', label: 'Placed by hand' });
            if (s.animalTotal) rows.push({ kind: 'Da', label: 'Spillover' });
            break;
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
