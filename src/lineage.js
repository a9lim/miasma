// lineage.js — strain registry panel renderer (Phase 7).
//
// Two exports:
//   computeStrainPrevalence(grid, registry, maxSlot)  — O(N) tally of slot-0 strain IDs
//   renderStrainPanel(panelEl, prevalence, registry, onClick?) — idempotent build/update
//
// The strain tab shows the top-8 most-prevalent strains as horizontal bars,
// plus a hint line when more strains exist than fit. Clicking a row reveals
// a small detail block with the strain's parameter vector and lineage parent.
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
    getStrain,
    EMPTY_STRAIN
} from './strains.js';

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
 * Tally cells per strain (slot 0 only for Phase 7). Single pass over
 * grid.strain_ids using a Uint32Array bucket; cells whose primary strain is
 * EMPTY_STRAIN, or whose mask byte is 0, don't contribute. Returns an array
 * of `{id, name, count, fraction}` rows sorted by count descending.
 *
 * `fraction` is `count / totalAssignedCells`. The denominator excludes cells
 * with no strain in slot 0, so the fractions sum to 1.0 (modulo rounding)
 * across only the strain-carrying population — which is the meaningful
 * normalization for "share of infected/carrier hosts" reporting.
 *
 * @param {{compartment:Uint8Array, strain_ids:Uint16Array, mask?:Uint8Array}} grid
 * @param {object} registry
 * @param {number} maxSlot — DEFAULTS.maxActiveStrains; phase 7 reads slot 0 only
 * @returns {Array<{id:number, name:string, count:number, fraction:number}>}
 */
