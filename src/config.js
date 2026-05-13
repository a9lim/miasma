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

// CSS var names (set by miasma/colors.js — Phase 1 just uses `--epi-s` for all cells).
export const COMPARTMENT_CSS_VAR = Object.freeze({
    [Compartment.S]:     '--epi-s',
    [Compartment.E]:     '--epi-e',
    [Compartment.I]:     '--epi-i',
    [Compartment.R]:     '--epi-r',
    [Compartment.D]:     '--epi-d',
    [Compartment.V]:     '--epi-v',
    [Compartment.M]:     '--epi-m',
    [Compartment.Z]:     '--epi-z',
    [Compartment.EMPTY]: '--bg-base'
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
    F_CORPSE: 4  // on D
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
export const Topology = Object.freeze({
    PLANE:    0,
    CYLINDER: 1,
    TORUS:    2,
    MOBIUS:   3,
    KLEIN:    4,
    RP2:      5
});

// ─── ViewMode enum ───
export const ViewMode = Object.freeze({
    COMPARTMENT:    'compartment',
    STRAIN:         'strain',
    AGE:            'age',
    HEALTH:         'health',
    STATUS:         'status',
    SUSCEPTIBILITY: 'susceptibility'
});

// Map data-topology string → Topology enum value.
export function topoFromString(s) {
    switch (s) {
        case 'plane':    return Topology.PLANE;
        case 'cylinder': return Topology.CYLINDER;
        case 'torus':    return Topology.TORUS;
        case 'mobius':   return Topology.MOBIUS;
        case 'klein':    return Topology.KLEIN;
        case 'rp2':      return Topology.RP2;
        default:         return Topology.TORUS;
    }
}

// ─── Default sim parameters ───
export const DEFAULTS = Object.freeze({
    W: 120,
    H: 120,
    hexSize: 6,
    tickRate: 30,         // ticks per second target (Phase 2+)
    topology: Topology.TORUS,
    viewMode: ViewMode.COMPARTMENT,
    maxActiveStrains: 4,  // per cell coinfection cap (Phase 7+)
    maxVax: 4             // per cell vax slots (Phase 3+)
});

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
