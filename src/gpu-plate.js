// gpu-plate.js — the lattice drawn from a state texture in WebGPU.
//
// One full-screen fragment pass draws the world and its faded copies: each
// pixel finds its cell (through the inverse of a glued edge's isometry when it
// lies on a copy), reads the cell's state from an rgba8uint texture, and draws
// the atlas marks procedurally in the world's own frame, so hatching runs on
// unbroken across cells and is mirrored on a mirrored copy. Isochrones come
// from the smoothed arrival field (isochrones.js), padded one cell past the
// edges through the gluing, interpolated linearly on the triangles of cell
// centers; their width uses the field's analytic gradient, so lines stay one
// pixel-true width at any zoom. A triangle whose corners span more than
// CLIFF_SPAN days (a new wave against an old one) draws no line, and each
// line is faded by how far its level lies behind the newest stamp, as
// isochrones.js fades the labels. The 2D canvas on top (plate.js) carries
// edges, labels and the plate furniture, and its Reference swatches draw
// these marks.
//
// Encodings, compartment view (every state is a pattern first, a color
// second, so the plate survives grayscale):
//   S  graphite dot         E  pale red          I  solid red (the disease)
//   R  stipple              D  small cross       V  hatching (prussian)
//   M  small ring           Z  cross-hatch (sap) EMPTY  the paper
//   latent E: a dot in the red; carrier R: a red dot in the stipple;
//   F-corpse: a red cross; H: a plus; Q: a cordon (hex outline).
// The strain view hatches each carrier at the angle and ink of every strain
// it holds (strain-style.js), each strain's lines as heavy as its load. Age,
// health and immunity are single-ink ramps in eight steps. The Immunoediting
// preset's State view is an H&E-stained section (histology.js).
//
// State texel: x compartment · y flags | status<<4 · z animal | (hatch angle code+1)<<3
// · w ramp value (age, health or immunity, 0–255), or the strain view's hue byte;
// in the strain view the angle and hue are the heaviest strain's. Strain texel
// (rgba16uint, written only in the strain view): one channel per strain the cell
// holds, heaviest first (strain-style.js strainMarks), each (angle code+1) | hue byte>>1
// << 5 | load level (1–15) << 12, 0 for none.
//
// The Descent view draws who infected whom (descent.js) over the State view's
// marks, muted: each infection a stroke from its source's centre to its own,
// as heavy as the infections that descend through it, faded by age on the
// isochrones' clock; graphite once the case has closed, red while it is
// exposed or infectious. A stroke is drawn in two halves, each from a cell's
// centre to the edge the two cells share, in that cell's own frame, so one
// that crosses a glued edge meets itself there and its copies come free. A
// case placed by hand is ringed; spillover is a stroke from the animal's
// mark. Descent texel (rgba32uint, written only in this view): descent.js
// packDescent.

import { memoryOf, susceptibility } from './immunity.js';
import { FADE_DAYS, FADE_FLOOR, CLIFF_SPAN } from './isochrones.js';
import { strainMarks, loadLevel } from './strain-style.js';
import { packDescent } from './descent.js';
import { getNeighborTable } from './topology.js';

