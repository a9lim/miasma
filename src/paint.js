// paint.js — brush + intervention logic.
//
// Phase 11 ports gerry's getHexFromPoint() + cube-rounding (via pixelToAxial
// in grid.js — same algorithm), snapshot-style undo stack, paint modes
// (seed / vaccinate / quarantine / sanitize / cull), brush radius
// (0/1/2 → 1/7/19 hexes), and touch support via pointer events.
//
// Design notes:
// - The paint controller owns ALL canvas pointer events. main.js no longer
//   attaches attachClickToSeed — when paint mode is SEED with brush size 0
//   (the default), a single tap reproduces the legacy click-to-seed
//   behavior.
// - Strokes (pointerdown → pointerup) push one entry onto the undo stack.
//   Each entry stores per-cell pre-paint snapshots keyed by linear index,
//   so undo only restores what the stroke touched (no whole-grid copies).
// - applyAtHex is exposed for keyboard shortcuts and tests; the controller
//   wraps it inside startStroke/endStroke when invoked through pointer
//   events.
// - mask=0 cells (outside the inscribed hex) are skipped. Cells failing the
//   per-mode validity check (e.g. cull on EMPTY, vaccinate on D) are
//   no-ops and do NOT consume an undo slot.

import { pixelToAxial, hexToPixel } from './grid.js';
import { Compartment, Flag, Status, DEFAULTS } from './config.js';

// ─── Paint mode enum ───
// 'none' means the controller is dormant: pointer events do nothing.
// Useful when the user wants to zoom/inspect without painting.
export const PaintMode = Object.freeze({
    NONE:       'none',
    SEED:       'seed',
    VACCINATE:  'vaccinate',
    QUARANTINE: 'quarantine',
    SANITIZE:   'sanitize',
    CULL:       'cull'
});

// Undo stack depth. ~20 strokes × ~50 cells × ~80 bytes ≈ 80 kB upper
// bound. Cheap; pick a small number so the user has a meaningful "oops"
// window without paying memory for ancient strokes.
const MAX_UNDO = 20;

// Per-stroke seed strain ID. Phase 7 ships α at registry index 0; the
// integrator can rebuild the registry on reset, but α is always at slot 0.
const SEED_STRAIN_ID = 0;

const MAX_SLOTS = DEFAULTS.maxActiveStrains;
const EMPTY_SLOT = 0xFFFF;

// ─── Hexagonal-radius cell enumeration ──────────────────────────────────────
// gerry's getHexesInRadius returns "q,r" strings; we want axial pairs to feed
// directly into grid.idx(). Otherwise identical: every (dq, dr) inside the
// triangular axial bound dq + dr in [-radius, radius] ∩ |dq|, |dr| ≤ radius.

/**
 * Return all axial cells within `radius` hex steps of (q, r).
 *   radius=0 → 1 cell (center only)
 *   radius=1 → 7 cells (center + 6 neighbors)
 *   radius=2 → 19 cells
 * @returns {Array<{q:number, r:number}>}
 */
export function hexesInRadius(q, r, radius) {
    const out = [];
    for (let dq = -radius; dq <= radius; dq++) {
        const drLo = Math.max(-radius, -dq - radius);
        const drHi = Math.min(radius, -dq + radius);
        for (let dr = drLo; dr <= drHi; dr++) {
            out.push({ q: q + dq, r: r + dr });
        }
    }
    return out;
}

// ─── Per-cell snapshot capture / restore ────────────────────────────────────

function captureCellState(grid, i) {
    const ids = new Uint16Array(MAX_SLOTS);
    const lds = new Float32Array(MAX_SLOTS);
    const base = i * MAX_SLOTS;
    for (let s = 0; s < MAX_SLOTS; s++) {
        ids[s] = grid.strain_ids[base + s];
        lds[s] = grid.strain_loads[base + s];
    }
    return {
        compartment: grid.compartment[i],
        status:      grid.status[i],
        flags:       grid.flags[i],
        age:         grid.age[i],
        health:      grid.health[i],
        strainIds:   ids,
        strainLoads: lds
    };
}

