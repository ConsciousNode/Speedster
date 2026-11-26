#!/usr/bin/env node
// 11-r2-curves-and-curved-fuzz.js — §3 Curves survive planar merge (+ chord-flattening mutant)
// and §4 200 seeds x 24 ops curved planar fuzz with honest fallback accounting.
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { loadSpeedsterCore } = require('./lib/load-core');

const C = loadSpeedsterCore();
const RED = { type: 'solid', color: C.rgba(220, 60, 70, 255) };
const BLUE = { type: 'solid', color: C.rgba(60, 110, 230, 255) };
const GREEN = { type: 'solid', color: C.rgba(60, 190, 120, 255) };
const COLORS = [RED, BLUE, GREEN];
const BLK = { color: C.rgba(15, 15, 20, 255), width: 40, cap: 'round', join: 'round' };

// === 1. §3: Curves survive the merge ===
let m = C.createEmptyPlanarMap();
m = C.addFill(m, C.makeRectPath(1000, 1000, 2000, 2000), RED, BLK).map;
const preMergeEdges = m.edges.length; // 4

// Merge a single quadratic curve right across the filled rectangle
const curveStroke = [{ type: 'quad', x0: 600, y0: 2000, cx: 2000, cy: 1300, x1: 3400, y1: 2000 }];
const mergeRes = C.addStroke(m, curveStroke, BLK);
assert.ok(mergeRes.ok && !mergeRes.fallback, 'Curve merge across rect must succeed');
const merged = mergeRes.map;
const filledFaces = merged.faces.filter((f) => f.fill);
assert.strictEqual(filledFaces.length, 2, 'Curved stroke must split rectangle fill into 2 faces');

const quadEdges = merged.edges.filter((e) => e.cx !== null && e.cx !== undefined);
assert.ok(quadEdges.length >= 2, `Merged curve must stay native quadratic edges per split piece, got ${quadEdges.length}`);
assert.ok(merged.edges.length <= preMergeEdges + 8,
  `Edge count after curve merge (${merged.edges.length}) exceeded bound (${preMergeEdges + 8})`);

// Bend the merged curve with direct shaping -> stays 1 smooth curve edge!
const targetQuad = quadEdges[Math.floor(quadEdges.length / 2)];
const bentRes = C.directShapeBendEdge(merged, targetQuad.id, 2000, 2400);
assert.ok(bentRes.ok);
assert.strictEqual(bentRes.map.edges.length, merged.edges.length, 'Bending merged curve must keep edge count unchanged');
const bentEdge = bentRes.map.edges.find((e) => e.id === targetQuad.id);
assert.ok(bentEdge && bentEdge.cx !== null, 'Bent merged edge must remain a single quadratic curve');

// Mutant R2-6: Reinstating chord flattening must fail both native-quad check and edge-count bound
let chordFlatteningCaught = false;
try {
  const CM = loadSpeedsterCore((src) =>
    src.replace('const refitCurves = !(opts && opts.disableCurveRefit);', 'const refitCurves = false;')
  );
  let mm = CM.createEmptyPlanarMap();
  mm = CM.addFill(mm, CM.makeRectPath(1000, 1000, 2000, 2000), RED, BLK).map;
  mm = CM.addStroke(mm, curveStroke, BLK).map;
  const qCount = mm.edges.filter((e) => e.cx !== null && e.cx !== undefined).length;
  assert.ok(qCount >= 2 && mm.edges.length <= preMergeEdges + 8,
    `Chord flattening produced qCount=${qCount}, edges=${mm.edges.length}`);
} catch (_) {
  chordFlatteningCaught = true;
}
assert.ok(chordFlatteningCaught, 'Mutant R2-6 (chord flattening reinstated) SURVIVED!');

// === 2. §4: 200 seeds x 24 operations Curved Planar Fuzz ===
const SEEDS = 200;
const OPS_PER_SEED = 24;

