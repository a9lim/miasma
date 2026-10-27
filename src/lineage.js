// lineage.js — strain registry panel: prevalence, rows, phylogeny, genome editor.
//
// Two exports:
//   computeStrainPrevalence(grid, registry, maxSlot)  — load-weighted tally of active strain slots
//   renderStrainPanel(panelEl, prevalence, registry, onClick?, tick?) — idempotent build/update
//
// The Strains tab shows a time-scaled phylogeny above the top-8 most-prevalent
// strains as rows (each with its plate swatch: ink and hatch angle). Clicking a
// row or a phylogeny branch reveals a detail block with the strain genome and
// lineage parentage.
//
// Mirrors the stats.js pattern: build skeleton once (data-lineage-ready='1'),
// then mutate text + bar widths on subsequent calls.
//
// No innerHTML — all DOM via createElement / textContent / style.cssText
// per the repo's pre-commit hook.

import {
    strainCount,
    bornCount,
    countLiving,
    getStrain,
    isExtinct,
    EMPTY_STRAIN
} from './strains.js';
import { STRAIN_GENOME_LAYOUT, buildSliderRow } from './params.js';
import { Compartment } from './config.js';
import { strainStyle } from './strain-style.js';
import { pickAntigenic, renderAntigenicMap } from './antigenic-map.js';
import { agDist } from './immunity.js';

// Top-K list cap. Anything beyond this is counted in the "+N" line under it.
const MAX_ROWS = 8;

/**
 * Tally cells per strain. Single pass over grid.strain_ids using a load-
 * weighted Float64 bucket; cells whose primary strain is EMPTY_STRAIN, or
 * whose mask byte is 0, don't contribute. Returns an array of
 * `{id, name, count, fraction}` rows sorted by count descending.
 *
 * `fraction` is `count / totalAssignedCells`. The denominator excludes cells
 * with no strain in slot 0, so the fractions sum to 1.0 (modulo rounding)
 * across only the strain-carrying population — which is the meaningful
 * normalization for "share of infected/carrier hosts" reporting.
 *
 * @param {{compartment:Uint8Array, strain_ids:Uint16Array, mask?:Uint8Array}} grid
 * @param {object} registry
 * @param {number} maxSlot — DEFAULTS.maxActiveStrains
 * @returns {Array<{id:number, name:string, count:number, fraction:number}>}
 */
export function computeStrainPrevalence(grid, registry, maxSlot) {
    const ids = grid.strain_ids;
    const loads = grid.strain_loads;
    const compartment = grid.compartment;
    const mask = grid.mask;
    const n = strainCount(registry);
    if (n === 0 || !ids || !maxSlot) return [];

    // Load-weighted tally — each cell distributes 1.0 of "cell-presence"
    // across the strains it carries:
    //
    //   • E / I / Z (active-state cells): loads at slots sum to 1.0 by the
    //     dynamics-step invariant. A coinfected I cell with 0.5α + 0.3β +
    //     0.2γ contributes 0.5 to α, 0.3 to β, 0.2 to γ — total 1.0.
    //     This makes coinfection visible to the ranking instead of
    //     attributing every coinfected cell to its dominant strain alone.
    //   • R+CARRIER, D+F_CORPSE (memory-state transmissible cells):
    //     slot 0 carries the strain id with load=0 as a memory marker.
    //     We contribute 1.0 to that slot-0 strain — these cells transmit
    //     at a reduced β multiplier (c_transmit_mult, f_transmit_mult)
    //     but they're not coinfected; only one strain is remembered.
    //   • M (maternal antibody memory): excluded entirely. M cells aren't
    //     transmissible — slot 0 just tags which strain's antibodies are
    //     decaying so m_decay reads off the right genome.
    //
    // Tally is Float64 so loads accumulate without truncation; downstream
    // display formats to 1 decimal place.
    const tally = new Float64Array(n);
    const cellCount = ids.length / maxSlot;
    const active = grid.activeIndices;
    const activeCount = active ? active.length : cellCount;
    let totalAssigned = 0;

    for (let ak = 0; ak < activeCount; ak++) {
        const i = active ? active[ak] : ak;
        if (mask !== undefined && mask[i] === 0) continue;
        if (compartment && compartment[i] === Compartment.M) continue;
        const slot0 = i * maxSlot;
        const primary = ids[slot0];
        if (primary === EMPTY_STRAIN) continue;
        if (primary >= n) continue; // out-of-range guard — shouldn't happen

        const slot0Load = loads ? loads[slot0] : 1;
        if (slot0Load <= 0) {
            // Memory-state cell (R+CARRIER or D+F_CORPSE): single-strain
            // contribution of 1.0 to the primary. No coinfection here —
            // recovery / death cleared the other slots; slot 0 is a single
            // remembered strain.
            tally[primary] += 1;
            totalAssigned += 1;
        } else {
            // Active-state cell: distribute by load across every populated
            // slot. The active-load invariant guarantees the per-cell sum
            // equals 1.0, so totalAssigned tracks "cells worth of strain
            // burden" — same units across compartments.
            for (let s = 0; s < maxSlot; s++) {
                const sid = ids[slot0 + s];
                if (sid === EMPTY_STRAIN || sid >= n) continue;
                const ld = loads[slot0 + s];
                if (ld <= 0) continue;
                tally[sid] += ld;
                totalAssigned += ld;
            }
        }
    }

    if (totalAssigned === 0) return [];

    // Build the row list, skip zero-count strains, then sort desc.
    const rows = [];
    for (let id = 0; id < n; id++) {
        const c = tally[id];
        if (c === 0) continue;
        const s = getStrain(registry, id);
        if (s === null) continue;
        rows.push({
            id,
            name:     s.name,
            count:    c,
            fraction: c / totalAssigned
        });
    }
    rows.sort((a, b) => b.count - a.count);
    return rows;
}

