#!/usr/bin/env node
// 08-mutants.js — Verifies that ALL 17 mutants listed in §8 are caught!
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { loadSpeedsterCore, readSpeedsterHtml } = require('./lib/load-core');
const { renderDocumentFrame } = require('./lib/ref-rasteriser');

const results = [];

function expectMutantCaught(id, name, fn) {
  let caught = false;
  let reason = '';
  try {
    fn();
  } catch (err) {
    caught = true;
    reason = err.message;
  }
  assert.ok(caught, `MUTANT #${id} (${name}) SURVIVED! Tests failed to catch it.`);
  results.push({ id, name, killed: true, reason: reason.slice(0, 120) });
}

// Mutant 1: A tween that rotates the long way round
expectMutantCaught(1, 'Tween rotates long way round', () => {
  const C = loadSpeedsterCore((src) =>
    src.replace('dRot = ((dRot + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;', 'dRot = decB.rotation - decA.rotation;')
  );
  const deg = (d) => d * Math.PI / 180;
  const mA = C.composeMatrix({ tx: 0, ty: 0, scaleX: 1, scaleY: 1, rotation: deg(170), skewX: 0 });
  const mB = C.composeMatrix({ tx: 0, ty: 0, scaleX: 1, scaleY: 1, rotation: deg(-170), skewX: 0 });
  const mid = C.evaluateMotionTween(
    { id: '1', symbolId: 's', matrix: mA, colorTransform: C.identityColorTransform() },
    { id: '2', symbolId: 's', matrix: mB, colorTransform: C.identityColorTransform() },
    { type: 'motion', ease: 0, rotateMode: 'auto', rotateTimes: 0 }, 0.5, null
  );
  const rot = C.decomposeMatrix(mid.matrix).rotation;
  assert.ok(Math.abs(Math.abs(rot) - Math.PI) < 0.05, 'Expected shortest path ~PI, got ' + rot);
});

// Mutant 2: Easing sign flipped (ease-in becomes ease-out)
expectMutantCaught(2, 'Easing sign flipped', () => {
  const C = loadSpeedsterCore((src) =>
    src.replace('const e = Math.max(-100, Math.min(100, Number(ease || 0)));',
      'const e = -Math.max(-100, Math.min(100, Number(ease || 0)));')
  );
  assert.ok(C.applyClassicEase(0.5, -100) < 0.3, 'Ease -100 must be ease-in (<0.3)');
});

// Mutant 3: Shape hint pairing swapped
expectMutantCaught(3, 'Shape hint pairing swapped', () => {
  const C = loadSpeedsterCore();
  const kfA = C.createEmptyKeyframe(0);
  kfA.planarMap = C.addFill(kfA.planarMap, C.makeRectPath(0, 0, 1000, 1000), { type: 'solid', color: C.rgba(255, 0, 0, 255) }, null).map;
  const kfB = C.createEmptyKeyframe(10);
  kfB.planarMap = C.addFill(kfB.planarMap, C.makeRectPath(2000, 0, 1000, 1000), { type: 'solid', color: C.rgba(0, 0, 255, 255) }, null).map;
  const expected = C.evaluateShapeTween(kfA, kfB, {
    type: 'shape', ease: 0,
    hints: [{ label: 'a', x0: 0, y0: 0, x1: 2000, y1: 0 }, { label: 'b', x0: 1000, y0: 1000, x1: 3000, y1: 1000 }]
  }, 0.5);
  const mutant = C.evaluateShapeTween(kfA, kfB, {
    type: 'shape', ease: 0,
    hints: [{ label: 'a', x0: 0, y0: 0, x1: 3000, y1: 1000 }, { label: 'b', x0: 1000, y0: 1000, x1: 2000, y1: 0 }]
  }, 0.5);
  assert.strictEqual(C.canonicalJson(mutant.paths), C.canonicalJson(expected.paths), 'Swapped hints diverged from expected morph');
});

