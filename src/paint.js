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
import { Compartment, Flag, Status, DEFAULTS, MEMORY_SLOTS, MemoryKind } from './config.js';
import { memoryOf, remember } from './immunity.js';

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
    const mb = i * MEMORY_SLOTS;
    return {
        memN:        grid.mem_n[i],
        memX:        grid.mem_x.slice(mb, mb + MEMORY_SLOTS),
        memY:        grid.mem_y.slice(mb, mb + MEMORY_SLOTS),
        memKind:     grid.mem_kind.slice(mb, mb + MEMORY_SLOTS),
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
    const mb = i * MEMORY_SLOTS;
    grid.mem_n[i] = state.memN;
    grid.mem_x.set(state.memX, mb);
    grid.mem_y.set(state.memY, mb);
    grid.mem_kind.set(state.memKind, mb);
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

// ctx: { toggles, params, reg } — the live toggles, params (for the vaccine's
// antigen) and strain registry (for the antigens a cured cell remembers).
function paintCell(grid, q, r, mode, ctx) {
    const toggles = ctx && ctx.toggles;
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
            const p = ctx && ctx.params;
            remember(memoryOf(grid), i, (p && p.vax_ag_x) || 0, (p && p.vax_ag_y) || 0, MemoryKind.VACCINE);
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
                // A cure is a recovery: remember the carried antigens.
                const reg = ctx && ctx.reg;
                if (reg) {
                    const mem = memoryOf(grid), base = i * MAX_SLOTS;
                    for (let s = 0; s < MAX_SLOTS; s++) {
                        const sid = grid.strain_ids[base + s];
                        if (sid !== EMPTY_SLOT && sid < reg.ag_x.length) remember(mem, i, reg.ag_x[sid], reg.ag_y[sid], MemoryKind.INFECTION);
                    }
                }
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
 * @param {() => object} [opts.getParams] — current params (the vaccine's antigen).
 * @param {() => object} [opts.getStrains] — current strain registry.
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
    const { canvas, getGrid, getToggles, getParams, getStrains, getViewport, pickAt, onMutate, onHover, onHistoryChange } = opts || {};
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
    // overlay (see main.js + gpu-plate.js). We track only the cell the cursor
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
        const ctx = {
            toggles: getToggles ? getToggles() : null,
            params: getParams ? getParams() : null,
            reg: getStrains ? getStrains() : null
        };
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
            if (paintCell(grid, cq, cr, mode, ctx)) changed++;
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
        // The owner may hit-test for us (the plate maps a point on a faded
        // copy beyond a glued edge to the world cell it shows).
        if (pickAt) {
            const hit = pickAt(event.clientX - rect.left, event.clientY - rect.top);
            if (!hit || hit.q < 0 || hit.q >= grid.W || hit.r < 0 || hit.r >= grid.H) return null;
            return grid.mask && grid.mask[grid.idx(hit.q, hit.r)] === 0 ? null : hit;
        }
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
    // The rail's buttons follow a mode or size set from the keyboard.
    function syncModeButtons() {
        document.querySelectorAll('#brush-rail .brush-btn').forEach((b) => {
            b.setAttribute('aria-checked', String(b.dataset.paint === mode));
        });
    }
    function syncBrushButtons() {
        document.querySelectorAll('#brush-rail .size-btn').forEach((b) => {
            b.setAttribute('aria-checked', String(b.dataset.brush === String(brushSize)));
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


// ─── The brush rail ─────────────────────────────────────────────────────────
// On the plate's left edge: the six brushes, each swatch the mark the brush
// leaves (or the ink of its footprint), then the footprint's size drawn as
// the 1, 7 and 19 hexes it covers, then undo and redo (index.html). No
// innerHTML: swatches are SVG built by createElementNS.

const BRUSHES = [
    { key: PaintMode.NONE,       label: 'Look',       hint: 'No brush: the pointer only looks (1)' },
    { key: PaintMode.SEED,       label: 'Seed',       hint: 'Infect cells with strain α (2)' },
    { key: PaintMode.VACCINATE,  label: 'Vaccinate',  hint: 'S, E, R and M cells become vaccinated (3)' },
    { key: PaintMode.QUARANTINE, label: 'Quarantine', hint: 'Cordon cells: less transmission both ways (4)' },
    { key: PaintMode.SANITIZE,   label: 'Sanitize',   hint: 'Cure E and I, clear flags, dispose of corpses (5)' },
    { key: PaintMode.CULL,       label: 'Cull',       hint: 'Kill the cells under the brush (6)' }
];
const SIZES = [
    { value: 0, label: '1 cell' },
    { value: 1, label: '7 cells' },
    { value: 2, label: '19 cells' }
];

const SVGNS = 'http://www.w3.org/2000/svg';
function svgEl(name, attrs, parent) {
    const e = document.createElementNS(SVGNS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
}
// Pointy-top hexagon path of circumradius r at (x, y), like the plate's cells.
function hexD(x, y, r) {
    let d = '';
    for (let k = 0; k < 6; k++) {
        const a = Math.PI / 6 + k * Math.PI / 3;
        d += (k ? 'L' : 'M') + (x + r * Math.cos(a)).toFixed(2) + ' ' + (y + r * Math.sin(a)).toFixed(2);
    }
    return d + 'Z';
}

/** The swatch for a brush: the mark it leaves on the plate. */
function brushSwatch(key) {
    const svg = svgEl('svg', { viewBox: '-8 -8 16 16', 'aria-hidden': 'true', class: 'brush-mark brush-mark-' + key });
    const clip = 'bclip-' + key;
    switch (key) {
        case PaintMode.NONE:
            svgEl('path', { d: 'M-3.6 -6 L-3.6 4.6 L-0.9 2.1 L1.2 6.4 L3 5.6 L0.9 1.4 L4.5 1.2 Z', class: 'mk-line' }, svg);
            break;
        case PaintMode.SEED:
            svgEl('path', { d: hexD(0, 0, 7), class: 'mk-seed' }, svg);
            break;
        case PaintMode.VACCINATE: {
            const cp = svgEl('clipPath', { id: clip }, svg);
            svgEl('path', { d: hexD(0, 0, 7) }, cp);
            const g = svgEl('g', { 'clip-path': `url(#${clip})`, class: 'mk-vax' }, svg);
            for (let o = -12; o <= 12; o += 3) svgEl('line', { x1: o - 8, y1: -8, x2: o + 8, y2: 8 }, g);
            break;
        }
        case PaintMode.QUARANTINE:
            svgEl('path', { d: hexD(0, 0, 6.2), class: 'mk-cordon' }, svg);
            break;
        case PaintMode.SANITIZE: {
            const cp = svgEl('clipPath', { id: clip }, svg);
            svgEl('path', { d: hexD(0, 0, 7) }, cp);
            const g = svgEl('g', { 'clip-path': `url(#${clip})`, class: 'mk-sanitize' }, svg);
            for (const [x, y] of [[-3, -3], [2, -4.5], [0, 1], [-4.2, 2.6], [4, 0.6], [1.6, -1], [-1, 4.6], [4.4, -3.4], [3, 4], [-2.4, -0.4]]) {
                svgEl('circle', { cx: x, cy: y, r: 0.75 }, g);
            }
            break;
        }
        case PaintMode.CULL:
            svgEl('path', { d: 'M-4 -4 L4 4 M4 -4 L-4 4', class: 'mk-cross' }, svg);
            break;
    }
    return svg;
}

/** The footprint of a brush size: 1, 7 or 19 hexes. */
function sizeGlyph(size) {
    const svg = svgEl('svg', { viewBox: '-10 -10 20 20', 'aria-hidden': 'true', class: 'size-mark' });
    const r = size === 0 ? 3.2 : size === 1 ? 2.9 : 2;
    const w = Math.sqrt(3) * r;
    let d = '';
    for (let dq = -size; dq <= size; dq++) {
        for (let dr = -size; dr <= size; dr++) {
            if (Math.abs(dq + dr) > size) continue;
            d += hexD(w * (dq + dr / 2), 1.5 * r * dr, r * 0.92);
        }
    }
    svgEl('path', { d }, svg);
    return svg;
}

/**
 * Build the rail into `railEl` (#brush-rail), before its history row.
 * onChange(kind, value) is called with ('mode', key) or ('brush', size).
 */
export function buildBrushRail(railEl, controller, onChange) {
    if (!railEl || !controller) return;
    const history = railEl.querySelector('.rail-history');
    const modes = document.createElement('div');
    modes.className = 'rail-brushes';
    modes.setAttribute('role', 'radiogroup');
    modes.setAttribute('aria-label', 'Brush');
    for (const spec of BRUSHES) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'brush-btn';
        b.dataset.paint = spec.key;
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(spec.key === controller.getMode()));
        b.title = spec.hint;
        const name = document.createElement('span');
        name.className = 'brush-name';
        name.textContent = spec.label;
        b.append(brushSwatch(spec.key), name);
        b.addEventListener('click', () => {
            controller.setMode(spec.key);
            modes.querySelectorAll('.brush-btn').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
            if (onChange) onChange('mode', spec.key);
        });
        modes.appendChild(b);
    }
    const sizes = document.createElement('div');
    sizes.className = 'rail-sizes';
    sizes.setAttribute('role', 'radiogroup');
    sizes.setAttribute('aria-label', 'Brush size');
    for (const opt of SIZES) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'size-btn';
        b.dataset.brush = String(opt.value);
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(opt.value === controller.getBrushSize()));
        b.setAttribute('aria-label', 'Brush of ' + opt.label);
        b.title = 'Brush of ' + opt.label + ' ([ and ])';
        b.appendChild(sizeGlyph(opt.value));
        b.addEventListener('click', () => {
            controller.setBrushSize(opt.value);
            sizes.querySelectorAll('.size-btn').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
            if (onChange) onChange('brush', opt.value);
        });
        sizes.appendChild(b);
    }
    railEl.insertBefore(modes, history);
    railEl.insertBefore(sizes, history);
}
