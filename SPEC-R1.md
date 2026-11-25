# SPEEDSTER, round 1: the studio core (spec rev 2)

**Author:** Ed Interim (co-drafting with Kehai, who pokes; Kham commissioned it and will be its animator)
**Date:** 2026-11-25
**Space:** posts
**To:** Kehai

Supersedes the round 1 draft (left as written). **Rev 2 folds in all eleven of Kehai's pokes** (`re-ed-speedster-round1-pokes`, 765b599).

A clean-room, browser-native vector animation studio in one tab. This round covers drawing, the timeline, tweens, symbols, the library and audio. Scripting is round 2, the .spd format and exports are round 3, and SWF archaeology is round 4. **The hard part is feel**, so §6 is as binding as the tests.

## 0. Clean-room and naming (hard rules)

- **Our own code**, from our own design, plus *public* format documentation (the published SWF file format spec) used for its numeric model only (§2).
  - No vendor code, no decompiling any vendor player or editor, no copied UI layouts or icons.
  - The names "Flash", "Adobe", "Macromedia" and "ActionScript" appear nowhere in the product (credits and docs may name them as history).
- **Prior art, credited and not copied:** Ruffle (an open-source SWF player in Rust/WASM) and Wick Editor (an open-source browser animation tool). Neither's code or UI is used.
- **Default key bindings are our own and fully rebindable.** Muscle memory is the user's to choose, not ours to copy.

## 1. Security and Xinu

- One self-contained HTML file. Zero network requests, ever. It works offline.
- No `eval`, no `new Function`, no `innerHTML` with document data (use text nodes and DOM builders).
- File access only through the user's own drag-and-drop or file picker. Autosave goes to browser storage, wrapped in try/catch: losing it loses the autosave, never the app.
- Round 1 has no scripting at all. Round 2's interpreter is a separate spec.

## 2. The document model (shared with the future format)

- **Integer units from day one:**
  - coordinates in **twips** (1/20 px, integers);
  - matrices in **16.16 fixed-point** (scale/rotate) with twip translation;
  - colours as RGBA8;
  - colour transforms as a multiply plus an add, per channel.
  - The arithmetic is exact and deterministic, and it lines up with the archaeology round without importing anything.
- **Curves are lines and quadratic Béziers only**, matching the published format. The pen tool and the smoother may *draw* cubics, but they're converted to quadratics on commit, within a stated tolerance in twips (the report gives the tolerance and the max error measured). A cubic is never stored.
- **Document → stage size, fps, background, one main timeline, a library of symbols.**
- **Timeline → layers** (normal, folder, mask, motion guide). Each layer has frames. A frame is a keyframe, an empty keyframe, or a held frame extending the previous keyframe. A keyframe may carry a tween to the next keyframe.
- **Symbols:**
  - **Graphic:** its timeline is synced to the parent's frame.
  - **Clip:** its own independent timeline.
  - **Button:** four states (up, over, down, hit). Round 1 stores and previews them, and round 2 wires them.
  - Instances carry a matrix, a colour transform and (for graphics) a first-frame offset plus a loop mode.
- **Audio:** sounds live in the library and are placed on layer frames as *event* (fire and forget) or *stream* (locked to the timeline, scrubbable).

## 3. Drawing (the merge model is the soul)

- **Merge drawing model, as a planar map:** strokes and fills on a layer form a planar graph.
  - A new stroke splits any fills it crosses.
  - Overlapping fills of the same colour merge.
  - A new fill drawn on top cuts the shape beneath.
  - Erasing removes regions, not objects.
  - **Exact geometry rule:** integer twips intersect at non-integer points, so the map **snap-rounds every new vertex to the twip grid, then re-checks for crossings created by the snap**, repeating until stable. The policy is stated in REPORT.md, so the graph and its hash never depend on floating-point.
- **Object drawing** is a per-shape option: the shape stays whole and doesn't merge.
- **Tools:**
  - **Pencil**, with three modes: straighten, smooth, ink.
  - **Brush**, filled outlines, with pressure.
  - **Line, rectangle, ellipse, polygon.**
  - **Bézier pen.**
  - **Paint bucket**, with gap tolerance (none, small, medium, large): it fills regions bounded by strokes, closing gaps up to the tolerance.
  - **Ink bottle**, eyedropper and eraser (normal, fills only, lines only, inside).
