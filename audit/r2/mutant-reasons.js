// Kehai, Speedster R2 audit: do the stroke mutants fail for the right reason (an assertion, not a TypeError)?
// Plus a real shared-timestamp mutant: patch the shipped normalizeCoalescedTimestamps to share one stamp per batch,
// run the shipped width pipeline (touch, speed-width on) and check that the adjacent-width ratio cap breaks.
// Usage: node mutant-reasons.js <delivery-dir>
const path = require('path'); const assert = require('assert');
const { loadSpeedsterCore } = require(path.resolve(process.argv[2], 'tests/lib/load-core.js'));
const C = loadSpeedsterCore();
function why(name, fn) { try { fn(); console.log(name, 'SURVIVED'); } catch (e) { console.log(name, '->', e.constructor.name, String(e.message).slice(0, 110)); } }
// 6 coalesced events per 16 ms frame, 4,000 px/s = 20 twips/px -> ~1,333 twips per frame
function batches(shared) {
  const evs = []; let x = 1000, t = 1000;
  for (let f = 0; f < 12; f++) for (let k = 0; k < 6; k++) {
    x += 1333 / 6; const ts = shared ? 1000 + 16 * (f + 1) : t += 16 / 6; evs.push({ x, y: 2000, t: ts, pressure: 0.5, hasPenPressure: false });
  }
  return evs;
}
function ratioOf(CM, pts) {
  const hw = CM.computeSmoothBrushHalfWidths(pts, { baseWidthTwips: 160, pointerType: 'touch', enableSpeedWidth: true });
  let r = 1; for (let i = 1; i < hw.length; i++) r = Math.max(r, hw[i] / hw[i - 1], hw[i - 1] / hw[i]); return r;
}
// The shipped pipeline goes through normalizeCoalescedTimestamps first; apply it the way the app does (per batch).
function viaNormalize(CM, shared) {
  const raw = batches(true); const out = []; let prev = 1000;
  for (let f = 0; f < 12; f++) {
    const evs = raw.slice(f * 6, f * 6 + 6).map(p => ({ timeStamp: p.t }));
    const ts = CM.normalizeCoalescedTimestamps ? CM.normalizeCoalescedTimestamps(evs, prev, raw[f * 6].t) : evs.map(e => e.timeStamp);
    ts.forEach((t, k) => out.push({ ...raw[f * 6 + k], t })); prev = raw[f * 6].t;
  }
  return out;
}
console.log('exports normalizeCoalescedTimestamps:', typeof C.normalizeCoalescedTimestamps);
console.log('shipped, distinct stamps   ratio', ratioOf(C, batches(false)).toFixed(3));
console.log('shipped, shared stamps raw ratio', ratioOf(C, batches(true)).toFixed(3));
if (C.normalizeCoalescedTimestamps) console.log('shipped, shared -> normalize ratio', ratioOf(C, viaNormalize(C)).toFixed(3));
const M = loadSpeedsterCore(src => src.replace(/const MAX_ADJ_WIDTH_RATIO = 1\.12;/, 'const MAX_ADJ_WIDTH_RATIO = 100.0;').replace('emaSpeed = i === 1 ? instSpeed : (emaSpeed * 0.72 + instSpeed * 0.28);', 'emaSpeed = instSpeed;'));
console.log('no-smoothing mutant, shared stamps ratio', ratioOf(M, batches(true)).toFixed(3));
why('R2-2 recheck', () => {
  const CM = loadSpeedsterCore(src => { const s2 = src.replace("const useSpeedWidth = pointerType === 'mouse' ? Boolean(o.enableSpeedWidth) : (o.enableSpeedWidth !== false);", 'const useSpeedWidth = true;'); assert.notStrictEqual(s2, src, 'patch did not apply'); return s2; });
  const hw = CM.computeSmoothBrushHalfWidths(batches(false), { baseWidthTwips: 160, pointerType: 'mouse' });
  assert.ok(Math.min(...hw) >= 72 && Math.max(...hw) <= 88, `mouse half-widths ${Math.min(...hw).toFixed(0)}..${Math.max(...hw).toFixed(0)} outside 80 +/-10%`);
});