function restoreCellState(grid, i, state) {
    grid.compartment[i] = state.compartment;
    grid.status[i]      = state.status;
    grid.flags[i]       = state.flags;
    grid.age[i]         = state.age;
    grid.health[i]      = state.health;
    const base = i * MAX_SLOTS;
    for (let s = 0; s < MAX_SLOTS; s++) {
        grid.strain_ids[base + s] = state.strainIds[s];
        grid.strain_loads[base + s] = state.strainLoads[s];
    }
}

// ─── Mode application ──────────────────────────────────────────────────────
// Returns true iff the cell state actually changed (used to skip undo
// snapshots on no-op cells).

function clearStrainSlots(grid, i) {
    const base = i * MAX_SLOTS;
    for (let s = 0; s < MAX_SLOTS; s++) {
        grid.strain_ids[base + s] = EMPTY_SLOT;
        grid.strain_loads[base + s] = 0;
    }
}

function paintCell(grid, q, r, mode, toggles) {
    if (q < 0 || q >= grid.W || r < 0 || r >= grid.H) return false;
    const i = grid.idx(q, r);
    if (grid.mask && grid.mask[i] === 0) return false;

    const comp = grid.compartment[i];

    switch (mode) {
        case PaintMode.SEED: {
            // Seed cell with strain α as an I, regardless of prior compartment
            // — but skip dead and empty cells (no host to infect).
            if (comp === Compartment.D || comp === Compartment.EMPTY) return false;
            if (comp === Compartment.Z) return false; // Z is its own thing
            grid.compartment[i] = Compartment.I;
            grid.flags[i] = Flag.NONE;
            const base = i * MAX_SLOTS;
            grid.strain_ids[base] = SEED_STRAIN_ID;
            grid.strain_loads[base] = 1.0;
            for (let s = 1; s < MAX_SLOTS; s++) {
                grid.strain_ids[base + s] = EMPTY_SLOT;
                grid.strain_loads[base + s] = 0;
            }
            return true;
        }
        case PaintMode.VACCINATE: {
            if (toggles && toggles.V === false) return false;
            // Vaccinate makes sense for S/E/R/M (immunizable). I cells need
            // to clear infection first — sanitize handles that. D/EMPTY/Z
            // are not vaccinable.
            if (comp === Compartment.D || comp === Compartment.EMPTY ||
                comp === Compartment.Z || comp === Compartment.I) return false;
            if (comp === Compartment.V) return false; // already vaccinated
            grid.compartment[i] = Compartment.V;
            grid.flags[i] = Flag.NONE;
            grid.status[i] = Status.NONE;
            clearStrainSlots(grid, i);
            return true;
        }
        case PaintMode.QUARANTINE: {
            // Quarantine is a status overlay, not a compartment change. Skip
            // D and EMPTY (no one to quarantine).
            if (comp === Compartment.D || comp === Compartment.EMPTY) return false;
            if (grid.status[i] === Status.Q) return false;
            grid.status[i] = Status.Q;
            return true;
        }
        case PaintMode.SANITIZE: {
            // Sanitize: clear infection + flags + status. Dispose corpses.
            //   I/E    → R  (cured)
            //   D      → EMPTY (corpse disposed; clears F flag)
            //   others → clear flags + status only
            let changed = false;
            if (comp === Compartment.D) {
                grid.compartment[i] = Compartment.EMPTY;
                grid.flags[i] = Flag.NONE;
                grid.status[i] = Status.NONE;
                grid.health[i] = 0;
                grid.age[i] = 0;
                changed = true;
            } else if (comp === Compartment.I || comp === Compartment.E) {
                grid.compartment[i] = Compartment.R;
                grid.flags[i] = Flag.NONE;
                grid.status[i] = Status.NONE;
                clearStrainSlots(grid, i);
                changed = true;
            } else {
                if (grid.flags[i] !== Flag.NONE) {
                    grid.flags[i] = Flag.NONE;
                    changed = true;
                }
                if (grid.status[i] !== Status.NONE) {
                    grid.status[i] = Status.NONE;
                    changed = true;
                }
            }
            return changed;
        }
        case PaintMode.CULL: {
            // Cull: force-kill the cell. Empty cells have nothing to cull.
            // Z gets explicitly killed too — this is the only handle for it.
            if (comp === Compartment.EMPTY || comp === Compartment.D) return false;
            grid.compartment[i] = Compartment.D;
            grid.flags[i] = Flag.NONE;
            grid.status[i] = Status.NONE;
            // Health drops to 0 on death; age preserved so disposal still
            // looks plausible. Clear strain slots since the host is dead.
            grid.health[i] = 0;
            clearStrainSlots(grid, i);
            return true;
        }
        default:
            return false;
    }
}