// ─── Renderer ───────────────────────────────────────────────────────────────

function buildPanelSkeleton(panelEl) {
    while (panelEl.firstChild) panelEl.removeChild(panelEl.firstChild);

    // Fig. 4, the antigenic map, then Fig. 5, the phylogeny, above the
    // rankings. Clicks on either route through selectStrain, like a row.
    const figure = (cls, label) => {
        const f = document.createElement('figure');
        f.className = 'strain-figure';
        const cap = document.createElement('figcaption');
        cap.className = 'caption strain-caption';
        const num = document.createElement('span');
        num.className = 'caption-n';
        num.textContent = label;
        const text = document.createElement('span');
        cap.append(num, ' ', text);
        return { f, cap, text };
    };
    const agFig = figure('antigenic', 'Fig. 4.');
    const agMap = document.createElement('canvas');
    agMap.className = 'antigenic-map-canvas';
    agMap.setAttribute('aria-label', 'Antigenic map of the strains on a torus');
    agMap.addEventListener('click', (ev) => {
        const rect = agMap.getBoundingClientRect();
        const id = pickAntigenic(ev.clientX - rect.left, ev.clientY - rect.top);
        if (id !== -1) selectStrain(panelEl, id);
    });
    const vaxRow = document.createElement('div');
    vaxRow.className = 'vax-row';
    const vaxBtn = document.createElement('button');
    vaxBtn.type = 'button';
    vaxBtn.className = 'tool-btn vax-match-btn';
    vaxBtn.addEventListener('click', () => {
        const cb = panelEl._lineageMatchVaccine;
        if (typeof cb === 'function') cb(panelEl._lineageVaxTarget);
    });
    vaxRow.appendChild(vaxBtn);
    agFig.f.append(agMap, agFig.cap, vaxRow);
    panelEl.appendChild(agFig.f);

    const phyFig = figure('phylogeny', 'Fig. 5.');
    phyFig.text.textContent = 'Phylogeny';
    const forest = document.createElement('canvas');
    forest.className = 'strain-forest-canvas';
    forest.dataset.role = 'lineage-phylogeny';
    forest.setAttribute('aria-label', 'Time-scaled phylogeny of the strains');
    forest.addEventListener('click', (ev) => {
        const rect = forest.getBoundingClientRect();
        const px = ev.clientX - rect.left;
        const py = ev.clientY - rect.top;
        const id = pickPhylo(px, py);
        if (id !== -1) selectStrain(panelEl, id);
    });
    phyFig.f.append(forest, phyFig.cap);
    panelEl.appendChild(phyFig.f);

    // Header row: title + total-count caption. Mirrors the .stat-row pattern
    // but uses a different role tag so it doesn't get mistaken for a compartment.
    const header = document.createElement('div');
    header.className = 'stat-row';
    header.dataset.role = 'lineage-header';

    const headerLabel = document.createElement('span');
    headerLabel.className = 'stat-label';
    headerLabel.textContent = 'Top strains';
    header.appendChild(headerLabel);

    const headerValue = document.createElement('span');
    headerValue.className = 'stat-value';
    headerValue.dataset.role = 'lineage-total';
    headerValue.textContent = '0 total';
    header.appendChild(headerValue);

    panelEl.appendChild(header);

    // List container — rows get appended/cleared inside this on each update.
    const list = document.createElement('div');
    list.className = 'strain-list';
    list.dataset.role = 'lineage-list';
    panelEl.appendChild(list);

    // Hidden-count caption — italic .panel-hint, only shown when applicable.
    const hint = document.createElement('p');
    hint.className = 'panel-hint';
    hint.dataset.role = 'lineage-hidden-hint';
    hint.style.display = 'none';
    hint.textContent = '';
    panelEl.appendChild(hint);

    // Detail block — built lazily on first click. We append a placeholder
    // container here so insertion order stays stable, but leave it empty
    // and hidden until a row is selected.
    const detail = document.createElement('div');
    detail.className = 'strain-detail';
    detail.dataset.role = 'lineage-detail';
    detail.style.display = 'none';
    panelEl.appendChild(detail);

    // Cache the DOM refs the per-tick update path needs so renderStrainPanel
    // doesn't pay a querySelector cost per call. The list keeps a pool of
    // .strain-row nodes keyed by strain id so re-orders only mutate text +
    // bar widths instead of tearing the DOM down every tick.
    panelEl._lineageRefs = {
        forestEl: forest,
        agMapEl:  agMap,
        agCapEl:  agFig.text,
        vaxBtn,
        lastMapSignature: '',
        lastMapDraw: 0,
        totalEl:  headerValue,
        listEl:   list,
        hintEl:   hint,
        detailEl: detail,
        // Map<strainId, {row, swatch, name, prev, fill}> — populated on
        // demand by ensureRow().
        rowPool:  new Map(),
        // Sorted strain IDs currently shown, in display order. Used to
        // detect re-orders cheaply (same length + same ids in same order
        // means we only need text/width updates).
        shownIds: [],
        // Sparse cache of last-rendered (count, fraction) keyed by strain id
        // so unchanged rows can skip text updates on the next tick.
        lastVals: new Map(),
        lastForestSignature: '',
        lastForestDraw: 0
    };

    panelEl.dataset.lineageReady = '1';
}

