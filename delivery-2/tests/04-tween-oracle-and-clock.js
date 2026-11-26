#!/usr/bin/env node
// 04-tween-oracle-and-clock.js — Independent tween oracle comparison, mechanical
// independence check, shape hints, and fixed-timestep accumulator playback clock (§4, §7).
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { loadSpeedsterCore, extractCoreSource } = require('./lib/load-core');
const oracle = require('./lib/tween-oracle');

const C = loadSpeedsterCore();

// 1. Mechanical independence check (§7)
const oracleSrc = fs.readFileSync(path.join(__dirname, 'lib', 'tween-oracle.js'), 'utf8');
const coreSrc = extractCoreSource();
const tweenStart = coreSrc.indexOf('// 04-tween-and-audio.js');
const appTweenSrc = coreSrc.slice(tweenStart >= 0 ? tweenStart : 0);
const indep = oracle.checkOracleIndependence(oracleSrc, appTweenSrc);
assert.ok(indep.independent, `Tween oracle not sufficiently independent (Jaccard=${indep.jaccardSimilarity})`);

// 2. Compare app vs independent oracle on 20 seeded keyframe pairs across all frames
const rng = C.createSeededRng(44444);
const rotateModes = ['auto', 'none', 'cw', 'ccw'];
let framesChecked = 0;
let maxMatrixDiff = 0;
let maxColorDiff = 0;

for (let p = 0; p < 20; p++) {
  const matA = C.composeMatrix({
    tx: Math.round((rng() - 0.5) * 4000),
    ty: Math.round((rng() - 0.5) * 4000),
    scaleX: 0.4 + rng() * 2.0,
    scaleY: 0.4 + rng() * 2.0,
    rotation: (rng() - 0.5) * Math.PI * 2,
    skewX: (rng() - 0.5) * 0.5
  });
  const matB = C.composeMatrix({
    tx: Math.round((rng() - 0.5) * 4000),
    ty: Math.round((rng() - 0.5) * 4000),
    scaleX: 0.4 + rng() * 2.0,
    scaleY: 0.4 + rng() * 2.0,
    rotation: (rng() - 0.5) * Math.PI * 2,
    skewX: (rng() - 0.5) * 0.5
  });
  const ctA = {
    mr: Math.round(128 + rng() * 256), mg: Math.round(128 + rng() * 256),
    mb: Math.round(128 + rng() * 256), ma: Math.round(128 + rng() * 256),
    ar: Math.round((rng() - 0.5) * 120), ag: Math.round((rng() - 0.5) * 120),
    ab: Math.round((rng() - 0.5) * 120), aa: Math.round((rng() - 0.5) * 120)
  };
  const ctB = {
    mr: Math.round(128 + rng() * 256), mg: Math.round(128 + rng() * 256),
    mb: Math.round(128 + rng() * 256), ma: Math.round(128 + rng() * 256),
    ar: Math.round((rng() - 0.5) * 120), ag: Math.round((rng() - 0.5) * 120),
    ab: Math.round((rng() - 0.5) * 120), aa: Math.round((rng() - 0.5) * 120)
  };
  const instA = { id: 'a', symbolId: 's1', matrix: matA, colorTransform: ctA };
  const instB = { id: 'b', symbolId: 's1', matrix: matB, colorTransform: ctB };
  const useCustom = p % 4 === 0;
  const tween = {
    type: 'motion',
    ease: Math.round((rng() - 0.5) * 200),
    customEase: useCustom ? { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1.0 } : null,
    rotateMode: rotateModes[p % rotateModes.length],
    rotateTimes: p % 3
  };

  for (let f = 0; f <= 12; f++) {
    const t = f / 12;
    const appRes = C.evaluateMotionTween(instA, instB, tween, t, null);
    const orcRes = oracle.oracleInterpolateMotion(instA, instB, tween, t);
    for (const k of ['a', 'b', 'c', 'd', 'tx', 'ty']) {
      const d = Math.abs(appRes.matrix[k] - orcRes.matrix[k]);
      if (d > maxMatrixDiff) maxMatrixDiff = d;
      assert.ok(d <= 2, `Matrix.${k} mismatch on pair ${p} frame ${f}: app=${appRes.matrix[k]} oracle=${orcRes.matrix[k]}`);
    }
    for (const k of ['mr', 'mg', 'mb', 'ma', 'ar', 'ag', 'ab', 'aa']) {
      const d = Math.abs(appRes.colorTransform[k] - orcRes.colorTransform[k]);
      if (d > maxColorDiff) maxColorDiff = d;
      assert.ok(d <= 1, `ColorTransform.${k} mismatch on pair ${p} frame ${f}`);
    }
    framesChecked++;
  }
}

