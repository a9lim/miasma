// render.js — canvas drawing for the hex grid.
// Phase 1: flat-top hex outlines, filled by compartment color (read from
// CSS vars set in miasma/colors.js).
// Phase 3: flag-overlay pass on top of fills — L stripes on E, C rim on R,
// F rim on D.
// Phase 4: status-overlay pass on top of flags — H "+" badge on hospitalized
// cells, Q darker outline ring on quarantined cells. Other view modes
// (strain / age / health / status / susceptibility) wire in in Phase 13.

import { hexToPixel, hexCorners } from './grid.js';
import { Animal, Compartment, COMPARTMENT_CSS_VAR, Flag, Status, ViewMode, DEFAULTS } from './config.js';

// Cache CSS-var lookups per-render so we don't pay getComputedStyle per cell.
function readCompartmentColors() {
    const style = getComputedStyle(document.documentElement);
    const out = {};
    for (const key in COMPARTMENT_CSS_VAR) {
        const varName = COMPARTMENT_CSS_VAR[key];
        const v = style.getPropertyValue(varName).trim();
        // Fall back to a visible neutral if a var is missing — Phase 1 may run
        // before colors.js defines the full set.
        out[key] = v || '#888';
    }
    return out;
}

// ─── Phase 13 — heatmap ramp helpers ───
// Parse a #RGB / #RRGGBB / rgb(...) string into an {r, g, b} object once
// per render so per-cell lerp doesn't keep re-parsing. Returns {r, g, b}
// with each channel in [0, 255]. Unknown strings fall back to grey.
function parseColor(s) {
    if (!s) return { r: 136, g: 136, b: 136 };
    s = s.trim();
    if (s[0] === '#') {
        if (s.length === 4) {
            return {
                r: parseInt(s[1] + s[1], 16),
                g: parseInt(s[2] + s[2], 16),
                b: parseInt(s[3] + s[3], 16)
            };
        }
        return {
            r: parseInt(s.substr(1, 2), 16),
            g: parseInt(s.substr(3, 2), 16),
            b: parseInt(s.substr(5, 2), 16)
        };
    }
    if (s.startsWith('rgb')) {
        const m = s.match(/-?\d+(?:\.\d+)?/g);
        if (m && m.length >= 3) {
            return {
                r: Math.round(parseFloat(m[0])),
                g: Math.round(parseFloat(m[1])),
                b: Math.round(parseFloat(m[2]))
            };
        }
    }
    return { r: 136, g: 136, b: 136 };
}

/** Linear interpolation in RGB space. t ∈ [0, 1]; returns a CSS rgb() string. */
function lerpColor(c0, c1, t) {
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const r = (c0.r + (c1.r - c0.r) * t) | 0;
    const g = (c0.g + (c1.g - c0.g) * t) | 0;
    const b = (c0.b + (c1.b - c0.b) * t) | 0;
    return 'rgb(' + r + ',' + g + ',' + b + ')';
}

/**
 * 3-stop gradient on t ∈ [0, 1]: c0 → c1 → c2 at t = 0, 0.5, 1.
 * Useful when the meaningful axis has a clear midpoint (health/age).
 */
function lerpColor3(c0, c1, c2, t) {
    if (t < 0) t = 0; else if (t > 1) t = 1;
    if (t < 0.5) return lerpColor(c0, c1, t * 2);
    return lerpColor(c1, c2, (t - 0.5) * 2);
}

// 64-bit-bloom popcount. Reads 8 bytes from grid.strain_hist starting at
// cellIdx * 8 and returns the number of set bits across the whole bloom.
// Used by the susceptibility view as a cheap proxy for "how many strains
// has this cell already seen?" (modulo bloom-filter false positives).
function bloomPopcount8(bloom, cellIdx) {
    let n = 0;
    const base = cellIdx * 8;
    for (let k = 0; k < 8; k++) {
        let b = bloom[base + k];
        // SWAR popcount on a single byte. Cheaper than a 256-entry LUT for
        // the volumes here (~10k cells × 8 bytes per render).
        b = (b & 0x55) + ((b >>> 1) & 0x55);
        b = (b & 0x33) + ((b >>> 2) & 0x33);
        b = (b & 0x0f) + ((b >>> 4) & 0x0f);
        n += b;
    }
    return n;
}