// ─── Strain detail block (Phase C: live genome editor) ─────────────────────
//
// The detail block has two parts:
//   1. A small read-only header — name, type, parent(s), birth tick.
//   2. A live genome editor — one slider per field in STRAIN_GENOME_LAYOUT.
//      Each slider writes directly into `reg.<key>[selectedStrainId]`, so a
//      drag takes effect on the next tick (the dynamics path reads strain
//      rates per-cell each tick — no caching to invalidate).
//
// The DOM is built once per detail block; on strain switch we re-target the
// genome-editor sliders and re-sync their values from the registry.
//
// The lineage-tree canvas was removed in Phase C — Phase D's force-directed
// forest at the panel top replaces it as the lineage visualisation.

const HEADER_FIELDS = [
    { key: 'name',      label: 'Strain'    },
    { key: 'type',      label: 'Type'      },
    { key: 'parent',    label: 'Parent'    },
    { key: 'parent2',   label: 'Parent 2'  },
    { key: 'birthTick', label: 'Born, day' },
    { key: 'antigen',   label: 'Antigen'   },
    { key: 'gen',       label: 'Generation' }
];

// Build a per-strain "target" object that buildSliderRow can read/write
// through. The object captures a closure over `detailEl._genomeState`, which
// holds the currently-selected (registry, strainId) pair; mutating it
// retargets every slider's reads + writes without rebuilding the DOM.
function makeGenomeTarget(detailEl, key) {
    return {
        get [key]() {
            const st = detailEl._genomeState;
            if (!st || !st.registry || st.strainId === null) return 0;
            const col = st.registry[key];
            return (col && col[st.strainId] !== undefined) ? col[st.strainId] : 0;
        },
        set [key](v) {
            const st = detailEl._genomeState;
            if (!st || !st.registry || st.strainId === null) return;
            const col = st.registry[key];
            if (!col) return;
            col[st.strainId] = v;
        }
    };
}

function buildDetailSkeleton(detailEl) {
    // Wipe whatever was here. NB: the row-pool / lastVals caches on
    // panelEl._lineageRefs live on the panel, not on the detail block, so
    // clearing the detail block can't disturb them.
    while (detailEl.firstChild) detailEl.removeChild(detailEl.firstChild);

    // Initialise the closure-state object the genome-target proxies read.
    // null sentinel for strainId means "no strain selected" — proxies short-
    // circuit so a slider drag with no selection is a no-op.
    detailEl._genomeState = { registry: null, strainId: null };

    // ── Header rows (read-only) ────────────────────────────────────────────
    for (const f of HEADER_FIELDS) {
        const row = document.createElement('div');
        row.className = 'stat-row';
        row.dataset.detailField = f.key;

        const label = document.createElement('span');
        label.className = 'stat-label';
        label.textContent = f.label;
        row.appendChild(label);

        const value = document.createElement('span');
        value.className = 'stat-value';
        value.dataset.role = 'detail-' + f.key;
        value.textContent = '—';
        row.appendChild(value);

        detailEl.appendChild(row);
    }

    // ── Genome editor section ──────────────────────────────────────────────
    // Headings use the `.toggles-section-header` class shared with the
    // toggles panel + presets list; visual treatment is consistent across
    // every grouped-rows surface in the sidebar.
    const refs = Object.create(null);
    for (const spec of STRAIN_GENOME_LAYOUT) {
        if (spec.heading) {
            const hdr = document.createElement('div');
            hdr.className = 'toggles-section-header';
            hdr.textContent = spec.heading;
            detailEl.appendChild(hdr);
            continue;
        }
        const target = makeGenomeTarget(detailEl, spec.key);
        const row = buildSliderRow(spec, target);
        detailEl.appendChild(row);
        refs[spec.key] = {
            slider: row.querySelector('input[type="range"]'),
            valEl:  row.querySelector('[data-role="value"]'),
            digits: spec.digits
        };
    }
    detailEl._genomeRefs = refs;

    detailEl.dataset.detailReady = '1';
}

