// Kehai, Speedster R2 audit: the exact 21 points the live app passed to buildBrushCapsulePolygons for the broken V
// (captured by instrument.py), through the shipped core in Node. Then single-capsule pair unions around the corner.
const path = require('path');
const { loadSpeedsterCore } = require(path.resolve(process.argv[2], 'tests/lib/load-core.js'));
const C = loadSpeedsterCore();
const P = [[1237,581],[1361,654],[1517,745],[1680,840],[1845,936],[2011,1033],[2178,1130],[2344,1227],[2510,1323],[2676,1420],[2842,1517],[3029,1469],[3220,1384],[3414,1291],[3608,1195],[3802,1099],[3996,1002],[4189,905],[4383,808],[4577,711],[4771,614]];
const pts = P.map(([x, y], i) => ({ x, y, t: 1000 + i * 2, pressure: 0.5, hasPenPressure: false }));
const opts = { baseWidthTwips: 160, pointerType: 'mouse', enableSpeedWidth: false, enablePressure: true };
const FILL = { type: 'solid', color: '#4a8cff' };
const faces = (polys) => C.addFillUnion(C.createEmptyPlanarMap(), polys, FILL).map.faces.filter(f => f.fill).length;
const { polygons, halfWidths } = C.buildBrushCapsulePolygons(pts, opts);
console.log('all 20 capsules -> filled faces:', faces(polygons), '| halfWidths', halfWidths.map(h => h.toFixed(0)).join(','));
for (let i = 7; i < 14; i++) console.log(`capsules ${i},${i + 1} -> ${faces([polygons[i], polygons[i + 1]])} face(s)`);
for (let k = 2; k <= 20; k++) { const f = faces(polygons.slice(0, k)); if (f !== 1) { console.log('first k capsules giving !=1 face: k =', k, '->', f); break; } }
