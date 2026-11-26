// Kehai, Speedster R2 audit: for the broken V, list unfilled bounded faces whose area really lies inside the capsules
// (grid samples inside the face that are inside some capsule), and where computeFaceInteriorPoint put its probe.
const path = require('path');
const { loadSpeedsterCore } = require(path.resolve(process.argv[2], 'tests/lib/load-core.js'));
const C = loadSpeedsterCore();
const P = [[1237,581],[1361,654],[1517,745],[1680,840],[1845,936],[2011,1033],[2178,1130],[2344,1227],[2510,1323],[2676,1420],[2842,1517],[3029,1469],[3220,1384],[3414,1291],[3608,1195],[3802,1099],[3996,1002],[4189,905],[4383,808],[4577,711],[4771,614]];
const pts = P.map(([x, y], i) => ({ x, y, t: 1000 + i * 2, pressure: 0.5, hasPenPressure: false }));
const { polygons } = C.buildBrushCapsulePolygons(pts, { baseWidthTwips: 160, pointerType: 'mouse' });
const snapped = C.snapRoundSegments ? null : null;
const r = C.addFillUnion(C.createEmptyPlanarMap(), polygons, { type: 'solid', color: '#4a8cff' });
const vById = new Map(r.map.vertices.map(v => [v.id, v]));
const inCaps = (x, y) => polygons.some(p => C.pointInFlatPolygon ? C.pointInFlatPolygon(x, y, p) : false);
console.log('exports pointInFlatPolygon:', typeof C.pointInFlatPolygon, 'computeFaceInteriorPoint:', typeof C.computeFaceInteriorPoint);
r.map.faces.forEach((f, i) => {
  const vs = f.outer.map(id => vById.get(id)); const xs = vs.map(v => v.x), ys = vs.map(v => v.y);
  let inside = 0, inCap = 0;
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += 8) for (let y = Math.min(...ys); y <= Math.max(...ys); y += 8)
    if (C.pointInFace(x, y, f, vById)) { inside++; if (inCaps(x, y)) inCap++; }
  console.log(`face ${i}: fill=${!!f.fill} outerVerts=${vs.length} area2=${f.area2} gridInside=${inside} ofWhichInCapsules=${inCap}`);
});
