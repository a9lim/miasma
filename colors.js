/* ═══════════════════════════════════════════════════════════════
   colors.js — Miasma's compartment colors over the shared palette.
   The plate is an atlas: the disease is the one red (the theme
   accent), and every other state is a pattern in graphite or an ink,
   so the map reads in grayscale too (render.js draws the patterns;
   the --epi-* vars below color the swatches and labels in the UI).

     S = graphite dot       (susceptible; textMuted)
     E = pale red           (exposed; the accent, washed)
     I = solid red          (infectious; the accent)
     R = stipple            (recovered; text)
     D = small cross        (deceased; text)
     V = hatching, prussian (vaccinated)
     M = ring, mulberry     (maternal-immunity newborns)
     Z = cross-hatch, sap   (zombie, or the transformed clone)

   Inks differ per theme, so canvas code reads them from
   _themePalette() on every theme change.
   ═══════════════════════════════════════════════════════════════ */

for (const T of [_PALETTE.light, _PALETTE.dark]) {
  T.susceptible = T.textMuted;
  T.exposed     = T.accent;
  T.infected    = T.accent;
  T.recovered   = T.text;
  T.deceased    = T.text;
  T.vaccinated  = T.inks.prussian;
  T.maternal    = T.inks.mulberry;
  T.zombie      = T.inks.sap;
}

_freezeTokens();


// ─── CSS Custom Property Injection ───
(function injectProjectVars() {
  const P = _PALETTE, L = P.light, D = P.dark;
  const compartments = [
    ['epi-s', 'susceptible'],
    ['epi-e', 'exposed'],
    ['epi-i', 'infected'],
    ['epi-r', 'recovered'],
    ['epi-d', 'deceased'],
    ['epi-v', 'vaccinated'],
    ['epi-m', 'maternal'],
    ['epi-z', 'zombie'],
  ];
  // E is the accent at the plate's exposed wash, so its swatch matches the map.
  const gen = (T, eAlpha) => compartments.map(([name, key]) =>
    `  --${name}: ${key === 'exposed' ? _r(T[key], eAlpha) : T[key]};`).join('\n') + `
  --epi-e-solid: ${T.accent};
  --rule: ${_r(T.text, 0.55)};
  --rule-soft: ${_r(T.text, 0.22)};`;
  _injectProjectVars(gen(L, 0.3), gen(D, 0.36));
})();
