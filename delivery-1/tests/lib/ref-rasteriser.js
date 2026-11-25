// tests/lib/ref-rasteriser.js — Deterministic pure-JS coverage-based anti-aliasing
// reference rasteriser (§7).
// HARD CONSTRAINT: Uses ONLY +, -, *, /, and Math.sqrt.
// Transcendental functions (sin, cos, atan2, exp, log, pow) and non-deterministic RNG are BANNED.

'use strict';

const crypto = require('crypto');

const TWIPS_PER_PX = 20;
const FIXED_ONE = 65536;
const SUBPIXEL = 4; // 4x4 = 16 deterministic coverage samples per pixel

function clampByte(v) {
  if (v < 0) return 0;
  if (v > 255) return 255;
  return v | 0;
}

function applyCT(c, ct) {
  if (!ct) return { r: c.r, g: c.g, b: c.b, a: c.a };
  return {
    r: clampByte(((c.r * ct.mr) >> 8) + ct.ar),
    g: clampByte(((c.g * ct.mg) >> 8) + ct.ag),
    b: clampByte(((c.b * ct.mb) >> 8) + ct.ab),
    a: clampByte(((c.a * ct.ma) >> 8) + ct.aa)
  };
}

function transformPt(m, x, y) {
  if (!m) return { x, y };
  const nx = m.tx + (m.a * x + m.c * y) / FIXED_ONE;
  const ny = m.ty + (m.b * x + m.d * y) / FIXED_ONE;
  return { x: nx, y: ny };
}

// Flatten quadratic Bézier using pure midpoint subdivision (+, -, *, /, Math.sqrt only)
function flattenQuad(x0, y0, cx, cy, x1, y1, out) {
  function rec(ax, ay, qx, qy, bx, by, depth) {
    const mx = (ax + bx) * 0.5;
    const my = (ay + by) * 0.5;
    const dx = qx - mx;
    const dy = qy - my;
    const dev = 0.5 * Math.sqrt(dx * dx + dy * dy);
    if (dev <= 1.0 || depth >= 7) {
      out.push({ x0: ax, y0: ay, x1: bx, y1: by });
      return;
    }
    const c0x = (ax + qx) * 0.5, c0y = (ay + qy) * 0.5;
    const c1x = (qx + bx) * 0.5, c1y = (qy + by) * 0.5;
    const midx = (c0x + c1x) * 0.5, midy = (c0y + c1y) * 0.5;
    rec(ax, ay, c0x, c0y, midx, midy, depth + 1);
    rec(midx, midy, c1x, c1y, bx, by, depth + 1);
  }
  rec(x0, y0, cx, cy, x1, y1, 0);
}

// Evaluate solid / linear / radial fill at twip coordinate (tx, ty)
function sampleFill(fill, tx, ty, ct) {
  if (!fill) return null;
  if (fill.type === 'solid') {
    return applyCT(fill.color, ct);
  }
  const stops = fill.stops || [];
  if (stops.length === 0) return { r: 0, g: 0, b: 0, a: 255 };
  let t = 0;
  if (fill.type === 'linear') {
    const dx = fill.x1 - fill.x0;
    const dy = fill.y1 - fill.y0;
    const len2 = dx * dx + dy * dy;
    t = len2 > 0 ? ((tx - fill.x0) * dx + (ty - fill.y0) * dy) / len2 : 0;
  } else if (fill.type === 'radial') {
    const dx = tx - fill.x0;
    const dy = ty - fill.y0;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const r0 = fill.r0 || 0;
    const r1 = fill.r1 > r0 ? fill.r1 : r0 + 1;
    t = (dist - r0) / (r1 - r0);
  }
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  let c = stops[stops.length - 1].color;
  if (t <= stops[0].offset) {
    c = stops[0].color;
  } else {
    for (let i = 0; i + 1 < stops.length; i++) {
      const s0 = stops[i], s1 = stops[i + 1];
      if (t >= s0.offset && t <= s1.offset) {
        const span = s1.offset - s0.offset;
        const f = span > 0 ? (t - s0.offset) / span : 0;
        c = {
          r: s0.color.r + (s1.color.r - s0.color.r) * f,
          g: s0.color.g + (s1.color.g - s0.color.g) * f,
          b: s0.color.b + (s1.color.b - s0.color.b) * f,
          a: s0.color.a + (s1.color.a - s0.color.a) * f
        };
        break;
      }
    }
  }
  return applyCT(c, ct);
}