// Refresh every genome slider's value + display from the registry. Called
// on strain switch (after retargeting `_genomeState.strainId`) and from
// renderStrainPanel's refresh when the selected strain is still alive.
function syncGenomeSliders(detailEl, registry, strainId) {
    const refs = detailEl._genomeRefs;
    if (!refs) return;
    for (const spec of STRAIN_GENOME_LAYOUT) {
        if (!spec.key) continue;
        const ref = refs[spec.key];
        if (!ref) continue;
        const col = registry[spec.key];
        const v = (col && col[strainId] !== undefined) ? col[strainId] : 0;
        // Skip writes that don't change the rendered string — keeps the input
        // node clean of redundant value churn while the user is actively
        // dragging it (the input value drives the slider thumb position).
        const vs = String(v);
        if (ref.slider && ref.slider.value !== vs) ref.slider.value = vs;
        const text = Number(v).toFixed(ref.digits);
        if (ref.valEl && ref.valEl.textContent !== text) ref.valEl.textContent = text;
    }
}

function updateDetail(detailEl, registry, strainId) {
    if (detailEl.dataset.detailReady !== '1') {
        buildDetailSkeleton(detailEl);
    }
    const s = getStrain(registry, strainId);
    if (s === null) {
        detailEl.style.display = 'none';
        return;
    }

    // Retarget the proxy-state used by every genome-editor slider. Subsequent
    // slider drags will now write into reg.<key>[strainId] for this strain.
    detailEl._genomeState.registry = registry;
    detailEl._genomeState.strainId = strainId;

    const set = (key, text) => {
        const el = detailEl.querySelector(`[data-role="detail-${key}"]`);
        if (el) el.textContent = text;
    };

    const showRow = (key, visible) => {
        const el = detailEl.querySelector(`[data-role="detail-${key}"]`);
        if (!el || !el.parentElement) return;
        el.parentElement.style.display = visible ? '' : 'none';
    };

    // Phase B: append "(extinct)" tag when the registry has tombstoned this
    // strain. The detail block normally closes for extinct selections (see
    // renderStrainPanel), but a stale snapshot could land here briefly when
    // the user clicks a forest node just before the extinction sweep fires.
    set('name', s.extinct ? `${s.name} (extinct)` : s.name);

    // parent2 may be missing on a registry built before Phase 8 — treat
    // undefined the same as null (point mutant). Hybrid status drives both
    // the "Type" label and the conditional Parent 2 row.
    const p2 = (s.parent2 === undefined) ? null : s.parent2;
    const isHybrid = (p2 !== null);
    set('type', isHybrid ? 'Hybrid' : 'Point mutant');

    if (s.parent === null || s.parent === undefined) {
        set('parent', '—');
    } else {
        const p = getStrain(registry, s.parent);
        set('parent', p ? p.name : `#${s.parent}`);
    }

    if (isHybrid) {
        const p2obj = getStrain(registry, p2);
        set('parent2', p2obj ? p2obj.name : `#${p2}`);
        showRow('parent2', true);
    } else {
        set('parent2', '—');
        showRow('parent2', false);
    }

    set('birthTick', String(s.birthTick));
    set('antigen', `${s.agX.toFixed(2)}, ${s.agY.toFixed(2)} · ${agDist(0, 0, s.agX, s.agY).toFixed(2)} AU from α`);
    set('gen', String(s.gen));

    // Pull every genome-editor slider value from the registry. Cheap text-
    // equality guards skip no-op writes — when the same strain is updated
    // tick-over-tick with no parameter drift this loop does zero DOM work.
    syncGenomeSliders(detailEl, registry, strainId);

    detailEl.style.display = '';
}

// Phase C: the per-detail-block lineage-tree canvas was removed — Phase D
// replaces it with a force-directed forest at the strain panel's top. The
// per-strain detail block now focuses on the live genome editor.

// ─── Time-scaled phylogeny ─────────────────────────────────────────────────
//
// Each strain is a branch drawn along real time, from the day it emerged to
// the day it went extinct (or today), and joins its parent with a vertical
// connector on its birth day; a recombinant's second parent joins with a
// dashed one. Rows are ladderized depth-first, children under their parent in
// birth order. A living branch's weight is its current prevalence and it ends
// in its plate swatch (ink and hatch angle); an extinct branch ends in a bar.
// Only living strains and their ancestors are drawn, at most PHYLO_MAX_ROWS.

const PHYLO_MAX_ROWS = 28;
const _phylo = { rows: [], x0: 0, x1: 1, t1: 1, rowH: 10, top: 0, hidden: 0 };

