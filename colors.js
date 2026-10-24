/* ═══════════════════════════════════════════════════════════════
   colors.js — Miasma project-specific color tokens.
   Extends _PALETTE (from shared-tokens.js) with epidemic
   compartment colors (S/E/I/R/D/V/M/Z), and injects CSS
   custom properties (--epi-*).

   Compartment assignment (inks are theme-paired):
     S = graphite (susceptible — neutral; the theme's textMuted)
     E = sienna (exposed)
     I = scarlet (infectious — data red, deliberately more vivid and more
         orange than the UI accent so the two never read as one color)
     R = viridian (recovered)
     D = near-black (deceased)
     V = verdigris (vaccinated)
     M = mulberry (maternal-immunity newborns)
     Z = sap (zombie — a yellow-green distinct from R's viridian)
   ═══════════════════════════════════════════════════════════════ */

// ─── Compartment Colors ───
// Pinned per theme to compartment names, so canvas code can read
// them from _themePalette() by compartment name.
for (const T of [_PALETTE.light, _PALETTE.dark]) {
  T.susceptible = T.textMuted;
  T.exposed     = T.inks.sienna;
  T.recovered   = T.inks.viridian;
  T.vaccinated  = T.inks.verdigris;
  T.maternal    = T.inks.mulberry;
  T.zombie      = T.inks.sap;
}

// I is the data red. The theme accent (oxblood on light, #DC5960 on dark) is
// UI: active tabs, links, focus. This scarlet (oklch 0.60 0.22 30) is ΔE > 7
// from both accents and ΔE ~10 from E's sienna, and is the same on both grounds.
_PALETTE.infected = _oklch2hex(0.60, 0.22, 30);

// D is "near-black" — pulled from the text token, not pure #000, so it
// shares the neutral ground's warm undertone.
_PALETTE.deceased = _PALETTE.light.text;

_freezeTokens();


// ─── CSS Custom Property Injection ───
(function injectProjectVars() {
  const P = _PALETTE, L = P.light, D = P.dark;

  // Compartment color mapping. Each theme block carries its own values,
  // since the inks (and D, which flips with the text token) differ per theme.
  // [css-var, palette-key]
  const compartments = [
    ['epi-s',  'susceptible'],
    ['epi-e',  'exposed'],
    ['epi-i',  'infected'],
    ['epi-r',  'recovered'],
    ['epi-v',  'vaccinated'],
    ['epi-m',  'maternal'],
    ['epi-z',  'zombie'],
  ];

  // Tinted-fill variants for the rendering canvas + UI swatches.
  // 0.10 wash for hex-cell fills; 0.22 stronger swatch for legend.
  const genCompartments = (T) => compartments.map(([name, key]) => {
    const c = T[key] || P[key];
    return `  --${name}: ${c};
  --${name}-wash: ${_r(c, 0.18)};
  --${name}-tint: ${_r(c, 0.10)};`;
  }).join('\n');

  // Light-mode --epi-d uses light.text; dark-mode flips to dark.text.
  _injectProjectVars(
    genCompartments(L) + `
  --epi-d:      ${L.text};
  --epi-d-wash: ${_r(L.text, 0.78)};
  --epi-d-tint: ${_r(L.text, 0.45)};
  --hex-stroke:        ${_r(L.text, 0.06)};
  --hex-hover-stroke:  ${_r(L.text, 0.28)};
  --hex-min-opacity:   0.22;
  --bg-grid:           ${_r(L.text, 0.04)};
  --ts-track:          ${_r(L.text, 0.07)};
  --strain-bar-bg:     ${_r(L.text, 0.05)};`,
    genCompartments(D) + `
  --epi-d:      ${D.canvas};
  --epi-d-wash: ${_r(D.canvas, 0.78)};
  --epi-d-tint: ${_r(D.canvas, 0.45)};
  --hex-stroke:        ${_r(D.text, 0.04)};
  --hex-hover-stroke:  ${_r(D.text, 0.22)};
  --hex-min-opacity:   0.30;
  --bg-grid:           ${_r(D.text, 0.03)};
  --ts-track:          ${_r(D.text, 0.06)};
  --strain-bar-bg:     ${_r(D.text, 0.04)};`
  );
})();
