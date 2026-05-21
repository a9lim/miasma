// lineage.js — strain registry panel renderer and throttled lineage forest.
//
// Two exports:
//   computeStrainPrevalence(grid, registry, maxSlot)  — load-weighted tally of active strain slots
//   renderStrainPanel(panelEl, prevalence, registry, onClick?) — idempotent build/update
//
// The strain tab shows a throttled force-layout forest plus the top-8 most-
// prevalent strains as horizontal bars. Clicking a row or forest node reveals
// a detail block with the strain genome and lineage parentage.
//
// Mirrors the stats.js pattern: build skeleton once (data-lineage-ready='1'),
// then mutate text + bar widths on subsequent calls. The top-8 list is small
// enough that clear-and-rebuild on every update is cheap and keeps the row
// ordering trivially correct.
//
// No innerHTML — all DOM via createElement / textContent / style.cssText
// per the repo's pre-commit hook.

import {
    strainCount,
    countLiving,
    getStrain,
    isExtinct,
    EMPTY_STRAIN
} from './strains.js';
import { STRAIN_GENOME_LAYOUT, buildSliderRow } from './params.js';
import { Compartment } from './config.js';

// Top-K list cap. Anything beyond this gets surfaced via the "+N hidden" hint.
const MAX_ROWS = 8;

// Golden-ratio hue distribution — multiplies the strain ID by ~137.508° so
// successive strains land far apart on the hue wheel and stay well-separated
// even at high registry counts. Same trick used for swatch palettes in lots
// of viz toolkits; cheap, deterministic, and ID-stable across re-renders.
const HUE_STEP = 137.508;
const HUE_SAT  = 60; // %, fixed for now — saturation knob isn't worth a token
const HUE_LIGHT = 55; // %, sits between bg-panel and text on both themes

function strainHue(id) {
    // Deterministic, ID-stable. No need to normalize negatives — IDs are Uint16.
    return (id * HUE_STEP) % 360;
}

function strainHsl(id) {
    return `hsl(${strainHue(id).toFixed(2)}, ${HUE_SAT}%, ${HUE_LIGHT}%)`;
}

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
    // Wipe any placeholder content (the Phase-1 .panel-hint).
    while (panelEl.firstChild) panelEl.removeChild(panelEl.firstChild);

    // Phase D: force-directed strain forest. Sits above the rankings list
    // so users see the lineage shape first, then the dominant strains.
    // Click hit-test routes through selectStrain → same flow as a row click.
    const forest = document.createElement('canvas');
    forest.className = 'strain-forest-canvas';
    forest.dataset.role = 'lineage-forest';
    forest.setAttribute('aria-label', 'Strain lineage forest');
    forest.addEventListener('click', (ev) => {
        const rect = forest.getBoundingClientRect();
        const px = ev.clientX - rect.left;
        const py = ev.clientY - rect.top;
        const id = pickForestNode(px, py);
        if (id !== -1) selectStrain(panelEl, id);
    });
    panelEl.appendChild(forest);

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
    { key: 'birthTick', label: 'Born tick' }
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

    // Pull every genome-editor slider value from the registry. Cheap text-
    // equality guards skip no-op writes — when the same strain is updated
    // tick-over-tick with no parameter drift this loop does zero DOM work.
    syncGenomeSliders(detailEl, registry, strainId);

    detailEl.style.display = '';
}

// Phase C: the per-detail-block lineage-tree canvas was removed — Phase D
// replaces it with a force-directed forest at the strain panel's top. The
// per-strain detail block now focuses on the live genome editor.

// ─── Phase D: force-directed strain forest ─────────────────────────────────
//
// A canvas at the top of the strains panel renders all currently-alive
// strains as nodes in a force-directed graph, edges connecting each strain
// to its nearest *alive* ancestor (walks up `parent` for extinct
// intermediates so the forest stays topologically connected through living
// lineages; hybrids draw a second dashed edge to their alive parent2 / its
// nearest alive ancestor).
//
// Layout state lives in module scope so it survives across renders. New
// nodes spawn at their alive parent's position with a few px of jitter,
// the spring layout pulls them into place gradually, and cooling decays
// per step so the layout settles when the alive set is stable. A change
// in the alive set re-heats cooling so the new node has time to find its
// place.
//
// Click hit-test: a node click invokes the panel's stashed selection
// pipeline (same as a rankings-row click) — marks the corresponding row
// active, opens the genome editor in the detail block, fires onClick.

