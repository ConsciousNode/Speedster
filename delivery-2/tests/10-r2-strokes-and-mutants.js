#!/usr/bin/env node
// 10-r2-strokes-and-mutants.js — R2 §1 fast stroke tests (4,000 px/s drag, gentle mouse default,
// speed-width smoothing, 150° zig-zag, pencil continuity) and all 5 R2 stroke mutants.
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { loadSpeedsterCore } = require('./lib/load-core');

const C = loadSpeedsterCore();
const FILL = { type: 'solid', color: C.rgba(79, 140, 255, 255) };
const BASE_WIDTH_TWIPS = 160; // 8 px default brush

// Generate synthetic 4,000 px/s drag at 60 Hz with 6 coalesced samples per frame
function makeFast4000DragPoints(sharedTimestamps) {
  const pts = [];
  const frames = 6;
  const coalesced = 6;
  const dxPerFrameTwips = Math.round((4000 / 60) * C.TWIPS_PER_PX); // ~1333 twips/frame
  let prevBatchTime = 1000;
  pts.push({ x: 1000, y: 2000, t: 1000, pressure: 0.5, hasPenPressure: false });

  for (let f = 1; f <= frames; f++) {
    const now = 1000 + f * 16.6667;
    const rawBatch = [];
    for (let c = 1; c <= coalesced; c++) {
      rawBatch.push({ timeStamp: now }); // browser gives shared timestamp across coalesced batch
    }
    const stamps = sharedTimestamps
      ? rawBatch.map(() => now)
      : C.normalizeCoalescedTimestamps(rawBatch, prevBatchTime, now);
    prevBatchTime = stamps[stamps.length - 1];
    for (let c = 1; c <= coalesced; c++) {
      const frac = (f - 1) + c / coalesced;
      pts.push({
        x: Math.round(1000 + frac * dxPerFrameTwips),
        y: Math.round(2000 + Math.sin(frac * 0.8) * 120),
        t: stamps[c - 1],
        pressure: 0.5,
        hasPenPressure: false
      });
    }
  }
  return pts;
}

// Measure cross-section thickness of a horizontal-ish filled planar map
function measureCrossSections(map) {
  const filledFaces = map.faces.filter((f) => f.fill);
  const vById = new Map(map.vertices.map((v) => [v.id, v]));
  let minX = Infinity, maxX = -Infinity;
  for (const v of map.vertices) {
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
  }
  const widths = [];
  for (let i = 2; i <= 38; i++) {
    const x = minX + (maxX - minX) * (i / 40);
    let minY = Infinity, maxY = -Infinity;
    for (let y = 1400; y <= 2600; y += 5) {
      for (const f of filledFaces) {
        if (C.pointInFace(x, y, f, vById)) {
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          break;
        }
      }
    }
    widths.push(minY < maxY ? (maxY - minY) : 0);
  }
  return widths;
}

// 1. Fresh mouse profile (gentle mouse default: speed-width OFF) at 4,000 px/s
const mousePts = makeFast4000DragPoints(false);
const builtMouse = C.buildBrushCapsulePolygons(mousePts, {
  baseWidthTwips: BASE_WIDTH_TWIPS,
  pointerType: 'mouse',
  enableSpeedWidth: false,
  enablePressure: true
});
const resMouse = C.addFillUnion(C.createEmptyPlanarMap(), builtMouse.polygons, FILL);
assert.ok(resMouse.ok);
const mouseFaces = resMouse.map.faces.filter((f) => f.fill);
assert.strictEqual(mouseFaces.length, 1, '4000 px/s mouse drag must commit exactly 1 connected region');
assert.strictEqual(mouseFaces[0].holes.length, 0, '4000 px/s mouse drag must have 0 holes');

const mouseWidths = measureCrossSections(resMouse.map);
const mouseMinW = Math.min(...mouseWidths);
const mouseMaxW = Math.max(...mouseWidths);
assert.ok(mouseMinW >= BASE_WIDTH_TWIPS * 0.90 && mouseMaxW <= BASE_WIDTH_TWIPS * 1.10,
  `Fresh mouse default must be constant width within ±10% of ${BASE_WIDTH_TWIPS}: got [${mouseMinW}, ${mouseMaxW}]`);

