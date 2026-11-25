// Kehai's planar-map probe for Speedster delivery 1. Much bigger than the delivered fuzz (18 strokes, 1 seed):
// for each seed, random axis-aligned rectangle fills in 3 colours plus random line and polyline strokes across them.
// Independent oracles written here:
//   (a) total filled area must equal the exact union area of the rectangles (coordinate compression, integers);
//       strokes split faces but must never add or remove fill;
//   (b) no two edges cross except at shared vertices (exact BigInt orientation on line edges);
//   (c) the same seed run twice gives an identical serialized map.
// Also runs the delivery's own verifyPlanarMapInvariants and counts honest fallbacks.
// Usage: node planar-fuzz.js <speedster.html> [seeds] [ops]
const fs = require('fs'), vm = require('vm');
const html = fs.readFileSync(process.argv[2], 'utf8');
const SEEDS = +(process.argv[3] || 200), OPS = +(process.argv[4] || 24);
const src = html.match(/<script id="speedster-core">([\s\S]*?)<\/script>/)[1];
const ctx = { console, Math, Number, BigInt, Array, Object, Map, Set, Uint8Array, Int32Array, Float32Array, ArrayBuffer, DataView, JSON, String, Error, Buffer, parseInt, parseFloat, isNaN, isFinite };
ctx.window = ctx; ctx.globalThis = ctx; vm.runInNewContext(src, ctx);
const C = ctx.SpeedsterCore;
function rng(s) { s >>>= 0; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; }; }
function unionArea(rects) {
  const xs = [...new Set(rects.flatMap(r => [r[0], r[0] + r[2]]))].sort((a, b) => a - b);
  let A = 0;
  for (let i = 0; i + 1 < xs.length; i++) {
    const x0 = xs[i], x1 = xs[i + 1], iv = rects.filter(r => r[0] <= x0 && r[0] + r[2] >= x1).map(r => [r[1], r[1] + r[3]]).sort((a, b) => a[0] - b[0]);
    let cov = 0, cs = -Infinity, ce = -Infinity;
    for (const [a, b] of iv) { if (a > ce) { if (ce > cs) cov += ce - cs; cs = a; ce = b; } else ce = Math.max(ce, b); }
    if (ce > cs) cov += ce - cs;
    A += cov * (x1 - x0);
  }
  return A;
}
const orient = (ax, ay, bx, by, cx, cy) => { const v = (BigInt(bx) - BigInt(ax)) * (BigInt(cy) - BigInt(ay)) - (BigInt(by) - BigInt(ay)) * (BigInt(cx) - BigInt(ax)); return v > 0n ? 1 : v < 0n ? -1 : 0; };
function properCrossings(m) {
  const V = new Map(m.vertices.map(v => [v.id, v])); const E = m.edges.filter(e => e.cx == null);
  let n = 0;
  for (let i = 0; i < E.length; i++) for (let j = i + 1; j < E.length; j++) {
    const a = V.get(E[i].u), b = V.get(E[i].v), c = V.get(E[j].u), d = V.get(E[j].v);
    if (!a || !b || !c || !d) return -1;
    if ([a, b].includes(c) || [a, b].includes(d)) continue;
    const o1 = orient(a.x, a.y, b.x, b.y, c.x, c.y), o2 = orient(a.x, a.y, b.x, b.y, d.x, d.y), o3 = orient(c.x, c.y, d.x, d.y, a.x, a.y), o4 = orient(c.x, c.y, d.x, d.y, b.x, b.y);
    if (o1 * o2 < 0 && o3 * o4 < 0) n++;
  }
  return n;
}
const COLORS = [C.rgba(220, 50, 50, 255), C.rgba(50, 110, 230, 255), C.rgba(40, 180, 90, 255)];
const STROKE = { color: C.rgba(10, 10, 10, 255), width: 40, cap: 'round', join: 'round' };
function run(seed) {
  const r = rng(seed * 2654435761 + 1); let m = C.createEmptyPlanarMap(); const rects = []; let fallbacks = 0, strokes = 0, fills = 0;
  for (let k = 0; k < OPS; k++) {
    if (r() % 3 === 0) {
      const x = 200 + r() % 3000, y = 200 + r() % 2000, w = 100 + r() % 1500, h = 100 + r() % 1200;
      const res = C.addFill(m, C.makeRectPath(x, y, w, h), { type: 'solid', color: COLORS[r() % 3] }, null);
      if (res.fallback || res.ok === false) fallbacks++; else { m = res.map; rects.push([x, y, w, h]); fills++; }
    } else {
      const pts = []; const n = 2 + r() % 4; for (let i = 0; i < n; i++) pts.push([r() % 4000, r() % 3000]);
      const segs = pts.slice(1).map((p, i) => ({ type: 'line', x0: pts[i][0], y0: pts[i][1], x1: p[0], y1: p[1] }));
      const res = C.addStroke(m, segs, STROKE);
      if (res.fallback || res.ok === false) fallbacks++; else { m = res.map; strokes++; }
    }
  }
  return { m, rects, fallbacks, strokes, fills };
}
let bad = 0, fb = 0, totalStrokes = 0, totalFills = 0, maxV = 0, t0 = Date.now(); const fails = [];
for (let s = 1; s <= SEEDS; s++) {
  let a;
  try { a = run(s); } catch (e) { bad++; fails.push(`seed ${s}: threw ${String(e).slice(0, 120)}`); continue; }
  const b = run(s);
  fb += a.fallbacks; totalStrokes += a.strokes; totalFills += a.fills; maxV = Math.max(maxV, a.m.vertices.length);
  const inv = C.verifyPlanarMapInvariants(a.m);
  const got = inv.totalFilledArea2, want = 2 * unionArea(a.rects);
  const cross = properCrossings(a.m);
  const det = JSON.stringify(a.m) === JSON.stringify(b.m);
  const probs = [];
  if (!inv.ok) probs.push('own invariants: ' + inv.errors.slice(0, 2).join('; '));
  if (got !== want) probs.push(`area2 ${got} != union ${want}`);
  if (cross !== 0) probs.push(`proper crossings ${cross}`);
  if (!det) probs.push('not deterministic');
  if (probs.length) { bad++; if (fails.length < 12) fails.push(`seed ${s}: ${probs.join(' | ')}`); }
}
console.log(`${SEEDS} seeds x ${OPS} ops: ${totalFills} fills, ${totalStrokes} strokes accepted, ${fb} honest fallbacks; max ${maxV} vertices; ${bad} seeds with problems; ${((Date.now() - t0) / 1000).toFixed(1)} s`);
fails.forEach(f => console.log('  ' + f));