const FOREST_REPULSION       = 1800;    // Coulomb constant (raw)
const FOREST_SPRING_K        = 0.045;   // Hooke spring constant (per edge)
const FOREST_SPRING_LEN      = 52;      // rest length (px)
const FOREST_CENTER_PULL     = 0.006;   // weak gravity toward canvas centre
const FOREST_DAMPING         = 0.72;    // velocity damping per step
const FOREST_COOLING_DECAY   = 0.985;
const FOREST_COOLING_RESEED  = 0.9;     // re-heat target when alive set changes
const FOREST_COOLING_MIN     = 0.05;    // below this we skip the layout step
const FOREST_NODE_MIN_RADIUS = 4;
const FOREST_NODE_MAX_RADIUS = 14;
const FOREST_CLICK_RADIUS_SQ = 18 * 18; // node hit-test radius² (CSS px)

// Module-private layout state. Resets implicitly when the registry is
// rebuilt (resetGridOnly) because the strain IDs change — extinct entries
// are pruned during ensureForestPositions and new ones bootstrap from the
// parent's position.
const _forestLayout = {
    positions: new Map(),   // strainId → {x, y, vx, vy}
    cooling:   1.0
};

// Walk parent links upward until we hit an alive strain or run out. Used
// to render lineage edges through extinct intermediates without dangling
// orphans in the canvas. Returns the alive ancestor's id, or -1 when
// there's no alive ancestor on this chain.
function nearestAliveAncestor(registry, startId, aliveSet) {
    let cur = registry.parent[startId];
    let safety = 1000; // anti-cycle (registry is append-only DAG; shouldn't hit)
    while (cur !== null && cur !== undefined && safety-- > 0) {
        if (aliveSet.has(cur)) return cur;
        cur = registry.parent[cur];
    }
    return -1;
}
// Same idea but starting from the parent2 link (hybrid second-parent edge).
// After the first hop into the parent2 chain we walk via primary parents.
function nearestAliveAncestor2(registry, startId, aliveSet) {
    let cur = registry.parents2[startId];
    let safety = 1000;
    while (cur !== null && cur !== undefined && safety-- > 0) {
        if (aliveSet.has(cur)) return cur;
        cur = registry.parent[cur];
    }
    return -1;
}

// Add positions for any alive strain that doesn't have one yet (spawned
// near its alive parent's position + jitter so the spring layout has
// somewhere coherent to start). Drop positions for ids that are no
// longer alive. Re-heat cooling when the alive set changed.
function ensureForestPositions(aliveIds, registry, w, h) {
    const positions = _forestLayout.positions;
    let changed = false;
    const aliveSet = new Set(aliveIds);

    for (const id of aliveIds) {
        if (positions.has(id)) continue;
        changed = true;
        let x = w / 2;
        let y = h / 2;
        const pid = registry.parent[id];
        if (pid !== null && pid !== undefined && positions.has(pid)) {
            const pp = positions.get(pid);
            x = pp.x + (Math.random() - 0.5) * 18;
            y = pp.y + (Math.random() - 0.5) * 18;
        } else {
            x += (Math.random() - 0.5) * 60;
            y += (Math.random() - 0.5) * 60;
        }
        positions.set(id, { x, y, vx: 0, vy: 0 });
    }
    for (const id of Array.from(positions.keys())) {
        if (!aliveSet.has(id)) {
            positions.delete(id);
            changed = true;
        }
    }
    if (changed) {
        _forestLayout.cooling = Math.max(_forestLayout.cooling, FOREST_COOLING_RESEED);
    }
}