// Even-odd point-in-edges test
function pointInEdgesEvenOdd(px, py, edges) {
  let inside = false;
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    if ((e.y0 > py) !== (e.y1 > py)) {
      const xInt = e.x0 + ((py - e.y0) * (e.x1 - e.x0)) / (e.y1 - e.y0);
      if (px < xInt) inside = !inside;
    }
  }
  return inside;
}

// Point-to-segment distance using only +, -, *, /, Math.sqrt
function distPtSeg(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  let t = 0;
  if (len2 > 0) {
    t = ((px - x0) * dx + (py - y0) * dy) / len2;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
  }
  const rx = px - (x0 + t * dx);
  const ry = py - (y0 + t * dy);
  return Math.sqrt(rx * rx + ry * ry);
}

function blendPixel(buf, idx, sr, sg, sb, saNorm) {
  if (saNorm <= 0) return;
  const dr = buf[idx], dg = buf[idx + 1], db = buf[idx + 2], da = buf[idx + 3] / 255;
  const outA = saNorm + da * (1 - saNorm);
  if (outA <= 0) return;
  const invA = 1 / outA;
  buf[idx] = clampByte((sr * saNorm + dr * da * (1 - saNorm)) * invA + 0.5);
  buf[idx + 1] = clampByte((sg * saNorm + dg * da * (1 - saNorm)) * invA + 0.5);
  buf[idx + 2] = clampByte((sb * saNorm + db * da * (1 - saNorm)) * invA + 0.5);
  buf[idx + 3] = clampByte(outA * 255 + 0.5);
}

function rasteriseFilledPolygon(buf, w, h, edges, fill, ct) {
  if (edges.length < 3) return;
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    if (e.x0 < minX) minX = e.x0; if (e.x1 < minX) minX = e.x1;
    if (e.y0 < minY) minY = e.y0; if (e.y1 < minY) minY = e.y1;
    if (e.x0 > maxX) maxX = e.x0; if (e.x1 > maxX) maxX = e.x1;
    if (e.y0 > maxY) maxY = e.y0; if (e.y1 > maxY) maxY = e.y1;
  }
  let px0 = Math.floor(minX / TWIPS_PER_PX); if (px0 < 0) px0 = 0;
  let py0 = Math.floor(minY / TWIPS_PER_PX); if (py0 < 0) py0 = 0;
  let px1 = Math.ceil(maxX / TWIPS_PER_PX); if (px1 > w) px1 = w;
  let py1 = Math.ceil(maxY / TWIPS_PER_PX); if (py1 > h) py1 = h;

  const invTotal = 1 / (SUBPIXEL * SUBPIXEL);
  const subStep = TWIPS_PER_PX / SUBPIXEL;
  const subOff = subStep * 0.5;

  for (let py = py0; py < py1; py++) {
    const baseY = py * TWIPS_PER_PX;
    for (let px = px0; px < px1; px++) {
      const baseX = px * TWIPS_PER_PX;
      let hits = 0;
      for (let sy = 0; sy < SUBPIXEL; sy++) {
        const ty = baseY + sy * subStep + subOff;
        for (let sx = 0; sx < SUBPIXEL; sx++) {
          const tx = baseX + sx * subStep + subOff;
          if (pointInEdgesEvenOdd(tx, ty, edges)) hits++;
        }
      }
      if (hits > 0) {
        const cov = hits * invTotal;
        const c = sampleFill(fill, baseX + TWIPS_PER_PX * 0.5, baseY + TWIPS_PER_PX * 0.5, ct);
        if (c) {
          blendPixel(buf, (py * w + px) * 4, c.r, c.g, c.b, (c.a / 255) * cov);
        }
      }
    }
  }
}

