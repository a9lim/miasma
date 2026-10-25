// config.js — enums + default sim parameters for miasma.
// Compartments, status layer, topology, view modes, and grid defaults.

// ─── Compartment enum ───
export const Compartment = Object.freeze({
    S: 0,    // susceptible
    E: 1,    // exposed
    I: 2,    // infectious
    R: 3,    // recovered
    D: 4,    // dead
    V: 5,    // vaccinated
    M: 6,    // maternal immunity
    Z: 7,    // zombified
    EMPTY: 8 // uninhabited tile
});

// CSS var names for each compartment's fill: --epi-* come from colors.js; the
// unoccupied sentinel is the page ground, --bg-canvas, from shared/tokens.js.
export const COMPARTMENT_CSS_VAR = Object.freeze({
    [Compartment.S]:     '--epi-s',
    [Compartment.E]:     '--epi-e',
    [Compartment.I]:     '--epi-i',
    [Compartment.R]:     '--epi-r',
    [Compartment.D]:     '--epi-d',
    [Compartment.V]:     '--epi-v',
    [Compartment.M]:     '--epi-m',
    [Compartment.Z]:     '--epi-z',
    [Compartment.EMPTY]: '--bg-canvas'
});

// ─── Status enum (orthogonal layer) ───
export const Status = Object.freeze({
    NONE: 0,
    H: 1, // hospitalized
    Q: 2  // quarantined
});

// ─── Flag bitfield (on compartments) ───
export const Flag = Object.freeze({
    NONE: 0,
    LATENT: 1,   // on E
    CARRIER: 2,  // on R
    F_CORPSE: 4, // on D
    AUTO_Q: 8    // provenance bit: this cell's Q status was set by auto-quarantine
                 // (contact tracing), not by manual paint. Lets the auto-quarantine
                 // step release only the Q it owns and leave painted Q alone.
});

// ─── Animal enum (orthogonal vector/reservoir layer) ───
// One animal compartment per cell, independent of the human compartment.
// Phase 9 doesn't distinguish vector vs reservoir — just "animal" — and
// spillover is bidirectional (animal I → human S → E, human I → animal S → I).
export const Animal = Object.freeze({
    VOID: 0,  // no animal in this cell
    S:    1,  // susceptible animal
    I:    2,  // infectious animal
    R:    3,  // recovered animal
    D:    4   // dead animal (carcass; disposed faster than human D)
});

// ─── Topology enum ───
// The four surfaces: no gluing, or all three edge pairs glued (topology.js).
export const Topology = Object.freeze({
    PLANE: 0,
    TORUS: 1,
    KLEIN: 2,
    RP2:   3
});

// ─── ViewMode enum ───
export const ViewMode = Object.freeze({
    COMPARTMENT:    'compartment',
    STRAIN:         'strain',
    AGE:            'age',
    HEALTH:         'health',
    STATUS:         'status',
    IMMUNITY:       'immunity'
});

// Map a data-topology / ?mi= string to the Topology enum. Anything else,
// including the retired 'cylinder' and 'mobius', falls back to the default.
export function topoFromString(s) {
    switch (s) {
        case 'plane': return Topology.PLANE;
        case 'torus': return Topology.TORUS;
        case 'klein': return Topology.KLEIN;
        case 'rp2':   return Topology.RP2;
        default:      return DEFAULTS.topology;
    }
}

/** Topology enum → its data-topology string. */
export function topoToString(t) {
    switch (t) {
        case Topology.PLANE: return 'plane';
        case Topology.KLEIN: return 'klein';
        case Topology.RP2:   return 'rp2';
        default:             return 'torus';
    }
}

// ─── World size ───
// The world is the regular hexagon of radius R inscribed in a (2R + 2)-cell
// axial rhombus (initialization.js applyHexMask), 3R(R + 1) + 1 cells.
// Settings offers WORLD_RADII; ?r= takes any radius in WORLD_R_RANGE.
export const WORLD_RADII = Object.freeze([59, 89, 119, 179]);
export const WORLD_R_RANGE = Object.freeze([16, 239]);
export const worldCells = (R) => 3 * R * (R + 1) + 1;
const DEFAULT_R = 59;

// ─── Default sim parameters ───
export const DEFAULTS = Object.freeze({
    R: DEFAULT_R,           // world radius in cells
    W: 2 * DEFAULT_R + 2,   // the rhombus that stores it
    H: 2 * DEFAULT_R + 2,
    hexSize: 6,
    tickRate: 30,         // ticks per second target (Phase 2+)
    topology: Topology.TORUS,
    viewMode: ViewMode.COMPARTMENT,
    maxActiveStrains: 4   // per cell coinfection cap (Phase 7+)
});

// ─── Antigenic space ───
// A square torus ANTIGENIC_SIZE antigenic units (AU) around (immunity.js).
// One AU is the distance at which cross-immunity falls by 1/e.
export const ANTIGENIC_SIZE = 8;
// Antigens each cell remembers, oldest first; a new one drops the oldest.
export const MEMORY_SLOTS = 4;
export const MemoryKind = Object.freeze({ INFECTION: 0, VACCINE: 1 });

// Flat-top hex geometry — axial neighbor offsets (clockwise from east).
export const HEX_DIRS = Object.freeze([
    { dq:  1, dr:  0 },
    { dq:  0, dr:  1 },
    { dq: -1, dr:  1 },
    { dq: -1, dr:  0 },
    { dq:  0, dr: -1 },
    { dq:  1, dr: -1 }
]);

export const SQRT3 = Math.sqrt(3);