// One Fruchterman-Reingold-flavoured step: pairwise repulsion, edge
// attraction to nearest alive ancestor(s), weak center pull, integration,
// damping, bounds clamp, then cooling decay. Bails early when cooling is
// below FOREST_COOLING_MIN — the layout has settled.
function stepForestLayout(aliveIds, registry, w, h) {
    if (_forestLayout.cooling < FOREST_COOLING_MIN) return;
    const positions = _forestLayout.positions;
    const cx = w / 2;
    const cy = h / 2;
    const aliveSet = new Set(aliveIds);

    // Repulsion — every pair pushes apart. O(n²) but n is bounded by the
    // alive strain count which sits in the dozens for realistic runs.
    for (let i = 0; i < aliveIds.length; i++) {
        const a = positions.get(aliveIds[i]);
        if (!a) continue;
        for (let j = i + 1; j < aliveIds.length; j++) {
            const b = positions.get(aliveIds[j]);
            if (!b) continue;
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            let d2 = dx * dx + dy * dy;
            if (d2 < 1) d2 = 1;
            const d = Math.sqrt(d2);
            const force = FOREST_REPULSION / d2;
            const fx = (dx / d) * force;
            const fy = (dy / d) * force;
            a.vx += fx; a.vy += fy;
            b.vx -= fx; b.vy -= fy;
        }
    }

    // Attraction (Hooke) to alive parents + weak center pull. Edges go to
    // nearest alive ancestor on each parent chain.
    for (let i = 0; i < aliveIds.length; i++) {
        const id = aliveIds[i];
        const a = positions.get(id);
        if (!a) continue;
        const pA = nearestAliveAncestor(registry, id, aliveSet);
        const pB = nearestAliveAncestor2(registry, id, aliveSet);
        if (pA !== -1) {
            const p = positions.get(pA);
            if (p) {
                const dx = p.x - a.x;
                const dy = p.y - a.y;
                const d = Math.sqrt(dx * dx + dy * dy) || 1;
                const force = FOREST_SPRING_K * (d - FOREST_SPRING_LEN);
                const fx = (dx / d) * force;
                const fy = (dy / d) * force;
                a.vx += fx; a.vy += fy;
                p.vx -= fx; p.vy -= fy;
            }
        }
        if (pB !== -1 && pB !== pA) {
            const p = positions.get(pB);
            if (p) {
                const dx = p.x - a.x;
                const dy = p.y - a.y;
                const d = Math.sqrt(dx * dx + dy * dy) || 1;
                // Half-strength on the parent2 edge so hybrids don't get
                // double the spring pull as point mutants.
                const force = 0.5 * FOREST_SPRING_K * (d - FOREST_SPRING_LEN);
                const fx = (dx / d) * force;
                const fy = (dy / d) * force;
                a.vx += fx; a.vy += fy;
                p.vx -= fx; p.vy -= fy;
            }
        }
        a.vx += (cx - a.x) * FOREST_CENTER_PULL;
        a.vy += (cy - a.y) * FOREST_CENTER_PULL;
    }

    // Integrate + damp + bounds clamp.
    const step = _forestLayout.cooling;
    for (const id of aliveIds) {
        const p = positions.get(id);
        if (!p) continue;
        p.x += p.vx * step;
        p.y += p.vy * step;
        p.vx *= FOREST_DAMPING;
        p.vy *= FOREST_DAMPING;
        if (p.x < 10) p.x = 10;
        if (p.y < 10) p.y = 10;
        if (p.x > w - 10) p.x = w - 10;
        if (p.y > h - 10) p.y = h - 10;
    }

    _forestLayout.cooling *= FOREST_COOLING_DECAY;
}

// Draw the forest. Edges underlay nodes; hybrid parent2 edges are dashed
// so they read as "secondary parentage" without needing a separate hue.
// Node radius scales with log(1 + prevalence count) so dominant strains
// pop visually.
function renderForest(canvas, aliveIds, prevalence, registry, selectedId) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Shared util signature is (canvas, ctx, opts) — the second positional
    // arg is the rendering context. Sets the transform to dpr-scale so we
    // draw in CSS pixels regardless of devicePixelRatio.
    if (typeof window !== 'undefined' && typeof window.resizeCanvasDPR === 'function') {
        window.resizeCanvasDPR(canvas, ctx);
    }
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    ctx.clearRect(0, 0, w, h);

    const prevById = new Map();
    for (const row of prevalence) prevById.set(row.id, row.count);
    const positions = _forestLayout.positions;
    const aliveSet = new Set(aliveIds);

    // Edge colour reads from a CSS variable so light/dark themes pick it
    // up automatically. We compute on the canvas because getComputedStyle
    // is cheap once per render.
    let edgeColor = 'rgba(127,127,127,0.45)';
    if (typeof window !== 'undefined' && window.getComputedStyle) {
        const cs = window.getComputedStyle(canvas);
        const v = cs.getPropertyValue('--text-secondary')
            || cs.getPropertyValue('--text-muted');
        if (v) edgeColor = v.trim() || edgeColor;
    }
    ctx.strokeStyle = edgeColor;
    ctx.lineWidth = 1;

    for (const id of aliveIds) {
        const a = positions.get(id);
        if (!a) continue;
        const pA = nearestAliveAncestor(registry, id, aliveSet);
        if (pA !== -1) {
            const p = positions.get(pA);
            if (p) {
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.moveTo(p.x, p.y);
                ctx.lineTo(a.x, a.y);
                ctx.stroke();
            }
        }
        const pB = nearestAliveAncestor2(registry, id, aliveSet);
        if (pB !== -1 && pB !== pA) {
            const p = positions.get(pB);
            if (p) {
                ctx.setLineDash([3, 3]);
                ctx.beginPath();
                ctx.moveTo(p.x, p.y);
                ctx.lineTo(a.x, a.y);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        }
    }

    for (const id of aliveIds) {
        const p = positions.get(id);
        if (!p) continue;
        const count = prevById.get(id) || 0;
        const r = Math.min(
            FOREST_NODE_MAX_RADIUS,
            FOREST_NODE_MIN_RADIUS + Math.log(1 + count) * 1.4
        );
        ctx.fillStyle = strainHsl(id);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
        if (id === selectedId) {
            // Selection ring — reuses the strain's own hue at higher
            // saturation so it stays distinct from the fill.
            ctx.strokeStyle = `hsl(${strainHue(id).toFixed(2)}, 80%, 35%)`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r + 3, 0, Math.PI * 2);
            ctx.stroke();
            ctx.lineWidth = 1;
            ctx.strokeStyle = edgeColor;
        }
    }
}