const SHADER = /* wgsl */`
@group(0) @binding(0) var<uniform> u: array<vec4f, 48>;
@group(0) @binding(1) var stateTex: texture_2d<u32>;
@group(0) @binding(2) var fieldTex: texture_2d<f32>;
@group(0) @binding(3) var strainTex: texture_2d<u32>;
@group(0) @binding(4) var descTex: texture_2d<u32>;

const SQ3: f32 = 1.7320508;

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(3.0, 1.0), vec2f(-1.0, 1.0));
  return vec4f(p[i], 0.0, 1.0);
}

fn cube(c: vec2f) -> f32 { return max(max(abs(c.x), abs(c.y)), abs(c.x + c.y)); }
fn roundAx(a: vec2f) -> vec2f {
  let x = a.x; let z = a.y; let y = -x - z;
  var rx = round(x); var ry = round(y); var rz = round(z);
  let dx = abs(rx - x); let dy = abs(ry - y); let dz = abs(rz - z);
  if (dx > dy && dx > dz) { rx = -ry - rz; } else if (dy > dz) { ry = -rx - rz; } else { rz = -rx - ry; }
  return vec2f(rx, rz);
}
fn toPx(a: vec2f) -> vec2f { return vec2f(SQ3 * (a.x + a.y * 0.5), 1.5 * a.y); }
fn toAx(p: vec2f) -> vec2f { let r = p.y / 1.5; return vec2f(p.x / SQ3 - r * 0.5, r); }
fn hash(n: u32) -> f32 {
  var x = n * 747796405u + 2891336453u;
  x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
  x = (x >> 22u) ^ x;
  return f32(x) / 4294967295.0;
}
// coverage of a band of half-width hw (css px) at distance d (css px)
fn cover(d: f32, hw: f32, dpr: f32) -> f32 { return clamp((hw - d) * dpr + 0.5, 0.0, 1.0); }
fn over(c: vec3f, ink: vec3f, a: f32) -> vec3f { return mix(c, ink, clamp(a, 0.0, 1.0)); }
fn hatchD(wp: vec2f, ang: f32, gap: f32) -> f32 { return hatchP(wp, ang, gap, 0.0); }
// distance to hatching whose lines sit ph of the gap off the origin's
fn hatchP(wp: vec2f, ang: f32, gap: f32, ph: f32) -> f32 {
  let n = vec2f(-sin(ang), cos(ang));
  let t = dot(wp, n) / gap - ph;
  return abs(fract(t + 0.5) - 0.5) * gap;
}
fn fieldAt(o: vec2i) -> f32 { return textureLoad(fieldTex, o, 0).x; }
// distance from p to the segment from the origin to m
fn toSeg(p: vec2f, m: vec2f) -> f32 { return length(p - m * clamp(dot(p, m) / dot(m, m), 0.0, 1.0)); }
// The strain hue wheel (strain-style.js): OKLCH at u[21].xy, hurried through
// the accent's hue u[21].z by u[21].w, chroma dipping there by u[22].x over
// u[22].y radians; returns gamma-encoded sRGB.
fn wheel(hb: f32) -> vec3f {
  let w = u[21]; let w2 = u[22];
  let v = fract((hb + 0.5) / 256.0 + 0.5);
  let h = w.z + 6.2831853 * v + w.w * sin(6.2831853 * v);
  let dh = abs(atan2(sin(h - w.z), cos(h - w.z)));
  let C = w.y * (1.0 - w2.x * exp(-(dh / w2.y) * (dh / w2.y)));
  let ca = C * cos(h); let cb = C * sin(h); let L = w.x;
  let l_ = L + 0.3963377774 * ca + 0.2158037573 * cb;
  let m_ = L - 0.1055613458 * ca - 0.0638541728 * cb;
  let s_ = L - 0.0894841775 * ca - 1.2914855480 * cb;
  let l = l_ * l_ * l_; let m = m_ * m_ * m_; let s = s_ * s_ * s_;
  let lin = clamp(vec3f(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
                       -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
                       -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s), vec3f(0.0), vec3f(1.0));
  return select(1.055 * pow(lin, vec3f(1.0 / 2.4)) - 0.055, 12.92 * lin, lin <= vec3f(0.0031308));
}

@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let dpr = u[0].z; let rc = u[0].w; let R = u[1].z;
  let paper = u[7].xyz;
  let css = pos.xy / dpr;
  var a = toAx((css - u[1].xy) / rc);
  var cell = roundAx(a);
  var vis = 1.0;
  var inside = cube(cell) <= R + 0.25;
  if (!inside && u[1].w > 0.5) {
    for (var e = 0; e < 6; e++) {
      let m = u[31 + e]; let d = a - u[37 + e].xy;
      let a2 = vec2f(m.x * d.x + m.y * d.y, m.z * d.x + m.w * d.y);
      let c2 = roundAx(a2);
      if (cube(c2) <= R + 0.25) {
        a = a2; cell = c2; inside = true;
        let t = clamp((length(css - u[1].xy) - u[2].x) / (u[2].y - u[2].x), 0.0, 1.0);
        vis = u[2].z * pow(1.0 - t, 1.6);
        break;
      }
    }
  }
  if (!inside) { return vec4f(paper, 1.0); }

  let mode = i32(u[2].w + 0.5);
  let histo = u[3].x > 0.5;
  let animalMode = i32(u[3].y + 0.5);
  let lp = toPx(a - cell) * rc;               // css px within the cell, world frame
  let wp = toPx(a) * rc;                      // css px in the world frame
  let h = max(abs(lp.x), abs(lp.x) * 0.5 + abs(lp.y) * 0.8660254) / (rc * 0.8660254);
  let edgeD = (1.0 - h) * rc * 0.8660254;     // css px to the cell's edge
  let fillM = clamp((edgeD - 0.12) * dpr + 0.5, 0.0, 1.0);
  let st = u[6];
  let s = textureLoad(stateTex, vec2i(i32(st.x + cell.x), i32(st.y + cell.y)), 0);
  let comp = i32(s.x);
  let flags = s.y & 15u; let status = s.y >> 4u;
  let animal = s.z & 7u; let slot = i32(s.z >> 3u) - 1;
  let ramp = f32(s.w) / 255.0;
  let idx = u32((st.y + cell.y) * st.z + (st.x + cell.x));
  let dark = u[20].x;
  var c = paper;
  let text = u[8].xyz; let accent = u[10].xyz;
  let lw = max(0.7, rc * 0.2);

  if (histo) {
    let living = comp != 8 && comp != 4;
    if (living) { c = over(c, u[16].xyz, (0.36 + 0.08 * dark) * clamp((edgeD - rc * 0.07) * dpr + 0.5, 0.0, 1.0)); }
    if (comp == 7) { c = over(c, u[17].xyz, 0.16 + 0.06 * dark); }
    if (comp == 4) { c = over(c, u[16].xyz, (0.56 + 0.1 * dark) * fillM); }
    if (living) {
      let h1 = hash(idx); let h2 = hash(idx + 7919u);
      var size = 0.3; var ink = u[17].xyz; var al = 0.72 + 0.1 * dark; var jit = 0.25;
      if (comp == 1 && (flags & 1u) != 0u) { size = 0.34; al = 0.78 + 0.08 * dark; }
      if (comp == 2) { size = 0.38; al = 0.5 + 0.1 * dark; jit = 0.2; }
      if (comp == 7) { size = 0.52; ink = u[18].xyz; al = 0.9 + 0.05 * dark; jit = 0.32; }
      let off = vec2f(h1 - 0.5, h2 - 0.5) * jit * rc;
      let q = (lp - off) / vec2f(size * rc * (0.85 + 0.3 * h2), size * rc * (0.85 + 0.3 * h1));
      c = over(c, ink, al * clamp((1.0 - length(q)) * size * rc * dpr + 0.5, 0.0, 1.0));
      if (comp == 1 && (flags & 1u) != 0u) { c = over(c, accent, cover(length(lp), max(0.8, 0.1 * rc), dpr)); }
      if (comp == 2) { c = over(c, accent, cover(length(lp), max(0.8, 0.2 * rc), dpr)); }
    }
    if (comp == 4) {
      let h1 = hash(idx);
      for (var k = 0; k < 3; k++) {
        let an = (h1 + f32(k) / 3.0) * 6.2831853;
        let dp = lp - vec2f(cos(an), sin(an)) * rc * 0.32;
        let hw = max(0.35, rc * 0.06);
        c = over(c, u[17].xyz, 0.6 * cover(max(abs(dp.x), abs(dp.y)), hw, dpr));
      }
    }
  } else {
    let quiet = mode == 4;
    let isRamp = mode == 2 || mode == 3 || mode == 5;
    var carrierHatch = false;
    if (mode == 1 && slot >= 0 && (comp == 1 || comp == 2 || comp == 7)) { carrierHatch = true; }
    if (comp != 8) {
      if (isRamp && comp != 4) {
        let bin = floor(min(ramp, 0.999) * 8.0);
        c = over(c, u[15].xyz, (0.08 + 0.1 * bin) * fillM);
      } else if (carrierHatch) {
        // Every strain the cell holds, lightest first so the heaviest lies on
        // top where they cross. A strain's tint and line width are its load's
        // share of a whole carrier's; under a device pixel the width turns to
        // opacity. Strains that share an angle interleave.
        let sv = textureLoad(strainTex, vec2i(i32(st.x + cell.x), i32(st.y + cell.y)), 0);
        var mk = array<u32, 4>(sv.x, sv.y, sv.z, sv.w);
        let gap = max(2.4, rc * 0.78); let hw = max(0.4, rc * 0.12);
        for (var k = 3; k >= 0; k--) {
          let v = mk[k];
          if (v == 0u) { continue; }
          let code = v & 31u;
          var same = 0.0; var before = 0.0;
          for (var j = 0; j < 4; j++) {
            if (mk[j] != 0u && (mk[j] & 31u) == code) { same += 1.0; if (j < k) { before += 1.0; } }
          }
          let ld = f32(v >> 12u) / 15.0;
          let hb = select(f32(((v >> 5u) & 127u) * 2u + 1u), f32(s.w), k == 0);
          let ink = wheel(hb);
          let ang = f32(code - 1u) / 31.0 * 3.1415927;
          let d = hatchP(wp, ang, gap, before / same);
          let h2 = hw * ld;
          let wide = ld >= 1.0 || 2.0 * h2 * dpr >= 1.0;   // a whole load draws as it always has
          let cov = select(2.0 * h2 * dpr * cover(d, 0.5 / dpr, dpr), cover(d, h2, dpr), wide);
          c = over(c, ink, 0.14 * ld * fillM);
          c = over(c, ink, fillM * cov);
        }
      } else if (comp == 0) {
        let r = max(0.5, rc * 0.18);
        let al = select(u[20].z, 0.3, quiet);
        c = over(c, u[9].xyz, al * cover(max(abs(lp.x), abs(lp.y)), r, dpr));
      } else if (comp == 1) {
        c = over(c, accent, select(u[20].y, 0.12, quiet) * fillM);
        if (mode == 0 && (flags & 1u) != 0u) { c = over(c, text, cover(max(abs(lp.x), abs(lp.y)), max(0.45, rc * 0.18), dpr)); }
      } else if (comp == 2) {
        c = over(c, accent, select(0.94, 0.3, quiet) * fillM);
      } else if (comp == 3) {
        var dots = 0.0;
        for (var k = 0u; k < 3u; k++) {
          let dp = lp - (vec2f(hash(idx * 3u + k), hash(idx * 3u + k + 101u)) - 0.5) * rc * 1.15;
          dots = max(dots, cover(max(abs(dp.x), abs(dp.y)), max(0.5, 0.55 / dpr), dpr));
        }
        c = over(c, text, u[20].w * dots * fillM);
        if (mode == 0 && (flags & 2u) != 0u) { c = over(c, accent, cover(max(abs(lp.x), abs(lp.y)), max(0.45, rc * 0.18), dpr)); }
      } else if (comp == 5) {
        c = over(c, u[11].xyz, fillM * cover(hatchD(wp, -0.7853982, max(2.4, rc * 0.82)), max(0.35, rc * 0.1), dpr));
      } else if (comp == 6) {
        c = over(c, u[13].xyz, cover(abs(length(lp) - rc * 0.42), max(0.35, rc * 0.09), dpr));
      } else if (comp == 7) {
        let gap = max(2.4, rc * 0.8);
        c = over(c, u[12].xyz, 0.22 * fillM);
        let hz = min(hatchD(wp, 0.7853982, gap), hatchD(wp, -0.7853982, gap));
        c = over(c, u[12].xyz, fillM * cover(hz, max(0.35, rc * 0.09), dpr));
      }
      if (comp == 4) {
        let arm = rc * 0.4;
        let inBox = max(abs(lp.x), abs(lp.y)) <= arm + 0.5;
        let dd = min(abs(lp.x - lp.y), abs(lp.x + lp.y)) * 0.7071068;
        let corpse = (flags & 4u) != 0u;
        let ink = select(text, accent, corpse);
        let al = select(0.84 + 0.0 * dark, 1.0, corpse);
        if (inBox) { c = over(c, ink, al * cover(dd, select(lw, max(0.85, rc * 0.24), corpse) * 0.5, dpr)); }
      }
      if (mode == 0 || mode == 4) {
        if (status == 2u) {
          c = over(c, u[14].xyz, cover(abs(h - 0.78) * rc * 0.8660254, max(0.8, rc * select(0.22, 0.3, quiet)) * 0.5, dpr));
        } else if (status == 1u) {
          let arm = rc * 0.4;
          let dd = select(abs(lp.x), abs(lp.y), abs(lp.x) > abs(lp.y));
          let inArm = max(abs(lp.x), abs(lp.y)) <= arm;
          if (inArm) { c = over(c, text, 0.86 * cover(dd, max(0.8, rc * select(0.2, 0.3, quiet)) * 0.5, dpr)); }
        }
      }
    }
    if (animalMode != 2 && animal != 0u && rc >= 2.0) {
      let sz = max(1.0, rc * select(0.34, 0.5, animalMode == 1));
      let o = select(vec2f(rc * 0.42, rc * 0.36), vec2f(0.0), animalMode == 1);
      let t = lp - o;
      let inside3 = t.y <= sz * 0.8 && t.y >= -sz && abs(t.x) <= (t.y + sz) * 0.555;
      var ink = u[19].xyz; var al = 0.75;
      if (animal == 2u) { ink = accent; al = 1.0; } else if (animal == 3u) { al = 0.35; } else if (animal == 4u) { ink = text; al = 1.0; }
      if (inside3) { c = over(c, ink, al); }
    }
  }

  // isochrones (the Descent view's strokes carry time themselves)
  if (!(histo && mode == 0) && mode != 6) {
    let base = floor(a); let f = a - base;
    let o = vec2i(base) + vec2i(i32(R) + 1);
    let v10 = fieldAt(o + vec2i(1, 0)); let v01 = fieldAt(o + vec2i(0, 1));
    var v = 0.0; var gq = 0.0; var gr = 0.0; var ok = v10 >= 0.0 && v01 >= 0.0;
    var span = 0.0;
    if (f.x + f.y <= 1.0) {
      let v00 = fieldAt(o);
      ok = ok && v00 >= 0.0;
      v = v00 * (1.0 - f.x - f.y) + v10 * f.x + v01 * f.y; gq = v10 - v00; gr = v01 - v00;
      span = max(v00, max(v10, v01)) - min(v00, min(v10, v01));
    } else {
      let v11 = fieldAt(o + vec2i(1, 1));
      ok = ok && v11 >= 0.0;
      v = v11 * (f.x + f.y - 1.0) + v10 * (1.0 - f.y) + v01 * (1.0 - f.x); gq = v11 - v01; gr = v11 - v10;
      span = max(v11, max(v10, v01)) - min(v11, min(v10, v01));
    }
    let step = u[3].w; let maxL = u[3].z;
    let level = round(v / step) * step;
    // fade: u[43] = (newest stamp, days to the floor, floor, cliff span)
    let ageN = max(u[43].x - level, 0.0) / u[43].y;
    let fadeL = max(u[43].z, 1.0 - ageN * ageN);
    if (ok && span <= u[43].w && level >= step && level <= maxL + 0.5) {
      let g = length(vec2f(gq / SQ3, -gq / 3.0 + gr * 2.0 / 3.0)) / rc;
      let d = abs(v - level) / max(g, 1e-5);
      let major = abs(level / (step * 3.0) - round(level / (step * 3.0))) < 0.01;
      let hw = select(0.375, 0.575, major);
      let al = select(0.32 + 0.04 * dark, 0.6 + 0.06 * dark, major);
      c = over(c, text, al * fadeL * cover(d, hw, dpr));
    }
  }

  // Descent: the marks muted, then the strokes. A stroke's weight w (0–1,
  // log₂ of its descendants over 16) sets its width and its tone, so the
  // trunks read at any zoom and the twigs stay a light texture; a stroke into
  // a live case takes full tone, the front being twigs. Where strokes
  // meet, the most visible one at this pixel is drawn, so a junction is their
  // union rather than a darker knot.
  if (mode == 6 && !histo) {
    c = mix(paper, c, 0.42);
    let dv = textureLoad(descTex, vec2i(i32(st.x + cell.x), i32(st.y + cell.y)), 0);
    var dirs = array<vec2f, 6>(vec2f(1.0, 0.0), vec2f(0.0, 1.0), vec2f(-1.0, 1.0), vec2f(-1.0, 0.0), vec2f(0.0, -1.0), vec2f(1.0, -1.0));
    var halves = array<u32, 6>(dv.x & 0xFFFFu, dv.x >> 16u, dv.y & 0xFFFFu, dv.y >> 16u, dv.z & 0xFFFFu, dv.z >> 16u);
    var best = 0.0; var bestInk = 0u;
    for (var k = 0; k < 6; k++) {
      let v = halves[k];
      if (v == 0u) { continue; }
      let w = f32((v & 255u) - 1u) / 254.0;
      let tone = select(0.18 + 0.82 * pow(w, 0.8), 1.0, (v >> 14u) != 0u);
      let al = f32((v >> 8u) & 63u) / 63.0 * tone * cover(toSeg(lp, toPx(dirs[k]) * rc * 0.5), max(0.3, rc * (0.05 + 0.4 * w)), dpr);
      if (al > best) { best = al; bestInk = v >> 14u; }
    }
    let rv = dv.w & 0xFFFFu;
    if (rv != 0u) {
      let fa = f32((rv >> 8u) & 63u) / 63.0;
      var al = 0.0;
      if ((dv.w >> 16u) == 2u) {
        // spillover: from the animal's mark to the centre
        let w = f32((rv & 255u) - 1u) / 254.0;
        al = fa * select(0.18 + 0.82 * pow(w, 0.8), 1.0, (rv >> 14u) != 0u) * cover(toSeg(lp, vec2f(rc * 0.42, rc * 0.36)), max(0.3, rc * (0.05 + 0.4 * w)), dpr);
      } else {
        al = fa * cover(abs(length(lp) - rc * 0.52), max(0.35, rc * 0.1), dpr);
      }
      if (al > best) { best = al; bestInk = rv >> 14u; }
    }
    if (best > 0.0) {
      let ink = select(select(u[9].xyz, u[12].xyz, bestInk == 2u), accent, bestInk == 1u);
      c = over(c, ink, 0.94 * best);
    }
  }

  // brush footprint
  if (u[4].w > 0.5) {
    let dc = cell - u[4].xy;
    if (cube(dc) <= u[4].z + 0.25) {
      c = over(c, u[5].xyz, 0.24 * fillM);
      c = over(c, u[5].xyz, 0.9 * cover(edgeD, 0.6, dpr));
    }
  }
  return vec4f(mix(paper, c, vis), 1.0);
}
`;

