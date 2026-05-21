// default-toggles.js — shared simulation toggle baseline.
//
// Dynamics imports this for omitted-toggle fallbacks; the Settings UI imports
// and re-exports it so reset/preset code uses the same object.

export const DEFAULT_TOGGLES = Object.freeze({
    V: true,
    M: true,
    // Z is an opt-in interpretive layer. Zombie/oncoviral presets enable it.
    Z: false,
    L: true,
    C: true,
    F: true,
    vax_rollout: true,
    auto_hospital: true,
    auto_quarantine: true,
    animalDisplay: 'dots'
});
