// strain-style.js — how a strain is drawn: an ink and a hatch angle.
//
// Pattern before hue: on the plate's strain view every carrier is hatched,
// and strains differ by the angle of the hatching as well as its ink, so
// four co-circulating strains read as four directions even in grayscale.
// The phylogeny and the strain list use the same pair. Styles cycle by
// strain id, so a strain keeps its style for life.

const INKS   = ['indigo', 'verdigris', 'ochre', 'mulberry', 'prussian', 'sienna', 'viridian', 'violet'];
const ANGLES = [45, -45, 0, 90, 22.5, -67.5, 67.5, -22.5];

export const STRAIN_STYLES = INKS.length;

/** Style slot of a strain id (0..7). */
export function strainSlot(id) {
    return id % INKS.length;
}

/** { ink: CSS color for the current theme, inkName, angle (degrees) } */
export function strainStyle(id) {
    const k = strainSlot(id);
    const inks = _themePalette().inks;
    return { ink: inks[INKS[k]], inkName: INKS[k], angle: ANGLES[k] };
}

/** The CSS variable name of a strain's ink, for DOM swatches. */
export function strainInkVar(id) {
    return '--ink-' + INKS[strainSlot(id)];
}
