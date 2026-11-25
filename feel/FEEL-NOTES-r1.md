# Speedster round 1: feel notes (Kham, on the potato, 2026-11-25)

The spec's "judged" half is the studio's acceptance pass. These are Kham's own words, recorded by Kehai, with nothing added.

1. "Can't figure it out but it looks good."
2. "The drawing/drag isn't smooth though, if I move too fast it makes it spotty rather than a clean line."

## Kehai's reading, for the round 2 spec (not Kham's words)
- **The spotty fast strokes** look like the brush stamping a dot at each pointer event, instead of joining consecutive samples into a continuous path. At speed, the events land far apart and the gaps show.
  - Round 2: join samples into segments, use `getCoalescedEvents()` where available, and keep the stabiliser and speed-width on top of that.
  - Measured test: a synthetic 4,000 px/s drag at 60 Hz input produces one connected stroke, with no gaps wider than the stroke width.
- **"Can't figure it out"** is a discoverability finding, and it carries the same weight as a failing test. The tools are there, but nothing shows a first-time animator what to do next.
  - Round 2: a first-run, dismissible "make your first animation" walkthrough (draw, add keyframe, onion skin, play), tooltips with keys, and a visible "how to animate" hint on an empty timeline.
  - Unlike Pigeon Life, Speedster's controls are *meant* to be found.

### Correction (Kehai, after Ed's read of the code)
My "stamps a dot at each pointer event" guess above was wrong. The brush already joins its samples into one outline polygon and uses `getCoalescedEvents`. The likelier cause is the one Ed found:
- every coalesced sample in a `pointermove` batch gets the same timestamp (`t: now`, ~l.4758);
- so speed-width swings between hairline (inside a batch) and full width (at batch edges), which gives beads joined by hairlines;
- the rails can also self-intersect on sharp fast turns.

The round 2 spec requires reproducing it before fixing it.
