#!/usr/bin/env node
// 03-planar-map-invariants.js — Planar drawing map merge semantics, seeded random stroke fuzz
// invariants, twice-run determinism, paint bucket gap tolerance, direct shaping, and honest
// fallback fixtures for hard curved cases (§3, §7).
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { loadSpeedsterCore } = require('./lib/load-core');

const C = loadSpeedsterCore();

const RED = { type: 'solid', color: C.rgba(220, 50, 50, 255) };
const BLUE = { type: 'solid', color: C.rgba(50, 110, 230, 255) };
const BLK_STROKE = { color: C.rgba(10, 10, 10, 255), width: 40, cap: 'round', join: 'round' };

// 1. Merge model: stroke splits fill beneath (mutant #5)
let m = C.createEmptyPlanarMap();
m = C.addFill(m, C.makeRectPath(1000, 1000, 2000, 2000), RED, null).map;
assert.strictEqual(m.faces.filter((f) => f.fill).length, 1);
const areaBeforeSplit = C.verifyPlanarMapInvariants(m).totalFilledArea2;

m = C.addStroke(m, [{ type: 'line', x0: 800, y0: 2000, x1: 3200, y1: 2000 }], BLK_STROKE).map;
const filledFacesAfterSplit = m.faces.filter((f) => f.fill);
assert.strictEqual(filledFacesAfterSplit.length, 2, 'Stroke across rectangle must split fill into 2 faces');
const invSplit = C.verifyPlanarMapInvariants(m);
assert.ok(invSplit.ok, 'Invariants after stroke split: ' + invSplit.errors.join('; '));
assert.strictEqual(invSplit.totalFilledArea2, areaBeforeSplit, 'Split faces must conserve total filled area');

// 2. Overlapping fills of same colour merge
let m2 = C.createEmptyPlanarMap();
m2 = C.addFill(m2, C.makeRectPath(1000, 1000, 1000, 1000), RED, null).map;
m2 = C.addFill(m2, C.makeRectPath(1500, 1000, 1000, 1000), RED, null).map;
assert.strictEqual(m2.faces.filter((f) => f.fill).length, 1, 'Overlapping same-color fills must merge into 1 face');
// Combined rect is 1500x1000 -> area2 = 3,000,000
assert.strictEqual(C.verifyPlanarMapInvariants(m2).totalFilledArea2, 1500 * 1000 * 2);

// 3. New fill on top cuts shape beneath
let m3 = C.createEmptyPlanarMap();
m3 = C.addFill(m3, C.makeRectPath(1000, 1000, 2000, 2000), RED, null).map;
m3 = C.addFill(m3, C.makeRectPath(1500, 1500, 1000, 1000), BLUE, null).map;
const redFaces = m3.faces.filter((f) => f.fill && f.fill.color.r === 220);
const blueFaces = m3.faces.filter((f) => f.fill && f.fill.color.b === 230);
assert.strictEqual(redFaces.length, 1);
assert.strictEqual(blueFaces.length, 1);
assert.strictEqual(redFaces[0].holes.length, 1, 'Top fill must cut a hole in bottom fill');
assert.strictEqual(redFaces[0].area2, (2000 * 2000 - 1000 * 1000) * 2);
assert.strictEqual(blueFaces[0].area2, 1000 * 1000 * 2);

// 4. Paint bucket gap tolerance (mutant #4)
let mGap = C.createEmptyPlanarMap();
// Open square with a 160-twip (8px) gap on the bottom edge
const openSquare = [
  { type: 'line', x0: 1000, y0: 1000, x1: 2000, y1: 1000 },
  { type: 'line', x0: 2000, y0: 1000, x1: 2000, y1: 2000 },
  { type: 'line', x0: 2000, y0: 2000, x1: 1160, y1: 2000 }, // 160-twip gap to (1000,2000)
  { type: 'line', x0: 1000, y0: 2000, x1: 1000, y1: 1000 }
];
mGap = C.addStroke(mGap, openSquare, BLK_STROKE).map;
const fillNone = C.paintBucketFill(mGap, 1500, 1500, BLUE, 'none');
assert.strictEqual(fillNone.filled, false, 'Gap of 160 twips must NOT fill when gap tolerance is none');
const fillSmall = C.paintBucketFill(mGap, 1500, 1500, BLUE, 'small'); // 100 twips
assert.strictEqual(fillSmall.filled, false, 'Gap of 160 twips must NOT fill when gap tolerance is small (100 twips)');
const fillMed = C.paintBucketFill(mGap, 1500, 1500, BLUE, 'medium'); // 240 twips
assert.strictEqual(fillMed.filled, true, 'Gap of 160 twips MUST fill when gap tolerance is medium (240 twips)');

// 5. Direct shaping: bend edge into quad, add corner
let mShape = C.createEmptyPlanarMap();
mShape = C.addFill(mShape, C.makeRectPath(1000, 1000, 1000, 1000), RED, BLK_STROKE).map;
const bent = C.directShapeBendEdge(mShape, mShape.edges[0].id, 1500, 800);
assert.ok(bent.ok && bent.map.edges[0].cx !== null, 'Direct shaping must bend edge into quadratic');