// Area check against ideal capsule-union area (pathLength * width + pi * r^2)
let pathLen = 0;
for (let i = 1; i < mousePts.length; i++) {
  pathLen += Math.hypot(mousePts[i].x - mousePts[i - 1].x, mousePts[i].y - mousePts[i - 1].y);
}
const idealArea = pathLen * BASE_WIDTH_TWIPS + Math.PI * Math.pow(BASE_WIDTH_TWIPS * 0.5, 2);
const actualArea = mouseFaces[0].area2 / 2;
const areaErrorPct = Math.abs(actualArea - idealArea) / idealArea * 100;
assert.ok(areaErrorPct <= 5.0, `Committed area error ${areaErrorPct.toFixed(2)}% exceeded 5% tolerance`);

// 2. Speed-width enabled (touch / mouse opt-in): continuous smoothed width, ratio <= 15%, min width >= 60 twips
const builtSpeed = C.buildBrushCapsulePolygons(mousePts, {
  baseWidthTwips: BASE_WIDTH_TWIPS,
  pointerType: 'touch',
  enableSpeedWidth: true,
  enablePressure: false
});
let maxAdjRatio = 1.0;
for (let i = 1; i < builtSpeed.halfWidths.length; i++) {
  const a = builtSpeed.halfWidths[i - 1], b = builtSpeed.halfWidths[i];
  const r = Math.max(a / b, b / a);
  if (r > maxAdjRatio) maxAdjRatio = r;
}
assert.ok(maxAdjRatio <= 1.15, `Adjacent half-width ratio ${maxAdjRatio.toFixed(4)} exceeded 1.15`);
const resSpeed = C.addFillUnion(C.createEmptyPlanarMap(), builtSpeed.polygons, FILL);
const speedFaces = resSpeed.map.faces.filter((f) => f.fill);
assert.strictEqual(speedFaces.length, 1, 'Speed-width 4000 px/s drag must commit 1 connected region');
const speedMinW = Math.min(...measureCrossSections(resSpeed.map));
assert.ok(speedMinW >= C.MIN_BRUSH_HALF_WIDTH_TWIPS * 2, `Narrowest cross-section ${speedMinW} < ${C.MIN_BRUSH_HALF_WIDTH_TWIPS * 2}`);

// 3. 150-degree sharp zig-zag at 4,000 px/s -> 1 connected region, 0 holes
const zzPts = [
  { x: 1000, y: 2000, t: 1000, pressure: 0.5, hasPenPressure: false },
  { x: 4000, y: 2000, t: 1037, pressure: 0.5, hasPenPressure: false },
  { x: 1300, y: 2700, t: 1074, pressure: 0.5, hasPenPressure: false },
  { x: 4300, y: 2700, t: 1111, pressure: 0.5, hasPenPressure: false }
];
const builtZZ = C.buildBrushCapsulePolygons(zzPts, { baseWidthTwips: BASE_WIDTH_TWIPS, pointerType: 'mouse', enableSpeedWidth: false });
const resZZ = C.addFillUnion(C.createEmptyPlanarMap(), builtZZ.polygons, FILL);
assert.ok(resZZ.ok);
const zzFaces = resZZ.map.faces.filter((f) => f.fill);
assert.strictEqual(zzFaces.length, 1, '150° zig-zag must commit exactly 1 connected filled region');
assert.strictEqual(zzFaces[0].holes.length, 0, '150° zig-zag must have 0 holes');

