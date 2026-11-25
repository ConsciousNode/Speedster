#!/usr/bin/env node
// 07-reference-rasteriser-goldens.js — Deterministic reference rasteriser golden hashes
// and coverage-based mask verification (NOT bounding box, mutant #16).
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { loadSpeedsterCore } = require('./lib/load-core');
const { renderDocumentFrame } = require('./lib/ref-rasteriser');

const C = loadSpeedsterCore();

// Scene 1: Solid + Linear Gradient + Radial Gradient + Quadratic Curve
function buildScene1() {
  const doc = C.createDocument({ stageWidth: 160 * 20, stageHeight: 120 * 20, fps: 24 });
  const kf = doc.mainTimeline.layers[0].keyframes[0];
  kf.planarMap = C.addFill(kf.planarMap, C.makeRectPath(200, 200, 1200, 800),
    { type: 'solid', color: C.rgba(220, 60, 70, 255) },
    { color: C.rgba(20, 20, 30, 255), width: 40 }).map;
  kf.objects.push({
    id: 'grad_rect',
    paths: [C.makeRectPath(1600, 200, 1200, 800)],
    fill: {
      type: 'linear', x0: 1600, y0: 200, x1: 2800, y1: 1000,
      stops: [
        { offset: 0, color: C.rgba(40, 120, 250, 255) },
        { offset: 1, color: C.rgba(60, 220, 140, 255) }
      ]
    },
    stroke: null,
    matrix: C.identityMatrix()
  });
  kf.objects.push({
    id: 'rad_quad',
    paths: [C.makeEllipsePath(1600, 1700, 700, 450, 8)],
    fill: {
      type: 'radial', x0: 1600, y0: 1700, r0: 0, x1: 1600, y1: 1700, r1: 700,
      stops: [
        { offset: 0, color: C.rgba(255, 220, 40, 255) },
        { offset: 1, color: C.rgba(230, 80, 20, 255) }
      ]
    },
    stroke: { color: C.rgba(30, 30, 30, 255), width: 40 },
    matrix: C.identityMatrix()
  });
  return doc;
}

// Scene 2: Coverage-based Mask (triangle mask over full red rectangle)
// Bounding box of triangle is [200..2200, 200..2200], but pixel (2000, 300) is OUTSIDE triangle!
function buildMaskedScene() {
  const doc = C.createDocument({ stageWidth: 120 * 20, stageHeight: 120 * 20, fps: 24 });
  const maskLyr = C.createLayer(doc, 'TriMask', 'mask', null);
  const contentLyr = doc.mainTimeline.layers[0];
  contentLyr.parentId = maskLyr.id;
  doc.mainTimeline.layers.unshift(maskLyr);

  // Content: big solid red square covering [200..2200, 200..2200]
  contentLyr.keyframes[0].objects.push({
    id: 'red_sq',
    paths: [C.makeRectPath(200, 200, 2000, 2000)],
    fill: { type: 'solid', color: C.rgba(220, 30, 30, 255) },
    stroke: null,
    matrix: C.identityMatrix()
  });

  // Mask: triangle with vertices (200,200), (200,2200), (2200,2200) (lower-left half only)
  maskLyr.keyframes[0].objects.push({
    id: 'tri_mask',
    paths: [[
      { type: 'line', x0: 200, y0: 200, x1: 2200, y1: 2200 },
      { type: 'line', x0: 2200, y0: 2200, x1: 200, y1: 2200 },
      { type: 'line', x0: 200, y0: 2200, x1: 200, y1: 200 }
    ]],
    fill: { type: 'solid', color: C.rgba(0, 0, 0, 255) },
    stroke: null,
    matrix: C.identityMatrix()
  });
  return doc;
}

const s1a = renderDocumentFrame(buildScene1(), 0);
const s1b = renderDocumentFrame(buildScene1(), 0);
assert.strictEqual(s1a.hash, s1b.hash, 'Reference rasteriser must be 100% deterministic');

const s2 = renderDocumentFrame(buildMaskedScene(), 0);
// Check pixel inside triangle: (30, 90) -> should be red (220, 30, 30)
const insideIdx = (90 * s2.width + 30) * 4;
assert.strictEqual(s2.data[insideIdx], 220, 'Pixel inside mask triangle must be red');
assert.strictEqual(s2.data[insideIdx + 1], 30);

// Check pixel inside mask bounding box but OUTSIDE triangle: (90, 30) -> must stay white background (255,255,255)
const outsideIdx = (30 * s2.width + 90) * 4;
assert.strictEqual(s2.data[outsideIdx], 255, 'Pixel outside triangle mask (inside bbox) must NOT be red');
assert.strictEqual(s2.data[outsideIdx + 1], 255);
assert.strictEqual(s2.data[outsideIdx + 2], 255);

const outDir = path.join(__dirname, 'results');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, '07-goldens.json'), JSON.stringify({
  suite: '07-reference-rasteriser-goldens',
  passed: true,
  scene1Hash: s1a.hash,
  scene1Size: `${s1a.width}x${s1a.height}`,
  scene2MaskedHash: s2.hash,
  scene2Size: `${s2.width}x${s2.height}`,
  predeclaredCanvas2DTolerance: {
    maxChannelDiffOnAAEdges: 24,
    minMatchingPixelsPercent: 98.0,
    maxMaskedOutLeakPixels: 0
  }
}, null, 2));

console.log(`PASS 07-reference-rasteriser-goldens (scene1=${s1a.hash.slice(0, 16)}, masked=${s2.hash.slice(0, 16)})`);
