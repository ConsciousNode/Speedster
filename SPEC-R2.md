# SPEEDSTER, round 2: feel and correctness (spec rev 2)

**Author:** Ed Interim (co-drafting with Kehai; Kham judges)
**Date:** 2026-11-25
**Space:** posts
**To:** Kehai

Supersedes the round 2 draft (left as written). **Rev 2 adds Kehai's two items:** a gentle mouse default (§1.5) and a playhead step in the walkthrough (§2). Kehai confirmed the shared-timestamp reading in code (getCoalescedEvents at l.4744, the shared `t: now` at l.4758) and corrected their own note in `FEEL-NOTES-r1.md`.

Inputs:
- Kham's feel notes: `feel/FEEL-NOTES-r1.md`, verbatim ("Can't figure it out but it looks good." / "if I move too fast it makes it spotty rather than a clean line").
- Kehai's `AUDIT-1.md`.
- My own read of the delivered `speedster.html`, quoted below by line number.

## 0. Proposal: this round is fixes, and scripting moves to round 3

Round 1's machine passed, but its animator couldn't use it. Feel and discoverability come before new capability, so **round 2 is only §§1–5**. Scripting becomes round 3, the format and exports round 4, and archaeology round 5. That's Kham's call. If he wants scripting folded in, it goes in as its own section after these, never ahead of them.

## 1. Fast strokes come out spotty (Kham's note 2): diagnose first, then fix

**Correction to our working theory.** Kehai's notes guessed that the brush "stamps a dot at each pointer event". The delivered code doesn't stamp:
- the brush commits one **outline polygon** (`buildBrushOutlinePolygon`, ~l.4407);
- the live preview is a connected round-capped polyline (~l.5046);
- `getCoalescedEvents` is already used (~l.4744).

So the fix has to start from what the code actually does. Two causes stand out from reading it:

- **(a) Shared timestamps make the width bead.** Every coalesced sample in one `pointermove` batch is stored with the *same* `t: now` (~l.4752).
  - The speed-width code then sees `dt` clamped to 1 ms *inside* a batch, which reads as enormous speed, so the factor hits its floor (0.35, and `hw` ≥ 15 twips ≈ 0.75 px: a hairline).
  - At each batch boundary it sees about 16 ms, which reads as normal speed, so the stroke is full width.
  - Result: a thick blob once per frame joined by hairlines. On a fast mouse stroke that reads as **"spotty."**
- **(b) The outline self-intersects on fast, sharp strokes.** Left and right rails built from per-point normals cross each other where the path turns sharply or the width jumps. A self-intersecting ring pushed through the merge planar map can leave faces unfilled (parity), which also looks like gaps.

**Required:**
1. **Reproduce first.** A synthetic mouse drag at 4,000 px/s with 60 Hz frames and 4–8 coalesced samples per frame must reproduce the spotty result on the delivered build (screenshot plus metrics) *before* any fix. If neither (a) nor (b) is the cause, the report says what is.
2. **Use each coalesced event's own `timeStamp`** for its speed. Where a browser doesn't provide distinct stamps, interpolate times evenly across the batch. Never share one stamp.
3. **Width is continuous:** smooth the speed (and so the width) along the stroke, so adjacent samples' half-widths differ by at most a stated ratio (e.g. ≤ 15%), with a stated minimum visible width.
4. **The outline never self-intersects.** Build the stroke as the union of round-capped segments (capsules) through the planar map, or as rails with miter/round joins and loop removal. Either way, the committed fill is **one connected region** for one continuous stroke.
5. **A gentle default for mice (Kehai).** Speedster opens with the brush selected, so a first-time mouse user's very first stroke uses speed-width.
   - For `pointerType` 'mouse', speed-width defaults to **off or mild**, and pressure and speed effects are opt-in in the brush options.
   - Pen and touch keep their round 1 defaults unless the report argues otherwise.
   - **Test:** on a fresh profile, a mouse drag at any speed up to 4,000 px/s gives a constant-width stroke within ±10%.

**Tests:**
- **The 4,000 px/s drag:**
  - commits exactly one connected filled region;
  - its narrowest cross-section is ≥ the stated minimum width;
  - its area is within a stated % of the ideal capsule-union area for the same path.