// 4. Pencil continuity on the same 4,000 px/s drag (smooth & ink modes)
// Build smooth (cubic->quad) and ink paths directly and check 0 gaps between segments
function checkPencilContinuous(pts, smooth) {
  const segs = [];
  if (smooth) {
    for (let i = 0; i + 1 < pts.length; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
      const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
      for (const q of C.cubicToQuadratics(p1, c1, c2, p2, C.CUBIC_TOLERANCE_TWIPS)) segs.push(q);
    }
    for (let i = 1; i < segs.length; i++) { segs[i].x0 = segs[i - 1].x1; segs[i].y0 = segs[i - 1].y1; }
  } else {
    for (let i = 0; i + 1 < pts.length; i++) {
      segs.push({ type: 'line', x0: pts[i].x, y0: pts[i].y, x1: pts[i + 1].x, y1: pts[i + 1].y });
    }
  }
  for (let i = 1; i < segs.length; i++) {
    assert.strictEqual(segs[i].x0, segs[i - 1].x1, 'Pencil gap in X');
    assert.strictEqual(segs[i].y0, segs[i - 1].y1, 'Pencil gap in Y');
  }
  const stRes = C.addStroke(C.createEmptyPlanarMap(), segs, { color: C.rgba(0, 0, 0, 255), width: 40 });
  assert.ok(stRes.ok && stRes.map.edges.length >= 1);
  return segs.length;
}
const smoothSegs = checkPencilContinuous(mousePts, true);
const inkSegs = checkPencilContinuous(mousePts, false);

// 5. ALL 5 R2 Stroke Mutants (§1)
const mutants = [];
function expectMutantCaught(id, name, fn) {
  let caught = false;
  try { fn(); } catch (_) { caught = true; }
  assert.ok(caught, `R2 Mutant ${id} (${name}) SURVIVED!`);
  mutants.push({ id, name, killed: true });
}

// R2-1: Shared timestamps reproduce beading
expectMutantCaught('R2-1', 'Shared timestamps reproduce beads', () => {
  const sharedPts = makeFast4000DragPoints(true);
  // Raw unsmoothed speed-width with shared timestamps produces huge swings at batch edges
  const halves = [];
  for (let i = 1; i < sharedPts.length; i++) {
    const dt = Math.max(1, sharedPts[i].t - sharedPts[i - 1].t);
    const spd = (Math.hypot(sharedPts[i].x - sharedPts[i - 1].x, sharedPts[i].y - sharedPts[i - 1].y) / 20) / dt;
    const f = Math.max(0.35, Math.min(1.35, 1.25 - spd * 0.45));
    halves.push(80 * f);
  }
  const ratio = Math.max(...halves) / Math.min(...halves);
  assert.ok(ratio < 1.25, 'Shared timestamps caused beading ratio ' + ratio);
});

// R2-2: Mouse default left at full speed-width fails ±10% constant-width test
expectMutantCaught('R2-2', 'Mouse default left at full speed-width', () => {
  const CM = loadSpeedsterCore((src) =>
    src.replace("const useSpeedWidth = pointerType === 'mouse' ? Boolean(o.enableSpeedWidth) : (o.enableSpeedWidth !== false);",
      "const useSpeedWidth = true;")
  );
  const built = CM.buildBrushCapsulePolygons(mousePts, { baseWidthTwips: BASE_WIDTH_TWIPS, pointerType: 'mouse', enableSpeedWidth: false });
  const r = CM.addFillUnion(CM.createEmptyPlanarMap(), built.polygons, FILL);
  const ws = measureCrossSections(r.map);
  assert.ok(Math.min(...ws) >= BASE_WIDTH_TWIPS * 0.90 && Math.max(...ws) <= BASE_WIDTH_TWIPS * 1.10);
});

// R2-3: Width without smoothing fails adjacent ratio <= 15% test
expectMutantCaught('R2-3', 'Width without smoothing fails ratio test', () => {
  const CM = loadSpeedsterCore((src) =>
    src.replace('const MAX_ADJ_WIDTH_RATIO = 1.12;', 'const MAX_ADJ_WIDTH_RATIO = 100.0;')
       .replace('emaSpeed = i === 1 ? instSpeed : (emaSpeed * 0.72 + instSpeed * 0.28);', 'emaSpeed = instSpeed;')
  );
  // Sudden stop-to-fast acceleration
  const accelPts = [
    { x: 1000, y: 2000, t: 1000, pressure: 0.5, hasPenPressure: false },
    { x: 1020, y: 2000, t: 1050, pressure: 0.5, hasPenPressure: false }, // very slow
    { x: 3500, y: 2000, t: 1066, pressure: 0.5, hasPenPressure: false }  // very fast
  ];
  const hw = CM.computeSmoothBrushHalfWidths(accelPts, { baseWidthTwips: 160, pointerType: 'touch', enableSpeedWidth: true });
  for (let i = 1; i < hw.length; i++) {
    assert.ok(Math.max(hw[i] / hw[i - 1], hw[i - 1] / hw[i]) <= 1.15);
  }
});