// Build a flat-top hex path on the current context. Caller handles fill/stroke.
function hexPath(ctx, corners) {
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let k = 1; k < 6; k++) ctx.lineTo(corners[k].x, corners[k].y);
    ctx.closePath();
}

/**
 * Draw the grid.
 * @param {CanvasRenderingContext2D} ctx — already transformed for DPR by resizeCanvasDPR
 * @param {Grid} grid
 * @param {string} mode — ViewMode value
 * @param {object} viewport — { cssWidth, cssHeight, hexSize, originX, originY }
 */
export function render(ctx, grid, mode, viewport) {
    const { cssWidth, cssHeight, hexSize, originX, originY } = viewport;

    // Clear in CSS-pixel coords (ctx is DPR-transformed by resizeCanvasDPR).
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const colors = readCompartmentColors();

    // Slight overscale so hex tiles butt-join without sub-pixel seams.
    const drawSize = hexSize + 0.5;

    ctx.lineWidth = 1;
    ctx.lineJoin = 'miter';

    // Cells with mask=0 are "void" — outside the hexagonal world. Skipping
    // them in fill + outline passes leaves the canvas background showing
    // through, so the rhombus storage reads visually as a regular hexagon.
    // (Flag and status overlay passes early-exit on flags=0 / status=0,
    // which applyHexMask already zeroed for void cells.)
    //
    // View modes (Phase 13):
    //   compartment    — color by Compartment enum via --epi-* vars
    //   strain         — color cells with an active strain by strain-ID
    //                    hue (golden-ratio mapping)
    //   age            — green → amber → near-black ramp on age
    //   health         — red → amber → green ramp on per-cell health
    //   status         — H cyan, Q amber, others muted-slate, D dark
    //   susceptibility — red (no prior exposure) → green (saturated bloom)
    //
    // Each per-cell fill is computed by `pickFill(i, comp)` so the loop
    // stays a single typed-array scan independent of mode.
    const mask = grid.mask;
    const strainIds = grid.strain_ids;
    const strainLoads = grid.strain_loads;
    const MAX_ACTIVE_RENDER = DEFAULTS.maxActiveStrains;

    // Pre-parse ramp endpoints for heatmap modes so the per-cell loop only
    // calls lerpColor (no string parsing). Tied to the current theme colors
    // so dark/light flips automatically.
    const cParse = {
        s: parseColor(colors[Compartment.S]),
        e: parseColor(colors[Compartment.E]),
        i: parseColor(colors[Compartment.I]),
        r: parseColor(colors[Compartment.R]),
        d: parseColor(colors[Compartment.D]),
        v: parseColor(colors[Compartment.V]),
        m: parseColor(colors[Compartment.M])
    };

    const pickFill = (cellIdx, comp) => {
        if (mode === ViewMode.STRAIN) {
            const base = cellIdx * MAX_ACTIVE_RENDER;
            let bestSid = 0xFFFF;
            let bestLoad = 0;
            for (let s = 0; s < MAX_ACTIVE_RENDER; s++) {
                const sid = strainIds[base + s];
                if (sid === 0xFFFF) continue;
                const ld = strainLoads ? strainLoads[base + s] : 1;
                if (ld > bestLoad) { bestLoad = ld; bestSid = sid; }
            }
            if (bestSid !== 0xFFFF) {
                const hue = (bestSid * 137.508) % 360;
                return `hsl(${hue}, 60%, 55%)`;
            }
            return colors[comp] || colors[Compartment.S];
        }
        if (mode === ViewMode.AGE) {
            if (comp === Compartment.EMPTY) return colors[Compartment.EMPTY];
            if (comp === Compartment.D) return colors[Compartment.D];
            // Normalize against the natural-mortality saturation age. 5000
            // ticks is the canonical "very old" point; anything past
            // saturates to near-black via the third ramp stop.
            const a = grid.age[cellIdx];
            const t = a > 5000 ? 1 : (a / 5000);
            // young (R green) → mid (E amber) → old (D near-black)
            return lerpColor3(cParse.r, cParse.e, cParse.d, t);
        }
        if (mode === ViewMode.HEALTH) {
            if (comp === Compartment.EMPTY) return colors[Compartment.EMPTY];
            if (comp === Compartment.D)     return colors[Compartment.D];
            if (comp === Compartment.Z)     return colors[Compartment.Z];
            const h = grid.health[cellIdx];
            const t = h < 0 ? 0 : (h > 1 ? 1 : h);
            // Health: low → I red, mid → E amber, high → R green.
            return lerpColor3(cParse.i, cParse.e, cParse.r, t);
        }
        if (mode === ViewMode.STATUS) {
            // Status overlay readout: highlight H (cyan) and Q (amber) cells
            // strongly; other cells fade to a muted slate so the H/Q
            // population pops. Dead stays near-black.
            if (comp === Compartment.EMPTY) return colors[Compartment.EMPTY];
            if (comp === Compartment.D)     return colors[Compartment.D];
            const st = grid.status[cellIdx];
            if (st === 1) return colors[Compartment.V]; // H → cyan
            if (st === 2) return colors[Compartment.E]; // Q → amber
            // Faded base — still readable but not competing with overlays.
            // Mid-mix between slate and empty so status overlays dominate.
            return lerpColor(cParse.s, parseColor(colors[Compartment.EMPTY]), 0.55);
        }
        if (mode === ViewMode.SUSCEPTIBILITY) {
            if (comp === Compartment.EMPTY) return colors[Compartment.EMPTY];
            if (comp === Compartment.D)     return colors[Compartment.D];
            if (comp === Compartment.V)     return colors[Compartment.V];
            // 64-bit bloom popcount approximates prior-exposure breadth.
            // Each strain sets ~2 bits, so popcount 0..16 covers the
            // typical range (saturating ≈ "fully exposed").
            let suscept = 1;
            if (grid.strain_hist) {
                const pc = bloomPopcount8(grid.strain_hist, cellIdx);
                // 16-bit cap so a single strain ≈ 0.875, two strains ≈ 0.75,
                // etc — visually decays smoothly.
                suscept = 1 - Math.min(1, pc / 16);
            }
            // Q multiplier compresses susceptibility further (visual proxy
            // for quarantine effectiveness on a target cell).
            if (grid.status[cellIdx] === 2) suscept *= 0.5;
            // Highly susceptible → I red; saturated immunity → R green.
            return lerpColor3(cParse.r, cParse.e, cParse.i, suscept);
        }
        // Default: COMPARTMENT view.
        return colors[comp] || colors[Compartment.S];
    };

    grid.forEach((q, r, i) => {
        if (mask && mask[i] === 0) return;
        const comp = grid.compartment[i];
        const fill = pickFill(i, comp);
        const center = hexToPixel(q, r, hexSize);
        const cx = center.x + originX;
        const cy = center.y + originY;

        const corners = hexCorners(cx, cy, drawSize);
        hexPath(ctx, corners);
        ctx.fillStyle = fill;
        ctx.fill();
    });

    // Faint outlines on top — graphic accent, not a container border.
    // Drawn as a separate pass so fills can't paint over neighbor edges.
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.06)';
    grid.forEach((q, r, i) => {
        if (mask && mask[i] === 0) return;
        const center = hexToPixel(q, r, hexSize);
        const cx = center.x + originX;
        const cy = center.y + originY;
        const corners = hexCorners(cx, cy, drawSize);
        hexPath(ctx, corners);
        ctx.stroke();
    });

    // ─── Phase 3: flag overlay pass ───
    // Only run in compartment view. Strain/age/health/status/susceptibility
    // modes ignore flags for now (Phase 13).
    if (mode === ViewMode.COMPARTMENT) {
        renderFlagOverlays(ctx, grid, colors, hexSize, drawSize, originX, originY);
        renderStatusOverlays(ctx, grid, colors, hexSize, drawSize, originX, originY);
    }

    // ─── Phase 9: animal dot overlay ───
    // Small filled dot in the center of cells where animal !== VOID. Visible
    // in both compartment and strain views — the animal layer is orthogonal
    // to whatever the cell fill represents. Colors:
    //   S animal → muted slate dot (alive but not infectious)
    //   I animal → red dot (infectious reservoir; spillover risk)
    //   R animal → green dot (recovered; cleared the reservoir)
    //   D animal → near-black dot (carcass)
    // Keeps the dot small (hexSize * 0.22) so it overlays cleanly without
    // dominating the underlying compartment color.
    if (grid.animal && hexSize >= 3) {
        renderAnimalDots(ctx, grid, colors, hexSize, originX, originY);
    }
}