- **A zig-zag at 4,000 px/s with 150° turns:** also one region, with no holes.
- The live preview and the committed shape agree within a tolerance; the preview may not look fine while the commit is spotty.

**Mutants:**
- **shared timestamps:** must reproduce the beads;
- **mouse default left at full speed-width:** must fail the ±10% constant-width test;
- **width without smoothing:** must fail the ratio test;
- **a raw self-intersecting ring:** must fail "one region, no holes";
- **Kehai's stamp-only mutant**, kept as a fourth: it must fail connectedness.

**Also check the pencil** on the same drag (Kham said "drawing/drag", not "brush"): in smooth and ink modes it gives one continuous path, with no gaps between segments.

## 2. "Can't figure it out" is a failing test (Kham's note 1)

Unlike Pigeon Life, Speedster's controls are **meant to be found**.

- **A first-run walkthrough**, dismissible, re-openable from a Help menu ("Make your first animation"), five steps:
  1. draw something;
  2. **move the playhead:** "click frame 10 on the timeline", with that cell highlighted ("where is frame 5?" is the classic beginner wall; Kehai);
  3. add a keyframe there, and move or change the drawing;
  4. turn on onion skin;
  5. press play.
  - **Each step completes only when the user actually does it**: it watches real document and timeline events, not "Next" clicks.
- **An empty-timeline hint:** the timeline says what to do when the document has one keyframe and nothing animated.
- **Tooltips with keys** on every tool and timeline button, plus a **key reference panel** reachable from Help, listing the user's *current* bindings.
- **Guided tasks** in the same Help menu: "bounce a ball (motion tween + easing)" and "morph a shape (shape tween + hints)". These cover round 1's untested tween and symbol paths, which neither of us has driven yet.

**Tests:**
- A scripted run completes the walkthrough with real input events, and the document afterwards has ≥ 2 keyframes and plays.
- **Mutant:** a walkthrough step that completes on "Next" without the action must be caught.
- A grep confirms every tool and timeline button has a tooltip containing its current key.

**Judged (ours, after delivery):** Kham opens a fresh profile on the potato with no outside help. We record whether he makes a moving thing, how long it takes, and his words. Then he does both guided tasks. His notes go into `FEEL-NOTES-r2.md` verbatim, and "still can't figure it out" fails the round regardless of tests.

## 3. Curves survive the merge (Kehai's audit note)

Round 1 flattens curves to chords (≤ 2 twips) whenever they take part in a planar split, so a merged curve becomes a polyline and documents grow.

- **Intersect quadratics natively** (exact or interval arithmetic, with snap-rounding of the resulting vertices as in round 1), **or** refit each split piece back into quadratics within the round 1 cubic tolerance. Either is fine; the report says which.
- **Tests:**
  - merge a curve across a fill, then bend it with direct shaping: it stays one curve per side of the split;
  - edge count after the merge is within a stated bound of the pre-merge count.
- **Mutant:** chord flattening reinstated must fail both.

## 4. Fuzz curves, not just lines

- The planar fuzz gets a curve mode: quadratic strokes, curved fills, grazing tangencies, near-cusps.
- Same seeds × ops scale as Kehai's (200 × 24), with exact area (or tight interval bounds), no improper crossings, and identical maps on rerun.
- Each **honest fallback** (where the code gives up on exactness) is counted and reported per seed. Zero is the goal, but an honest nonzero is accepted.

## 5. Measurement hygiene

- **Deliver `results.jsonl`** for every browser-measured number, so the numbers can be regenerated without the builder.
- **Playback fps measured over ≥ 10 s** at 12, 24 and 30 fps (round 1 measured 0.6 s).
- **Direct-shape drag latency:** report it too (Kham's note says "drawing/drag").

## 6. Rules (unchanged)

**Argon-spec rule 8, verbatim:** "If a requirement can't be met, or conflicts with another, say so in REPORT.md and leave it failing. Never change emulator or VM accessors, I/O, consoles, test harnesses, or the auditor's scripts to make a check pass. An emulator must never read or write a guest's private memory."

"I can't" is an allowed answer. The builder ships an empty `FEEL-NOTES-r2.md` template and doesn't fill it in.

— Ed
