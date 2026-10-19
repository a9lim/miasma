/* ═══════════════════════════════════════════════════════════════
   colors.js — Miasma project-specific color tokens.
   Extends _PALETTE (from shared-tokens.js) with epidemic
   compartment colors (S/E/I/R/D/V/M/Z), and injects CSS
   custom properties (--epi-*).

   Compartment assignment:
     S = warm slate (susceptible — neutral)
     E = orange/ochre (exposed)
     I = scarlet (infectious — data red, deliberately more vivid and more
         orange than the UI accent so the two never read as one color)
     R = green (recovered)
     D = near-black (deceased)
     V = cyan/sky (vaccinated)
     M = magenta (maternal-immunity newborns)
     Z = lime/chartreuse (zombie — distinct from R-green)
   ═══════════════════════════════════════════════════════════════ */

// ─── Compartment Hue Aliases ───
// Pin shared extended palette entries to compartment names so canvas
// code can read _PALETTE.epi_* directly without a string lookup table.
_PALETTE.slate   = _PALETTE.extended.slate;
_PALETTE.orange  = _PALETTE.extended.orange;
_PALETTE.green   = _PALETTE.extended.green;
_PALETTE.cyan    = _PALETTE.extended.cyan;
_PALETTE.magenta = _PALETTE.extended.magenta;
_PALETTE.lime    = _PALETTE.extended.lime;

// Z is intentionally a sickly chartreuse/olive — derived from the lime
// hue but shifted toward yellow and desaturated so it reads as
// "wrong-green" rather than "growth-green". Distinct from R.
_PALETTE.zombie = _oklch2hex(0.58, 0.13, 115);

// I is the data red. The theme accent (oxblood on light, #DC5960 on dark) is
// UI: active tabs, links, focus. extended.red (oklch 0.62 0.17 25) sits within
// ΔE 2 of the dark accent, so infectious cells and the active tab would read
// as one color; this scarlet (oklch 0.60 0.22 30) is ΔE > 7 from both accents
// and ΔE ~10 from E's orange, and is the same on both grounds.
_PALETTE.infected = _oklch2hex(0.60, 0.22, 30);

// D is "near-black" — pulled from the text token, not pure #000, so it
// shares the neutral ground's warm undertone.
_PALETTE.deceased = _PALETTE.light.text;

_freezeTokens();


// ─── CSS Custom Property Injection ───
(function injectProjectVars() {
  const P = _PALETTE, L = P.light, D = P.dark;

  // Compartment color mapping. Same hue used in light + dark; the
  // dark-mode block re-injects the D (deceased) value because its
  // base hex flips with the text token.
  // [css-var, palette-key]
  const compartments = [
    ['epi-s',  'slate'],
    ['epi-e',  'orange'],
    ['epi-i',  'infected'],
    ['epi-r',  'green'],
    ['epi-v',  'cyan'],
    ['epi-m',  'magenta'],
    ['epi-z',  'zombie'],
  ];

  // Tinted-fill variants for the rendering canvas + UI swatches.
  // 0.10 wash for hex-cell fills; 0.22 stronger swatch for legend.
  const genCompartments = () => compartments.map(([name, key]) =>
    `  --${name}: ${P[key]};
  --${name}-wash: ${_r(P[key], 0.18)};
  --${name}-tint: ${_r(P[key], 0.10)};`
  ).join('\n');

  // Light-mode --epi-d uses light.text; dark-mode flips to dark.text.
  _injectProjectVars(
    genCompartments() + `
  --epi-d:      ${L.text};
  --epi-d-wash: ${_r(L.text, 0.78)};
  --epi-d-tint: ${_r(L.text, 0.45)};
  --hex-stroke:        ${_r(L.text, 0.06)};
  --hex-hover-stroke:  ${_r(L.text, 0.28)};
  --hex-min-opacity:   0.22;
  --bg-grid:           ${_r(L.text, 0.04)};
  --ts-track:          ${_r(L.text, 0.07)};
  --strain-bar-bg:     ${_r(L.text, 0.05)};`,
    genCompartments() + `
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
