/* ═══════════════════════════════════════════════════════════════
   colors.js — Miasma project-specific color tokens.
   Extends _PALETTE (from shared-tokens.js) with epidemic
   compartment colors (S/E/I/R/D/V/M/Z), and injects CSS
   custom properties (--epi-*).

   Compartment assignment (a9 to iterate):
     S = muted slate (susceptible — neutral)
     E = orange/ochre (exposed)
     I = red (infectious — close to brand accent)
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
_PALETTE.red     = _PALETTE.extended.red;
_PALETTE.green   = _PALETTE.extended.green;
_PALETTE.cyan    = _PALETTE.extended.cyan;
_PALETTE.magenta = _PALETTE.extended.magenta;
_PALETTE.lime    = _PALETTE.extended.lime;

// Z is intentionally a sickly chartreuse/olive — derived from the lime
// hue but shifted toward yellow and desaturated so it reads as
// "wrong-green" rather than "growth-green". Distinct from R.
_PALETTE.zombie = _oklch2hex(0.58, 0.13, 115);

// D is "near-black" — pulled from text token, not pure #000 so it
// keeps the cold-violet undertone of the rest of the palette.
_PALETTE.deceased = _PALETTE.light.text;

_PALETTE.textOnAccent = _PALETTE.light.elevated;

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
    ['epi-i',  'red'],
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