function phyloRows(registry, prevalence) {
    const n = strainCount(registry);
    const keep = new Uint8Array(n);
    const live = [];
    for (let id = 0; id < n; id++) if (!isExtinct(registry, id)) live.push(id);
    const prev = new Map(prevalence.map(p => [p.id, p.count]));
    live.sort((a, b) => (prev.get(b) || 0) - (prev.get(a) || 0));
    _phylo.hidden = Math.max(0, live.length - PHYLO_MAX_ROWS);
    for (const id of live.slice(0, PHYLO_MAX_ROWS)) {
        for (let k = id; k >= 0 && k < n && !keep[k]; k = registry.parent[k]) keep[k] = 1;
    }
    const kids = new Map();
    for (let id = 1; id < n; id++) {
        if (!keep[id]) continue;
        const p = registry.parent[id];
        if (!kids.has(p)) kids.set(p, []);
        kids.get(p).push(id);
    }
    const order = [];
    const visit = (id) => {
        if (order.length >= PHYLO_MAX_ROWS + 24) return;
        order.push(id);
        for (const c of kids.get(id) || []) visit(c);
    };
    if (n && keep[0]) visit(0);
    // roots other than α (shouldn't happen, but keep them visible)
    for (let id = 1; id < n; id++) if (keep[id] && !(registry.parent[id] >= 0 && keep[registry.parent[id]])) if (!order.includes(id)) visit(id);
    return order;
}

function renderPhylogeny(canvas, registry, prevalence, selectedId, tick) {
    const rows = phyloRows(registry, prevalence);
    const rowH = rows.length > 30 ? 7 : rows.length > 18 ? 10 : 13;
    const cssH = Math.max(64, Math.min(420, rows.length * rowH + (_phylo.hidden ? 52 : 38)));
    if (Math.abs(canvas.clientHeight - cssH) > 1) canvas.style.height = cssH + 'px';
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 300, h = cssH;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    const c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const P = _themePalette();
    const now = Math.max(1, tick | 0);
    const x0 = 6, x1 = w - 46, top = 10;
    const X = (t) => x0 + (x1 - x0) * Math.max(0, Math.min(1, t / now));
    const yOf = new Map(rows.map((id, i) => [id, top + i * rowH + rowH / 2]));
    const prev = new Map(prevalence.map(p => [p.id, p.count]));
    let maxPrev = 1;
    for (const v of prev.values()) if (v > maxPrev) maxPrev = v;
    Object.assign(_phylo, { rows, x0, x1, t1: now, rowH, top });
    const muted = P.textMuted, rule = rgbaHex(P.text, 0.2);
    // time axis
    const ay = top + rows.length * rowH + 10;
    c.strokeStyle = rule; c.lineWidth = 1;
    c.beginPath(); c.moveTo(x0, ay); c.lineTo(x1, ay); c.stroke();
    c.font = `11px ${_FONT.text}`; c.fillStyle = muted; c.textAlign = 'center'; c.textBaseline = 'top';
    const step = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000].find(s => now / s <= 5) || 10000;
    for (let t = 0; t <= now; t += step) {
        const x = X(t);
        c.beginPath(); c.moveTo(x, ay); c.lineTo(x, ay + 3); c.stroke();
        c.fillText(String(t), x, ay + 5);
    }
    c.textAlign = 'right';
    c.fillText('day', w - 4, ay + 5);
    if (_phylo.hidden) {
        c.textAlign = 'left'; c.font = `italic 11px ${_FONT.text}`;
        c.fillText(`+${_phylo.hidden}`, x0, ay + 19);
    }
    for (const id of rows) {
        const st = strainStyle(registry, id), y = yOf.get(id);
        const born = registry.birthTick[id] | 0;
        const dead = !!registry.extinct[id];
        const end = dead ? (registry.extinctTick[id] | 0) : now;
        const p = registry.parent[id], p2 = registry.parents2 ? registry.parents2[id] : -1;
        const ink = id === selectedId ? P.accent : st.ink;
        c.strokeStyle = ink;
        if (p >= 0 && yOf.has(p)) {
            c.lineWidth = 1;
            c.beginPath(); c.moveTo(X(born), yOf.get(p)); c.lineTo(X(born), y); c.stroke();
        }
        if (p2 >= 0 && p2 !== EMPTY_STRAIN && yOf.has(p2)) {
            c.setLineDash([2, 2]); c.lineWidth = 1;
            c.beginPath(); c.moveTo(X(born), yOf.get(p2)); c.lineTo(X(born), y); c.stroke();
            c.setLineDash([]);
        }
        const lw = dead ? 1 : 1 + 4 * Math.sqrt((prev.get(id) || 0) / maxPrev);
        c.lineWidth = lw;
        c.beginPath(); c.moveTo(X(born), y); c.lineTo(X(end), y); c.stroke();
        if (dead) {
            c.lineWidth = 1;
            c.beginPath(); c.moveTo(X(end), y - 2.5); c.lineTo(X(end), y + 2.5); c.stroke();
        } else {
            tipSwatch(c, X(end) + 7, y, Math.min(5, rowH * 0.45), st, ink);
            if (rowH >= 9) {
                c.font = `italic 11px ${_FONT.text}`; c.fillStyle = id === selectedId ? P.accent : P.textSecondary;
                c.textAlign = 'left'; c.textBaseline = 'middle';
                c.fillText(registry.names[id], X(end) + 14, y + 0.5);
            }
        }
    }
}

