// Kehai, Speedster R2 audit: how often does one continuous mouse brush stroke commit as more than one filled face?
// Shipped core, mouse defaults (width 160 twips). Random strokes: 8-40 points, step 60-250 twips (~4-18 screen px
// at 145%), random turning up to +/-110 degrees. Seeded. Usage: node brush-fuzz.js <delivery-dir> [n]
const path = require('path');
const { loadSpeedsterCore } = require(path.resolve(process.argv[2], 'tests/lib/load-core.js'));
const C = loadSpeedsterCore(); const N = Number(process.argv[3] || 300);
let s = 12345; const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
const FILL = { type: 'solid', color: '#4a8cff' }; const hist = {}; let bad = 0; const examples = [];
for (let n = 0; n < N; n++) {
  const k = 8 + Math.floor(rnd() * 33); let x = 3000, y = 3000, a = rnd() * 6.28; const pts = [];
  for (let i = 0; i < k; i++) {
    pts.push({ x: Math.round(x), y: Math.round(y), t: 1000 + i * 8, pressure: 0.5, hasPenPressure: false });
    const st = 60 + rnd() * 190; a += (rnd() - 0.5) * 2 * (rnd() < 0.2 ? 1.92 : 0.5); x += Math.cos(a) * st; y += Math.sin(a) * st;
  }
  const { polygons } = C.buildBrushCapsulePolygons(pts, { baseWidthTwips: 160, pointerType: 'mouse' });
  const r = C.addFillUnion(C.createEmptyPlanarMap(), polygons, FILL);
  const f = r.map.faces.filter(q => q.fill); const holes = f.reduce((h, q) => h + (q.holes ? q.holes.length : 0), 0);
  const key = `${f.length}f/${holes}h`; hist[key] = (hist[key] || 0) + 1;
  if (f.length !== 1) { bad++; if (examples.length < 3) examples.push(n); }
}
console.log(`strokes=${N} with !=1 filled face: ${bad} (${(100 * bad / N).toFixed(1)}%)`, JSON.stringify(hist), 'first bad seeds-index:', examples.join(','));
