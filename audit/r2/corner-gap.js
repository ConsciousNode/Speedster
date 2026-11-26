// Kehai, Speedster R2 audit: node repro of the browser's broken V. Shipped buildBrushCapsulePolygons + addFillUnion,
// a V of 10 even steps per arm (as Playwright's mouse.move(steps=10) feeds it), mouse default width 160 twips.
// Then walk the centreline and count samples that land in no filled face (a gap in the committed fill).
// Usage: node corner-gap.js <delivery-dir> [scale]
const path = require('path');
const { loadSpeedsterCore } = require(path.resolve(process.argv[2], 'tests/lib/load-core.js'));
const C = loadSpeedsterCore(); const S = Number(process.argv[3] || 13.8);  // twips per screen px at 145%
function V(stepsPerArm) {
  const P = [[0, 0], [120, 70], [260, 0]], pts = []; let t = 1000;
  pts.push({ x: 2000 + P[0][0] * S, y: 2000 + P[0][1] * S, t, pressure: 0.5, hasPenPressure: false });
  for (let a = 1; a < P.length; a++) for (let k = 1; k <= stepsPerArm; k++) {
    t += 2; pts.push({ x: Math.round(2000 + (P[a-1][0] + (P[a][0]-P[a-1][0]) * k / stepsPerArm) * S), y: Math.round(2000 + (P[a-1][1] + (P[a][1]-P[a-1][1]) * k / stepsPerArm) * S), t, pressure: 0.5, hasPenPressure: false });
  }
  return pts;
}
for (const steps of [1, 3, 5, 10, 20]) {
  const pts = V(steps);
  const { polygons } = C.buildBrushCapsulePolygons(pts, { baseWidthTwips: 160, pointerType: 'mouse' });
  const r = C.addFillUnion(C.createEmptyPlanarMap(), polygons, { type: 'solid', color: '#4a8cff' });
  const vById = new Map(r.map.vertices.map(v => [v.id, v]));
  const filled = r.map.faces.filter(f => f.fill);
  let gaps = 0, n = 0;
  for (let i = 0; i + 1 < pts.length; i++) for (let k = 0; k < 20; k++) {
    const x = pts[i].x + (pts[i+1].x - pts[i].x) * k / 20, y = pts[i].y + (pts[i+1].y - pts[i].y) * k / 20; n++;
    if (!filled.some(f => C.pointInFace(x, y, f, vById))) gaps++;
  }
  console.log(`steps/arm=${String(steps).padStart(2)} capsules=${polygons.length} filledFaces=${filled.length} centreline samples in no fill: ${gaps}/${n}`);
}