function tipSwatch(c, x, y, r, st, ink) {
    c.save();
    c.beginPath();
    const hh = r * 0.866;
    c.moveTo(x, y - r); c.lineTo(x + hh, y - r / 2); c.lineTo(x + hh, y + r / 2); c.lineTo(x, y + r); c.lineTo(x - hh, y + r / 2); c.lineTo(x - hh, y - r / 2); c.closePath();
    c.clip();
    c.strokeStyle = ink; c.lineWidth = 1;
    const a = st.angle * Math.PI / 180, ux = Math.cos(a), uy = Math.sin(a);
    c.beginPath();
    for (let s = -r; s <= r; s += 2.2) { c.moveTo(x - uy * s - ux * r * 1.5, y + ux * s - uy * r * 1.5); c.lineTo(x - uy * s + ux * r * 1.5, y + ux * s + uy * r * 1.5); }
    c.stroke();
    c.restore();
}

function rgbaHex(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function pickPhylo(px, py) {
    const { rows, rowH, top } = _phylo;
    const i = Math.floor((py - top) / rowH);
    return i >= 0 && i < rows.length ? rows[i] : -1;
}

// Public hook for the panel's selection flow — mark a row active, refresh
// the detail block, fire the user-supplied onClick. Extracted so the canvas
// click handler and the row click handler both route through the same code
// path (single source of truth for "select strain id N").
function selectStrain(panelEl, id) {
    const refs = panelEl._lineageRefs;
    if (!refs) return;
    if (refs.listEl) {
        clearActiveRow(refs.listEl);
        const rec = refs.rowPool && refs.rowPool.get(id);
        if (rec && rec.row) rec.row.classList.add('active');
    }
    if (refs.detailEl) {
        const reg = panelEl._lineageRegistry;
        if (reg) updateDetail(refs.detailEl, reg, id);
    }
    const cb = panelEl._lineageOnClick;
    if (typeof cb === 'function') cb(id);
}


function clearActiveRow(listEl) {
    const prev = listEl.querySelector('.strain-row.active');
    if (prev) prev.classList.remove('active');
}

// Build a row record (DOM + cached children). Used by ensureRow when a new
// strain id appears in the top-N for the first time. Returned record is
// stashed in the row pool keyed by id; subsequent renders mutate text /
// width / class on the same nodes without recreating them.
// A row's swatch and bar take the strain's mark (strain-style.js) for the
// current theme; repainted when the id is reused or the theme changes.
function paintRow(rec, registry, id) {
    const st = strainStyle(registry, id);
    rec.row.style.setProperty('--strain-color', st.ink);
    rec.swatch.style.background = `repeating-linear-gradient(${st.angle.toFixed(1)}deg, ${st.ink} 0 1px, transparent 1px 3px)`;
    rec.theme = document.documentElement.dataset.theme;
}

function buildRow(id, name, panelEl, onClick) {
    const el = document.createElement('div');
    el.className = 'strain-row';
    el.dataset.strainId = String(id);

    const swatch = document.createElement('span');
    swatch.className = 'strain-swatch';
    el.appendChild(swatch);

    const nameEl = document.createElement('span');
    nameEl.className = 'strain-name';
    nameEl.textContent = name;
    el.appendChild(nameEl);

    const prev = document.createElement('span');
    prev.className = 'strain-prev';
    el.appendChild(prev);

    const bar = document.createElement('div');
    bar.className = 'strain-bar';
    const fill = document.createElement('div');
    fill.className = 'strain-bar-fill';
    bar.appendChild(fill);
    el.appendChild(bar);

    el.addEventListener('click', () => {
        // Refs cached on the panel — built once in buildPanelSkeleton.
        const refs = panelEl._lineageRefs;
        if (refs && refs.listEl) {
            clearActiveRow(refs.listEl);
            el.classList.add('active');
        }
        const rid = parseInt(el.dataset.strainId, 10);
        if (refs && refs.detailEl) {
            // The current registry handle is stashed by renderStrainPanel on
            // each update so the click handler picks up the latest reference.
            const reg = panelEl._lineageRegistry;
            if (reg) updateDetail(refs.detailEl, reg, rid);
        }
        if (typeof onClick === 'function') onClick(rid);
    });

    return { row: el, swatch, name: nameEl, prev, fill, theme: null };
}

/**
 * Render (or update) the strain panel. Idempotent: first call builds the
 * skeleton; subsequent calls update the total count, rebuild the row list
 * (top-MAX_ROWS by prevalence), and refresh the hidden-count hint. The
 * detail block is only built on first click and updated thereafter.
 *
 * The list is cleared and rebuilt each call — top-8 means at most 8
 * createElement calls per stats tick, which is cheap enough to skip the
 * diff-by-data-strain-id dance that compartments use.
 *
 * @param {HTMLElement} panelEl — the #tab-strains container
 * @param {Array<{id:number, name:string, count:number, fraction:number}>} prevalence
 * @param {object} registry — for detail-block parent lookups
 * @param {(strainId:number) => void} [onClick]
 * @param {number} [tick] — today, the right edge of the phylogeny's time axis
 * @param {{vax:{x:number,y:number}, onMatchVaccine:(id:number)=>void}} [extra]
 *   — the vaccine's antigen, and what "match the vaccine" does
 */
export function renderStrainPanel(panelEl, prevalence, registry, onClick, tick, extra) {
    if (!panelEl) return;
    if (panelEl.dataset.lineageReady !== '1') {
        buildPanelSkeleton(panelEl);
    }

    // Bail early when the tab isn't visible — the .tab-panel rule sets
    // display:none on inactive tabs, so any DOM work here is invisible until
    // the user clicks back into Strains. classList beats offsetParent because
    // reading offsetParent forces a sync layout flush; checking the class is
    // a string compare. main.js's wakeRenders() catches the visibility flip
    // on tab switch so freshness is fine.
    if (!panelEl.classList.contains('active')) return;

    // Stash the registry + onClick on the panel so click handlers (row +
    // forest canvas) can read the latest references at click time.
    panelEl._lineageRegistry = registry;
    panelEl._lineageOnClick = onClick;

    const refs = panelEl._lineageRefs;
    const { forestEl, totalEl, listEl, hintEl, detailEl, rowPool, shownIds, lastVals } = refs;

    // Header total. Phase B: "alive" = registry-living (extinct flag not set);
    // "extinct" = explicitly tombstoned. Before Phase B this was a heuristic
    // (registry-size − prevalence-count) which over-counted "extinct" for
    // strains that simply had no I cells right now — the new flag-based
    // counts are honest about which strains are gone for good vs. dormant.
    const aliveCount = registry ? countLiving(registry) : 0;
    const extinct = registry ? bornCount(registry) - aliveCount : 0;
    const totalText = extinct > 0
        ? aliveCount + ' alive · ' + extinct + ' extinct'
        : aliveCount + ' alive';
    if (totalEl.textContent !== totalText) totalEl.textContent = totalText;

    // Remember the currently-active strain ID (if any) so we can re-mark it
    // after the update and not lose the user's selection on a stats tick.
    const activeEl = listEl.querySelector('.strain-row.active');
    const activeId = activeEl ? parseInt(activeEl.dataset.strainId, 10) : null;

    // Pull top-MAX_ROWS into a stable, scratch-friendly shape.
    const visibleCount = prevalence.length < MAX_ROWS ? prevalence.length : MAX_ROWS;

    // Detect whether the displayed set + order is unchanged from last tick.
    // When it is we skip the DOM reorder entirely; we still update per-row
    // text/width because counts shift even when ranks don't.
    let orderUnchanged = (shownIds.length === visibleCount);
    if (orderUnchanged) {
        for (let i = 0; i < visibleCount; i++) {
            if (shownIds[i] !== prevalence[i].id) { orderUnchanged = false; break; }
        }
    }

    // Update / build rows. New ids get a row created on demand from the pool;
    // ids that fell out get their row detached (kept in the pool for reuse
    // when they come back). Text updates skip when (count, fraction) match
    // last tick's cached values.
    for (let i = 0; i < visibleCount; i++) {
        const row = prevalence[i];
        let rec = rowPool.get(row.id);
        if (!rec) {
            rec = buildRow(row.id, row.name, panelEl, onClick);
            rowPool.set(row.id, rec);
            paintRow(rec, registry, row.id);
        } else if (rec.name.textContent !== row.name) {
            // A reclaimed id reused by a new strain (names follow births).
            rec.name.textContent = row.name;
            paintRow(rec, registry, row.id);
        } else if (rec.theme !== document.documentElement.dataset.theme) {
            paintRow(rec, registry, row.id);
        }

        const last = lastVals.get(row.id);
        if (!last || last.count !== row.count || last.fraction !== row.fraction) {
            const pct = row.fraction * 100;
            const pctStr = pct >= 10 ? pct.toFixed(0) : pct.toFixed(1);
            // Counts are load-weighted (coinfection apportioned by load), so
            // they round to whole carriers.
            const countStr = row.count < 0.5 ? '<1' : Math.round(row.count).toLocaleString('en-US');
            rec.prev.textContent = countStr + ' · ' + pctStr + '%';
            rec.fill.style.width = pct.toFixed(2) + '%';
            if (last) { last.count = row.count; last.fraction = row.fraction; }
            else lastVals.set(row.id, { count: row.count, fraction: row.fraction });
        }

        const wantActive = (activeId !== null && row.id === activeId);
        if (wantActive !== rec.row.classList.contains('active')) {
            rec.row.classList.toggle('active', wantActive);
        }
    }

    if (!orderUnchanged) {
        // Reorder / attach in one pass. appendChild on an already-attached node
        // moves it without detaching first, so this is cheap when ranks shift.
        for (let i = 0; i < visibleCount; i++) {
            const rec = rowPool.get(prevalence[i].id);
            if (rec.row.parentNode !== listEl || listEl.children[i] !== rec.row) {
                listEl.appendChild(rec.row);
            }
        }
        // Remove any leftover rows that fell out of the top-N.
        while (listEl.children.length > visibleCount) {
            listEl.removeChild(listEl.lastChild);
        }
        // Rewrite the shown-ids cache.
        shownIds.length = visibleCount;
        for (let i = 0; i < visibleCount; i++) shownIds[i] = prevalence[i].id;
    }

    // Drop pool entries for strains that have gone extinct (count === 0 means
    // they're not in `prevalence`). Strain IDs are append-only — an extinct
    // strain won't ever resurrect with the same ID — so it's safe to release
    // the DOM nodes + cached values. Builds a small Set of alive IDs first
    // so the sweep is O(P + alive).
    const aliveIds = new Set();
    for (let i = 0; i < prevalence.length; i++) aliveIds.add(prevalence[i].id);
    for (const id of rowPool.keys()) {
        if (aliveIds.has(id)) continue;
        const rec = rowPool.get(id);
        if (rec && rec.row && rec.row.parentNode) {
            rec.row.parentNode.removeChild(rec.row);
        }
        rowPool.delete(id);
        lastVals.delete(id);
    }

    // Hidden-count hint — only shown when the registry holds more strains
    // than we're displaying. Counts strains beyond the top-MAX_ROWS cut.
    const overflow = prevalence.length > MAX_ROWS ? prevalence.length - MAX_ROWS : 0;
    if (overflow > 0) {
        const hintText = '+' + overflow;
        if (hintEl.textContent !== hintText) hintEl.textContent = hintText;
        if (hintEl.style.display === 'none') hintEl.style.display = '';
    } else if (hintEl.style.display !== 'none') {
        hintEl.textContent = '';
        hintEl.style.display = 'none';
    }

    // If a row is currently selected and the underlying strain still exists
    // AND is not tombstoned, refresh the detail block. Using the registry
    // extinction flag (Phase B) instead of the prevalence-derived aliveIds
    // set means a strain that's only present in memory cells (M / R+CARRIER /
    // D+F / vax) keeps its detail block open while editable — they don't show
    // in prevalence (load=0 filter) but they're meaningfully alive.
    if (activeId !== null && getStrain(registry, activeId) !== null && !isExtinct(registry, activeId)) {
        updateDetail(detailEl, registry, activeId);
    } else if (activeId !== null) {
        detailEl.style.display = 'none';
    }

    // ── Antigenic map ──
    const vax = extra && extra.vax;
    panelEl._lineageMatchVaccine = extra && extra.onMatchVaccine;
    if (registry && refs.agMapEl) {
        const target = activeId !== null && getStrain(registry, activeId) && !isExtinct(registry, activeId)
            ? activeId : (prevalence.length ? prevalence[0].id : 0);
        panelEl._lineageVaxTarget = target;
        const label = 'Match vaccine to ' + registry.names[target];
        if (refs.vaxBtn.textContent !== label) refs.vaxBtn.textContent = label;
        const now = performance.now();
        const signature = bornCount(registry) + '|' + countLiving(registry) + '|' + activeId + '|' + (vax ? vax.x + ',' + vax.y : '') + '|' + document.documentElement.dataset.theme;
        if (now - refs.lastMapDraw >= 250 || refs.lastMapSignature !== signature) {
            const m = renderAntigenicMap(refs.agMapEl, registry, prevalence, activeId, vax);
            const text = `Antigenic map · lead ${m.name} · ${m.fromA.toFixed(1)} AU from α` +
                (vax ? ` · ${m.fromV.toFixed(1)} from vaccine` : '');
            if (refs.agCapEl.textContent !== text) refs.agCapEl.textContent = text;
            refs.lastMapSignature = signature;
            refs.lastMapDraw = now;
        }
    }

    // ── Phylogeny ──
    if (registry && forestEl) {
        const now = performance.now();
        const signature = bornCount(registry) + '|' + countLiving(registry) + '|' + (activeId === null ? '' : activeId) + '|' + document.documentElement.dataset.theme;
        if (now - refs.lastForestDraw >= 250 || refs.lastForestSignature !== signature) {
            renderPhylogeny(forestEl, registry, prevalence, activeId, tick);
            refs.lastForestSignature = signature;
            refs.lastForestDraw = now;
        }
    }
}
