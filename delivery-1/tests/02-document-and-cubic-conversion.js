#!/usr/bin/env node
// 02-document-and-cubic-conversion.js — Document model, cubic->quadratic error bound,
// byte-identical save/load round trip, colour-transform preservation, and nested library usage.
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { loadSpeedsterCore } = require('./lib/load-core');
const { renderDocumentFrame } = require('./lib/ref-rasteriser');

const C = loadSpeedsterCore();

// 1. Cubic-to-quadratic conversion across 60 seeded cubic curves (§2)
const rng = C.createSeededRng(20261125);
let maxMeasuredErrorTwips = 0;
let totalQuadsProduced = 0;
for (let i = 0; i < 60; i++) {
  const p0 = { x: Math.round(rng() * 8000), y: Math.round(rng() * 6000) };
  const p1 = { x: Math.round(rng() * 8000), y: Math.round(rng() * 6000) };
  const p2 = { x: Math.round(rng() * 8000), y: Math.round(rng() * 6000) };
  const p3 = { x: Math.round(rng() * 8000), y: Math.round(rng() * 6000) };
  const quads = C.cubicToQuadratics(p0, p1, p2, p3, C.CUBIC_TOLERANCE_TWIPS);
  totalQuadsProduced += quads.length;
  for (const q of quads) {
    assert.strictEqual(q.type, 'quad');
    assert.ok(Number.isInteger(q.x0) && Number.isInteger(q.y0));
    assert.ok(Number.isInteger(q.cx) && Number.isInteger(q.cy));
    assert.ok(Number.isInteger(q.x1) && Number.isInteger(q.y1));
  }
  const err = C.measureCubicToQuadMaxError(p0, p1, p2, p3, quads);
  if (err > maxMeasuredErrorTwips) maxMeasuredErrorTwips = err;
}
assert.ok(maxMeasuredErrorTwips <= C.CUBIC_TOLERANCE_TWIPS + 1.0,
  `Cubic->quad max error ${maxMeasuredErrorTwips} exceeded tolerance`);

// 2. Save -> Load -> Save byte-identical round trip + colour transform add terms (mutant #9)
const doc = C.createDocument({ stageWidth: 3200, stageHeight: 2400, fps: 24 });
const symA = C.createSymbol(doc, 'NestedInner', 'graphic');
const symB = C.createSymbol(doc, 'OuterHolder', 'clip');
const symUnused = C.createSymbol(doc, 'OrphanSym', 'button');

// Put NestedInner inside OuterHolder ONLY (nested usage test, mutant #17)
const kfOuter = symB.timeline.layers[0].keyframes[0];
kfOuter.instances.push(C.createSymbolInstance(doc, symA.id, C.identityMatrix(), {
  colorTransform: { mr: 200, mg: 256, mb: 128, ma: 256, ar: 45, ag: -18, ab: 90, aa: 12 }
}));
// Put OuterHolder on Main stage
const kfMain = doc.mainTimeline.layers[0].keyframes[0];
kfMain.instances.push(C.createSymbolInstance(doc, symB.id, C.identityMatrix(), {
  colorTransform: { mr: 256, mg: 220, mb: 256, ma: 240, ar: 15, ag: 25, ab: -30, aa: 5 }
}));
// Add a fill to main planar map
const addRes = C.addFill(kfMain.planarMap, C.makeRectPath(400, 400, 1200, 800),
  { type: 'solid', color: C.rgba(220, 60, 80, 255) },
  { color: C.rgba(20, 20, 30, 255), width: 40, cap: 'round', join: 'round' }
);
assert.ok(addRes.ok);
kfMain.planarMap = addRes.map;
C.recomputeKeyframeBlank(kfMain);

const saved1 = C.serializeDocument(doc);
const loaded = C.deserializeDocument(saved1);
const saved2 = C.serializeDocument(loaded);
assert.strictEqual(saved1, saved2, 'Save -> Load -> Save must be byte-identical');

// Verify colour transform add terms survived intact
const loadedInst = loaded.mainTimeline.layers[0].keyframes[0].instances[0];
assert.strictEqual(loadedInst.colorTransform.ar, 15);
assert.strictEqual(loadedInst.colorTransform.ag, 25);
assert.strictEqual(loadedInst.colorTransform.ab, -30);
assert.strictEqual(loadedInst.colorTransform.aa, 5);

// Verify load -> render gives identical golden hash
const r1 = renderDocumentFrame(doc, 0);
const r2 = renderDocumentFrame(loaded, 0);
assert.strictEqual(r1.hash, r2.hash, 'Load -> render golden hash mismatch');

// 3. Stored cubic must fail validation & save/load (mutant #13)
const badDoc = C.deserializeDocument(saved1);
badDoc.mainTimeline.layers[0].keyframes[0].objects.push({
  id: 'bad_cubic',
  paths: [[{ type: 'cubic', x0: 0, y0: 0, c1x: 100, c1y: 200, c2x: 300, c2y: 200, x1: 400, y1: 0 }]],
  fill: null, stroke: null, matrix: C.identityMatrix()
});
assert.strictEqual(C.validateDocument(badDoc).ok, false, 'Stored cubic must fail validateDocument');
assert.throws(() => C.serializeDocument(badDoc), /forbidden segment type|cubic/i);

// 4. Nested library usage counts & Select/Delete Unused (mutant #17)
const counts = C.computeUsageCounts(loaded);
assert.strictEqual(counts[symA.id], 1, 'Nested symbol used inside OuterHolder must have usage=1');
assert.strictEqual(counts[symB.id], 1, 'OuterHolder used on stage must have usage=1');
assert.strictEqual(counts[symUnused.id], 0, 'OrphanSym must have usage=0');
const unused = C.selectUnusedLibraryItems(loaded);
assert.strictEqual(unused.length, 1);
assert.strictEqual(unused[0].id, symUnused.id);
C.deleteUnusedLibraryItems(loaded);
assert.ok(loaded.library.symbols.some((s) => s.id === symA.id), 'Nested symbol must survive Delete Unused');
assert.ok(!loaded.library.symbols.some((s) => s.id === symUnused.id), 'Orphan symbol must be deleted');

const outDir = path.join(__dirname, 'results');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, '02-document.json'), JSON.stringify({
  suite: '02-document-and-cubic-conversion',
  passed: true,
  cubicToleranceTwips: C.CUBIC_TOLERANCE_TWIPS,
  cubicSamplesTested: 60,
  cubicMaxMeasuredErrorTwips: Number(maxMeasuredErrorTwips.toFixed(4)),
  totalQuadsProduced,
  roundTripBytes: saved1.length,
  goldenHash: r1.hash
}, null, 2));

console.log(`PASS 02-document-and-cubic-conversion (max cubic->quad err = ${maxMeasuredErrorTwips.toFixed(4)} twips)`);
