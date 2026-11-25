# Speedster Round 1 — Verification & Measurement Report

Generated automatically by `tests/generate-report.js` on 2026-11-25T09:28:02.353Z.

> Note on judged FEEL: `FEEL-NOTES.md` is intentionally shipped empty for Kham's acceptance pass on his own machine (mouse, trackpad, and phone). No judged FEEL results are claimed here.

## 1. Machine & Renderer Environment

- **OS / Arch:** Linux-6.12.105+-x86_64-with-glibc2.36 (x86_64), 2 CPU cores
- **Browser:** Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/156.0.0.0 Safari/537.36
- **Renderer:** ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver) — **Software-rendered (headless Chromium Canvas2D / SwiftShader)**
- **Shipped file:** `speedster.html` (232,680 bytes, single self-contained file, zero network requests)

## 2. Document Model & Cubic-to-Quadratic Policy (§2)

- **Units:** Integer twips (1/20 px), 16.16 fixed-point affine matrices with integer twip translation, RGBA8 colours, 8.8 multiply + integer add colour transforms.
- **Curve storage:** Lines and quadratic Béziers only; cubics are never stored and are rejected by `validateDocument` / `serializeDocument`.
- **Cubic-to-quadratic tolerance:** `2` twips (0.10 px).
- **Max measured error across 60 seeded cubic curves:** `1.2819` twips (744 quadratic segments emitted).
- **Save → Load → Save round trip:** Byte-identical (3698 bytes), load → render golden SHA-256 = `052faed957d6b6c4448ea12eb2f12854a180a7d2842243e3193289f6c0474f40`.

## 3. Planar Drawing Map: Snap-Rounding Policy & Honest Fallback Boundaries (§3)

### Snap-Rounding Policy
- All segment-segment intersections are computed in exact `BigInt` rational arithmetic (`orientBig` + exact rational numerator/denominator).
- Every new intersection vertex is snap-rounded to the integer twip grid using deterministic **BigInt round-to-nearest-even** (`roundRationalBigInt`), eliminating all floating-point nondeterminism.
- After splitting all intersecting segments and snapping vertices, the arrangement re-checks all segment pairs for new crossings or collinear T-junctions introduced by snapping, repeating until zero improper crossings remain (capped at `MAX_SNAP_ITER = 32`).
- Outgoing half-edges around each vertex are sorted using exact integer quadrant + `BigInt` cross product (zero `Math.atan2`), and face areas are computed via exact `BigInt` shoelace arithmetic.

### Cases Where the Planar Map Says "I Can't" (Explicit Fallback to Object Drawing)
When any of the following cases occur, `addFill` / `addStroke` explicitly returns `{ ok: false, fallback: true, reason }`, displays a warning in the status bar, and stores the shape as an **Object Drawing** shape rather than silently corrupting the planar graph:

1. **`curved-near-tangent-grazing`**: Two quadratic Bézier edges pass within `< 4` twips of each other at non-endpoint samples with nearly parallel tangents (`|sin(angle)| < 0.08`). Integer-twip snap-rounding of grazing curves can flip crossing parity or create spurious micro-loops. Tested by fixture `curved-near-tangent-grazing` in `tests/03-planar-map-invariants.js`.
2. **`micro-curve-cusp`**: A quadratic Bézier segment whose chord length is `< 4` twips while its control point bulges `> 2` twips off-chord. Tested by fixture `micro-curve-cusp` in `tests/03-planar-map-invariants.js`.
3. **`snap-round-non-convergence`**: Pathological cascading snap-round splits that do not reach a zero-crossing fixed point within `MAX_SNAP_ITER = 32` passes.

*Note:* Curved fills/strokes that do not trigger the above conditions are flattened deterministically to integer-twip chords (`<= 2` twips max deviation) during planar boolean splits, while direct-shaped bent edges store native quadratic control points `(cx, cy)`.