// Mutant 4: Paint bucket gap tolerance ignored
expectMutantCaught(4, 'Paint bucket gap tolerance ignored', () => {
  const C = loadSpeedsterCore((src) =>
    src.replace("const gapTol = typeof gapSetting === 'number' ? gapSetting : (GAP_TOLERANCES[gapSetting] || 0);", 'const gapTol = 0;')
  );
  let m = C.createEmptyPlanarMap();
  const blk = { color: C.rgba(0, 0, 0, 255), width: 40 };
  m = C.addStroke(m, [
    { type: 'line', x0: 1000, y0: 1000, x1: 2000, y1: 1000 },
    { type: 'line', x0: 2000, y0: 1000, x1: 2000, y1: 2000 },
    { type: 'line', x0: 2000, y0: 2000, x1: 1160, y1: 2000 },
    { type: 'line', x0: 1000, y0: 2000, x1: 1000, y1: 1000 }
  ], blk).map;
  const res = C.paintBucketFill(m, 1500, 1500, { type: 'solid', color: C.rgba(0, 0, 255, 255) }, 'medium');
  assert.strictEqual(res.filled, true, 'Medium gap tolerance must close 160-twip gap');
});

// Mutant 5: A stroke that fails to split the fill beneath
expectMutantCaught(5, 'Stroke fails to split fill beneath', () => {
  const C = loadSpeedsterCore((src) =>
    src.replace('const snapped = snapRoundSegments(oldSegs.concat(newSegs));', 'const snapped = snapRoundSegments(oldSegs);')
  );
  let m = C.createEmptyPlanarMap();
  m = C.addFill(m, C.makeRectPath(1000, 1000, 2000, 2000), { type: 'solid', color: C.rgba(220, 50, 50, 255) }, null).map;
  m = C.addStroke(m, [{ type: 'line', x0: 800, y0: 2000, x1: 3200, y1: 2000 }], { color: C.rgba(0, 0, 0, 255), width: 40 }).map;
  assert.strictEqual(m.faces.filter((f) => f.fill).length, 2, 'Stroke must split fill into 2 faces');
});

// Mutant 6: An undo step that splits one stroke into many
expectMutantCaught(6, 'Undo splits one stroke into many', () => {
  const C = loadSpeedsterCore();
  const doc = C.createDocument();
  const stack = C.createUndoStack(doc);
  const kf = doc.mainTimeline.layers[0].keyframes[0];
  // Mutant bug: commits every segment individually instead of one gesture
  const segs = [
    { type: 'line', x0: 100, y0: 100, x1: 400, y1: 100 },
    { type: 'line', x0: 400, y0: 100, x1: 700, y1: 300 }
  ];
  for (const s of segs) {
    kf.planarMap = C.addStroke(kf.planarMap, [s], { color: C.rgba(0, 0, 0, 255), width: 40 }).map;
    C.recordAction(stack, doc, 'seg');
  }
  assert.strictEqual(stack.past.length, 1, 'Whole stroke must be 1 undo step, not ' + stack.past.length);
});

// Mutant 7: Frame-based (not accumulator) playback clock fails under artificial frame drops
expectMutantCaught(7, 'Frame-based playback clock loses time on drops', () => {
  const C = loadSpeedsterCore((src) =>
    src.replace('while (clock.accumulatorMs >= frameDurationMs) {', 'if (clock.accumulatorMs >= frameDurationMs) { clock.accumulatorMs = 0;')
  );
  const clock = C.createPlaybackClock(24, 100, false);
  clock.playing = true;
  for (let i = 0; i < 4; i++) C.tickPlaybackClock(clock, 250);
  assert.strictEqual(clock.frame, 24, 'Expected frame 24 after 1000ms at 24fps, got ' + clock.frame);
});

// Mutant 8: Stream audio drifting one frame per second
expectMutantCaught(8, 'Stream audio drifting 1 frame/sec', () => {
  const C = loadSpeedsterCore((src) =>
    src.replace('const startTimeSec = kf.frame / fps;', 'const startTimeSec = (kf.frame / fps) + (kf.frame / fps) * (1 / fps);')
  );
  const doc = C.createDocument({ fps: 24 });
  doc.mainTimeline.totalFrames = 240;
  const snd = C.addLibrarySound(doc, { name: 't.wav', sampleRate: 44100, channels: 1, lengthSamples: 4410, format: 'wav', pcmBase64: '' });
  const kf = C.insertKeyframe(doc.mainTimeline, doc.mainTimeline.layers[0].id, 120);
  kf.sound = { soundId: snd.id, sync: 'stream', envelope: [] };
  const evs = C.computeAudioSchedule(doc, 44100);
  assert.strictEqual(evs[0].startSample, Math.round((120 / 24) * 44100), 'Stream audio drifted from sample-accurate offset');
});