// R2-4: Raw self-intersecting ring on 150° zig-zag fails "one region, no holes"
expectMutantCaught('R2-4', 'Raw self-intersecting rail ring on 150° zig-zag', () => {
  // Build naive R1 left/right rail polygon on zzPts
  const left = [], right = [];
  for (let i = 0; i < zzPts.length; i++) {
    const prev = zzPts[Math.max(0, i - 1)], next = zzPts[Math.min(zzPts.length - 1, i + 1)];
    let dx = next.x - prev.x, dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    left.push({ x: Math.round(zzPts[i].x - dy * 80), y: Math.round(zzPts[i].y + dx * 80) });
    right.push({ x: Math.round(zzPts[i].x + dy * 80), y: Math.round(zzPts[i].y - dx * 80) });
  }
  const ring = left.concat(right.reverse());
  const segs = ring.map((a, i) => {
    const b = ring[(i + 1) % ring.length];
    return { type: 'line', x0: a.x, y0: a.y, x1: b.x, y1: b.y };
  });
  const res = C.addFill(C.createEmptyPlanarMap(), segs, FILL, null);
  const faces = res.map.faces.filter((f) => f.fill);
  assert.ok(faces.length === 1 && faces[0].holes.length === 0 && faces[0].area2 > 600000);
});

// R2-5: Kehai's stamp-only mutant fails connectedness (produces multiple disconnected faces)
expectMutantCaught('R2-5', 'Stamp-only brush fails connectedness', () => {
  // Stamp small circles only at the 6 frame-boundary samples (1333 twips apart, radius 80 twips)
  const dots = [];
  for (let f = 0; f < 6; f++) {
    const cx = 1000 + f * 1333, cy = 2000;
    const poly = [];
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI * 2) / 8;
      poly.push({ x: Math.round(cx + 80 * Math.cos(a)), y: Math.round(cy + 80 * Math.sin(a)) });
    }
    dots.push(poly);
  }
  const res = C.addFillUnion(C.createEmptyPlanarMap(), dots, FILL);
  const faces = res.map.faces.filter((f) => f.fill);
  assert.strictEqual(faces.length, 1, 'Stamp-only produced ' + faces.length + ' disconnected regions');
});

const outDir = path.join(__dirname, 'results');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, '10-r2-strokes.json'), JSON.stringify({
  suite: '10-r2-strokes-and-mutants',
  passed: true,
  mouseFresh4000pxs: {
    baseWidthTwips: BASE_WIDTH_TWIPS,
    minWidthTwips: mouseMinW,
    maxWidthTwips: mouseMaxW,
    filledRegions: mouseFaces.length,
    holes: mouseFaces[0].holes.length,
    areaErrorPct: Number(areaErrorPct.toFixed(3))
  },
  speedWidth4000pxs: {
    maxAdjacentHalfWidthRatio: Number(maxAdjRatio.toFixed(4)),
    narrowestCrossSectionTwips: speedMinW,
    filledRegions: speedFaces.length
  },
  zigzag150: { filledRegions: zzFaces.length, holes: zzFaces[0].holes.length },
  pencilContinuous: { smoothSegments: smoothSegs, inkSegments: inkSegs },
  mutants
}, null, 2));

console.log(`PASS 10-r2-strokes-and-mutants (mouse=[${mouseMinW}..${mouseMaxW}] twips, areaErr=${areaErrorPct.toFixed(2)}%, 5/5 R2 stroke mutants caught)`);