// ─── Controller ────────────────────────────────────────────────────────────

/**
 * Create the paint controller. Owns the canvas pointer events.
 *
 * @param {Object} opts
 * @param {HTMLCanvasElement} opts.canvas
 * @param {() => import('./grid.js').Grid} opts.getGrid — returns the live grid
 *   (must be a getter since main.js reassigns sim.grid on reset).
 * @param {() => object} [opts.getToggles] — current toggles object.
 * @param {() => object} opts.getViewport — returns { originX, originY, hexSize }.
 * @param {() => void} [opts.onMutate] — called after any cell change so the
 *   integrator can mark renderDirty / statsDirty.
 * @returns {{
 *   setMode: (m:string) => void,
 *   getMode: () => string,
 *   setBrushSize: (s:number) => void,
 *   getBrushSize: () => number,
 *   applyAtHex: (q:number, r:number) => boolean,
 *   undo: () => boolean,
 *   canUndo: () => boolean,
 *   clearUndo: () => void,
 *   detach: () => void
 * }}
 */
export function createPaintController(opts) {
    const { canvas, getGrid, getToggles, getViewport, onMutate } = opts || {};
    if (!canvas) throw new Error('paint: canvas required');
    if (typeof getGrid !== 'function') throw new Error('paint: getGrid required');
    if (typeof getViewport !== 'function') throw new Error('paint: getViewport required');

    let mode = PaintMode.SEED;   // default preserves single-tap-to-seed UX
    let brushSize = 0;            // 0/1/2 → 1/7/19 hex
    let activeStroke = null;      // Map<cellIdx, snapshot>
    let pointerDown = false;
    let lastApplied = -1;         // last cell idx painted this stroke (dedupe drag-paint)
    const undoStack = [];

    // ─── Brush indicator overlay ───
    // Visual hint of brush size on hover. Single absolutely-positioned div
    // appended to <body>. Hidden when mode === NONE or pointer is outside
    // the canvas. Re-sized in CSS pixels each pointermove to match the
    // current brush radius in hex coordinates → world pixels.
    const indicator = document.createElement('div');
    indicator.className = 'brush-indicator';
    indicator.setAttribute('aria-hidden', 'true');
    indicator.style.display = 'none';
    document.body.appendChild(indicator);

    function hideIndicator() {
        indicator.style.display = 'none';
    }

    function showIndicatorAt(clientX, clientY) {
        if (mode === PaintMode.NONE) {
            hideIndicator();
            return;
        }
        const vp = getViewport();
        if (!vp) return;
        // Brush radius in cells → axial-pixel radius. drawSize = hexSize.
        // The brush covers (2*radius+1) cells across the long diameter, so
        // its CSS diameter ≈ (2*radius+1) * hexSize * sqrt(3).
        const SQRT3 = Math.sqrt(3);
        const diameter = (2 * brushSize + 1) * vp.hexSize * SQRT3;
        indicator.style.display = 'block';
        indicator.style.left   = (clientX - diameter / 2) + 'px';
        indicator.style.top    = (clientY - diameter / 2) + 'px';
        indicator.style.width  = diameter + 'px';
        indicator.style.height = diameter + 'px';
        // Color-code the indicator by current paint mode using the same
        // semantic accents as the mode buttons.
        const accent = {
            [PaintMode.SEED]:       'var(--epi-i)',
            [PaintMode.VACCINATE]:  'var(--epi-v)',
            [PaintMode.QUARANTINE]: 'var(--epi-e)',
            [PaintMode.SANITIZE]:   'var(--epi-r)',
            [PaintMode.CULL]:       'var(--epi-d)'
        }[mode] || 'var(--accent)';
        indicator.style.setProperty('--brush-accent', accent);
    }

    function setMode(m) {
        mode = m || PaintMode.NONE;
    }
    function getMode() { return mode; }

    function setBrushSize(s) {
        const n = (s | 0);
        brushSize = n < 0 ? 0 : (n > 2 ? 2 : n);
    }
    function getBrushSize() { return brushSize; }

    function startStroke() {
        activeStroke = new Map();
        lastApplied = -1;
    }
    function endStroke() {
        if (activeStroke && activeStroke.size > 0) {
            undoStack.push(activeStroke);
            while (undoStack.length > MAX_UNDO) undoStack.shift();
        }
        activeStroke = null;
        lastApplied = -1;
    }

    function applyAtHex(q, r) {
        const grid = getGrid();
        if (!grid) return false;
        const toggles = getToggles ? getToggles() : null;
        const cells = hexesInRadius(q, r, brushSize);
        let changed = 0;
        for (let k = 0; k < cells.length; k++) {
            const c = cells[k];
            if (c.q < 0 || c.q >= grid.W || c.r < 0 || c.r >= grid.H) continue;
            const i = grid.idx(c.q, c.r);
            if (grid.mask && grid.mask[i] === 0) continue;
            // Snapshot before first modify in this stroke. Subsequent drag-
            // paint hits on the same cell don't re-snapshot (the original
            // pre-stroke state is what undo needs).
            if (activeStroke && !activeStroke.has(i)) {
                activeStroke.set(i, captureCellState(grid, i));
            }
            if (paintCell(grid, c.q, c.r, mode, toggles)) changed++;
        }
        if (changed > 0 && onMutate) onMutate();
        return changed > 0;
    }

    function undo() {
        const entry = undoStack.pop();
        if (!entry) return false;
        const grid = getGrid();
        if (!grid) return false;
        for (const [i, snap] of entry) {
            restoreCellState(grid, i, snap);
        }
        if (onMutate) onMutate();
        return true;
    }

    function canUndo() { return undoStack.length > 0; }
    function clearUndo() { undoStack.length = 0; }

    function hitTest(event) {
        const grid = getGrid();
        const vp = getViewport();
        if (!grid || !vp) return null;
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left - vp.originX;
        const y = event.clientY - rect.top - vp.originY;
        const { q, r } = pixelToAxial(x, y, vp.hexSize);
        if (q < 0 || q >= grid.W || r < 0 || r >= grid.H) return null;
        if (grid.mask && grid.mask[grid.idx(q, r)] === 0) return null;
        return { q, r };
    }

    // ── Pointer event handlers ──
    // Use Pointer Events (covers mouse + touch + pen with a single path).
    // setPointerCapture keeps drag-paint working when the pointer leaves
    // the canvas mid-stroke.

    function onPointerDown(e) {
        if (mode === PaintMode.NONE) return;
        // Allow only the primary pointer button (left mouse, or any touch/pen).
        if (e.button !== undefined && e.button !== 0) return;
        if (e.cancelable) e.preventDefault();
        try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ok */ }
        pointerDown = true;
        startStroke();
        showIndicatorAt(e.clientX, e.clientY);
        const hit = hitTest(e);
        if (hit) {
            const grid = getGrid();
            lastApplied = grid.idx(hit.q, hit.r);
            applyAtHex(hit.q, hit.r);
        }
    }

    function onPointerMove(e) {
        showIndicatorAt(e.clientX, e.clientY);
        if (!pointerDown || mode === PaintMode.NONE) return;
        const hit = hitTest(e);
        if (!hit) return;
        const grid = getGrid();
        const i = grid.idx(hit.q, hit.r);
        // Skip if pointer is still on the same cell as last apply — saves
        // a redundant brush sweep when the pointer moves sub-cell.
        if (i === lastApplied) return;
        lastApplied = i;
        applyAtHex(hit.q, hit.r);
    }

    function onPointerLeave() {
        hideIndicator();
    }

    function onPointerUp(e) {
        if (!pointerDown) return;
        pointerDown = false;
        try { canvas.releasePointerCapture(e.pointerId); } catch (_) { /* ok */ }
        endStroke();
    }

    function onPointerCancel() {
        if (!pointerDown) return;
        pointerDown = false;
        endStroke();
    }

    canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
    // Right-click menu would interrupt strokes; suppress.
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // ─── Keyboard shortcuts ───
    // 1..6 → paint mode (none / seed / vaccinate / quarantine / sanitize / cull)
    // [ / ] → brush size down / up
    // ctrl+z (or cmd+z) → undo last stroke
    // Listen on document; skip when focus is in an input/textarea so the
    // shortcuts don't fight slider drags or text typing.
    const MODE_ORDER = [
        PaintMode.NONE,       // 1
        PaintMode.SEED,       // 2
        PaintMode.VACCINATE,  // 3
        PaintMode.QUARANTINE, // 4
        PaintMode.SANITIZE,   // 5
        PaintMode.CULL        // 6
    ];
    function onKeyDown(e) {
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
                  t.tagName === 'SELECT' || t.isContentEditable)) return;
        // Mode keys 1..6
        if (e.key >= '1' && e.key <= '6') {
            const idx = parseInt(e.key, 10) - 1;
            const newMode = MODE_ORDER[idx];
            if (newMode) {
                setMode(newMode);
                // Sync the active button in the Interventions tab if rendered.
                const grid = document.getElementById('paint-mode-grid');
                if (grid) {
                    grid.querySelectorAll('.paint-mode-btn').forEach((b) => {
                        const on = (b.dataset.paint === newMode);
                        b.classList.toggle('active', on);
                        b.setAttribute('aria-selected', on ? 'true' : 'false');
                    });
                }
                e.preventDefault();
            }
            return;
        }
        if (e.key === '[' || e.key === ']') {
            setBrushSize(brushSize + (e.key === '[' ? -1 : 1));
            // Sync the brush slider if rendered.
            const row = document.querySelector('[data-role="brush"]');
            if (row) {
                const slider = row.querySelector('input[type="range"]');
                const valEl = row.querySelector('[data-role="value"]');
                if (slider) slider.value = String(brushSize);
                if (valEl) {
                    const labels = ['1 cell', '7 cells', '19 cells'];
                    valEl.textContent = labels[brushSize] || labels[0];
                }
            }
            e.preventDefault();
            return;
        }
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
            if (undo()) e.preventDefault();
        }
    }
    document.addEventListener('keydown', onKeyDown);

    function detach() {
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerleave', onPointerLeave);
        canvas.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('pointercancel', onPointerCancel);
        document.removeEventListener('keydown', onKeyDown);
        if (indicator.parentNode) indicator.parentNode.removeChild(indicator);
    }

    return {
        setMode, getMode,
        setBrushSize, getBrushSize,
        applyAtHex,
        undo, canUndo, clearUndo,
        detach
    };
}

