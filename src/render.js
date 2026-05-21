// render.js — canvas drawing for the hex grid.
//
// Performance notes:
// - CSS-var colors are read once per theme change via a MutationObserver on
//   <html data-theme> rather than getComputedStyle on every render. Reading
//   computed styles forces a synchronous style/layout pass; doing that at
//   60 Hz was a major UI-stall source.
// - Hex corner unit-offsets are computed once at module load. The per-cell
//   inner loop pulls cx/cy from precomputed Float32Array caches keyed by
//   viewport hash — no per-cell hexToPixel allocations, no per-cell trig.
// - Fill + outline + flag/status overlays share the same precomputed
//   geometry so the four old passes collapse into one viewport-pixel cache
//   rebuild + tight per-cell render loops.
//
// View modes:
//   compartment    — color by Compartment enum via --epi-* vars
//   strain         — color cells with an active strain by strain-ID
//                    hue (golden-ratio mapping)
//   age            — green → amber → near-black ramp on age
//   health         — red → amber → green ramp on per-cell health
//   status         — H cyan, Q amber, others muted-slate, D dark
//   susceptibility — red (no prior exposure) → green (saturated bloom)

import { Compartment, COMPARTMENT_CSS_VAR, Flag, Status, ViewMode, DEFAULTS, SQRT3 } from './config.js';

// ─── Color cache (theme-aware) ──────────────────────────────────────────────
// Reading getComputedStyle is expensive (forces sync style recomputation), so
// we resolve --epi-* + --text once and refresh only when the theme attribute
// changes. The cache also pre-parses each color into r/g/b ints so the ramp
// helpers don't re-parse on every cell.

let _colorCache = null;
let _colorCacheTheme = null;

function readCss(varName, fallback) {
    const v = getComputedStyle(document.documentElement)
        .getPropertyValue(varName)
        .trim();
    return v || fallback;
}

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

function rebuildColorCache() {
    const colors = {};
    for (const key in COMPARTMENT_CSS_VAR) {
        colors[key] = readCss(COMPARTMENT_CSS_VAR[key], '#888');
    }
    const text = readCss('--text', '#000');
    const stroke = readCss('--hex-stroke', 'rgba(0, 0, 0, 0.06)');
    const parsed = {
        s: parseColor(colors[Compartment.S]),
        e: parseColor(colors[Compartment.E]),
        i: parseColor(colors[Compartment.I]),
        r: parseColor(colors[Compartment.R]),
        d: parseColor(colors[Compartment.D]),
        v: parseColor(colors[Compartment.V]),
        m: parseColor(colors[Compartment.M]),
        empty: parseColor(colors[Compartment.EMPTY])
    };
    _colorCache = {
        colors,
        text,
        stroke,
        parsed,
        statusBase: lerpColor(parsed.s, parsed.empty, 0.55),
        ramps: {
            age: makeGradient3(parsed.r, parsed.e, parsed.d),
            health: makeGradient3(parsed.i, parsed.e, parsed.r),
            susceptibility: makeGradient3(parsed.r, parsed.e, parsed.i)
        }
    };
    _colorCacheTheme = document.documentElement.dataset.theme || '';
}

function getColors() {
    const theme = document.documentElement.dataset.theme || '';
    if (_colorCache === null || theme !== _colorCacheTheme) rebuildColorCache();
    return _colorCache;
}

// Public hook used by main.js after theme toggles so callers don't need to
// know about the cache. Cheap; the next render is the one that pays.
export function invalidateColorCache() {
    _colorCache = null;
}

