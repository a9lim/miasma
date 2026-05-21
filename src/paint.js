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
const RADIUS_OFFSETS = [
    new Int8Array([0, 0]),
    buildRadiusOffsets(1),
    buildRadiusOffsets(2)
];

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
    const offsets = RADIUS_OFFSETS[radius] || buildRadiusOffsets(radius);
    for (let k = 0; k < offsets.length; k += 2) {
        out.push({ q: q + offsets[k], r: r + offsets[k + 1] });
    }
    return out;
}

function buildRadiusOffsets(radius) {
    const pairs = [];
    for (let dq = -radius; dq <= radius; dq++) {
        const drLo = Math.max(-radius, -dq - radius);
        const drHi = Math.min(radius, -dq + radius);
        for (let dr = drLo; dr <= drHi; dr++) {
            pairs.push(dq, dr);
        }
    }
    return new Int8Array(pairs);
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
 * @param {() => void} [opts.onHover] — called when the brush footprint moves
 *   onto a different cell (or leaves/enters the canvas). Lets the integrator
 *   flip renderDirty so the cell-overlay refreshes without a tick.
 * @param {() => void} [opts.onHistoryChange] — called whenever undo/redo
 *   stacks change so the integrator can sync toolbar button disabled state.
 * @returns {object} controller handle (see below)
 */
export function createPaintController(opts) {
    const { canvas, getGrid, getToggles, getViewport, onMutate, onHover, onHistoryChange } = opts || {};
    if (!canvas) throw new Error('paint: canvas required');
    if (typeof getGrid !== 'function') throw new Error('paint: getGrid required');
    if (typeof getViewport !== 'function') throw new Error('paint: getViewport required');

    let mode = PaintMode.SEED;   // default preserves single-tap-to-seed UX
    let brushSize = 0;            // 0/1/2 → 1/7/19 hex
    // ─── Stroke state ───
    // activeUndoStroke and activeRedoStroke are two parallel Maps captured
    // during a single pointer-down → pointer-up. The undo map holds pre-
    // stroke snapshots; the redo map captures the post-stroke state at
    // endStroke so a subsequent redo can replay exactly the same outcome
    // without re-running paintCell (which depends on the live grid state).
    let activeUndoStroke = null;
    let activeRedoStroke = null;
    let pointerDown = false;
    let lastApplied = -1;         // last cell idx painted this stroke (dedupe drag-paint)
    // Stroke-suppression flag flipped by external owners (e.g. main.js pinch
    // handler) so two-finger gestures don't trigger paint. When set during an
    // active stroke we cleanly end it so the undo stack stays sane.
    let suppressed = false;
    // Each undo/redo entry is { pre: Map<i, snap>, post: Map<i, snap> } so
    // redo can restore the post-stroke state without re-deriving it from
    // mode + brush + live grid (which would be wrong if a subsequent tick
    // mutated the cells between undo and redo).
    const undoStack = [];
    const redoStack = [];

    function notifyHistoryChange() {
        if (onHistoryChange) onHistoryChange();
    }

    // ─── Brush footprint hover state ───
    // The brush no longer renders as a DOM circle hovering above the canvas;
    // instead the cells under the brush are highlighted via a render-pass
    // overlay (see main.js + render.js). We track only the cell the cursor
    // is currently over and emit onHover whenever that changes — main.js
    // flips renderDirty so the next frame redraws with the new footprint.
    let hoverQ = -1;
    let hoverR = -1;
    let hoverInside = false;

    function setHover(q, r, inside) {
        const next = inside ? q : -1;
        const nextR = inside ? r : -1;
        if (next === hoverQ && nextR === hoverR && inside === hoverInside) return;
        hoverQ = next;
        hoverR = nextR;
        hoverInside = inside;
        if (onHover) onHover();
    }

    function clearHover() {
        if (!hoverInside && hoverQ === -1 && hoverR === -1) return;
        hoverQ = -1;
        hoverR = -1;
        hoverInside = false;
        if (onHover) onHover();
    }

    function getHoverFootprint() {
        // Returned object is read synchronously by main.js's render path —
        // safe to share a fresh literal each call since hover only fires on
        // actual cell changes (not 60 Hz).
        return { q: hoverQ, r: hoverR, brushSize, mode, inside: hoverInside };
    }

    function setMode(m) {
        mode = m || PaintMode.NONE;
        // The hover footprint's accent color depends on mode, so a mode
        // change without pointer movement still needs a render bump.
        if (onHover) onHover();
    }
    function getMode() { return mode; }

    function setBrushSize(s) {
        const n = (s | 0);
        brushSize = n < 0 ? 0 : (n > 2 ? 2 : n);
        if (onHover) onHover();
    }
    function getBrushSize() { return brushSize; }

    function startStroke() {
        activeUndoStroke = new Map();
        activeRedoStroke = new Map();
        lastApplied = -1;
    }

    function endStroke() {
        if (activeUndoStroke && activeUndoStroke.size > 0) {
            // Capture post-stroke state for every cell the stroke touched.
            // applyAtHex only snapshots pre-state on the first touch; we do
            // the post-state sweep here so a single cell touched multiple
            // times during the stroke still maps to its final state.
            const grid = getGrid();
            if (grid) {
                for (const i of activeUndoStroke.keys()) {
                    activeRedoStroke.set(i, captureCellState(grid, i));
                }
            }
            undoStack.push({ pre: activeUndoStroke, post: activeRedoStroke });
            while (undoStack.length > MAX_UNDO) undoStack.shift();
            // Any fresh stroke invalidates the redo stack — the user has
            // diverged from the saved future. Same convention as gerry.
            redoStack.length = 0;
            notifyHistoryChange();
        }
        activeUndoStroke = null;
        activeRedoStroke = null;
        lastApplied = -1;
    }

    function applyAtHex(q, r) {
        const grid = getGrid();
        if (!grid) return false;
        const toggles = getToggles ? getToggles() : null;
        const cells = RADIUS_OFFSETS[brushSize] || buildRadiusOffsets(brushSize);
        let changed = 0;
        for (let k = 0; k < cells.length; k += 2) {
            const cq = q + cells[k];
            const cr = r + cells[k + 1];
            if (cq < 0 || cq >= grid.W || cr < 0 || cr >= grid.H) continue;
            const i = grid.idx(cq, cr);
            if (grid.mask && grid.mask[i] === 0) continue;
            // Snapshot before first modify in this stroke. Subsequent drag-
            // paint hits on the same cell don't re-snapshot (the original
            // pre-stroke state is what undo needs).
            if (activeUndoStroke && !activeUndoStroke.has(i)) {
                activeUndoStroke.set(i, captureCellState(grid, i));
            }
            if (paintCell(grid, cq, cr, mode, toggles)) changed++;
        }
        if (changed > 0 && onMutate) onMutate();
        return changed > 0;
    }

    function undo() {
        const entry = undoStack.pop();
        if (!entry) return false;
        const grid = getGrid();
        if (!grid) return false;
        for (const [i, snap] of entry.pre) {
            restoreCellState(grid, i, snap);
        }
        redoStack.push(entry);
        while (redoStack.length > MAX_UNDO) redoStack.shift();
        if (onMutate) onMutate();
        notifyHistoryChange();
        return true;
    }

    function redo() {
        const entry = redoStack.pop();
        if (!entry) return false;
        const grid = getGrid();
        if (!grid) return false;
        for (const [i, snap] of entry.post) {
            restoreCellState(grid, i, snap);
        }
        undoStack.push(entry);
        while (undoStack.length > MAX_UNDO) undoStack.shift();
        if (onMutate) onMutate();
        notifyHistoryChange();
        return true;
    }

    function canUndo() { return undoStack.length > 0; }
    function canRedo() { return redoStack.length > 0; }
    function clearUndo() {
        const hadAny = undoStack.length > 0 || redoStack.length > 0;
        undoStack.length = 0;
        redoStack.length = 0;
        if (hadAny) notifyHistoryChange();
    }

    // ─── Stroke suppression ───
    // External owners (main.js's zoom/pinch handler) toggle this so two-
    // finger gestures don't paint. When flipping to true mid-stroke we end
    // the active stroke cleanly so its snapshot still lands on the undo
    // stack rather than dangling. Pointer-down while suppressed early-exits
    // in onPointerDown; pointer-up still runs, but pointerDown is false so
    // it's a no-op.
    function setSuppressed(v) {
        const next = !!v;
        if (next === suppressed) return;
        suppressed = next;
        if (suppressed && pointerDown) {
            pointerDown = false;
            endStroke();
            clearHover();
        }
    }
    function isSuppressed() { return suppressed; }

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
        // Pinch/zoom in progress — skip the stroke entirely. main.js's pinch
        // handler flips suppressed=true on second-finger touchstart.
        if (suppressed) return;
        // Allow only the primary pointer button (left mouse, or any touch/pen).
        if (e.button !== undefined && e.button !== 0) return;
        if (e.cancelable) e.preventDefault();
        try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ok */ }
        pointerDown = true;
        startStroke();
        const hit = hitTest(e);
        if (hit) {
            const grid = getGrid();
            lastApplied = grid.idx(hit.q, hit.r);
            setHover(hit.q, hit.r, true);
            applyAtHex(hit.q, hit.r);
        } else {
            clearHover();
        }
    }

    function onPointerMove(e) {
        const hit = hitTest(e);
        if (hit) {
            setHover(hit.q, hit.r, true);
        } else {
            clearHover();
        }
        if (!pointerDown || mode === PaintMode.NONE || suppressed) return;
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
        clearHover();
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
    function syncModeButtons() {
        const grid = document.getElementById('paint-mode-grid');
        if (!grid) return;
        grid.querySelectorAll('.paint-mode-btn').forEach((b) => {
            const on = (b.dataset.paint === mode);
            b.classList.toggle('active', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
    }
    function syncBrushButtons() {
        const group = document.getElementById('brush-size-group');
        if (!group) return;
        group.querySelectorAll('.mode-btn').forEach((b) => {
            const on = (b.dataset.brush === String(brushSize));
            b.classList.toggle('active', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
    }

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
                syncModeButtons();
                e.preventDefault();
            }
            return;
        }
        if (e.key === '[' || e.key === ']') {
            setBrushSize(brushSize + (e.key === '[' ? -1 : 1));
            syncBrushButtons();
            e.preventDefault();
            return;
        }
        // Cmd/Ctrl+Z = undo; Cmd/Ctrl+Shift+Z or Cmd/Ctrl+Y = redo
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
            if (e.shiftKey) {
                if (redo()) e.preventDefault();
            } else {
                if (undo()) e.preventDefault();
            }
            return;
        }
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
            if (redo()) e.preventDefault();
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
    }

    return {
        setMode, getMode,
        setBrushSize, getBrushSize,
        applyAtHex,
        undo, redo, canUndo, canRedo, clearUndo,
        getHoverFootprint,
        setSuppressed, isSuppressed,
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

// Brush footprint counts at radius 0/1/2 — mirrors gerry's "1/3/7" pattern
// but with the hex-radius cell counts (1, 7, 19). Displayed as a three-
// button mode-group; clicking a button calls setBrushSize directly.
const BRUSH_SIZE_OPTIONS = [
    { value: 0, label: '1',  hint: 'Single cell (1 hex)' },
    { value: 1, label: '7',  hint: 'Small brush (7 hexes)' },
    { value: 2, label: '19', hint: 'Wide brush (19 hexes)' }
];

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
    // Segmented control with three buttons (1 / 7 / 19) replacing the old
    // slider. The mode-toggles styling gives us the sliding accent indicator
    // for free, and matches the topology / viewmode / animal-display rows.
    const row = document.createElement('div');
    row.className = 'settings-dd-row animal-display-row';
    row.dataset.role = 'brush';

    const lbl = document.createElement('span');
    lbl.className = 'toggle-label';
    lbl.textContent = 'Brush size';
    row.appendChild(lbl);

    const group = document.createElement('div');
    group.id = 'brush-size-group';
    group.className = 'mode-toggles inline-mode-toggles';
    group.setAttribute('role', 'tablist');
    group.setAttribute('aria-label', 'Brush size');

    const initial = controller.getBrushSize();
    const buttons = [];
    for (const opt of BRUSH_SIZE_OPTIONS) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mode-btn' + (opt.value === initial ? ' active' : '');
        btn.dataset.brush = String(opt.value);
        btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-selected', opt.value === initial ? 'true' : 'false');
        btn.title = opt.hint;
        btn.textContent = opt.label;
        group.appendChild(btn);
        buttons.push(btn);
    }
    group.addEventListener('click', (e) => {
        const btn = e.target.closest('.mode-btn');
        if (!btn) return;
        const v = parseInt(btn.dataset.brush, 10);
        if (Number.isNaN(v)) return;
        for (const b of buttons) {
            const on = (b === btn);
            b.classList.toggle('active', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
        }
        controller.setBrushSize(v);
        if (onChange) onChange('brush', v);
    });

    row.appendChild(group);
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
        'Sanitize, and Cull act on the cells under the brush. ' +
        'Undo / redo strokes live in the top bar.'
    ));

    panelEl.appendChild(buildSectionHeader('Brush'));
    panelEl.appendChild(buildBrushRow(controller, onChange));

    panelEl.dataset.interventionsReady = '1';
}