// Hit-test the alive-strain positions against a CSS-pixel click point.
// Returns the closest strain id within FOREST_CLICK_RADIUS_SQ², or -1.
function pickForestNode(px, py) {
    const positions = _forestLayout.positions;
    let bestId = -1;
    let bestD2 = FOREST_CLICK_RADIUS_SQ;
    for (const [id, p] of positions) {
        const dx = p.x - px;
        const dy = p.y - py;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) { bestD2 = d2; bestId = id; }
    }
    return bestId;
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
function buildRow(id, name, panelEl, onClick) {
    const el = document.createElement('div');
    el.className = 'strain-row';
    el.dataset.strainId = String(id);
    el.style.setProperty('--strain-color', strainHsl(id));

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

    return { row: el, name: nameEl, prev, fill };
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
 */
export function renderStrainPanel(panelEl, prevalence, registry, onClick) {
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
    const registrySize = registry ? strainCount(registry) : 0;
    const aliveCount = registry ? countLiving(registry) : 0;
    const extinct = registrySize - aliveCount;
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
        } else if (rec.row.firstChild && rec.name.textContent !== row.name) {
            // Names are stable after registration, but be safe across resets.
            rec.name.textContent = row.name;
        }

        const last = lastVals.get(row.id);
        if (!last || last.count !== row.count || last.fraction !== row.fraction) {
            const pct = row.fraction * 100;
            const pctStr = pct >= 10 ? pct.toFixed(0) : pct.toFixed(1);
            // Counts are load-weighted floats now (coinfection apportioned by
            // load). Show one decimal so the fractional shape is visible
            // without rendering trailing-FP noise like "1497.30000000001".
            const countStr = row.count.toFixed(1);
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
        const noun = overflow === 1 ? 'strain' : 'strains';
        const hintText = '+' + overflow + ' less prevalent ' + noun + ' hidden';
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

    // ── Phase D: force-directed forest ─────────────────────────────────────
    //
    // "Alive" for forest purposes = strains the registry has NOT tombstoned
    // (Phase B). A strain may have prevalence 0 (no actively-transmitting
    // cells right now) but still be alive if some cell carries it in memory
    // (M / R+CARRIER / D+F / vax slots). The B sweep tombstones only when
    // no slot of any cell holds the id — so registry liveness is the right
    // signal for what to render in the lineage forest.
    if (registry && forestEl) {
        const registrySize = strainCount(registry);
        const forestAlive = [];
        for (let id = 0; id < registrySize; id++) {
            if (!isExtinct(registry, id)) forestAlive.push(id);
        }
        const now = (typeof performance !== 'undefined' && performance.now)
            ? performance.now()
            : Date.now();
        const forestSignature = forestAlive.join(',') + '|sel=' + (activeId === null ? '' : activeId);
        const due = now - refs.lastForestDraw >= 100;
        const force = refs.lastForestSignature !== forestSignature;
        if (due || force) {
            const w = forestEl.clientWidth  || 1;
            const h = forestEl.clientHeight || 1;
            ensureForestPositions(forestAlive, registry, w, h);
            stepForestLayout(forestAlive, registry, w, h);
            renderForest(forestEl, forestAlive, prevalence, registry, activeId);
            refs.lastForestSignature = forestSignature;
            refs.lastForestDraw = now;
        }
    }
}
