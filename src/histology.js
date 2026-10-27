// histology.js — the oncoviral preset as an H&E-stained section: what its
// marks read, and their rows in the Reference cartouche. The shader in
// gpu-plate.js draws the section.
//
// The same lattice and the same Z state machine, read at the scale of cells:
// each hex is a cell, eosin (madder) stains its cytoplasm and haematoxylin
// (violet) its nucleus. What each mark reads:
//   normal nucleus, small and round     S, R, M and V cells
//   latent integration                  an E cell carrying the provirus: a dot
//                                       of red in the nucleus
//   viral inclusion                     I: the nucleus holds a red inclusion body
//   enlarged, dark, irregular nucleus   Z, the transformed clone (nuclear atypia)
//   pink, anucleate                     D, necrosis (crowding exhaustion at the
//                                       tumor core): eosin deepens, the nucleus
//                                       breaks into dust
//   bare glass                          EMPTY
// Nuclear size and density carry the state, so the slide reads in grayscale.

function hexAt(c, x, y, rr) {
    const h = rr * 0.8660254;
    c.moveTo(x, y - rr); c.lineTo(x + h, y - rr / 2); c.lineTo(x + h, y + rr / 2);
    c.lineTo(x, y + rr); c.lineTo(x - h, y + rr / 2); c.lineTo(x - h, y - rr / 2); c.closePath();
}

// Reference rows for the slide, drawn with the same marks.
const nucleus = (size, ink, alpha, inclusion) => (c, x, y, t) => {
    c.beginPath(); hexAt(c, x, y, 7); c.fillStyle = t.rgba(t.inks.madder, t.dark ? 0.44 : 0.36); c.fill();
    c.beginPath(); c.arc(x, y, size, 0, Math.PI * 2); c.fillStyle = t.rgba(t.inks[ink], alpha); c.fill();
    if (inclusion) { c.beginPath(); c.arc(x, y, inclusion, 0, Math.PI * 2); c.fillStyle = t.accent; c.fill(); }
};
export const HISTOLOGY_ROWS = [
    { label: 'Cell, normal nucleus', kind: 'draw', draw: nucleus(2.2, 'violet', 0.75) },
    { label: 'Latent provirus', kind: 'draw', draw: nucleus(2.5, 'violet', 0.8, 0.9) },
    { label: 'Viral inclusion', kind: 'draw', draw: nucleus(2.8, 'violet', 0.5, 1.5) },
    { label: 'Transformed, atypical', kind: 'draw', draw: nucleus(3.8, 'indigo', 0.92) },
    { label: 'Necrosis', kind: 'draw', draw: (c, x, y, t) => {
        c.beginPath(); hexAt(c, x, y, 7); c.fillStyle = t.rgba(t.inks.madder, t.dark ? 0.66 : 0.56); c.fill();
        c.fillStyle = t.rgba(t.inks.violet, 0.6);
        for (const [a, b] of [[-2, -1], [2, -2], [0, 2.5]]) c.fillRect(x + a - 0.6, y + b - 0.6, 1.2, 1.2);
    } },
    { label: 'Glass', kind: 'draw', draw: (c, x, y, t) => { c.beginPath(); hexAt(c, x, y, 7); c.strokeStyle = t.rgba(t.text, 0.25); c.lineWidth = 1; c.stroke(); } }
];