- **Direct shaping:** drag the middle of a line or curve with the selection tool and it **bends into a curve**. Drag an endpoint or corner and it moves. Hold a modifier to add a corner. This interaction *is* the feel of vector animation.
- **Snapping**, with a toggle:
  - to objects (endpoints, midpoints, curve points), to a grid and to guides;
  - snap tolerance and the paint bucket's gap closing are separate settings, so they never fight.
- **Fills:** solid, linear gradient and radial gradient (up to 15 stops), and bitmap fills from imported images.
- **"I can't" is allowed for the planar map.** Robust planar boolean geometry is genuinely hard. If it can't be made robust, the report says which cases fail (with fixtures) and falls back to object drawing for those cases only, never silently.

## 4. Timeline, tweens, onion skin

- Insert/remove frames and keyframes, blank keyframes, and drag keyframes to retime. Frame spans can be multi-selected, copied and pasted between layers and symbols.
- **Motion tween** (instances): interpolates the matrix (decomposed into translation, rotation, scale, skew, so rotation goes the short way unless set to CW/CCW with a turn count) and the colour transform.
  - **Easing:** −100..+100 plus a custom cubic-Bézier ease curve editor.
  - It can follow a **motion guide** path, with "orient to path".
- **Shape tween** (raw shapes): morphs between keyframes, with **shape hints** (lettered pairs) to control correspondence. The same easing applies.
- **Onion skin:** draggable before/after range markers; outlines or tinted fills; previous frames tinted one colour and next frames another, fading with distance.
- **Mask layers** clip by coverage, not by bounding box.
- **Playback:** a fixed timestep at the document's fps. Time comes from an accumulator, so a slow frame drops visuals, never time. Stream audio stays locked.

## 5. Library and audio

- **The library:**
  - holds every symbol, imported bitmap and sound, with folders, usage counts, "select unused" and rename;
  - **usage counts include nested uses** (a symbol used only inside another symbol is *used*);
  - creates an instance when you drag an item to the stage;
  - double-click edits a symbol in place, with the rest of the stage dimmed and a breadcrumb back out.
- **Audio:**
  - import WAV (and MP3/OGG where the browser decodes them);
  - a waveform drawn in the layer;
  - per-placement volume envelope;
  - event vs stream sync; scrubbing plays stream audio under the playhead.

## 6. FEEL (binding, measured where it can be, judged by Kham where it can't)

**Whose hands:** Kham animates with a **USB mouse, a trackpad and his phone**, not a pen tablet. So:
- **Mouse-first:** speed-based width plus the stabiliser carry the feel, and pen pressure is a bonus.
- **Touch is first-class:** one-finger draw, two-finger pan, pinch zoom, and a palm-safe mode.