// 3. Explicit shortest-way rotation check (mutant #1): +170 deg -> -170 deg must go through 180 deg, NOT 0 deg!
const deg = (d) => d * Math.PI / 180;
const mStart = C.composeMatrix({ tx: 0, ty: 0, scaleX: 1, scaleY: 1, rotation: deg(170), skewX: 0 });
const mEnd = C.composeMatrix({ tx: 0, ty: 0, scaleX: 1, scaleY: 1, rotation: deg(-170), skewX: 0 });
const midAuto = C.evaluateMotionTween(
  { id: '1', symbolId: 's', matrix: mStart, colorTransform: C.identityColorTransform() },
  { id: '2', symbolId: 's', matrix: mEnd, colorTransform: C.identityColorTransform() },
  { type: 'motion', ease: 0, rotateMode: 'auto', rotateTimes: 0 },
  0.5, null
);
const midDec = C.decomposeMatrix(midAuto.matrix);
assert.ok(Math.abs(Math.abs(midDec.rotation) - Math.PI) < 0.05,
  `Shortest-way rotation failed: expected ~PI, got ${midDec.rotation}`);

// 4. Easing sign check (mutant #2): negative ease = ease-in (< 0.5 at t=0.5), positive = ease-out (> 0.5)
assert.ok(C.applyClassicEase(0.5, -100) < 0.3, 'Ease -100 must be ease-in');
assert.ok(C.applyClassicEase(0.5, 100) > 0.7, 'Ease +100 must be ease-out');

// 5. Shape tween with lettered hints (mutant #3)
const kfA = C.createEmptyKeyframe(0);
kfA.planarMap = C.addFill(kfA.planarMap, C.makeRectPath(0, 0, 1000, 1000), { type: 'solid', color: C.rgba(255, 0, 0, 255) }, null).map;
const kfB = C.createEmptyKeyframe(10);
kfB.planarMap = C.addFill(kfB.planarMap, C.makeRectPath(2000, 0, 1000, 1000), { type: 'solid', color: C.rgba(0, 0, 255, 255) }, null).map;
const hintsNormal = [
  { label: 'a', x0: 0, y0: 0, x1: 2000, y1: 0 },
  { label: 'b', x0: 1000, y0: 1000, x1: 3000, y1: 1000 }
];
const hintsSwapped = [
  { label: 'a', x0: 0, y0: 0, x1: 3000, y1: 1000 },
  { label: 'b', x0: 1000, y0: 1000, x1: 2000, y1: 0 }
];
const morphNormal = C.evaluateShapeTween(kfA, kfB, { type: 'shape', ease: 0, hints: hintsNormal }, 0.5);
const morphSwapped = C.evaluateShapeTween(kfA, kfB, { type: 'shape', ease: 0, hints: hintsSwapped }, 0.5);
assert.notStrictEqual(C.canonicalJson(morphNormal.paths), C.canonicalJson(morphSwapped.paths),
  'Swapping shape hints must alter morphed vertex correspondence');

// 6. Fixed-timestep accumulator playback clock under artificial frame drops (mutant #7)
const clock = C.createPlaybackClock(24, 100, false);
clock.playing = true;
// Simulate 4 heavy dropped frames of 250ms each (= 1000ms total -> MUST advance exactly 24 frames!)
for (let i = 0; i < 4; i++) {
  C.tickPlaybackClock(clock, 250);
}
assert.strictEqual(clock.frame, 24, `Accumulator clock must reach frame 24 after 1000ms at 24fps, got ${clock.frame}`);

const outDir = path.join(__dirname, 'results');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, '04-tween-oracle.json'), JSON.stringify({
  suite: '04-tween-oracle-and-clock',
  passed: true,
  independence: indep,
  pairsTested: 20,
  framesChecked,
  maxMatrixDiffFixed16: maxMatrixDiff,
  maxColorDiff,
  accumulatorFrameAfter1000msAt24fps: clock.frame
}, null, 2));

console.log(`PASS 04-tween-oracle-and-clock (${framesChecked} frames verified, Jaccard=${indep.jaccardSimilarity})`);