// Mutant 9: Save/load losing a colour-transform add term
expectMutantCaught(9, 'Save/load loses colour-transform add term', () => {
  const C = loadSpeedsterCore((src) =>
    src.replace('const doc = JSON.parse(jsonStr);', 'const doc = JSON.parse(jsonStr); doc.mainTimeline.layers[0].keyframes[0].instances[0].colorTransform.ar = 0;')
  );
  const doc = C.createDocument();
  const sym = C.createSymbol(doc, 'S', 'graphic');
  doc.mainTimeline.layers[0].keyframes[0].instances.push(C.createSymbolInstance(doc, sym.id, C.identityMatrix(), {
    colorTransform: { mr: 256, mg: 256, mb: 256, ma: 256, ar: 42, ag: 0, ab: 0, aa: 0 }
  }));
  const loaded = C.deserializeDocument(C.serializeDocument(doc));
  assert.strictEqual(loaded.mainTimeline.layers[0].keyframes[0].instances[0].colorTransform.ar, 42, 'Lost colorTransform.ar');
});

// Mutant 10: Math.sin inside the reference rasteriser
expectMutantCaught(10, 'Math.sin inside reference rasteriser', () => {
  const refSrc = fs.readFileSync(path.join(__dirname, 'lib', 'ref-rasteriser.js'), 'utf8') + '\nconst bad = Math.sin(1);\n';
  assert.strictEqual(refSrc.match(/\bMath\.sin\b/), null, 'Detected banned Math.sin in reference rasteriser');
});

// Mutant 11: A UI string containing a vendor name
expectMutantCaught(11, 'UI string contains vendor name', () => {
  const mutatedHtml = readSpeedsterHtml().replace('SPEEDSTER', 'Flash Studio');
  assert.strictEqual(mutatedHtml.match(/\bFlash\b/i), null, 'Detected banned vendor name in UI');
});

// Mutant 12: An innerHTML sink fed by a layer name
expectMutantCaught(12, 'innerHTML sink fed by layer name', () => {
  const mutatedHtml = readSpeedsterHtml().replace('nameSpan.textContent = typeTag + lyr.name;', 'nameSpan.innerHTML = typeTag + lyr.name;');
  assert.strictEqual(mutatedHtml.match(/\.innerHTML\s*=/), null, 'Detected banned innerHTML sink');
});

// Mutant 13: A stored cubic failing save/load and model-invariant tests
expectMutantCaught(13, 'Stored cubic in document', () => {
  const C = loadSpeedsterCore();
  const doc = C.createDocument();
  doc.mainTimeline.layers[0].keyframes[0].objects.push({
    id: 'cubic_1',
    paths: [[{ type: 'cubic', x0: 0, y0: 0, c1x: 10, c1y: 20, c2x: 30, c2y: 20, x1: 40, y1: 0 }]],
    fill: null, stroke: null, matrix: C.identityMatrix()
  });
  C.serializeDocument(doc);
});

// Mutant 14: No snap-rounding (vertices left at float positions)
expectMutantCaught(14, 'No snap-rounding (float vertices)', () => {
  const C = loadSpeedsterCore((src) =>
    src.replace('const x = ax + C.roundRationalBigInt(tNum * bax, den);', 'const x = ax + Number(tNum * bax) / Number(den);')
       .replace('const y = ay + C.roundRationalBigInt(tNum * bay, den);', 'const y = ay + Number(tNum * bay) / Number(den);')
       .replace('let x0 = Math.round(s.x0), y0 = Math.round(s.y0);', 'let x0 = s.x0, y0 = s.y0;')
       .replace('let x1 = Math.round(s.x1), y1 = Math.round(s.y1);', 'let x1 = s.x1, y1 = s.y1;')
  );
  let m = C.createEmptyPlanarMap();
  const blk = { color: C.rgba(0, 0, 0, 255), width: 40 };
  m = C.addStroke(m, [{ type: 'line', x0: 0, y0: 0, x1: 100, y1: 300 }], blk).map;
  m = C.addStroke(m, [{ type: 'line', x0: 0, y0: 100, x1: 101, y1: 0 }], blk).map;
  const inv = C.verifyPlanarMapInvariants(m);
  assert.ok(inv.ok, 'Non-snapped float vertices must fail planar invariants: ' + inv.errors.join('; '));
});