// Re-export pixel→axial helpers used by tests / consumers wiring a brush
// indicator overlay (Phase 14 polish).
export { pixelToAxial, hexToPixel };


// ─── Interventions tab UI ──────────────────────────────────────────────────
// Idempotent builder for #tab-interventions. Same pattern as toggles.js and
// params.js: wipe panel content node-by-node, build via createElement, no
// innerHTML. The paint controller is passed in so this module can wire mode
// buttons + brush slider + undo button without re-exporting state.
//
// Layout:
//   [Section header] Paint mode
//   [Row] Mode buttons: None / Seed / Vaccinate / Quarantine / Sanitize / Cull
//   [Row] Brush size slider (0/1/2 → 1/7/19 hex)
//   [Row] Undo button + cell-count readout

const MODE_SPECS = [
    { key: PaintMode.NONE,       label: 'None',       hint: 'Pointer does nothing' },
    { key: PaintMode.SEED,       label: 'Seed',       hint: 'Click to infect cells with strain α' },
    { key: PaintMode.VACCINATE,  label: 'Vaccinate',  hint: 'Convert S/E/R/M cells to V' },
    { key: PaintMode.QUARANTINE, label: 'Quarantine', hint: 'Apply Q status overlay (reduces transmission both ways)' },
    { key: PaintMode.SANITIZE,   label: 'Sanitize',   hint: 'Cure I/E → R, clear flags, dispose corpses' },
    { key: PaintMode.CULL,       label: 'Cull',       hint: 'Force-kill cells (S/E/I/R/V/M/Z → D)' }
];