const MODES = { compartment: 0, strain: 1, age: 2, health: 3, status: 4, immunity: 5, descent: 6 };

function rgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Try to start WebGPU on `canvas`. Resolves to a renderer or null. */
export async function createGpuPlate(canvas) {
    if (!navigator.gpu) return null;
    let device, context, format;
    try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) return null;
        device = await adapter.requestDevice();
        context = canvas.getContext('webgpu');
        if (!context) return null;
        format = navigator.gpu.getPreferredCanvasFormat();
        context.configure({ device, format, alphaMode: 'opaque' });
    } catch (e) {
        return null;
    }
    const module = device.createShaderModule({ code: SHADER });
    const pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'fs', targets: [{ format }] },
        primitive: { topology: 'triangle-list' }
    });
    const ubuf = device.createBuffer({ size: 48 * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const U = new Float32Array(48 * 4);
    let stateTex = null, fieldTex = null, strainTex = null, descTex = null, bind = null, lost = false;
    let stateData = null, fieldData = null, strainData = null, descData = null, fieldSide = 0;
    const marks = { a: new Uint8Array(4), h: new Uint8Array(4), l: new Float32Array(4) };
    device.lost.then(() => { lost = true; });

    function ensureTextures(W, H, side) {
        if (!stateTex || stateTex.width !== W || stateTex.height !== H) {
            if (stateTex) stateTex.destroy();
            stateTex = device.createTexture({ size: [W, H], format: 'rgba8uint', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
            // cells outside the world stay EMPTY; uploadState rewrites only the world's
            stateData = new Uint8Array(W * H * 4);
            for (let i = 0; i < W * H; i++) stateData[i * 4] = 8;
            if (strainTex) strainTex.destroy();
            strainTex = device.createTexture({ size: [W, H], format: 'rgba16uint', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
            strainData = new Uint16Array(W * H * 4);
            if (descTex) descTex.destroy();
            descTex = device.createTexture({ size: [W, H], format: 'rgba32uint', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
            descData = new Uint32Array(W * H * 4);
            bind = null;
        }
        if (!fieldTex || fieldSide !== side) {
            if (fieldTex) fieldTex.destroy();
            fieldSide = side;
            fieldTex = device.createTexture({ size: [side, side], format: 'r32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
            fieldData = new Float32Array(side * side).fill(-1);
            device.queue.writeTexture({ texture: fieldTex }, fieldData, { bytesPerRow: side * 4 }, [side, side]);
            bind = null;
        }
        if (!bind) {
            bind = device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: ubuf } },
                    { binding: 1, resource: stateTex.createView() },
                    { binding: 2, resource: fieldTex.createView() },
                    { binding: 3, resource: strainTex.createView() },
                    { binding: 4, resource: descTex.createView() }
                ]
            });
        }
    }

    /** Pack the grid into the state texture, and in the strain and descent views their own. */
    function uploadState(grid, mode, opts) {
        const im = opts.immunity, mem = im ? memoryOf(grid) : null;
        const { W, H } = grid;
        ensureTextures(W, H, fieldSide || 3);
        const d = stateData, sd = strainData, comp = grid.compartment, flags = grid.flags, status = grid.status, an = grid.animal;
        const act = grid.activeIndices;
        // age reads relative to the oldest living cell, so the ramp spans the population
        let ageMax = 1;
        if (mode === 'age') for (let k = 0; k < act.length; k++) { const i = act[k]; if (comp[i] !== 8 && comp[i] !== 4 && grid.age[i] > ageMax) ageMax = grid.age[i]; }
        const strain = mode === 'strain', age = mode === 'age', health = mode === 'health', immunity = mode === 'immunity' && im;
        for (let k = 0; k < act.length; k++) {
            const i = act[k], o = i * 4, c = comp[i];
            d[o] = c;
            d[o + 1] = (flags[i] & 15) | ((status[i] & 15) << 4);
            let z = an ? an[i] & 7 : 0, w = 0;
            if (strain) {
                const n = c === 1 || c === 2 || c === 7 ? strainMarks(grid, i, opts.strains, marks) : 0;
                if (n > 0) { z |= (marks.a[0] + 1) << 3; w = marks.h[0]; }
                for (let m = 0; m < 4; m++) {
                    sd[o + m] = m < n ? (marks.a[m] + 1) | ((marks.h[m] >> 1) << 5) | (loadLevel(marks.l[m]) << 12) : 0;
                }
            } else if (age) w = Math.min(255, (grid.age[i] / ageMax) * 255) | 0;
            else if (health) w = Math.max(0, Math.min(255, grid.health[i] * 255)) | 0;
            else if (immunity) w = Math.round(255 * (1 - susceptibility(mem, i, im.ax, im.ay, im.cInf, im.cVax)));
            d[o + 2] = z;
            d[o + 3] = w;
        }
        device.queue.writeTexture({ texture: stateTex }, d, { bytesPerRow: W * 4 }, [W, H]);
        if (strain) device.queue.writeTexture({ texture: strainTex }, sd, { bytesPerRow: W * 8 }, [W, H]);
        if (mode === 'descent') {
            packDescent(grid.descent, grid, getNeighborTable(W, H, opts.topology).back, descData);
            device.queue.writeTexture({ texture: descTex }, descData, { bytesPerRow: W * 16 }, [W, H]);
        }
    }

    /** Upload the padded arrival field (side = 2R+3, -1 = none). */
    function uploadField(values, side) {
        if (!stateTex) return;
        ensureTextures(stateTex.width, stateTex.height, side);
        device.queue.writeTexture({ texture: fieldTex }, values, { bytesPerRow: side * 4 }, [side, side]);
    }

    function resize(w, h) {
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    }

    /** Draw. p: { cssW, cssH, dpr, rc, cx, cy, R, closed, fade:[r0,r1,peak], mode, histology,
     *  animalDisplay, maxLevel, isoLatest, step, brush:{q,r,size,active,ink}, cq, cr, W, side, theme, wheel, ghosts } */
    function render(p) {
        if (lost || !stateTex) return false;
        const t = p.theme, set = (i, a, b = 0, c = 0, d = 0) => { U[i * 4] = a; U[i * 4 + 1] = b; U[i * 4 + 2] = c; U[i * 4 + 3] = d; };
        const col = (i, hex, a = 1) => { const [r, g, b] = rgb(hex); set(i, r, g, b, a); };
        set(0, p.cssW, p.cssH, p.dpr, p.rc);
        set(1, p.cx, p.cy, p.R, p.closed ? 1 : 0);
        set(2, p.fade[0], p.fade[1], p.fade[2], MODES[p.mode] || 0);
        set(3, p.histology ? 1 : 0, p.animalDisplay === 'only' ? 1 : p.animalDisplay === 'off' ? 2 : 0, p.maxLevel, p.step);
        set(43, p.isoLatest, FADE_DAYS, FADE_FLOOR, CLIFF_SPAN);
        set(4, p.brush.q, p.brush.r, p.brush.size, p.brush.active ? 1 : 0);
        col(5, p.brush.ink);
        set(6, p.cq, p.cr, p.W, p.side);
        col(7, t.paper); col(8, t.text); col(9, t.muted); col(10, t.accent);
        col(11, t.hatch); col(12, t.zombie); col(13, t.maternal); col(14, t.cordon);
        col(15, p.rampInk || t.inks.umber); col(16, t.inks.madder); col(17, t.inks.violet); col(18, t.inks.indigo); col(19, t.inks.umber);
        set(20, t.dark ? 1 : 0, t.dark ? 0.36 : 0.3, t.dark ? 0.62 : 0.55, t.dark ? 0.6 : 0.55);
        const w = p.wheel;
        set(21, w.L, w.C, w.accentHue * Math.PI / 180, w.hurry);
        set(22, w.dip, w.dipWidth * Math.PI / 180, 0, 0);
        for (let e = 0; e < 6; e++) {
            const g = p.ghosts ? p.ghosts[e] : null;
            if (!g) { set(31 + e, 1, 0, 0, 1); set(37 + e, 1e6, 1e6, 0, 0); continue; }
            const [a, b, c, d] = g.m, det = a * d - b * c;
            set(31 + e, d / det, -b / det, -c / det, a / det);
            set(37 + e, g.v[0], g.v[1], 1, 0);
        }
        device.queue.writeBuffer(ubuf, 0, U);
        const enc = device.createCommandEncoder();
        const pass = enc.beginRenderPass({
            colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 1, g: 1, b: 1, a: 1 } }]
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bind);
        pass.draw(3);
        pass.end();
        device.queue.submit([enc.finish()]);
        return true;
    }

    return { uploadState, uploadField, resize, render, get lost() { return lost; } };
}
