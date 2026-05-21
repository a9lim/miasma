// camera.js — zoom/pan viewport composition for the hex canvas.

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 3;
export const ZOOM_STEP_WHEEL = 1.1;
export const ZOOM_STEP_BTN = 1.25;

function clampZoom(z) {
    return z < ZOOM_MIN ? ZOOM_MIN : (z > ZOOM_MAX ? ZOOM_MAX : z);
}

export function createCamera({ canvas, ctx, sim, getGrid, computeViewport, resizeCanvasDPR, onChange }) {
    let baseViewport = null;
    const effViewport = {
        cssWidth: 0, cssHeight: 0, hexSize: 0, originX: 0, originY: 0
    };

    function changed() {
        if (onChange) onChange();
    }

    function ensureViewport() {
        if (!baseViewport) baseViewport = computeViewport(canvas, getGrid());
        return baseViewport;
    }

    function getEffectiveViewport() {
        const bv = ensureViewport();
        effViewport.cssWidth  = bv.cssWidth;
        effViewport.cssHeight = bv.cssHeight;
        effViewport.hexSize   = bv.hexSize  * sim.zoom;
        effViewport.originX   = bv.originX  + sim.panX;
        effViewport.originY   = bv.originY  + sim.panY;
        return effViewport;
    }

    function resize() {
        resizeCanvasDPR(canvas, ctx);
        baseViewport = computeViewport(canvas, getGrid());
        if (window.innerWidth <= 900 && sim.panX !== 0) {
            sim.panX = 0;
        }
        changed();
    }

    function refreshBaseViewport() {
        baseViewport = computeViewport(canvas, getGrid());
        changed();
    }

    function reset() {
        sim.zoom = 1;
        sim.panX = 0;
        sim.panY = 0;
        changed();
    }

    function zoomTo(newZoom, anchorX, anchorY) {
        const z0 = sim.zoom;
        const z1 = clampZoom(newZoom);
        if (z1 === z0) return false;
        const bv = ensureViewport();
        const ax = anchorX - bv.originX;
        const ay = anchorY - bv.originY;
        const worldX = (ax - sim.panX) / z0;
        const worldY = (ay - sim.panY) / z0;
        sim.zoom = z1;
        sim.panX = ax - worldX * z1;
        sim.panY = ay - worldY * z1;
        changed();
        return true;
    }

    function zoomAtCenter(direction) {
        const rect = canvas.getBoundingClientRect();
        return zoomTo(
            sim.zoom * (direction > 0 ? ZOOM_STEP_BTN : 1 / ZOOM_STEP_BTN),
            rect.width / 2,
            rect.height / 2
        );
    }

    function panBy(dx, dy) {
        if (dx === 0 && dy === 0) return false;
        sim.panX += dx;
        sim.panY += dy;
        changed();
        return true;
    }

    return {
        getEffectiveViewport,
        refreshBaseViewport,
        resize,
        reset,
        zoomTo,
        zoomAtCenter,
        panBy
    };
}