### Planar Map Fuzz Invariants
- **Seed:** `987654321` (base rect + 18 crossing strokes + erase-then-undo)
- **Graph size:** 78 vertices, 98 edges, 22 faces
- **Twice-run determinism hash:** Run 1 = `8a4aca319023626e`, Run 2 = `8a4aca319023626e` (**IDENTICAL**)
- **Invariants verified:** Every region closed, zero improper crossings, fill areas sum to exact covered area, erase-then-undo restores identical graph hash.

## 4. Measured FEEL Benchmarks on 500-Shape Document (§6)

| Metric | Measured Value |
| --- | --- |
| Input-to-pixels latency (median / p95) | 16.5 ms / 16.8 ms |
| Live scrubbing frame time (median / p95) | 2.2 ms / 3.1 ms |
| Zoom & pan frame time (median / p95) | 1.9 ms / 2.3 ms |
| Playback achieved FPS (target 12 fps) | 11.66 fps (7 frames in 0.6s) |
| Playback achieved FPS (target 24 fps) | 23.13 fps (14 frames in 0.605s) |
| Playback achieved FPS (target 30 fps) | 28.33 fps (17 frames in 0.6s) |
| 5 MB WAV IndexedDB kill-and-reopen | **PASSED** (hash `1150f1aa7a497bff`) |

## 5. Instruments & Verification Suites (§7)

| Suite | Status | Key Result |
| --- | --- | --- |
| 01 Security & Determinism | PASS | 21 static greps passed (no eval, innerHTML, network, vendor names, transcendentals, Math.random) |
| 02 Document & Cubic Conversion | PASS | Max cubic→quad err 1.2819 twips; byte-identical save/load; nested library usage verified |
| 03 Planar Map Invariants | PASS | Twice-run hash `8a4aca319023626e`; 2 honest fallback fixtures verified |
| 04 Independent Tween Oracle | PASS | 260 frames verified (max fixed16 diff=0); Jaccard=0.0375 (<0.25); accumulator=24f/1s |
| 05 Audio Offline & Sync | PASS | Sample-accurate onset verified; golden WAV SHA-256=`aed5ca342f7be8b3...` |
| 06 Undo/Redo Fuzz | PASS | 36 gestures: undo-all=`8c4f77e16e41b7e5`, redo-all=`e8f6708d0df08694` |
| 07 Reference Rasteriser Goldens | PASS | Scene 1=`fc2f9979f9d3bf61...`, Coverage Mask=`d39b1264e4424e97...` |
| 08 Mutant Suite | PASS | **17/17** mutants caught |
| 09 Browser Integration & FEEL | PASS | XSS blocked; Canvas2D vs ref rasteriser match=99.306% (tol ≤24 ch diff); OfflineAudioContext onset verified |

## 6. Mutant Kill Table (§8)

| # | Mutant | Status |
| --- | --- | --- |
| 1 | Tween rotates long way round | CAUGHT |
| 2 | Easing sign flipped | CAUGHT |
| 3 | Shape hint pairing swapped | CAUGHT |
| 4 | Paint bucket gap tolerance ignored | CAUGHT |
| 5 | Stroke fails to split fill beneath | CAUGHT |
| 6 | Undo splits one stroke into many | CAUGHT |
| 7 | Frame-based playback clock loses time on drops | CAUGHT |
| 8 | Stream audio drifting 1 frame/sec | CAUGHT |
| 9 | Save/load loses colour-transform add term | CAUGHT |
| 10 | Math.sin inside reference rasteriser | CAUGHT |
| 11 | UI string contains vendor name | CAUGHT |
| 12 | innerHTML sink fed by layer name | CAUGHT |
| 13 | Stored cubic in document | CAUGHT |
| 14 | No snap-rounding (float vertices) | CAUGHT |
| 15 | Autosave to localStorage overflows on 5MB sound | CAUGHT |
| 16 | Mask applied as bounding rectangle | CAUGHT |
| 17 | Select unused deletes nested symbol | CAUGHT |
