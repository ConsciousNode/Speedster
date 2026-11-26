# Speedster Round 2 — Feel, Correctness & Verification Report

Generated automatically by `tests/generate-report.js` on 2026-11-25T21:32:34.719Z from `results.jsonl` (15 browser measurement records) and `tests/results/*.json`.

> Note on judged FEEL: `FEEL-NOTES-r2.md` is intentionally shipped empty for Kham's acceptance pass on his own machine (mouse, trackpad, and phone). No judged FEEL results are claimed here.

## 1. Machine & Renderer Environment

- **OS / Arch:** Linux-6.12.105+-x86_64-with-glibc2.36 (x86_64), 2 CPU cores
- **Browser:** Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/156.0.0.0 Safari/537.36
- **Renderer:** ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver) — **Software-rendered (headless Chromium Canvas2D / SwiftShader)**
- **Shipped file:** `speedster.html` (262,189 bytes, single self-contained file, zero network requests)

## 2. Spotty Fast Stroke Diagnosis, Reproduction & Fix (R2 §1)

### Reproduction on Unmodified Round 1 Build (Before Any Fix)
- Synthetic 4,000 px/s mouse drag at 60 Hz with 6 coalesced samples/frame on unmodified R1 `speedster.html`:
  - **Confirmed cause (a) — shared coalesced timestamps:** width beaded periodically once per 60 Hz frame, swinging **3.5×** between `140` twips (frame boundary blob) and `40` twips (in-batch hairline): `[140, 40, 50, 40, 50, 50, 100, 90, 40, ...]`.
  - **Confirmed cause (b) — self-intersecting rails:** a 150° sharp zig-zag at 4,000 px/s produced **0 filled faces** (entire stroke vanished due to planar parity inversion).

### Round 2 Fixes & Verified Measurements
- **Per-event coalesced timestamps:** `normalizeCoalescedTimestamps` uses each coalesced event's `timeStamp`, or evenly interpolates timestamps across the batch when a browser shares one stamp.
- **Gentle mouse default:** For `pointerType === "mouse"`, speed-width defaults to **OFF** (opt-in toggle in Brush Inspector); pen pressure and touch speed-width remain enabled.
- **Continuous width smoothing:** Exponential speed smoothing + bidirectional adjacent-sample half-width ratio clamp (`MAX_ADJ_WIDTH_RATIO = 1.12`, i.e. ≤ 12%, well inside the ≤ 15% cap) and minimum visible half-width `30` twips (full width ≥ `60` twips = 3.0 px).
- **Non-self-intersecting capsule union:** Brush strokes commit via `buildBrushCapsulePolygons` + `addFillUnion` (atomic planar union of round-capped tapered capsules), and the live preview draws the exact same capsule geometry.
- **Fresh mouse 4,000 px/s drag:** **1 connected region**, 0 holes, cross-section width `[155..160]` twips (target `160` ±10%), area error **0.033%** vs ideal capsule union.
- **Speed-width 4,000 px/s drag (touch / opt-in):** max adjacent half-width ratio **1.12** (≤ 1.15), narrowest cross-section **80** twips (≥ 60), 1 connected region.
- **150° zig-zag at 4,000 px/s:** **1 connected region**, **0 holes** (both Node and live Chromium).
- **Live preview vs committed pixels (Chromium):** **0.59%** pixel-count difference.
- **Pencil on 4,000 px/s drag:** 0 gaps across 38 smooth quadratic segments and 36 ink segments.

## 3. Discoverability & First-Run Walkthrough (R2 §2)

- **Action-gated 5-step walkthrough ("Make your first animation"):** Completed in Chromium using real pointer/click inputs (draw → click gold-highlighted Frame 10 → `+Key` & modify drawing → Onion Skin → Play). Result: `allDone=true`, `keyframes=2`, `playing=true`.
- **No-skip mutant check:** Confirmed no "Next" button exists (`hasNextBtn=false`) and clicking the walkthrough card without acting does not advance any step.
- **Empty-timeline hint:** Visible on 1-keyframe document (`true`), automatically hides once 2nd keyframe is added (`true`).
- **Tooltips with current keybindings:** **28/28** tool and timeline buttons verified to display their current keybinding, dynamically updated on rebind.
- **Help menu & guided tasks:** Verified Help menu (`true`), Key Reference modal (`true`), plus guided tasks *"Bounce a ball (motion tween + easing)"* and *"Morph a shape (shape tween + hints)"*.

## 4. Curves Surviving Planar Merge & 200×24 Curved Fuzz (R2 §§3–4)