function rasteriseStroke(buf, w, h, edges, stroke, ct) {
  if (!stroke || edges.length === 0) return;
  const halfW = (stroke.width || 20) * 0.5;
  const c = applyCT(stroke.color, ct);
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    if (e.x0 < minX) minX = e.x0; if (e.x1 < minX) minX = e.x1;
    if (e.y0 < minY) minY = e.y0; if (e.y1 < minY) minY = e.y1;
    if (e.x0 > maxX) maxX = e.x0; if (e.x1 > maxX) maxX = e.x1;
    if (e.y0 > maxY) maxY = e.y0; if (e.y1 > maxY) maxY = e.y1;
  }
  let px0 = Math.floor((minX - halfW) / TWIPS_PER_PX) - 1; if (px0 < 0) px0 = 0;
  let py0 = Math.floor((minY - halfW) / TWIPS_PER_PX) - 1; if (py0 < 0) py0 = 0;
  let px1 = Math.ceil((maxX + halfW) / TWIPS_PER_PX) + 1; if (px1 > w) px1 = w;
  let py1 = Math.ceil((maxY + halfW) / TWIPS_PER_PX) + 1; if (py1 > h) py1 = h;

  const invTotal = 1 / (SUBPIXEL * SUBPIXEL);
  const subStep = TWIPS_PER_PX / SUBPIXEL;
  const subOff = subStep * 0.5;

  for (let py = py0; py < py1; py++) {
    const baseY = py * TWIPS_PER_PX;
    for (let px = px0; px < px1; px++) {
      const baseX = px * TWIPS_PER_PX;
      let hits = 0;
      for (let sy = 0; sy < SUBPIXEL; sy++) {
        const ty = baseY + sy * subStep + subOff;
        for (let sx = 0; sx < SUBPIXEL; sx++) {
          const tx = baseX + sx * subStep + subOff;
          for (let i = 0; i < edges.length; i++) {
            const e = edges[i];
            if (distPtSeg(tx, ty, e.x0, e.y0, e.x1, e.y1) <= halfW) {
              hits++;
              break;
            }
          }
        }
      }
      if (hits > 0) {
        blendPixel(buf, (py * w + px) * 4, c.r, c.g, c.b, (c.a / 255) * hits * invTotal);
      }
    }
  }
}

function collectLayerGeometry(kf, mat) {
  const fills = [];
  const strokes = [];
  if (kf.planarMap) {
    const map = kf.planarMap;
    const vById = new Map();
    for (let i = 0; i < map.vertices.length; i++) vById.set(map.vertices[i].id, map.vertices[i]);
    const edgeMap = new Map();
    for (let i = 0; i < map.edges.length; i++) {
      const e = map.edges[i];
      edgeMap.set(Math.min(e.u, e.v) + ':' + Math.max(e.u, e.v), e);
    }
    for (let f = 0; f < map.faces.length; f++) {
      const face = map.faces[f];
      if (!face.fill) continue;
      const flatEdges = [];
      const cycles = [face.outer].concat(face.holes || []);
      for (let ci = 0; ci < cycles.length; ci++) {
        const cyc = cycles[ci];
        for (let i = 0; i < cyc.length; i++) {
          const aId = cyc[i], bId = cyc[(i + 1) % cyc.length];
          const va = transformPt(mat, vById.get(aId).x, vById.get(aId).y);
          const vb = transformPt(mat, vById.get(bId).x, vById.get(bId).y);
          const e = edgeMap.get(Math.min(aId, bId) + ':' + Math.max(aId, bId));
          if (e && e.cx !== null && e.cx !== undefined) {
            const vc = transformPt(mat, e.cx, e.cy);
            flattenQuad(va.x, va.y, vc.x, vc.y, vb.x, vb.y, flatEdges);
          } else {
            flatEdges.push({ x0: va.x, y0: va.y, x1: vb.x, y1: vb.y });
          }
        }
      }
      fills.push({ edges: flatEdges, fill: face.fill });
    }
    for (let i = 0; i < map.edges.length; i++) {
      const e = map.edges[i];
      if (!e.stroke) continue;
      const va = transformPt(mat, vById.get(e.u).x, vById.get(e.u).y);
      const vb = transformPt(mat, vById.get(e.v).x, vById.get(e.v).y);
      const flat = [];
      if (e.cx !== null && e.cx !== undefined) {
        const vc = transformPt(mat, e.cx, e.cy);
        flattenQuad(va.x, va.y, vc.x, vc.y, vb.x, vb.y, flat);
      } else {
        flat.push({ x0: va.x, y0: va.y, x1: vb.x, y1: vb.y });
      }
      strokes.push({ edges: flat, stroke: e.stroke });
    }
  }
  if (kf.objects) {
    for (let oi = 0; oi < kf.objects.length; oi++) {
      const obj = kf.objects[oi];
      const flat = [];
      for (let pi = 0; pi < obj.paths.length; pi++) {
        const segs = obj.paths[pi];
        for (let si = 0; si < segs.length; si++) {
          const s = segs[si];
          const p0 = transformPt(obj.matrix, s.x0, s.y0);
          const p1 = transformPt(obj.matrix, s.x1, s.y1);
          if (s.type === 'quad') {
            const pc = transformPt(obj.matrix, s.cx, s.cy);
            flattenQuad(p0.x, p0.y, pc.x, pc.y, p1.x, p1.y, flat);
          } else {
            flat.push({ x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y });
          }
        }
      }
      if (obj.fill) fills.push({ edges: flat, fill: obj.fill });
      if (obj.stroke) strokes.push({ edges: flat, stroke: obj.stroke });
    }
  }
  return { fills, strokes };
}