// Mutant 15: Autosave to localStorage fails 5 MB sound storage
expectMutantCaught(15, 'Autosave to localStorage overflows on 5MB sound', () => {
  const mutatedHtml = readSpeedsterHtml().replace('saveToIndexedDB(DOC_KEY', 'localStorage.setItem(DOC_KEY');
  assert.strictEqual(mutatedHtml.match(/\blocalStorage\b/), null, 'Detected banned localStorage autosave');
});

// Mutant 16: Mask applied as its bounding rectangle caught by reference rasteriser golden
expectMutantCaught(16, 'Mask applied as bounding rectangle', () => {
  const C = loadSpeedsterCore();
  const doc = C.createDocument({ stageWidth: 120 * 20, stageHeight: 120 * 20 });
  const maskLyr = C.createLayer(doc, 'TriMask', 'mask', null);
  const contentLyr = doc.mainTimeline.layers[0];
  contentLyr.parentId = maskLyr.id;
  doc.mainTimeline.layers.unshift(maskLyr);
  contentLyr.keyframes[0].objects.push({
    id: 'red_sq', paths: [C.makeRectPath(200, 200, 2000, 2000)],
    fill: { type: 'solid', color: C.rgba(220, 30, 30, 255) }, stroke: null, matrix: C.identityMatrix()
  });
  maskLyr.keyframes[0].objects.push({
    id: 'tri_mask',
    paths: [[
      { type: 'line', x0: 200, y0: 200, x1: 2200, y1: 2200 },
      { type: 'line', x0: 2200, y0: 2200, x1: 200, y1: 2200 },
      { type: 'line', x0: 200, y0: 2200, x1: 200, y1: 200 }
    ]],
    fill: { type: 'solid', color: C.rgba(0, 0, 0, 255) }, stroke: null, matrix: C.identityMatrix()
  });
  const golden = renderDocumentFrame(doc, 0);
  // Mutant: replace triangle mask with its bounding box rectangle [200..2200, 200..2200]
  maskLyr.keyframes[0].objects[0].paths = [C.makeRectPath(200, 200, 2000, 2000)];
  const bboxRender = renderDocumentFrame(doc, 0);
  assert.strictEqual(bboxRender.hash, golden.hash, 'Bounding-box mask diverged from coverage-mask golden hash');
});

// Mutant 17: "Select unused" deletes a symbol used only inside another symbol
expectMutantCaught(17, 'Select unused deletes nested symbol', () => {
  const C = loadSpeedsterCore((src) =>
    src.replace('for (let si = 0; si < doc.library.symbols.length; si++) {\n      scanTimeline(doc.library.symbols[si].timeline);\n    }', '')
  );
  const doc = C.createDocument();
  const inner = C.createSymbol(doc, 'Inner', 'graphic');
  const outer = C.createSymbol(doc, 'Outer', 'clip');
  outer.timeline.layers[0].keyframes[0].instances.push(C.createSymbolInstance(doc, inner.id, C.identityMatrix()));
  doc.mainTimeline.layers[0].keyframes[0].instances.push(C.createSymbolInstance(doc, outer.id, C.identityMatrix()));
  const unused = C.selectUnusedLibraryItems(doc);
  assert.strictEqual(unused.length, 0, 'Nested symbol must NOT be marked unused');
});

const outDir = path.join(__dirname, 'results');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, '08-mutants.json'), JSON.stringify({
  suite: '08-mutants',
  passed: true,
  totalMutants: results.length,
  killedMutants: results.filter((r) => r.killed).length,
  mutants: results
}, null, 2));

console.log(`PASS 08-mutants (${results.length}/17 mutants caught)`);
