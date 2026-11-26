# Speedster round 2 audit (Kehai Interim, 2026-11-26)

**Verdict: not accepted as delivered. The walkthrough, the gentle mouse default and the curve work hold, but the
new capsule brush breaks ordinary strokes into pieces, which is the round's own headline requirement (§1.4).**
Kham's judged feel pass is still to come and decides the rest. Spec: `SPEC-R2.md` (64b0a1d, preregistered).
Delivery: `delivery-2/` (16e7585, committed as delivered). Scripts and output are in `audit/r2/`.

## What holds (verified here)
| Claim | Check | Result |
|---|---|---|
| All Node suites | rerun 01–08, 10, 11 on the delivered tree | **PASS**, same summary lines as REPORT (17/17 R1 mutants, 5/5 R2 stroke mutants, 200×24 curved fuzz with 0 failures and 538 honest fallbacks) |
| Mutants fail for the right reason | `audit/r2/mutant-reasons.js` | R2-2 dies on a real assertion (mouse half-widths 41..88, outside 80 ±10%), not on a TypeError. R2-1 and R2-4/5 are hand-built demonstrations rather than patches of the shipped code, so I added a real one: shared timestamps through the **shipped** width code stay at ratio 1.12, while the no-smoothing mutant beads to 2.44 |
| Gentle mouse default (§1.5) | real Chromium, real mouse, ~4,200 px/s (`fast-stroke.py`) | A fast zig-zag and a fast sweep each commit as one piece, 11–12 px wide end to end. Round 1 on the same input gives a 4–7 px hairline with a blob at the start (`shots/r1-vs-r2-fast.png`) |
| Walkthrough (§2) | real mouse and keys (`walkthrough.py`) | Steps advance only on the real action: draw, click frame 10, F6 + change, U, Enter. Clicking the card does nothing, and a miss on frame 10 leaves it waiting at step 2. It ends playing |
| Tooltips with keys | page read | Every tool and timeline button shows its key (e.g. `Brush (B)`, `Insert Keyframe (F6)`) |
| Measurement hygiene (§5) | `results.jsonl` | Delivered, 15 records; playback fps measured over 10.05 s at 12/24/30 |

## What fails
1. **One continuous brush stroke commits as several pieces (§1.4).** Spec: "the committed fill is **one connected region** for one continuous stroke."
   - **In the browser:** a plain V drawn with the mouse in ~13 px steps comes out in two pieces, split at the corner (`shots/r1-vs-r2-dashes.png`). Round 1 drew the same V whole. The walkthrough's first stroke came out visibly dashed (`shots/wt-4-onion.png`).
   - **Root cause is in the core, not the pointer path.**
     - `instrument.py` captured the 21 points the live app hands to `buildBrushCapsulePolygons`: one stroke, 20 capsules, constant width.
     - `addFillUnion` on those capsules returns **2 filled faces**. `exact-v.js` reproduces this in Node from the exact points.
     - Every adjacent capsule pair unions to one face. The split appears when the 12th capsule is added, near the corner.
     - Afterwards the map holds only the two filled faces and **no face covering the corner** (`why-unfilled.js`). So the corner geometry is lost, in snap-rounding or `cleanupAndMergePlanarMap`. It isn't a missed fill.
   - **It's common.** `brush-fuzz.js` (seeded, 300 ordinary mouse strokes, 8–40 points, 4–18 px steps, mouse defaults): **115 of 300 (38%)** commit as more than one filled face.
   - **Why the delivered tests missed it.** They draw one straight 4,000 px/s drag and one evenly spaced zig-zag. The 200×24 fuzz is curves and fills, not brush unions.
2. **Kham's real condition, coalesced batches, can't be reproduced here.**
   - Headless Chromium delivered every CDP mouse event as its own pointermove (max 1 coalesced; `coalesced-stroke.py`). So the shared-stamp path is verified only in Node, against the shipped code (above).
   - The potato is the real test.
3. **Neon's browser suite (09) didn't run here.** It needs Selenium, which isn't in this sandbox, as in round 1. My Playwright passes above stand in for it.

Smaller notes:
- On the timeline ruler, the gold frame-10 box overlaps the "11" label.
- REPORT's "1 connected region" claims hold for its two test strokes only.

## For round 2.1 (or the start of round 3)
- Fix the brush union so any continuous stroke commits as one region. Make `brush-fuzz.js` (or a stronger version) a delivered test, with my seeds, at 0 failures. Keep the Bentley–Ottmann/snap-round oracles honest: a brush stroke that becomes two faces is an invariant failure, not a fallback.
- Add the V from `exact-v.js` as a regression fixture.
- Everything in the "holds" table stays.

## For Kham
`index.html` now opens round 2, with round 1 linked. The walkthrough and the steady-width mouse brush are ready for
your fresh-profile pass. You'll likely see strokes break at sharp turns. That's the bug above, already on the list,
so note it but judge the rest: can you make a moving thing, and do the two guided tasks make sense?

— Kehai
