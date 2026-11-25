#!/usr/bin/env node
// 06-undo-redo-fuzz.js — Unlimited gesture-based undo/redo fuzz (§6.5, mutant #6).
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { loadSpeedsterCore } = require('./lib/load-core');

const C = loadSpeedsterCore();

const rng = C.createSeededRng(654321);
let doc = C.createDocument({ stageWidth: 6000, stageHeight: 4000, fps: 24 });
const stack = C.createUndoStack(doc);
const originalHash = C.hashDocument(doc);

// 1. Verify one multi-segment stroke gesture = exactly 1 undo step (mutant #6)
C.beginGesture(stack, 'brush-stroke');
const kf0 = doc.mainTimeline.layers[0].keyframes[0];
const multiSegStroke = [
  { type: 'line', x0: 400, y0: 400, x1: 800, y1: 600 },
  { type: 'line', x0: 800, y0: 600, x1: 1200, y1: 500 },
  { type: 'line', x0: 1200, y0: 500, x1: 1600, y1: 900 }
];
kf0.planarMap = C.addStroke(kf0.planarMap, multiSegStroke, { color: C.rgba(10, 10, 10, 255), width: 40 }).map;
C.recomputeKeyframeBlank(kf0);
C.commitGesture(stack, doc);
assert.strictEqual(stack.past.length, 1, 'Whole multi-segment stroke must be exactly 1 undo step');

// 2. Seeded random edit script (35 mixed drawing, timeline, and library gestures)
let committedSteps = 1;
for (let step = 0; step < 35; step++) {
  const op = Math.floor(rng() * 6);
  const tl = doc.mainTimeline;
  const lyr = tl.layers[Math.floor(rng() * tl.layers.length)];
  const kf = lyr.keyframes[0];

  C.beginGesture(stack, 'fuzz-' + step);
  if (op === 0) {
    // Draw random rect fill
    const x = 400 + Math.round(rng() * 3000);
    const y = 400 + Math.round(rng() * 2000);
    const w = 300 + Math.round(rng() * 800);
    const h = 300 + Math.round(rng() * 800);
    const col = C.rgba(Math.round(rng() * 255), Math.round(rng() * 255), Math.round(rng() * 255), 255);
    const r = C.addFill(kf.planarMap, C.makeRectPath(x, y, w, h), { type: 'solid', color: col }, null);
    if (r.ok) kf.planarMap = r.map;
    C.recomputeKeyframeBlank(kf);
  } else if (op === 1) {
    // Draw random stroke
    const r = C.addStroke(kf.planarMap, [{
      type: 'line',
      x0: 200 + Math.round(rng() * 4000), y0: 200 + Math.round(rng() * 3000),
      x1: 200 + Math.round(rng() * 4000), y1: 200 + Math.round(rng() * 3000)
    }], { color: C.rgba(0, 0, 0, 255), width: 40 });
    if (r.ok) kf.planarMap = r.map;
    C.recomputeKeyframeBlank(kf);
  } else if (op === 2) {
    // Insert keyframe at random frame
    const f = 1 + Math.floor(rng() * 20);
    C.insertKeyframe(tl, lyr.id, f);
  } else if (op === 3) {
    // Add layer
    tl.layers.push(C.createLayer(doc, 'FuzzLyr_' + step, 'normal', null));
  } else if (op === 4) {
    // Retime a keyframe if >1 exists
    if (lyr.keyframes.length > 1) {
      const k = lyr.keyframes[1];
      C.retimeKeyframe(tl, lyr.id, k.frame, k.frame + 2);
    } else {
      C.insertFrames(tl, lyr.id, 0, 2);
    }
  } else {
    // Create symbol & place instance
    const sym = C.createSymbol(doc, 'Sym_' + step, 'graphic');
    kf.instances.push(C.createSymbolInstance(doc, sym.id, C.identityMatrix()));
    C.recomputeKeyframeBlank(kf);
  }
  if (C.commitGesture(stack, doc)) committedSteps++;
}

const finalHash = C.hashDocument(doc);
assert.notStrictEqual(finalHash, originalHash, 'Fuzz edits must change document hash');

// Undo all -> must equal exact original document hash
let undoCount = 0;
while (stack.past.length > 0) {
  doc = C.undo(stack);
  undoCount++;
}
assert.strictEqual(undoCount, committedSteps);
assert.strictEqual(C.hashDocument(doc), originalHash, 'Undo-all must restore exact original document hash');

// Redo all -> must equal exact final document hash
let redoCount = 0;
while (stack.future.length > 0) {
  doc = C.redo(stack);
  redoCount++;
}
assert.strictEqual(redoCount, committedSteps);
assert.strictEqual(C.hashDocument(doc), finalHash, 'Redo-all must restore exact final document hash');

const outDir = path.join(__dirname, 'results');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, '06-undo-redo.json'), JSON.stringify({
  suite: '06-undo-redo-fuzz',
  passed: true,
  committedSteps,
  originalHash,
  finalHash
}, null, 2));

console.log(`PASS 06-undo-redo-fuzz (${committedSteps} steps: undo-all=${originalHash}, redo-all=${finalHash})`);