const BRUSH_SIZE_LABELS = ['1 cell', '7 cells', '19 cells'];

function buildSectionHeader(text) {
    const hdr = document.createElement('div');
    hdr.className = 'toggles-section-header';
    hdr.textContent = text;
    return hdr;
}

function buildModeRow(controller, onChange) {
    // 3×2 grid of buttons. bindModeGroup assumes single-row flexbox with an
    // absolute-positioned sliding indicator, which breaks when buttons wrap.
    // We use a plain CSS grid with a per-button .active class instead.
    const group = document.createElement('div');
    group.id = 'paint-mode-grid';
    group.className = 'paint-mode-grid';
    group.setAttribute('role', 'tablist');
    group.setAttribute('aria-label', 'Paint mode');

    const initial = controller.getMode();
    const buttons = [];
    for (const spec of MODE_SPECS) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'paint-mode-btn' + (spec.key === initial ? ' active' : '');
        btn.dataset.paint = spec.key;
        btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-selected', spec.key === initial ? 'true' : 'false');
        btn.setAttribute('title', spec.hint);
        btn.id = `mode-${spec.key}`;
        btn.textContent = spec.label;
        group.appendChild(btn);
        buttons.push(btn);
    }

    group.addEventListener('click', (e) => {
        const btn = e.target.closest('.paint-mode-btn');
        if (!btn) return;
        for (const b of buttons) {
            const on = (b === btn);
            b.classList.toggle('active', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
        }
        controller.setMode(btn.dataset.paint);
        if (onChange) onChange('mode', btn.dataset.paint);
    });

    return group;
}