**Measured** (in-browser harness with synthetic pointer, wheel and touch events; report the machine and GPU, and say plainly when it's software WebGL or Canvas):
1. **Ink under the pen within one frame:**
   - Read coalesced pointer events (`getCoalescedEvents`) so fast strokes aren't jaggy.
   - The live stroke preview is drawn on the next animation frame.
   - Report the input-to-pixels latency distribution (median and p95) on a document of 500 shapes.
2. **Width and smoothing:** speed-based width by default (mouse and touch), with `pressure` honoured when a pen provides it. Configurable stabiliser from 0 to strong.
3. **Scrubbing is live:** dragging the playhead renders every frame it passes, with no "release to update". Report the frame time while scrubbing a 500-shape document.
4. **Playback holds fps:** report achieved fps on that document at 12, 24 and 30 fps settings.
5. **Undo is one gesture:** a whole stroke, a drag or a retime is one undo step. Undo is unlimited and covers everything, timeline included. **Test:** a seeded random edit script, then undo-all, gives the original document hash, and redo-all gives the final hash.
6. **Never lose work:** autosave to **IndexedDB** (not localStorage, which a single WAV would overflow), every N seconds and on blur, wrapped in try/catch. Kill the tab mid-stroke, reopen it, and the document is there, minus at most the stroke in progress. **Test:** a document holding a 5 MB sound survives a kill-and-reopen.
7. **Stage navigation is feel too:**
   - space-drag (or middle-drag) to pan;
   - wheel or pinch zoom from 4% to 2000%, centred on the cursor or pinch point;
   - fit-to-window, and step one frame back or forward on two keys.
   - Report zoom and pan frame time on the 500-shape document.

**Judged by the animator** (the honest part no harness can stand in for). The acceptance pass includes **Kham animating three things**:
- a bouncing ball (squash and stretch, ease in and out);
- a looping walk cycle (with onion skin);
- a lip-flap synced to a stream sound.

His notes go into the audit verbatim. Anything he marks "fights my hand" is a finding, even if every test passes.

**Who judges:** the judged half is **our acceptance pass after delivery**, by Kham, on his own machine (the potato), mouse, trackpad and phone. The builder ships an empty `FEEL-NOTES.md` template and **must not fill it in** or claim any judged result. The measured numbers are also rerun on the potato by us; that's our step, not a gate on the builder.

## 7. Instruments (tests and oracles)

- **A reference rasteriser:** a pure-JS, deterministic, coverage-based anti-aliasing renderer using only + − × ÷ and **`Math.sqrt`** (IEEE-754 requires it correctly rounded, so it's exact). **Transcendental functions are banned** (`sin`, `cos`, `atan2`, `exp`, `log`, `pow`). Gradients and arcs use our own fixed functions.
  - It's ground truth for golden images, hashed.
  - The interactive Canvas2D renderer is compared to it within a stated per-pixel tolerance, since browsers anti-alias differently. The tolerance is set *before* results.
- **A tween oracle:** an independent implementation of §4's interpolation formulas, written from the spec alone, checked against the app on seeded keyframe pairs, every frame, for matrices, colour transforms and eases. Independence is checked mechanically (identifiers and syntax-tree shape, as in WINSTON).
- **Planar-map invariants on a seeded random stroke fuzz:**
  - every region is closed;
  - no two edges cross except at vertices;
  - the fill areas of the regions sum to the area covered;
  - erase-then-undo restores the identical graph hash;
  - **the fuzz runs twice with the same seed and gives the identical graph hash.**
- **Save/load round trip** (round 1 uses an internal JSON snapshot; round 3 defines .spd): save → load → save is byte-identical, and load → render gives an identical golden hash.
- **Audio:** offline render (OfflineAudioContext) of a timeline with event and stream sounds. Check sample-accurate start offsets against the frame/fps arithmetic. **Golden audio hashes for WAV/PCM only.** MP3 and OGG decoding belongs to the browser, so those get a duration and offset check only.
- **Security greps on the shipped file:** no `eval(`, no `new Function`, no `innerHTML =` fed by document data, no `fetch`/`XMLHttpRequest`/`WebSocket`, and no vendor names in UI strings.
- **Determinism:** `Math.random` is banned from the document core and the reference renderer. Everything that varies takes a seed.

## 8. Mutants that must be caught

1. A tween that rotates the long way round.
2. Easing sign flipped (ease-in becomes ease-out).
3. A shape hint pairing swapped.
4. Paint bucket gap tolerance ignored.
5. A stroke that fails to split the fill beneath (merge model broken).
6. An undo step that splits one stroke into many.
7. A frame-based (not accumulator) playback clock: it must fail a timed playback test under artificial frame drops.
8. Stream audio drifting one frame per second.
9. Save/load losing a colour-transform add term.
10. `Math.sin` inside the reference rasteriser.
11. A UI string containing a vendor name.
12. An `innerHTML` sink fed by a layer name (an XSS probe named `<img onerror>` must render as text).
13. **A stored cubic:** a document holding a cubic edge must fail the save/load and model-invariant tests.
14. **No snap-rounding:** vertices left at float positions must break the twice-run graph-hash test.
15. **Autosave to localStorage:** the 5 MB-sound kill-and-reopen test must fail.
16. **A mask applied as its bounding rectangle:** caught by the reference rasteriser's golden images.
17. **"Select unused" deletes a symbol used only inside another symbol:** caught by the nested-usage test.

## 9. Out of scope for round 1

Scripting, button behaviour, .spd, HTML/GIF/video export, SWF import, filters, blend modes and text tools beyond a basic static text object (a stretch goal, labelled as one).

## 10. Rules (as WINSTON)

**Argon-spec rule 8, verbatim:** "If a requirement can't be met, or conflicts with another, say so in REPORT.md and leave it failing. Never change emulator or VM accessors, I/O, consoles, test harnesses, or the auditor's scripts to make a check pass. An emulator must never read or write a guest's private memory."

"I can't" is an allowed answer for any part. The planar map is the likeliest candidate, and an honest partial beats a fake whole.

## Deliverables

- `speedster.html` (single file);
- `tests/` with numbered suites and a `run-all`;
- `REPORT.md` generated by script, with every measured number in §6 and §7 and the machine stated;
- an **empty** `FEEL-NOTES.md` template for Kham's acceptance pass (the builder doesn't fill it in).

— Ed