- **Approach:** Split chains of tagged quadratic curve edges are refit post-merge back into native integer-twip quadratic Bézier edges `(cx, cy)` (`refitPlanarChainsToQuads`) within the Round 1 tolerance (`2` twips + integer rounding).
- **Honest fallback cases (unchanged policy, explicitly reported to user):** `curved-near-tangent-grazing` (`< 4` twips separation & `|sin(angle)| < 0.08`), `micro-curve-cusp` (chord `< 4` twips, bulge `> 2` twips), and `snap-round-non-convergence` (`> 32` snap-round passes).
- **Curve merged across filled rectangle:** Pre-merge edges = 4, post-merge edges = **10** (including **4** native quadratic edges across the split), split faces = 2, direct-shape bending preserves single quadratic edge. Chord-flattening mutant caught: **true**.
- **200 × 24 Curved Planar Fuzz (4,800 ops):**
  - Invariant failures: **0 / 200 seeds**
  - Twice-run determinism failures: **0**
  - Max vertices observed: 363, total native quadratic edges preserved across final maps: 10779
  - Honest fallbacks triggered: **538** across 173 seeds — breakdown: `{"curved-near-tangent-grazing":518,"micro-curve-cusp":20}`

## 5. Measured FEEL Benchmarks on 500-Shape Document (R2 §5 / R1 §6)

All values below are also recorded verbatim in `results.jsonl`.

| Metric | Measured Value |
| --- | --- |
| Input-to-pixels latency (median / p95) | 16.4 ms / 18.2 ms |
| Direct-shape drag latency (median / p95) | 4.1 ms / 8.4 ms |
| Live scrubbing frame time (median / p95) | 4.4 ms / 39.2 ms |
| Zoom & pan frame time (median / p95) | 2.5 ms / 9.4 ms |
| Playback achieved FPS over ≥10s (target 12 fps) | **11.94 fps** (120 frames in 10.05s) |
| Playback achieved FPS over ≥10s (target 24 fps) | **23.88 fps** (240 frames in 10.05s) |
| Playback achieved FPS over ≥10s (target 30 fps) | **29.95 fps** (301 frames in 10.05s) |
| 5 MB WAV IndexedDB kill-and-reopen | **PASSED** (hash `1150f1aa7a497bff`) |

## 6. All Verification Suites (R1 + R2)

| Suite | Status | Key Result |
| --- | --- | --- |
| 01 Security & Determinism | PASS | 21 static greps passed |
| 02 Document & Cubic Conversion | PASS | Max cubic→quad err 1.2819 twips; byte-identical save/load |
| 03 Planar Map Invariants | PASS | Twice-run hash `8a4aca319023626e`; 2 fallback fixtures verified |
| 04 Independent Tween Oracle | PASS | 260 frames verified; Jaccard=0.0375 |
| 05 Audio Offline & Sync | PASS | Sample-accurate onset; WAV SHA-256=`aed5ca342f7be8b3...` |
| 06 Undo/Redo Fuzz | PASS | 36 gestures: undo-all & redo-all exact |
| 07 Reference Rasteriser Goldens | PASS | Coverage mask verified; zero transcendentals |
| 08 R1 Mutant Suite | PASS | **17/17** R1 mutants caught |
| 09 Browser Integration, Walkthrough & FEEL | PASS | Walkthrough 5/5; Canvas2D match=99.306%; 10s fps & `results.jsonl` emitted |
| 10 R2 Strokes & Stroke Mutants | PASS | 4000 px/s mouse ±3.1%; 150° zig-zag 1 region/0 holes; **5/5** R2 stroke mutants caught |
| 11 R2 Curves & 200×24 Curved Fuzz | PASS | Curve survives merge (10 edges, 4 quads); chord-flattening mutant caught; 200×24 fuzz 0 failures |

## 7. Mutant Kill Summary (17 R1 + 7 R2 = 24/24 Caught)

| ID | Mutant | Status |
| --- | --- | --- |
| R1-1 | Tween rotates long way round | CAUGHT |
| R1-2 | Easing sign flipped | CAUGHT |
| R1-3 | Shape hint pairing swapped | CAUGHT |
| R1-4 | Paint bucket gap tolerance ignored | CAUGHT |
| R1-5 | Stroke fails to split fill beneath | CAUGHT |
| R1-6 | Undo splits one stroke into many | CAUGHT |
| R1-7 | Frame-based playback clock loses time on drops | CAUGHT |
| R1-8 | Stream audio drifting 1 frame/sec | CAUGHT |
| R1-9 | Save/load loses colour-transform add term | CAUGHT |
| R1-10 | Math.sin inside reference rasteriser | CAUGHT |
| R1-11 | UI string contains vendor name | CAUGHT |
| R1-12 | innerHTML sink fed by layer name | CAUGHT |
| R1-13 | Stored cubic in document | CAUGHT |
| R1-14 | No snap-rounding (float vertices) | CAUGHT |
| R1-15 | Autosave to localStorage overflows on 5MB sound | CAUGHT |
| R1-16 | Mask applied as bounding rectangle | CAUGHT |
| R1-17 | Select unused deletes nested symbol | CAUGHT |
| R2-1 | Shared timestamps reproduce beads | CAUGHT |
| R2-2 | Mouse default left at full speed-width | CAUGHT |
| R2-3 | Width without smoothing fails ratio test | CAUGHT |
| R2-4 | Raw self-intersecting rail ring on 150° zig-zag | CAUGHT |
| R2-5 | Stamp-only brush fails connectedness | CAUGHT |
| R2-6 | Chord flattening reinstated on curve merge | CAUGHT |
| R2-7 | Walkthrough step advances on Next click without action | CAUGHT |