/**
 * Animal dot overlay pass. Small filled circle in each cell where the
 * animal layer is non-void, colored by animal state. Cheap early-exit
 * for VOID cells (which is most of the grid at default density 0.1).
 */
function renderAnimalDots(ctx, grid, colors, hexSize, originX, originY) {
    const mask = grid.mask;
    const anim = grid.animal;
    const W = grid.W;
    const H = grid.H;
    const dotR = Math.max(1, hexSize * 0.22);

    // Pre-pick dot colors per state (read once per render).
    // S animal: muted neutral so it doesn't compete with human compartment.
    // I/R/D: reuse the disease palette — they read with the same semantic
    // as their human counterparts (red = infectious, green = recovered).
    const sColor = colors[Compartment.S] || '#888';
    const iColor = colors[Compartment.I] || '#e11107';
    const rColor = colors[Compartment.R] || '#0a7';
    const dColor = colors[Compartment.D] || '#222';

    for (let r = 0; r < H; r++) {
        for (let q = 0; q < W; q++) {
            const i = r * W + q;
            if (mask && mask[i] === 0) continue;
            const a = anim[i];
            if (a === Animal.VOID) continue;
            let fill;
            if      (a === Animal.S) fill = sColor;
            else if (a === Animal.I) fill = iColor;
            else if (a === Animal.R) fill = rColor;
            else                     fill = dColor;
            const center = hexToPixel(q, r, hexSize);
            const cx = center.x + originX;
            const cy = center.y + originY;
            ctx.fillStyle = fill;
            ctx.beginPath();
            ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

/**
 * Third render pass — draw L stripes on E, C rim on R, F rim on D.
 * Cheap early-exit for all cells without a relevant flag set.
 *
 * Aesthetic choices (a9 to iterate):
 * - Stripe angle: ~60° from horizontal so it's diagonal on flat-top hexes.
 *   Spacing chosen to give 2-3 visible stripes inside a hexSize=6 hex.
 * - Stripe color: --epi-s (S slate) at alpha 0.55 over E amber.
 * - C rim: stroke a smaller hex (drawSize * 0.82) inside the outline at
 *   --epi-i alpha 0.5, lineWidth ~1.8. Same treatment as F-corpse —
 *   distinguished from F by the base compartment color (R green vs D near-black).
 * - F rim: same as C rim. Distinguishing signal is the underlying fill.
 */
function renderFlagOverlays(ctx, grid, colors, hexSize, drawSize, originX, originY) {
    const stripeColor = colors[Compartment.S] || '#888';
    const rimColor    = colors[Compartment.I] || '#e11107';

    // Stripe geometry — precomputed once per render.
    // 60° from horizontal: direction vector (cos60°, sin60°) = (0.5, √3/2).
    // Normal to stripe (the spacing axis) is (-sin60°, cos60°) = (-√3/2, 0.5).
    const SQ3 = Math.sqrt(3);
    const stripeDx = 0.5;          // along-stripe x
    const stripeDy = SQ3 / 2;      // along-stripe y
    const stripeNx = -SQ3 / 2;     // across-stripe x (offset axis)
    const stripeNy = 0.5;          // across-stripe y
    // Half-length along the stripe direction needs to span the hex's bounding
    // box. drawSize * 1.2 is a safe over-cover; we clip to the hex anyway.
    const stripeHalf = drawSize * 1.2;
    // Spacing between adjacent stripes (in pixels). hexSize * 0.55 gives ~2-3
    // visible stripes per hex at the default size.
    const stripeSpacing = hexSize * 0.55;
    const stripeOffsets = [-stripeSpacing, 0, stripeSpacing];

    // Inner rim geometry (shared by C and F).
    const rimSize = drawSize * 0.82;

    const W = grid.W;
    const H = grid.H;
    const compartmentArr = grid.compartment;
    const flagsArr = grid.flags;

    for (let r = 0; r < H; r++) {
        for (let q = 0; q < W; q++) {
            const i = r * W + q;
            const flags = flagsArr[i];
            if (flags === Flag.NONE) continue;

            const comp = compartmentArr[i];
            // The flags field can carry multiple bits in principle; in
            // practice only one of (LATENT, CARRIER, F_CORPSE) is meaningful
            // per compartment. Mask to the relevant bit per comp.
            const isLatentE  = comp === Compartment.E && (flags & Flag.LATENT);
            const isCarrierR = comp === Compartment.R && (flags & Flag.CARRIER);
            const isCorpseFD = comp === Compartment.D && (flags & Flag.F_CORPSE);
            if (!isLatentE && !isCarrierR && !isCorpseFD) continue;

            const center = hexToPixel(q, r, hexSize);
            const cx = center.x + originX;
            const cy = center.y + originY;

            if (isLatentE) {
                // Clip to hex, draw 3 diagonal stripes. α bumped from 0.55
                // to 0.78 per Phase 14 polish — slate-on-amber at 0.55 was
                // barely visible.
                const corners = hexCorners(cx, cy, drawSize);
                ctx.save();
                hexPath(ctx, corners);
                ctx.clip();
                ctx.globalAlpha = 0.78;
                ctx.strokeStyle = stripeColor;
                ctx.lineWidth = 1.2;
                ctx.beginPath();
                for (let s = 0; s < stripeOffsets.length; s++) {
                    const off = stripeOffsets[s];
                    const ox = cx + stripeNx * off;
                    const oy = cy + stripeNy * off;
                    ctx.moveTo(ox - stripeDx * stripeHalf, oy - stripeDy * stripeHalf);
                    ctx.lineTo(ox + stripeDx * stripeHalf, oy + stripeDy * stripeHalf);
                }
                ctx.stroke();
                ctx.restore();
            } else if (isCarrierR) {
                // Inner-hex rim — same treatment as F-corpse. Underlying R
                // green vs D near-black does the distinguishing work.
                // C alpha bumped to 0.75 (vs F's 0.5) per Phase 14 to
                // compensate for red-on-green being lower contrast than
                // red-on-near-black.
                const innerCorners = hexCorners(cx, cy, rimSize);
                ctx.save();
                ctx.globalAlpha = 0.75;
                ctx.strokeStyle = rimColor;
                ctx.lineWidth = 1.8;
                hexPath(ctx, innerCorners);
                ctx.stroke();
                ctx.restore();
            } else if (isCorpseFD) {
                // Inner-hex rim — slightly smaller than drawSize so it sits
                // inside the faint outline pass.
                const innerCorners = hexCorners(cx, cy, rimSize);
                ctx.save();
                ctx.globalAlpha = 0.5;
                ctx.strokeStyle = rimColor;
                ctx.lineWidth = 1.8;
                hexPath(ctx, innerCorners);
                ctx.stroke();
                ctx.restore();
            }
        }
    }
}

/**
 * Fourth render pass — draw status overlays. H "+" badge on hospitalized
 * cells, Q darker outline ring on quarantined cells. Status is orthogonal
 * to compartment, so this runs over the flag pass. Cheap early-exit for
 * cells with Status.NONE.
 *
 * Aesthetic choices (a9 to iterate):
 * - H "+" badge: two short line segments centered in the hex, length
 *   hexSize * 0.45, lineWidth 1.2, color --text, alpha 0.85. Small enough
 *   to hint at hospital admission without dominating the fill readout.
 * - Q ring: re-stroke the standard hex path at --text alpha 0.55,
 *   lineWidth 1.5. Sits AT the cell boundary (not inset like C/F rims)
 *   so it reads as a darker outline rather than an inner ring.
 */
function renderStatusOverlays(ctx, grid, colors, hexSize, drawSize, originX, originY) {
    // Cache the canonical text color once per render — auto-flips with theme.
    const textColor = getComputedStyle(document.documentElement)
        .getPropertyValue('--text').trim() || '#000';

    // H badge geometry.
    const crossHalf = hexSize * 0.225; // segment half-length → total length 0.45 * hexSize
    const crossLineWidth = 1.2;
    const crossAlpha = 0.85;

    // Q ring geometry.
    const ringAlpha = 0.55;
    const ringLineWidth = 1.5;

    const W = grid.W;
    const H = grid.H;
    const statusArr = grid.status;

    for (let r = 0; r < H; r++) {
        for (let q = 0; q < W; q++) {
            const i = r * W + q;
            const status = statusArr[i];
            if (status === Status.NONE) continue;

            const center = hexToPixel(q, r, hexSize);
            const cx = center.x + originX;
            const cy = center.y + originY;

            // Q ring first so the H badge sits on top if a cell has both.
            if (status === Status.Q) {
                const corners = hexCorners(cx, cy, drawSize);
                ctx.save();
                ctx.globalAlpha = ringAlpha;
                ctx.strokeStyle = textColor;
                ctx.lineWidth = ringLineWidth;
                hexPath(ctx, corners);
                ctx.stroke();
                ctx.restore();
            }

            if (status === Status.H) {
                ctx.save();
                ctx.globalAlpha = crossAlpha;
                ctx.strokeStyle = textColor;
                ctx.lineWidth = crossLineWidth;
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(cx - crossHalf, cy);
                ctx.lineTo(cx + crossHalf, cy);
                ctx.moveTo(cx, cy - crossHalf);
                ctx.lineTo(cx, cy + crossHalf);
                ctx.stroke();
                ctx.restore();
            }
        }
    }
}

/** Compute a viewport that fits a W×H grid into the canvas. */
export function computeViewport(canvas, grid) {
    const rect = canvas.getBoundingClientRect();
    const cssWidth = rect.width || canvas.clientWidth;
    const cssHeight = rect.height || canvas.clientHeight;

    // Flat-top hex extents (axial → pixel, last hex sits at q=W-1, r=H-1).
    // Width spans about SQRT3 * hexSize * (W + H/2); height spans 1.5 * hexSize * H + hexSize.
    const SQRT3 = Math.sqrt(3);
    const widthPerUnit  = SQRT3 * (grid.W + grid.H / 2);
    const heightPerUnit = 1.5 * grid.H + 1;

    const fitW = cssWidth  / widthPerUnit;
    const fitH = cssHeight / heightPerUnit;
    const hexSize = Math.max(2, Math.min(fitW, fitH));

    const drawnW = SQRT3 * hexSize * (grid.W + grid.H / 2);
    const drawnH = 1.5 * hexSize * grid.H + hexSize;
    const originX = (cssWidth  - drawnW) / 2 + SQRT3 * hexSize / 2;
    const originY = (cssHeight - drawnH) / 2 + hexSize;

    return { cssWidth, cssHeight, hexSize, originX, originY };
}

// Re-export the default view mode so main.js can stay decoupled.
export { ViewMode, DEFAULTS };