// 6. Seeded random stroke fuzz — run TWICE with identical seed (§7)
function runPlanarFuzz(seed) {
  const rng = C.createSeededRng(seed);
  let pm = C.createEmptyPlanarMap();
  // Base canvas rect fill
  pm = C.addFill(pm, C.makeRectPath(500, 500, 4000, 3000), RED, BLK_STROKE).map;
  // 18 random crossing strokes
  for (let i = 0; i < 18; i++) {
    const x0 = 400 + Math.round(rng() * 4200);
    const y0 = 400 + Math.round(rng() * 3200);
    const x1 = 400 + Math.round(rng() * 4200);
    const y1 = 400 + Math.round(rng() * 3200);
    const res = C.addStroke(pm, [{ type: 'line', x0, y0, x1, y1 }], BLK_STROKE);
    assert.ok(res.ok, 'Stroke fuzz step failed: ' + res.reason);
    pm = res.map;
  }
  const invAfterStrokes = C.verifyPlanarMapInvariants(pm);
  assert.ok(invAfterStrokes.ok, 'Fuzz invariants failed: ' + invAfterStrokes.errors.join('; '));
  // Total filled area must still equal exact 4000x3000 rect!
  assert.strictEqual(invAfterStrokes.totalFilledArea2, 4000 * 3000 * 2,
    'Sum of split face areas must equal total covered area');

  // Erase-then-undo test via UndoStack
  const doc = C.createDocument();
  doc.mainTimeline.layers[0].keyframes[0].planarMap = pm;
  const stack = C.createUndoStack(doc);
  const hashBeforeErase = C.hashPlanarMap(doc.mainTimeline.layers[0].keyframes[0].planarMap);

  C.beginGesture(stack, 'erase');
  const erasePoly = [
    { x: 1500, y: 1200 }, { x: 2500, y: 1200 },
    { x: 2500, y: 2200 }, { x: 1500, y: 2200 }
  ];
  const erased = C.eraseRegion(doc.mainTimeline.layers[0].keyframes[0].planarMap, erasePoly, 'normal');
  assert.ok(erased.ok);
  doc.mainTimeline.layers[0].keyframes[0].planarMap = erased.map;
  C.commitGesture(stack, doc);

  const invAfterErase = C.verifyPlanarMapInvariants(doc.mainTimeline.layers[0].keyframes[0].planarMap);
  assert.ok(invAfterErase.ok, 'Post-erase invariants failed: ' + invAfterErase.errors.join('; '));
  assert.ok(invAfterErase.totalFilledArea2 < invAfterStrokes.totalFilledArea2, 'Erase must reduce filled area');

  const restoredDoc = C.undo(stack);
  const hashAfterUndo = C.hashPlanarMap(restoredDoc.mainTimeline.layers[0].keyframes[0].planarMap);
  assert.strictEqual(hashAfterUndo, hashBeforeErase, 'Erase-then-undo must restore identical graph hash');

  return {
    hashBeforeErase,
    hashAfterErase: invAfterErase.hash,
    vertices: invAfterStrokes.vertexCount,
    edges: invAfterStrokes.edgeCount,
    faces: invAfterStrokes.faceCount,
    area2: invAfterStrokes.totalFilledArea2
  };
}

const run1 = runPlanarFuzz(987654321);
const run2 = runPlanarFuzz(987654321);
assert.strictEqual(run1.hashBeforeErase, run2.hashBeforeErase, 'Twice-run fuzz must produce identical graph hash');
assert.strictEqual(run1.hashAfterErase, run2.hashAfterErase, 'Twice-run post-erase fuzz must produce identical graph hash');

// 7. Honest "I can't" Fallback Fixtures (§3)
// Fixture A: Micro-curve cusp (chord < 4 twips, bulge > 2 twips)
const microCurveFixture = [{ type: 'quad', x0: 1000, y0: 1000, cx: 1040, cy: 1040, x1: 1002, y1: 1001 }];
const fbA = C.addStroke(C.createEmptyPlanarMap(), microCurveFixture, BLK_STROKE);
assert.strictEqual(fbA.ok, false);
assert.strictEqual(fbA.fallback, true);
assert.strictEqual(fbA.reason, 'micro-curve-cusp');

// Fixture B: Near-tangent quadratic-quadratic grazing (< 4 twips separation, sinAngle < 0.08)
let mCurve = C.createEmptyPlanarMap();
mCurve = C.addFill(mCurve, C.makeRectPath(1000, 1000, 1000, 1000), RED, BLK_STROKE).map;
mCurve = C.directShapeBendEdge(mCurve, mCurve.edges[0].id, 1500, 800).map;
const e0 = mCurve.edges[0];
const u0 = mCurve.vertices.find((v) => v.id === e0.u);
const v0 = mCurve.vertices.find((v) => v.id === e0.v);
const grazingFixture = [{ type: 'quad', x0: u0.x, y0: u0.y + 2, cx: e0.cx, cy: e0.cy + 2, x1: v0.x, y1: v0.y + 2 }];
const fbB = C.addStroke(mCurve, grazingFixture, BLK_STROKE);
assert.strictEqual(fbB.ok, false);
assert.strictEqual(fbB.fallback, true);
assert.strictEqual(fbB.reason, 'curved-near-tangent-grazing');

const outDir = path.join(__dirname, 'results');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, '03-planar-map.json'), JSON.stringify({
  suite: '03-planar-map-invariants',
  passed: true,
  fuzzSeed: 987654321,
  fuzzVertices: run1.vertices,
  fuzzEdges: run1.edges,
  fuzzFaces: run1.faces,
  fuzzHashRun1: run1.hashBeforeErase,
  fuzzHashRun2: run2.hashBeforeErase,
  fallbackFixturesVerified: [
    { name: 'micro-curve-cusp', reason: fbA.reason },
    { name: 'curved-near-tangent-grazing', reason: fbB.reason }
  ]
}, null, 2));

console.log(`PASS 03-planar-map-invariants (fuzz hash=${run1.hashBeforeErase}, 2 fallback fixtures verified)`);