export function computeStrainPrevalence(grid, registry, maxSlot) {
    const ids = grid.strain_ids;
    const mask = grid.mask;
    const n = strainCount(registry);
    if (n === 0 || !ids || !maxSlot) return [];

    const tally = new Uint32Array(n);
    const cellCount = ids.length / maxSlot;
    let totalAssigned = 0;

    for (let i = 0; i < cellCount; i++) {
        if (mask !== undefined && mask[i] === 0) continue;
        const sid = ids[i * maxSlot]; // slot 0
        if (sid === EMPTY_STRAIN) continue;
        if (sid >= n) continue; // out-of-range guard — shouldn't happen
        tally[sid]++;
        totalAssigned++;
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

    panelEl.dataset.lineageReady = '1';
}

function buildDetailSkeleton(detailEl) {
    // Detail block — small grid of parameter rows + a lineage-tree canvas.
    // Built once, then text mutated on subsequent inspects; the canvas is
    // reused and only redrawn.
    while (detailEl.firstChild) detailEl.removeChild(detailEl.firstChild);

    // Phase 8 adds "type" (point mutant vs hybrid) and a conditional "parent2"
    // row. The parent2 row is always created here so insertion order stays
    // stable; updateDetail shows/hides it based on the strain's parent2 field.
    const fields = [
        { key: 'name',      label: 'Strain'    },
        { key: 'type',      label: 'Type'      },
        { key: 'beta',      label: 'β'         },
        { key: 'sigma',     label: 'σ'         },
        { key: 'gamma',     label: 'γ'         },
        { key: 'mu',        label: 'μ'         },
        { key: 'parent',    label: 'Parent'    },
        { key: 'parent2',   label: 'Parent 2'  },
        { key: 'birthTick', label: 'Born tick' }
    ];

    for (const f of fields) {
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

    // Lineage-tree canvas. Lazy-created here (once per detail-block init);
    // updateDetail repaints it on each click. Width is driven by CSS so it
    // tracks the panel; resizeCanvasDPR handles the backing buffer.
    const canvas = document.createElement('canvas');
    canvas.className = 'lineage-tree-canvas';
    canvas.dataset.role = 'detail-tree';
    detailEl.appendChild(canvas);

    detailEl.dataset.detailReady = '1';
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

    const set = (key, text) => {
        const el = detailEl.querySelector(`[data-role="detail-${key}"]`);
        if (el) el.textContent = text;
    };

    // Show/hide the row containing the named detail field. Each row is the
    // direct parent of the `[data-role="detail-${key}"]` value span; we walk
    // up one level rather than re-querying by data-detail-field so the
    // lookup stays single-sourced through the same role tag.
    const showRow = (key, visible) => {
        const el = detailEl.querySelector(`[data-role="detail-${key}"]`);
        if (!el || !el.parentElement) return;
        el.parentElement.style.display = visible ? '' : 'none';
    };

    set('name', s.name);
    set('beta',  s.beta.toFixed(3));
    set('sigma', s.sigma.toFixed(3));
    set('gamma', s.gamma.toFixed(3));
    set('mu',    s.mu.toFixed(4));

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
    detailEl.style.display = '';

    // Repaint the lineage tree for the newly-selected strain. The canvas
    // is part of the skeleton, so it always exists once the detail block
    // has been built; renderLineageTree no-ops if for some reason it's not.
    const treeEl = detailEl.querySelector('[data-role="detail-tree"]');
    if (treeEl) renderLineageTree(treeEl, registry, strainId);
}

// ─── Lineage tree (Phase 8) ─────────────────────────────────────────────────
//
// Renders a small horizontal cladogram inside the strain detail block. The
// rendered scope is intentionally narrow: the ancestor chain of the clicked
// strain back to its root (no parent), capped at MAX_TREE_DEPTH generations,
// with second-parent (recombination) edges annotated as dotted branches off
// each hybrid node in the chain. Walking the full forest of descendants is
// out of scope — this is meant as a click-context aid, not a fleet view.
//
// Layout: clicked strain at the right, oldest visible ancestor at the left.
// Second-parent nodes hang above/below the chain at the same x-position as
// the hybrid child they recombine into; orientation alternates to keep things
// readable when multiple hybrids appear in one chain.
const MAX_TREE_DEPTH      = 6;   // generations walked back from the clicked strain
const TREE_HEIGHT_CSS_PX  = 92;  // matches the .lineage-tree-canvas CSS height
const TREE_PAD_X          = 14;  // horizontal padding (CSS pixels)
const TREE_PAD_Y          = 18;  // vertical padding for labels
const TREE_NODE_R         = 5;   // ancestor node radius (CSS pixels)
const TREE_HIGHLIGHT_R    = 7;   // clicked-strain node radius

/**
 * Walk the parent chain starting from `startId` back toward the seed. Stops
 * when `parent` is null/undefined (the seed has no parent) or after
 * `maxDepth` generations, whichever comes first. Returns an array ordered
 * oldest-ancestor-first; the clicked strain is always the last entry.
 *
 * Each entry includes its strain ID, display name, golden-ratio hue, and the
 * `parent2` ID (or null) so the renderer can draw second-parent annotations
 * without re-resolving the registry.
 *
 * If the chain hits `maxDepth` before reaching the seed, the array's first
 * entry's `truncated` flag is set so the caller can render a "…" marker.
 *
 * @param {object} reg
 * @param {number} startId
 * @param {number} maxDepth
 * @returns {Array<{id:number, name:string, hue:number, parent:(number|null), parent2:(number|null), truncated:boolean}>}
 */
function walkAncestors(reg, startId, maxDepth) {
    const chain = [];
    let cur = startId;
    let steps = 0;
    while (steps < maxDepth) {
        const s = getStrain(reg, cur);
        if (s === null) break;
        const parent2 = (s.parent2 === undefined) ? null : s.parent2;
        chain.push({
            id:       s.id,
            name:     s.name,
            hue:      strainHue(s.id),
            parent:   s.parent,
            parent2:  parent2,
            truncated: false
        });
        if (s.parent === null || s.parent === undefined) {
            cur = null;
            break;
        }
        cur = s.parent;
        steps++;
    }
    // Reverse so index 0 is the oldest ancestor visible and the last entry
    // is the clicked strain — matches the right-to-left visual layout.
    chain.reverse();
    // If we stopped because of depth (not because parent === null), the
    // chain's eldest entry still has a parent we didn't walk. Flag it so
    // the renderer can prepend a "…" marker.
    if (chain.length > 0) {
        const eldest = chain[0];
        if (eldest.parent !== null && eldest.parent !== undefined) {
            eldest.truncated = true;
        }
    }
    return chain;
}

function readTreeColors() {
    const cs = getComputedStyle(document.documentElement);
    // --text is the canonical foreground for both themes. Falls back to a
    // neutral mid-grey if the CSS var isn't resolvable (e.g. JSDOM in a
    // future test setup).
    const text = (cs.getPropertyValue('--text') || '').trim() || '#7a7a82';
    return { text };
}

/**
 * Repaint the lineage-tree canvas for `strainId`. Idempotent: caller owns
 * the canvas element (created in buildDetailSkeleton); we only clear and
 * redraw. DPR handling defers to window.resizeCanvasDPR when available.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} reg
 * @param {number} strainId
 */
function renderLineageTree(canvas, reg, strainId) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (typeof window !== 'undefined' && typeof window.resizeCanvasDPR === 'function') {
        window.resizeCanvasDPR(canvas, ctx);
    }

    // Work in CSS pixels — resizeCanvasDPR applied the transform. Width is
    // driven by layout, so re-read on every paint in case the panel resized.
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height || TREE_HEIGHT_CSS_PX;
    if (w <= 0 || h <= 0) return;

    ctx.clearRect(0, 0, w, h);

    const chain = walkAncestors(reg, strainId, MAX_TREE_DEPTH);
    if (chain.length === 0) return;

    const colors = readTreeColors();
    const midY = h / 2;

    // X-positions: spread chain across the panel width with padding on both
    // sides. When the chain has a single node (just α), centre it.
    const n = chain.length;
    const xLeft  = TREE_PAD_X;
    const xRight = w - TREE_PAD_X;
    const xs = new Array(n);
    if (n === 1) {
        xs[0] = (xLeft + xRight) / 2;
    } else {
        const step = (xRight - xLeft) / (n - 1);
        for (let i = 0; i < n; i++) xs[i] = xLeft + step * i;
    }

    // Truncation marker — small "…" at the left edge if the chain was
    // capped before reaching the seed.
    if (chain[0].truncated) {
        ctx.fillStyle = colors.text;
        ctx.globalAlpha = 0.5;
        ctx.font = '10px var(--font-mono, monospace)';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText('…', xs[0] - TREE_NODE_R - 4, midY);
        ctx.globalAlpha = 1;
    }

    // Main-chain parent edges (solid 1.5px, alpha 0.5). Draw before nodes so
    // node circles cover the line ends and there's no visible stub.
    ctx.save();
    ctx.strokeStyle = colors.text;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.beginPath();
    for (let i = 1; i < n; i++) {
        ctx.moveTo(xs[i - 1], midY);
        ctx.lineTo(xs[i], midY);
    }
    ctx.stroke();
    ctx.restore();

    // Second-parent (recombination) edges. For each chain node with a
    // parent2, draw a dashed branch up or down to a satellite node at the
    // same x. Alternate orientation per occurrence so adjacent hybrids
    // don't overlap each other vertically.
    const satelliteOffset = Math.min(28, (h / 2) - TREE_PAD_Y);
    let altUp = true;
    for (let i = 0; i < n; i++) {
        const node = chain[i];
        if (node.parent2 === null) continue;
        const p2 = getStrain(reg, node.parent2);
        if (p2 === null) continue;

        const sy = midY + (altUp ? -satelliteOffset : satelliteOffset);
        altUp = !altUp;

        // Dashed edge in --text @ alpha 0.4.
        ctx.save();
        ctx.strokeStyle = colors.text;
        ctx.globalAlpha = 0.4;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(xs[i], midY);
        ctx.lineTo(xs[i], sy);
        ctx.stroke();
        ctx.restore();

        // Satellite (second-parent) node: small stroked circle in the
        // parent's golden-ratio hue. Labelled with the parent's Greek name.
        const p2hue = strainHue(p2.id);
        ctx.save();
        ctx.strokeStyle = `hsl(${p2hue.toFixed(2)}, ${HUE_SAT}%, ${HUE_LIGHT}%)`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(xs[i], sy, TREE_NODE_R - 1, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        // Label the satellite away from the chain so it doesn't sit on
        // the dashed edge. above-chain → label above the satellite node;
        // below-chain → label below it.
        ctx.save();
        ctx.fillStyle = colors.text;
        ctx.globalAlpha = 0.7;
        ctx.font = '10px var(--font-mono, monospace)';
        ctx.textAlign = 'center';
        const labelAboveSat = (sy < midY);
        ctx.textBaseline = labelAboveSat ? 'bottom' : 'top';
        const labelSatY = labelAboveSat
            ? sy - (TREE_NODE_R + 2)
            : sy + (TREE_NODE_R + 2);
        ctx.fillText(p2.name, xs[i], labelSatY);
        ctx.restore();
    }

    // Main-chain nodes. Clicked strain (last entry) is filled and slightly
    // larger; ancestors are stroked-only circles. All use the strain's
    // golden-ratio hue. Labels alternate above/below to reduce overlap on
    // tight chains.
    for (let i = 0; i < n; i++) {
        const node = chain[i];
        const isHead = (i === n - 1);
        const hueStr = `hsl(${node.hue.toFixed(2)}, ${HUE_SAT}%, ${HUE_LIGHT}%)`;
        const r = isHead ? TREE_HIGHLIGHT_R : TREE_NODE_R;

        ctx.save();
        if (isHead) {
            ctx.fillStyle = hueStr;
            ctx.beginPath();
            ctx.arc(xs[i], midY, r, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.strokeStyle = hueStr;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(xs[i], midY, r, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.restore();

        // Label. Place above the chain by default; flip below for the head
        // node so the highlighted strain's name doesn't collide with the
        // chain's stack of upper labels.
        ctx.save();
        ctx.fillStyle = colors.text;
        ctx.globalAlpha = isHead ? 0.9 : 0.65;
        ctx.font = isHead
            ? '600 11px var(--font-mono, monospace)'
            : '10px var(--font-mono, monospace)';
        ctx.textAlign = 'center';
        const labelAbove = !isHead;
        ctx.textBaseline = labelAbove ? 'bottom' : 'top';
        const labelY = labelAbove
            ? midY - r - 3
            : midY + r + 3;
        ctx.fillText(node.name, xs[i], labelY);
        ctx.restore();
    }
}


function clearActiveRow(listEl) {
    const prev = listEl.querySelector('.strain-row.active');
    if (prev) prev.classList.remove('active');
}

function buildRow(row, panelEl, onClick) {
    const el = document.createElement('div');
    el.className = 'strain-row';
    el.dataset.strainId = String(row.id);
    el.style.setProperty('--strain-color', strainHsl(row.id));
    // Phase 14 polish: assign a unique view-transition-name keyed on the
    // strain ID. With document.startViewTransition() wrapping the row
    // rebuild, browsers that support it (Chromium ≥ 111) animate the
    // re-ordering of strain rows smoothly instead of flashing.
    if (typeof el.style.viewTransitionName !== 'undefined') {
        el.style.viewTransitionName = `strain-row-${row.id}`;
    }

    const swatch = document.createElement('span');
    swatch.className = 'strain-swatch';
    el.appendChild(swatch);

    const name = document.createElement('span');
    name.className = 'strain-name';
    name.textContent = row.name;
    el.appendChild(name);

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
        // Stash the registry + detail target on the panel for the click handler.
        // We look them back up by data-role so the renderer stays the single
        // source of truth on those references.
        const listEl = panelEl.querySelector('[data-role="lineage-list"]');
        const detailEl = panelEl.querySelector('[data-role="lineage-detail"]');
        if (listEl) {
            clearActiveRow(listEl);
            el.classList.add('active');
        }
        const id = parseInt(el.dataset.strainId, 10);
        if (detailEl) {
            // The current registry handle is stashed by renderStrainPanel on
            // each update so the click handler picks up the latest reference.
            const reg = panelEl._lineageRegistry;
            if (reg) updateDetail(detailEl, reg, id);
        }
        if (typeof onClick === 'function') onClick(id);
    });

    return el;
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

    // Stash the registry on the panel so the row-click handler (which doesn't
    // re-receive registry on every event) can read the latest reference.
    panelEl._lineageRegistry = registry;

    // Header total — "{strainCount} total". This is the registry size, not
    // the displayed-row count; communicates "how big is the strain pool" even
    // when only the top-8 are visible.
    const totalEl = panelEl.querySelector('[data-role="lineage-total"]');
    if (totalEl) {
        const n = registry ? strainCount(registry) : 0;
        totalEl.textContent = `${n} total`;
    }

    const listEl = panelEl.querySelector('[data-role="lineage-list"]');
    const detailEl = panelEl.querySelector('[data-role="lineage-detail"]');

    // Remember the currently-active strain ID (if any) so we can re-mark it
    // after the rebuild and not lose the user's selection on a stats tick.
    const activePrev = listEl ? listEl.querySelector('.strain-row.active') : null;
    const activeId = activePrev ? parseInt(activePrev.dataset.strainId, 10) : null;

    if (listEl) {
        // Phase 14 polish: when the browser supports View Transitions API,
        // wrap the row-rebuild in startViewTransition so rows with stable
        // viewTransitionName="strain-row-<id>" cross-fade across re-order
        // instead of flashing on every stats tick.
        const doRebuild = () => {
            while (listEl.firstChild) listEl.removeChild(listEl.firstChild);

            const rows = prevalence.slice(0, MAX_ROWS);
            for (const row of rows) {
                const el = buildRow(row, panelEl, onClick);
                const pct = (row.fraction * 100);
                const pctStr = pct >= 10 ? pct.toFixed(0) : pct.toFixed(1);
                const prevEl = el.querySelector('.strain-prev');
                if (prevEl) prevEl.textContent = `${row.count} · ${pctStr}%`;
                const fill = el.querySelector('.strain-bar-fill');
                if (fill) fill.style.width = pct.toFixed(2) + '%';
                if (activeId !== null && row.id === activeId) {
                    el.classList.add('active');
                }
                listEl.appendChild(el);
            }
        };
        if (typeof document.startViewTransition === 'function') {
            // Skip transition if the page is hidden (no visible benefit).
            if (!document.hidden) {
                try { document.startViewTransition(doRebuild); }
                catch (_) { doRebuild(); }
            } else {
                doRebuild();
            }
        } else {
            doRebuild();
        }
    }

    // Hidden-count hint — only shown when the registry holds more strains
    // than we're displaying. Counts strains that have a row in the prevalence
    // array (i.e. nonzero count) but didn't make the top-MAX_ROWS cut, plus
    // any registered-but-zero-count strains aren't part of "less prevalent"
    // — those are just unrepresented in the world right now.
    const hintEl = panelEl.querySelector('[data-role="lineage-hidden-hint"]');
    if (hintEl) {
        const overflow = Math.max(0, prevalence.length - MAX_ROWS);
        if (overflow > 0) {
            const noun = overflow === 1 ? 'strain' : 'strains';
            hintEl.textContent = `+${overflow} less prevalent ${noun} hidden`;
            hintEl.style.display = '';
        } else {
            hintEl.textContent = '';
            hintEl.style.display = 'none';
        }
    }

    // If a row is currently selected and the underlying strain still exists,
    // refresh the detail block so parameter changes (e.g. a new mutation
    // displacing the selection) stay in sync. Otherwise hide the block.
    if (detailEl) {
        if (activeId !== null && getStrain(registry, activeId) !== null
            && listEl && listEl.querySelector(`[data-strain-id="${activeId}"]`)) {
            updateDetail(detailEl, registry, activeId);
        } else if (activeId !== null) {
            // Selected strain dropped out of the visible top-MAX_ROWS — keep
            // the detail visible (the strain still exists in the registry)
            // but don't try to highlight a row that no longer exists.
            if (getStrain(registry, activeId) !== null) {
                updateDetail(detailEl, registry, activeId);
            } else {
                detailEl.style.display = 'none';
            }
        }
    }
}