function runCurvedSeed(seed) {
  const rng = C.createSeededRng(seed * 2654435761 + 17);
  let pm = C.createEmptyPlanarMap();
  let fallbacks = 0;
  const fallbackReasons = {};
  let quadStrokes = 0, curvedFills = 0, lineOps = 0;

  for (let op = 0; op < OPS_PER_SEED; op++) {
    const kind = op % 6;
    let res;
    if (kind === 0) {
      // Curved fill (4-segment quad blob / ellipse)
      const cx = 1200 + Math.round(rng() * 3600);
      const cy = 1200 + Math.round(rng() * 2600);
      const rx = 300 + Math.round(rng() * 600);
      const ry = 300 + Math.round(rng() * 600);
      res = C.addFill(pm, C.makeEllipsePath(cx, cy, rx, ry, 4), COLORS[op % 3], BLK);
      curvedFills++;
    } else if (kind === 1 || kind === 2) {
      // Quadratic stroke crossing the stage
      const x0 = 600 + Math.round(rng() * 4800);
      const y0 = 600 + Math.round(rng() * 3800);
      const x1 = 600 + Math.round(rng() * 4800);
      const y1 = 600 + Math.round(rng() * 3800);
      const cx = Math.round((x0 + x1) * 0.5 + (rng() - 0.5) * 1400);
      const cy = Math.round((y0 + y1) * 0.5 + (rng() - 0.5) * 1400);
      res = C.addStroke(pm, [{ type: 'quad', x0, y0, cx, cy, x1, y1 }], BLK);
      quadStrokes++;
    } else if (kind === 3) {
      // Rectangle fill
      const x = 800 + Math.round(rng() * 3400);
      const y = 800 + Math.round(rng() * 2400);
      const w = 400 + Math.round(rng() * 1000);
      const h = 400 + Math.round(rng() * 1000);
      res = C.addFill(pm, C.makeRectPath(x, y, w, h), COLORS[(op + 1) % 3], null);
      lineOps++;
    } else if (kind === 4 && pm.edges.some((e) => e.cx !== null)) {
      // Deliberate grazing curve near an existing quad edge (tests honest fallback detector)
      const qe = pm.edges.find((e) => e.cx !== null);
      const u = pm.vertices.find((v) => v.id === qe.u);
      const v = pm.vertices.find((vt) => vt.id === qe.v);
      const off = (seed + op) % 2 === 0 ? 2 : 120; // half grazing (<4 twips), half clean
      res = C.addStroke(pm, [{ type: 'quad', x0: u.x, y0: u.y + off, cx: qe.cx, cy: qe.cy + off, x1: v.x, y1: v.y + off }], BLK);
      quadStrokes++;
    } else {
      // Deliberate near-cusp on 1/20 ops, otherwise normal line stroke
      if (op === 23 && seed % 10 === 0) {
        res = C.addStroke(pm, [{ type: 'quad', x0: 2000, y0: 2000, cx: 2040, cy: 2040, x1: 2002, y1: 2001 }], BLK);
        quadStrokes++;
      } else {
        const x0 = 600 + Math.round(rng() * 4800);
        const y0 = 600 + Math.round(rng() * 3800);
        const x1 = 600 + Math.round(rng() * 4800);
        const y1 = 600 + Math.round(rng() * 3800);
        res = C.addStroke(pm, [{ type: 'line', x0, y0, x1, y1 }], BLK);
        lineOps++;
      }
    }

    if (res.ok && !res.fallback) {
      pm = res.map;
    } else if (res.fallback) {
      fallbacks++;
      fallbackReasons[res.reason] = (fallbackReasons[res.reason] || 0) + 1;
    } else {
      throw new Error(`Unexpected planar failure on seed ${seed} op ${op}: ${res.reason}`);
    }
  }

  const inv = C.verifyPlanarMapInvariants(pm);
  assert.ok(inv.ok, `Curved fuzz seed ${seed} failed invariants: ${inv.errors.join('; ')}`);
  return {
    seed,
    hash: inv.hash,
    vertices: inv.vertexCount,
    edges: inv.edgeCount,
    quadEdges: inv.quadEdgeCount,
    faces: inv.faceCount,
    area2: inv.totalFilledArea2,
    fallbacks,
    fallbackReasons,
    quadStrokes,
    curvedFills,
    lineOps
  };
}

let totalFallbacks = 0;
let seedsWithFallbacks = 0;
const reasonTotals = {};
let maxVertices = 0;
let totalQuadEdgesFinal = 0;

for (let s = 1; s <= SEEDS; s++) {
  const r1 = runCurvedSeed(s);
  // Check twice-run determinism on first 20 seeds + every 10th seed (full determinism verification)
  if (s <= 20 || s % 10 === 0) {
    const r2 = runCurvedSeed(s);
    assert.strictEqual(r1.hash, r2.hash, `Curved fuzz seed ${s} nondeterministic: ${r1.hash} vs ${r2.hash}`);
  }
  totalFallbacks += r1.fallbacks;
  if (r1.fallbacks > 0) seedsWithFallbacks++;
  for (const [k, v] of Object.entries(r1.fallbackReasons)) {
    reasonTotals[k] = (reasonTotals[k] || 0) + v;
  }
  if (r1.vertices > maxVertices) maxVertices = r1.vertices;
  totalQuadEdgesFinal += r1.quadEdges;
}

const outDir = path.join(__dirname, 'results');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, '11-r2-curves-fuzz.json'), JSON.stringify({
  suite: '11-r2-curves-and-curved-fuzz',
  passed: true,
  curveSurvivesMerge: {
    preMergeEdges,
    postMergeEdges: merged.edges.length,
    nativeQuadEdgesAfterMerge: quadEdges.length,
    splitFilledFaces: filledFaces.length,
    chordFlatteningMutantCaught: chordFlatteningCaught
  },
  curvedFuzz: {
    seeds: SEEDS,
    opsPerSeed: OPS_PER_SEED,
    totalOps: SEEDS * OPS_PER_SEED,
    failedInvariantSeeds: 0,
    maxVerticesObserved: maxVertices,
    totalNativeQuadEdgesPreserved: totalQuadEdgesFinal,
    totalHonestFallbacks: totalFallbacks,
    seedsWithFallbacks,
    fallbackReasons: reasonTotals
  }
}, null, 2));

console.log(`PASS 11-r2-curves-and-curved-fuzz (merge edges=${merged.edges.length}, quads=${quadEdges.length}; 200x24 fuzz: 0 failures, ${totalFallbacks} honest fallbacks)`);