// One-time MutationObserver: any change to <html data-theme> invalidates the
// cache so the next render reads the new vars. Cheaper than calling
// invalidateColorCache from every theme handler, and means CSS-only theme
// switches (e.g. system prefers-color-scheme follow) also work.
if (typeof window !== 'undefined' && typeof MutationObserver !== 'undefined') {
    const mo = new MutationObserver((muts) => {
        for (const m of muts) {
            if (m.attributeName === 'data-theme') {
                _colorCache = null;
                return;
            }
        }
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

// ─── Heatmap ramp helpers ───────────────────────────────────────────────────

/** Linear interpolation in RGB space. t ∈ [0, 1]; returns a CSS rgb() string. */
function lerpColor(c0, c1, t) {
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const r = (c0.r + (c1.r - c0.r) * t) | 0;
    const g = (c0.g + (c1.g - c0.g) * t) | 0;
    const b = (c0.b + (c1.b - c0.b) * t) | 0;
    return 'rgb(' + r + ',' + g + ',' + b + ')';
}

/** 3-stop gradient on t ∈ [0, 1]: c0 → c1 → c2 at t = 0, 0.5, 1. */
function lerpColor3(c0, c1, c2, t) {
    if (t < 0) t = 0; else if (t > 1) t = 1;
    if (t < 0.5) return lerpColor(c0, c1, t * 2);
    return lerpColor(c1, c2, (t - 0.5) * 2);
}

function makeGradient3(c0, c1, c2) {
    const out = new Array(256);
    for (let i = 0; i < 256; i++) {
        out[i] = lerpColor3(c0, c1, c2, i / 255);
    }
    return out;
}

const _strainFillCache = new Map();

function strainFill(strainId) {
    let fill = _strainFillCache.get(strainId);
    if (fill !== undefined) return fill;
    const hue = (strainId * 137.508) % 360;
    fill = 'hsl(' + hue + ', 60%, 55%)';
    _strainFillCache.set(strainId, fill);
    return fill;
}

// 64-bit-bloom popcount over grid.strain_hist starting at cellIdx * 8.
function bloomPopcount8(bloom, cellIdx) {
    let n = 0;
    const base = cellIdx * 8;
    for (let k = 0; k < 8; k++) {
        let b = bloom[base + k];
        b = (b & 0x55) + ((b >>> 1) & 0x55);
        b = (b & 0x33) + ((b >>> 2) & 0x33);
        b = (b & 0x0f) + ((b >>> 4) & 0x0f);
        n += b;
    }
    return n;
}

// ─── Hex corner unit offsets (precomputed) ──────────────────────────────────
// Flat-top hex: corner k sits at angle (60k - 30)°. Computing the trig once
// at module load means the per-cell hex path is just six adds — no Math.cos
// / Math.sin / array-of-{x,y}-objects allocations.
const HEX_UNIT_X = new Float32Array(6);
const HEX_UNIT_Y = new Float32Array(6);
for (let k = 0; k < 6; k++) {
    const angle = Math.PI / 180 * (60 * k - 30);
    HEX_UNIT_X[k] = Math.cos(angle);
    HEX_UNIT_Y[k] = Math.sin(angle);
}

/** Inline a hex path on the supplied context. cx,cy = center; size = radius. */
function hexPathInline(ctx, cx, cy, size) {
    ctx.moveTo(cx + HEX_UNIT_X[0] * size, cy + HEX_UNIT_Y[0] * size);
    for (let k = 1; k < 6; k++) {
        ctx.lineTo(cx + HEX_UNIT_X[k] * size, cy + HEX_UNIT_Y[k] * size);
    }
    ctx.closePath();
}

// ─── Per-cell pixel-position cache ──────────────────────────────────────────
// Cell (q, r) → (cx, cy) depends on hexSize + originX + originY. Two Float32
// arrays keyed by the numeric viewport components, rebuilt only when the
// viewport changes (resize / zoom / pan). The render loop reads from these
// directly. Hash via separate numeric fields, not a concatenated string, so
// cache hits don't allocate a 30-char string every frame.

let _posCache = null;
let _posCacheGrid = null;
let _posCacheHexSize = NaN;
let _posCacheOriginX = NaN;
let _posCacheOriginY = NaN;
let _posCacheW = 0;
let _posCacheH = 0;

function ensurePositionCache(grid, hexSize, originX, originY) {
    if (
        _posCache !== null &&
        _posCacheGrid    === grid     &&
        _posCacheHexSize === hexSize  &&
        _posCacheOriginX === originX  &&
        _posCacheOriginY === originY  &&
        _posCacheW       === grid.W   &&
        _posCacheH       === grid.H
    ) {
        return _posCache;
    }
    const N = grid.W * grid.H;
    // Reuse the underlying buffers when the cell count hasn't changed —
    // pinch-zoom / pan fires this many times per second and we don't want
    // to allocate a 50kB+ pair of Float32Arrays each time.
    let cx, cy;
    if (_posCache !== null && _posCache.cx.length === N) {
        cx = _posCache.cx;
        cy = _posCache.cy;
    } else {
        cx = new Float32Array(N);
        cy = new Float32Array(N);
    }
    const w = SQRT3 * hexSize;
    const h = 1.5 * hexSize;
    const active = grid.activeIndices;
    if (active && active.length) {
        for (let k = 0; k < active.length; k++) {
            const i = active[k];
            const r = (i / grid.W) | 0;
            const q = i - r * grid.W;
            cx[i] = w * (q + r / 2) + originX;
            cy[i] = h * r + originY;
        }
    } else {
        for (let r = 0; r < grid.H; r++) {
            const baseY = h * r + originY;
            for (let q = 0; q < grid.W; q++) {
                const i = r * grid.W + q;
                cx[i] = w * (q + r / 2) + originX;
                cy[i] = baseY;
            }
        }
    }
    _posCache = { cx, cy };
    _posCacheGrid    = grid;
    _posCacheHexSize = hexSize;
    _posCacheOriginX = originX;
    _posCacheOriginY = originY;
    _posCacheW       = grid.W;
    _posCacheH       = grid.H;
    return _posCache;
}

// ─── Main render ────────────────────────────────────────────────────────────

/**
 * Draw the grid.
 * @param {CanvasRenderingContext2D} ctx — DPR-transformed by resizeCanvasDPR
 * @param {Grid} grid
 * @param {string} mode — ViewMode value
 * @param {object} viewport — { cssWidth, cssHeight, hexSize, originX, originY }
 * @param {object} [opts] — additional render options:
 *   - animalDisplay: 'dots' | 'only' | 'off' (default 'dots')
 *   - ageMax: number — AGE view ramp saturation (default 5000)
 *   - paintOverlay: { q, r, brushSize, mode, inside } — when present and
 *     `inside` is true, the cells under the brush footprint are filled with
 *     a translucent paint-mode-accent tint. Replaces the DOM brush circle.
 */
export function render(ctx, grid, mode, viewport, opts) {
    const { cssWidth, cssHeight, hexSize, originX, originY } = viewport;
    const animalDisplay = (opts && opts.animalDisplay) || 'dots';
    const ageMax = (opts && opts.ageMax) || 5000;
    const paintOverlay = (opts && opts.paintOverlay) || null;

    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const {
        colors,
        text: textColor,
        stroke: strokeColor,
        ramps,
        statusBase
    } = getColors();

    // Slight overscale so hex tiles butt-join without sub-pixel seams.
    const drawSize = hexSize + 0.5;

    const mask = grid.mask;
    const compartmentArr = grid.compartment;
    const flagsArr = grid.flags;
    const statusArr = grid.status;
    const ageArr = grid.age;
    const healthArr = grid.health;
    const strainIds = grid.strain_ids;
    const strainLoads = grid.strain_loads;
    const strainHist = grid.strain_hist;
    const animalArr = grid.animal;
    const N = grid.W * grid.H;
    const active = grid.activeIndices;
    const activeCount = active ? active.length : N;
    const MAX_ACTIVE_RENDER = DEFAULTS.maxActiveStrains;

    const { cx: posX, cy: posY } = ensurePositionCache(grid, hexSize, originX, originY);

    // Build a per-cell fill resolver bound to the current view mode. Resolving
    // once per render instead of once per cell saves a stack of branches in
    // the inner loop.
    const pickFill = buildFillResolver(mode, colors, {
        ageArr, healthArr, strainIds, strainLoads, strainHist, statusArr,
        ageMax, maxActive: MAX_ACTIVE_RENDER, ramps, statusBase
    });

    const drawHumanLayer = (animalDisplay !== 'only');

    if (drawHumanLayer) {
        // Single fused pass: fill each cell, then stroke its outline. The path
        // is built once per cell and used for both ops. Empty (unoccupied)
        // cells skip both fill AND stroke so they render transparent — the
        // canvas background shows through instead of the previous beige
        // `--bg-base` fill, and there's no hex outline to read as "cell here."
        ctx.lineWidth = 1;
        ctx.lineJoin = 'miter';
        ctx.strokeStyle = strokeColor;

        for (let ak = 0; ak < activeCount; ak++) {
            const i = active ? active[ak] : ak;
            if (mask && mask[i] === 0) continue;
            const comp = compartmentArr[i];
            if (comp === Compartment.EMPTY) continue;
            const cx = posX[i];
            const cy = posY[i];
            ctx.beginPath();
            hexPathInline(ctx, cx, cy, drawSize);
            ctx.fillStyle = pickFill(i, comp);
            ctx.fill();
            ctx.stroke();
        }

        // Flag overlays (only in COMPARTMENT view — flags are modifiers on
        // their base compartment, so other modes intentionally hide them).
        if (mode === ViewMode.COMPARTMENT) {
            renderFlagOverlays(ctx, grid, colors, drawSize, posX, posY, hexSize, active, activeCount);
        }
        // Status overlays (H badge, Q ring) render in both COMPARTMENT and
        // STATUS views.
        if (mode === ViewMode.COMPARTMENT || mode === ViewMode.STATUS) {
            renderStatusOverlays(ctx, grid, textColor, drawSize, posX, posY, hexSize, active, activeCount);
        }
    } else {
        // animalDisplay === 'only': skip the human-compartment fill entirely
        // so the canvas background shows through. Animal dots draw on top.
        // Previously we filled the inscribed region with `colors[EMPTY]`
        // (beige) as a backdrop for dots — with EMPTY now transparent,
        // dots read fine against the page background.
    }

    // Animal dots — three-way: 'dots' overlay, 'only' (skipped above's human
    // pass), 'off' (skipped here). Below the min hex-size threshold the dots
    // become indistinguishable from the cell center, so skip then too.
    if (animalArr && hexSize >= 3 && animalDisplay !== 'off') {
        renderAnimalDots(ctx, animalArr, mask, colors, hexSize, posX, posY, active, activeCount);
    }

    // Brush footprint overlay — translucent fill on every cell under the
    // current brush, plus a thin outline tracing the outer edge of the
    // footprint. Drawn last so it sits on top of every base/strain/age fill.
    if (paintOverlay && paintOverlay.inside && paintOverlay.mode !== 'none') {
        renderPaintOverlay(ctx, grid, paintOverlay, drawSize, posX, posY);
    }
}

// ─── View-mode-specific fill resolvers ──────────────────────────────────────
// Resolving (mode → fill function) once per render eliminates the per-cell
// switch in the hot loop. Each resolver closes over the arrays it needs.

function buildFillResolver(mode, colors, ctx) {
    const { ageArr, healthArr, strainIds, strainLoads, strainHist, statusArr,
            ageMax, maxActive, ramps, statusBase } = ctx;
    const emptyFill = colors[Compartment.EMPTY];
    const sFill = colors[Compartment.S];
    const dFill = colors[Compartment.D];
    const zFill = colors[Compartment.Z];
    const vFill = colors[Compartment.V];
    const mFill = colors[Compartment.M];
    const eFill = colors[Compartment.E];

    if (mode === ViewMode.STRAIN) {
        return (i, comp) => {
            const base = i * maxActive;
            let bestSid = 0xFFFF;
            let bestLoad = 0;
            for (let s = 0; s < maxActive; s++) {
                const sid = strainIds[base + s];
                if (sid === 0xFFFF) continue;
                const ld = strainLoads ? strainLoads[base + s] : 1;
                if (ld > bestLoad) { bestLoad = ld; bestSid = sid; }
            }
            if (bestSid !== 0xFFFF) {
                return strainFill(bestSid);
            }
            return colors[comp] || sFill;
        };
    }

    if (mode === ViewMode.AGE) {
        return (i, comp) => {
            if (comp === Compartment.EMPTY) return emptyFill;
            if (comp === Compartment.D) return dFill;
            const a = ageArr[i];
            const t = a >= ageMax ? 1 : (a / ageMax);
            // young (R) → mid (E) → old (D)
            return ramps.age[(t * 255) | 0];
        };
    }

    if (mode === ViewMode.HEALTH) {
        return (i, comp) => {
            if (comp === Compartment.EMPTY) return emptyFill;
            if (comp === Compartment.D)     return dFill;
            if (comp === Compartment.Z)     return zFill;
            const h = healthArr[i];
            const t = h < 0 ? 0 : (h > 1 ? 1 : h);
            return ramps.health[(t * 255) | 0];
        };
    }

    if (mode === ViewMode.STATUS) {
        // Pre-compute the muted base color (mid-mix of slate and empty). Same
        // across cells, so no need to re-lerp per cell.
        const baseMuted = statusBase;
        return (i, comp) => {
            if (comp === Compartment.EMPTY) return emptyFill;
            if (comp === Compartment.D)     return dFill;
            const st = statusArr[i];
            if (st === 1) return vFill; // H → cyan
            if (st === 2) return eFill; // Q → amber
            return baseMuted;
        };
    }

    if (mode === ViewMode.SUSCEPTIBILITY) {
        return (i, comp) => {
            if (comp === Compartment.EMPTY) return emptyFill;
            if (comp === Compartment.D)     return dFill;
            if (comp === Compartment.V)     return vFill;
            if (comp === Compartment.M)     return mFill;
            let suscept = 1;
            if (strainHist) {
                const pc = bloomPopcount8(strainHist, i);
                suscept = 1 - Math.min(1, pc / 16);
            }
            if (statusArr[i] === 2) suscept *= 0.5;
            return ramps.susceptibility[(suscept * 255) | 0];
        };
    }

    // Default: COMPARTMENT view — direct table lookup, no branching.
    return (i, comp) => colors[comp] || sFill;
}

// ─── Animal dot overlay ─────────────────────────────────────────────────────

function renderAnimalDots(ctx, anim, mask, colors, hexSize, posX, posY, active, activeCount) {
    const dotR = Math.max(1, hexSize * 0.22);

    // Index dot-color by Animal enum so the inner loop avoids the if-else
    // chain. Indices match Animal.VOID/S/I/R/D enum values.
    const dotColors = [
        null,                                  // VOID — never drawn
        colors[Compartment.S] || '#888',       // S
        colors[Compartment.I] || '#e11107',    // I
        colors[Compartment.R] || '#0a7',       // R
        colors[Compartment.D] || '#222'        // D
    ];

    // Group draws by color so we minimize fillStyle changes (canvas state
    // changes are cheap individually but add up across thousands of cells).
    const TWO_PI = Math.PI * 2;
    for (let state = 1; state <= 4; state++) {
        const color = dotColors[state];
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.beginPath();
        let any = false;
        for (let ak = 0; ak < activeCount; ak++) {
            const i = active ? active[ak] : ak;
            if (mask && mask[i] === 0) continue;
            if (anim[i] !== state) continue;
            ctx.moveTo(posX[i] + dotR, posY[i]);
            ctx.arc(posX[i], posY[i], dotR, 0, TWO_PI);
            any = true;
        }
        if (any) ctx.fill();
    }
}

// ─── Flag overlays (L stripes on E, C rim on R, F rim on D) ─────────────────

function renderFlagOverlays(ctx, grid, colors, drawSize, posX, posY, hexSize, active, activeCount) {
    const stripeColor = colors[Compartment.S] || '#888';
    const rimColor    = colors[Compartment.I] || '#e11107';

    // 60° stripe geometry — direction (cos60°, sin60°), normal (-sin60°, cos60°).
    const stripeDx = 0.5;
    const stripeDy = SQRT3 / 2;
    const stripeNx = -SQRT3 / 2;
    const stripeNy = 0.5;
    const stripeHalf = drawSize * 1.2;
    const stripeSpacing = hexSize * 0.55;
    const stripeOffsets = [-stripeSpacing, 0, stripeSpacing];

    const rimSize = drawSize * 0.82;

    const compartmentArr = grid.compartment;
    const flagsArr = grid.flags;

    for (let ak = 0; ak < activeCount; ak++) {
        const i = active ? active[ak] : ak;
        const flags = flagsArr[i];
        if (flags === Flag.NONE) continue;

        const comp = compartmentArr[i];
        const isLatentE  = comp === Compartment.E && (flags & Flag.LATENT);
        const isCarrierR = comp === Compartment.R && (flags & Flag.CARRIER);
        const isCorpseFD = comp === Compartment.D && (flags & Flag.F_CORPSE);
        if (!isLatentE && !isCarrierR && !isCorpseFD) continue;

        const cx = posX[i];
        const cy = posY[i];

        if (isLatentE) {
            ctx.save();
            ctx.beginPath();
            hexPathInline(ctx, cx, cy, drawSize);
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
            ctx.save();
            ctx.globalAlpha = 0.75;
            ctx.strokeStyle = rimColor;
            ctx.lineWidth = 1.8;
            ctx.beginPath();
            hexPathInline(ctx, cx, cy, rimSize);
            ctx.stroke();
            ctx.restore();
        } else {
            ctx.save();
            ctx.globalAlpha = 0.5;
            ctx.strokeStyle = rimColor;
            ctx.lineWidth = 1.8;
            ctx.beginPath();
            hexPathInline(ctx, cx, cy, rimSize);
            ctx.stroke();
            ctx.restore();
        }
    }
}

// ─── Status overlays (H "+" badge, Q ring) ──────────────────────────────────

function renderStatusOverlays(ctx, grid, textColor, drawSize, posX, posY, hexSize, active, activeCount) {
    const crossHalf = hexSize * 0.225;
    const crossLineWidth = 1.2;
    const crossAlpha = 0.85;
    const ringAlpha = 0.55;
    const ringLineWidth = 1.5;

    const statusArr = grid.status;

    // Batch Q rings into one stroke, H badges into one stroke. Same color +
    // line settings → drastically fewer ctx state changes.
    let anyQ = false;
    let anyH = false;
    for (let ak = 0; ak < activeCount; ak++) {
        const i = active ? active[ak] : ak;
        const s = statusArr[i];
        if (s === Status.Q) { anyQ = true; if (anyH) break; }
        else if (s === Status.H) { anyH = true; if (anyQ) break; }
    }

    if (anyQ) {
        ctx.save();
        ctx.globalAlpha = ringAlpha;
        ctx.strokeStyle = textColor;
        ctx.lineWidth = ringLineWidth;
        ctx.beginPath();
        for (let ak = 0; ak < activeCount; ak++) {
            const i = active ? active[ak] : ak;
            if (statusArr[i] !== Status.Q) continue;
            hexPathInline(ctx, posX[i], posY[i], drawSize);
        }
        ctx.stroke();
        ctx.restore();
    }

    if (anyH) {
        ctx.save();
        ctx.globalAlpha = crossAlpha;
        ctx.strokeStyle = textColor;
        ctx.lineWidth = crossLineWidth;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (let ak = 0; ak < activeCount; ak++) {
            const i = active ? active[ak] : ak;
            if (statusArr[i] !== Status.H) continue;
            const cx = posX[i];
            const cy = posY[i];
            ctx.moveTo(cx - crossHalf, cy);
            ctx.lineTo(cx + crossHalf, cy);
            ctx.moveTo(cx, cy - crossHalf);
            ctx.lineTo(cx, cy + crossHalf);
        }
        ctx.stroke();
        ctx.restore();
    }
}

// ─── Brush footprint overlay ───────────────────────────────────────────────
// Tint the cells under the current brush with the paint-mode accent color
// so the user sees exactly which hexes a stroke would affect. Replaces the
// old DOM .brush-indicator circle — the cell-accurate outline is the whole
// point on a hex lattice (a circle never matches the seven/nineteen-hex
// footprints precisely).
//
// The paint mode → accent var mapping mirrors paint.js's hover color logic;
// keep them in sync.
const PAINT_ACCENT_VARS = {
    seed:       '--epi-i',
    vaccinate:  '--epi-v',
    quarantine: '--epi-e',
    sanitize:   '--epi-r',
    cull:       '--epi-d'
};

function readAccentColor(paintMode) {
    const varName = PAINT_ACCENT_VARS[paintMode];
    if (!varName) return '#888';
    return readCss(varName, '#888');
}

function renderPaintOverlay(ctx, grid, overlay, drawSize, posX, posY) {
    const { q, r, brushSize } = overlay;
    const accent = readAccentColor(overlay.mode);
    const parsed = parseColor(accent);
    const fillAlpha = 0.28;
    const strokeAlpha = 0.85;
    const fillStyle = `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${fillAlpha})`;
    const strokeStyle = `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${strokeAlpha})`;

    // Walk the (q, r) ± brushSize triangular axial bound — same enumeration
    // as paint.js hexesInRadius, inlined to avoid the array allocation.
    ctx.save();
    ctx.fillStyle = fillStyle;
    ctx.beginPath();
    let any = false;
    for (let dq = -brushSize; dq <= brushSize; dq++) {
        const drLo = Math.max(-brushSize, -dq - brushSize);
        const drHi = Math.min(brushSize,  -dq + brushSize);
        for (let dr = drLo; dr <= drHi; dr++) {
            const cq = q + dq;
            const cr = r + dr;
            if (cq < 0 || cq >= grid.W || cr < 0 || cr >= grid.H) continue;
            const i = cr * grid.W + cq;
            if (grid.mask && grid.mask[i] === 0) continue;
            hexPathInline(ctx, posX[i], posY[i], drawSize);
            any = true;
        }
    }
    if (any) {
        ctx.fill();
        // Restroke the same path so the footprint reads as a coherent
        // outline even when neighboring cells share edges.
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = strokeStyle;
        ctx.stroke();
    }
    ctx.restore();
}

/** Compute a viewport that fits a W×H grid into the canvas. */
export function computeViewport(canvas, grid) {
    const rect = canvas.getBoundingClientRect();
    const cssWidth = rect.width || canvas.clientWidth;
    const cssHeight = rect.height || canvas.clientHeight;

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