function buildBrushRow(controller, onChange) {
    const row = document.createElement('div');
    row.className = 'settings-dd-row';
    row.dataset.role = 'brush';

    const lbl = document.createElement('label');
    lbl.className = 'settings-dd-label';
    lbl.textContent = 'Brush size';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'sim-slider';
    slider.min = '0';
    slider.max = '2';
    slider.step = '1';
    slider.value = String(controller.getBrushSize());
    slider.setAttribute('aria-label', 'Brush size');

    const valEl = document.createElement('span');
    valEl.className = 'settings-dd-val';
    valEl.dataset.role = 'value';
    valEl.textContent = BRUSH_SIZE_LABELS[controller.getBrushSize()] || BRUSH_SIZE_LABELS[0];

    const handler = (v) => {
        const n = Math.round(v);
        controller.setBrushSize(n);
        valEl.textContent = BRUSH_SIZE_LABELS[n] || BRUSH_SIZE_LABELS[0];
        if (onChange) onChange('brush', n);
    };

    if (window._forms && typeof window._forms.bindSlider === 'function') {
        window._forms.bindSlider(slider, null, handler);
    } else {
        slider.addEventListener('input', () => handler(parseFloat(slider.value)));
    }

    row.append(lbl, slider, valEl);
    return row;
}

function buildUndoRow(controller, onChange) {
    const row = document.createElement('div');
    row.className = 'settings-dd-row';
    row.dataset.role = 'undo';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tool-btn paint-undo-btn';
    btn.textContent = 'Undo last stroke';
    btn.setAttribute('aria-label', 'Undo last paint stroke');
    btn.addEventListener('click', () => {
        const ok = controller.undo();
        if (ok && onChange) onChange('undo', null);
    });

    row.appendChild(btn);
    return row;
}

function buildHint(text) {
    const row = document.createElement('div');
    row.className = 'settings-dd-row';
    row.dataset.role = 'hint';

    const span = document.createElement('span');
    span.className = 'panel-hint';
    span.textContent = text;
    row.appendChild(span);
    return row;
}

/**
 * Build the Interventions tab panel.
 * @param {HTMLElement} panelEl — usually #tab-interventions
 * @param {object} controller — return value of createPaintController
 * @param {(key:string, value:*) => void} [onChange]
 */
export function buildInterventionsPanel(panelEl, controller, onChange) {
    if (!panelEl || !controller) return;
    while (panelEl.firstChild) panelEl.removeChild(panelEl.firstChild);

    panelEl.appendChild(buildSectionHeader('Paint mode'));
    panelEl.appendChild(buildModeRow(controller, onChange));
    panelEl.appendChild(buildHint(
        'Click or drag on the canvas to apply the selected mode. ' +
        'Seed places strain α infections; Vaccinate, Quarantine, ' +
        'Sanitize, and Cull act on the cells under the brush.'
    ));

    panelEl.appendChild(buildSectionHeader('Brush'));
    panelEl.appendChild(buildBrushRow(controller, onChange));

    panelEl.appendChild(buildSectionHeader('Undo'));
    panelEl.appendChild(buildUndoRow(controller, onChange));

    panelEl.dataset.interventionsReady = '1';
}