function getActiveKeyframe(layer, frame) {
  let active = null;
  for (let i = 0; i < layer.keyframes.length; i++) {
    if (layer.keyframes[i].frame <= frame) active = layer.keyframes[i];
    else break;
  }
  return active;
}

function renderLayerIntoBuffer(buf, w, h, layer, frame, ct, solidWhiteOverride) {
  if (!layer || !layer.visible || layer.type === 'folder' || layer.type === 'guide') return;
  const kf = getActiveKeyframe(layer, frame);
  if (!kf) return;
  const geom = collectLayerGeometry(kf, null);
  for (let i = 0; i < geom.fills.length; i++) {
    const f = solidWhiteOverride ? { type: 'solid', color: { r: 255, g: 255, b: 255, a: 255 } } : geom.fills[i].fill;
    rasteriseFilledPolygon(buf, w, h, geom.fills[i].edges, f, solidWhiteOverride ? null : ct);
  }
  for (let i = 0; i < geom.strokes.length; i++) {
    const st = solidWhiteOverride
      ? { color: { r: 255, g: 255, b: 255, a: 255 }, width: geom.strokes[i].stroke.width }
      : geom.strokes[i].stroke;
    rasteriseStroke(buf, w, h, geom.strokes[i].edges, st, solidWhiteOverride ? null : ct);
  }
}

// Render document frame with exact coverage-based masks (NOT bounding boxes!)
function renderDocumentFrame(doc, frame) {
  const w = Math.round(doc.stageWidth / TWIPS_PER_PX);
  const h = Math.round(doc.stageHeight / TWIPS_PER_PX);
  const buf = new Uint8Array(w * h * 4);
  const bg = doc.background || { r: 255, g: 255, b: 255, a: 255 };
  for (let i = 0; i < w * h; i++) {
    buf[i * 4] = bg.r;
    buf[i * 4 + 1] = bg.g;
    buf[i * 4 + 2] = bg.b;
    buf[i * 4 + 3] = bg.a;
  }

  const layers = doc.mainTimeline.layers;
  const maskIds = new Set(layers.filter((l) => l.type === 'mask' && l.visible).map((l) => l.id));
  const maskedBy = new Map();
  for (const id of maskIds) maskedBy.set(id, []);
  for (let i = 0; i < layers.length; i++) {
    if (layers[i].parentId && maskedBy.has(layers[i].parentId)) {
      maskedBy.get(layers[i].parentId).push(layers[i]);
    }
  }

  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    if (!layer.visible) continue;
    if (layer.parentId && maskIds.has(layer.parentId)) continue;

    if (layer.type === 'mask') {
      const children = maskedBy.get(layer.id) || [];
      if (children.length === 0) continue;
      // Coverage-based mask compositing
      const contentBuf = new Uint8Array(w * h * 4);
      for (let ci = children.length - 1; ci >= 0; ci--) {
        renderLayerIntoBuffer(contentBuf, w, h, children[ci], frame, null, false);
      }
      const maskBuf = new Uint8Array(w * h * 4);
      renderLayerIntoBuffer(maskBuf, w, h, layer, frame, null, true);
      // Composite content * maskAlpha onto main buffer
      for (let p = 0; p < w * h; p++) {
        const idx = p * 4;
        const maskCov = maskBuf[idx + 3] / 255;
        if (maskCov <= 0 || contentBuf[idx + 3] === 0) continue;
        const effAlpha = (contentBuf[idx + 3] / 255) * maskCov;
        blendPixel(buf, idx, contentBuf[idx], contentBuf[idx + 1], contentBuf[idx + 2], effAlpha);
      }
      continue;
    }

    renderLayerIntoBuffer(buf, w, h, layer, frame, null, false);
  }

  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  return { width: w, height: h, data: buf, hash: sha256 };
}

module.exports = {
  renderDocumentFrame
};
