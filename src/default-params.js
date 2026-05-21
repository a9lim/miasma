// default-params.js — live simulation parameter defaults.
//
// Kept separate from dynamics.js so UI, presets, and the tick engine can
// share the same baseline without importing the whole state-transition file.

export const DEFAULT_PARAMS = Object.freeze({
    // Core SEIR(D)
    beta:  0.32,   // transmission probability per S-I contact per tick
    sigma: 0.22,   // E -> I rate per tick (1/sigma ~= incubation period)
    gamma: 0.11,   // I -> R rate per tick (1/gamma ~= infectious period)
    mu:    0.012,  // I -> D rate per tick

    // Maternal immunity decay + flag dynamics
    m_decay:         0.025,
    l_seed:          0.15,
    l_reactivate:    0.0025,
    c_seed:          0.18,
    c_transmit_mult: 0.35,
    f_decay:         0.06,
    f_transmit_mult: 0.55,

    // Zombie dynamics. The rates are live, but the mechanic is gated by t.Z.
    dz_dead:             0.04,
    dz_alive:            0.003,
    z_convert_unopposed: 0.35,
    z_fight_kill:        0.15,
    z_fight_infect:      0.20,
    z_fight_expose:      0.05,
    z_die_fighting:      0.04,
    z_die_natural:       0.005,
    z_exhaust_threshold: 4,
    z_exhaust:           0.08,
    l_transform:         0.0005,

    // Status (H / Q)
    h_capacity_frac:           0.025,
    h_recover_mult:            1.6,
    h_mortality_mult:          0.45,
    h_overflow_mortality_mult: 1.4,
    q_transmit_mult:           0.15,
    q_susceptibility_mult:     0.35,
    quarantine_trace_rate:     0.5,

    // Aging / births / health
    d_disposal:              0.025,
    birth_rate:              0.045,
    birth_threshold:         3,
    health_degrade_per_tick: 0.025,
    mortality_baseline:      0.0003,
    mortality_age_max:       0.0045,
    mortality_max_age:       4500,
    age_susceptibility_mult: 1.6,
    age_severity_mult:       2.2,
    health_mortality_mult:   2.8,

    // Multi-strain
    mutation_rate:       0.008,
    mutation_strength:   0.07,
    cross_immunity_mult: 0.65,

    // Coinfection / recombination
    coinfection_load_delta: 0.35,
    competition_strength:   0.06,
    recombination_rate:     0.015,
    min_strain_load:        0.025,

    // Vector / reservoir
    animal_density:            0.12,
    animal_birth_rate:         0.05,
    animal_birth_threshold:    3,
    animal_mortality_baseline: 0.0005,
    animal_mortality_age_max:  0.006,
    animal_max_age:            2500,
    animal_d_disposal:         0.12,
    spillover_rate:            0.018,
    reverse_spillover_rate:    0.006,
    animal_beta:               0.18,
    animal_gamma:              0.06,
    animal_mu:                 0.006,

    // Vaccination rollout
    vax_rollout_rate:        0.0015,

    // Reinfection / vaccine breakthrough
    r_susceptibility_mult:   0.15,
    vax_efficacy:            0.85
});
