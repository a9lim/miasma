# Miasma — handoff after phase 10 (for phases 11-14)

Phase 10 shipped on 2026-05-13. Read **`HANDOFF-phase10.md` first** — that doc covers architecture, dispatcher pattern, validation rhythm, a9's working style, and is still the canonical briefing for phases 11-14. This file is a thin addendum noting what changed in phase 10 and what got deferred.

## What phase 10 shipped

- `src/topology.js` rewritten as **hex-quotient** (not rhombus-quotient). Identifications happen at the 6 hex edges of the inscribed hexagon, not the 4 rhombus edges, because that's where the simulated world's boundary actually is. Per a9's call (option b from the phase-10 handoff).
- Two topologies are real:
  - **PLANE**: cells outside the inscribed hex return null. Wave terminates at the hex edge.
  - **TORUS**: cells outside the hex translate back inside via the hex-tessellation lattice (`T1 = (2R+1, -R)`, `T2 = (R, R+1)`). Tested to land inside the hex for every neighbor offset of every interior cell.
- New exports: `hexBounds(W, H)` → `{ cq, cr, R }`, and `inHex(q, r, W, H)` → bool. Both mirror `applyHexMask`'s geometry. Downstream code (phase 11 paint, phase 13 viewmodes) will want these.
- `src/topology.test.mjs` — 2294 checks, all green. Run with `node src/topology.test.mjs` from miasma/. Covers hexBounds on 120×120 and 12×12, PLANE null behavior, TORUS adjacency symmetry, exact 6-neighbor count for every interior cell, and the round-trip identity `wrap(neighbor(c, d), inverse(d)) === c` for every (cell, direction) pair on a 12×12 grid (91 cells × 6 dirs).

## What got deferred to phase 14

- **CYLINDER, MÖBIUS, KLEIN, RP² hex-quotients.** Currently all four fall back to TORUS with `TODO Phase 14` comments. Each needs a hex-edge twist-design decision:
  - **CYLINDER**: identify one pair of opposite hex edges via parallel translation; the other two pairs stay PLANE.
  - **MÖBIUS**: same pair with a reflection (and choose *which* reflection — the hex-symmetric vertical flip in axial is `(q, r) → (q + r - cr, 2*cr - r)`, which is involutive).
  - **KLEIN**: one translation pair + one reflection pair; the third pair stays PLANE (or is a derived consequence — hex fund domains have more freedom than rectangles here).
  - **RP²**: antipodal identification on the hex boundary. Topologically this *is* the real projective plane (disk with antipodal boundary identified). For each boundary cell, identify with the cell diametrically opposite through the hex center.
- Hex-corner consistency is the fiddly part: at the 6 vertices of the inscribed hex, multiple edge identifications meet, and the chosen transformations must agree at the corner cells. Worth working out on paper before coding.

## Things the next instance should know

- The hex-quotient call was made deliberately with a9 over a scoping question. The original handoff suggested PLANE / TORUS / etc. could just be rhombus-quotients (with mask=0 wrap targets), which would have made the topology toggle mostly cosmetic. The chosen path makes the toggle visually meaningful: a wave seeded near the inscribed-hex E edge actually wraps to the SW edge under TORUS, as confirmed by direct compartment-count comparison vs PLANE (~10 extra SW-side affected cells from the wrapped wave).
- `applyHexMask` in `dynamics.js` defines the inscribed hex (center, R). If you ever change its geometry (different center, non-default rhombus), `hexBounds` in `topology.js` must stay in sync — they share the same formula.
- `translateToHex` tries 9 lattice candidates (a, b ∈ {-1, 0, 1}). That's sufficient for neighbor offsets (which are always ±1 from in-hex cells), but if any future code calls `wrap` with cells more than 1 step outside the hex, the candidate set will need to widen.

## Phase 14 sketch: möbius on a hex (worked partway, for whoever picks it up)

Park here for the future-me / future-instance who tackles the non-orientable hex-quotients. Worked through this during leisure; not enough to ship, enough to save 30 minutes of re-derivation.

The inscribed hex has 6 edges, naturally indexed by which cube coord saturates at the boundary:
- `dq = +R` (E-NE edge)  ↔ `dq = -R` (W-SW edge)
- `dr = -R` (NE-NW edge) ↔ `dr = +R` (SW-SE edge)
- `ds = +R` (NW-W edge)  ↔ `ds = -R` (SE-E edge)

where `ds = -dq - dr`. Each pair is opposite under the central inversion.

**Lattice translation between paired faces** (the TORUS identification):
- Pair 1 (`dq`):  ±T1 = ±(2R+1, -R)
- Pair 2 (`dr`):  ±T2 = ±(R,    R+1)
- Pair 3 (`ds`):  ±T3 = ±(-(R+1), 2R+1)   [= ∓R60(T2)]

These are the three 60°-rotated generators of the hex sublattice. Subtracting the right one maps a "just outside" cell on one face to the corresponding edge cell inside the hex.

**Reflective identification for MÖBIUS** (pick Pair 1, leave others PLANE):
- Face `+dq` has cells `(cq + R + 1, cr + dr_out)` for `dr_out ∈ [-(R+1), 0]`.
- Parallel translation: `(cq - R, cr + dr_out + R)`, parameter `dr_in = dr_out + R ∈ [-1, R]`.
- Reflective (möbius) twist: reverse the parameter along the face — `dr_in_twisted = -1 - dr_out`. Concretely: `(cq + R + 1, cr + dr_out) → (cq - R, cr - 1 - dr_out)`.
- This is involutive (applying twice returns the original cube position) and maps face A bijectively to face A' with order reversed.

**The hex-corner snag**:
- At `dr_out = 0` (one corner of face A, where face A meets face C): the reflected target lands at cube `(-R, -1, R+1)` — distance R+1, still outside.
- At `dr_out = -(R+1)` (other corner, where face A meets face B): symmetric problem.
- For MÖBIUS the other faces are PLANE-null, so the corner could either (a) return null conservatively, or (b) chain into a second lattice op.
- For TORUS all three pairs translate, so the corner just routes through `a*T1 + b*T2` with `(a, b) ∈ {-1, 0, 1}²` — that's exactly why `translateToHex` tries 9 candidates. For the reflective version the chain isn't as clean because successive reflections don't commute with translation.

**Practical advice**: think of each face independently as a "twist or translate" choice. At corners, the only honest answer is to enumerate which of the two adjacent face rules lands inside the hex and pick that one (with a fallback to null if neither does). This is finicky but the search space is small (≤ 6 candidates per corner).

**RP²** is structurally cleanest of the four — antipodal identification on the boundary is a single rule: for any outside cell, map to its central antipode and then lattice-translate as needed. The corners trivially compose since antipode is involutive.

## Phase 11 starts here

Phase 11 (paint) is the next bite. The previous handoff (`HANDOFF-phase10.md` section "Phases remaining") describes it well — gerry-style brush, modes (seed / vaccinate / quarantine / sanitize / cull), brush size, undo, touch. Medium-size phase; the handoff suggests 2-3 dispatched agents. The hex coord math is already shared from gerry (`gerry/src/hex-math.js`, `gerry/src/input.js` lines 43-70). With phase 10's `inHex` available, paint can cleanly skip mask=0 cells.

— previous instance, 2026-05-13
