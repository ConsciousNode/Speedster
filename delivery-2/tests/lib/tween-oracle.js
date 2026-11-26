// tests/lib/tween-oracle.js — Independent implementation of §4 tween formulas,
// written from the specification alone with distinct structure & identifiers.

'use strict';

const SCALE_UNIT = 65536;
const FULL_TURN = Math.PI * 2;

function clampUnit(val) {
  return val < 0 ? 0 : (val > 1 ? 1 : val);
}

function oracleClassicEase(progress, strength) {
  const x = clampUnit(progress);
  const k = Math.max(-100, Math.min(100, strength || 0)) / 100;
  if (k === 0) return x;
  if (k < 0) {
    // Ease-in: blend linear toward x^2
    const weight = -k;
    return (1 - weight) * x + weight * (x * x);
  }
  // Ease-out: blend linear toward 1 - (1 - x)^2
  const inv = 1 - x;
  return (1 - k) * x + k * (1 - inv * inv);
}

// Pure bisection solver for cubic Bezier ease (structurally independent from Newton-Raphson)
function oracleCubicEase(progress, ax, ay, bx, by) {
  const target = clampUnit(progress);
  if (target === 0 || target === 1) return target;
  let low = 0;
  let high = 1;
  for (let step = 0; step < 48; step++) {
    const mid = (low + high) / 2;
    const rem = 1 - mid;
    const xVal = 3 * rem * rem * mid * ax + 3 * rem * mid * mid * bx + mid * mid * mid;
    if (xVal < target) low = mid;
    else high = mid;
  }
  const sol = (low + high) / 2;
  const rem = 1 - sol;
  return 3 * rem * rem * sol * ay + 3 * rem * sol * sol * by + sol * sol * sol;
}

function oracleExtractTransform(mat) {
  const m00 = mat.a / SCALE_UNIT;
  const m10 = mat.b / SCALE_UNIT;
  const m01 = mat.c / SCALE_UNIT;
  const m11 = mat.d / SCALE_UNIT;
  const sx = Math.hypot(m00, m10);
  const theta = sx > 1e-9 ? Math.atan2(m10, m00) : 0;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  // Rotate column 2 back by -theta
  const ux = c * m01 + s * m11;
  const uy = -s * m01 + c * m11;
  const sy = uy;
  const shear = Math.abs(sy) > 1e-9 ? Math.atan2(ux, sy) : 0;
  return { x: mat.tx, y: mat.ty, sx, sy, theta, shear };
}

function oracleBuildTransform(x, y, sx, sy, theta, shear) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const k = Math.tan(shear);
  const a = c * sx;
  const b = s * sx;
  const cc = c * (sy * k) - s * sy;
  const d = s * (sy * k) + c * sy;
  return {
    a: Math.round(a * SCALE_UNIT),
    b: Math.round(b * SCALE_UNIT),
    c: Math.round(cc * SCALE_UNIT),
    d: Math.round(d * SCALE_UNIT),
    tx: Math.round(x),
    ty: Math.round(y)
  };
}

function oracleInterpolateMotion(startInst, endInst, spec, rawProgress) {
  const factor = (spec && spec.customEase)
    ? oracleCubicEase(rawProgress, spec.customEase.x1, spec.customEase.y1, spec.customEase.x2, spec.customEase.y2)
    : oracleClassicEase(rawProgress, spec ? spec.ease : 0);

  const p0 = oracleExtractTransform(startInst.matrix);
  const p1 = oracleExtractTransform(endInst.matrix);

  let angleDiff = p1.theta - p0.theta;
  while (angleDiff > Math.PI) angleDiff -= FULL_TURN;
  while (angleDiff <= -Math.PI) angleDiff += FULL_TURN;

  const spin = (spec && spec.rotateMode) || 'auto';
  const extra = Math.max(0, Math.round((spec && spec.rotateTimes) || 0));
  if (spin === 'none') {
    angleDiff = 0;
  } else if (spin === 'cw') {
    let cw = (p1.theta - p0.theta) % FULL_TURN;
    if (cw < 0) cw += FULL_TURN;
    angleDiff = cw + extra * FULL_TURN;
  } else if (spin === 'ccw') {
    let ccw = (p1.theta - p0.theta) % FULL_TURN;
    if (ccw > 0) ccw -= FULL_TURN;
    angleDiff = ccw - extra * FULL_TURN;
  }

  const outMat = oracleBuildTransform(
    p0.x + (p1.x - p0.x) * factor,
    p0.y + (p1.y - p0.y) * factor,
    p0.sx + (p1.sx - p0.sx) * factor,
    p0.sy + (p1.sy - p0.sy) * factor,
    p0.theta + angleDiff * factor,
    p0.shear + (p1.shear - p0.shear) * factor
  );

  const c0 = startInst.colorTransform || { mr: 256, mg: 256, mb: 256, ma: 256, ar: 0, ag: 0, ab: 0, aa: 0 };
  const c1 = endInst.colorTransform || { mr: 256, mg: 256, mb: 256, ma: 256, ar: 0, ag: 0, ab: 0, aa: 0 };
  const mix = (u, v) => Math.round(u + (v - u) * factor);
  const outCt = {
    mr: mix(c0.mr, c1.mr), mg: mix(c0.mg, c1.mg), mb: mix(c0.mb, c1.mb), ma: mix(c0.ma, c1.ma),
    ar: mix(c0.ar, c1.ar), ag: mix(c0.ag, c1.ag), ab: mix(c0.ab, c1.ab), aa: mix(c0.aa, c1.aa)
  };

  return { matrix: outMat, colorTransform: outCt, factor };
}

// Mechanical independence check (§7, as in WINSTON):
// Compares non-keyword identifier sets (Jaccard similarity) between oracle and app tween code.
function checkOracleIndependence(oracleSource, appTweenSource) {
  const KEYWORDS = new Set([
    'function', 'const', 'let', 'var', 'return', 'if', 'else', 'for', 'while',
    'Math', 'round', 'abs', 'min', 'max', 'cos', 'sin', 'tan', 'atan2', 'hypot', 'sqrt', 'PI',
    'matrix', 'colorTransform', 'customEase', 'ease', 'rotateMode', 'rotateTimes',
    'a', 'b', 'c', 'd', 'tx', 'ty', 'mr', 'mg', 'mb', 'ma', 'ar', 'ag', 'ab', 'aa',
    'x1', 'y1', 'x2', 'y2', 'true', 'false', 'null', 'undefined', 'strict', 'use', 'module', 'exports'
  ]);
  const extractIds = (src) => {
    const matches = src.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
    const s = new Set();
    for (const m of matches) {
      if (!KEYWORDS.has(m) && m.length > 2) s.add(m);
    }
    return s;
  };
  const idsA = extractIds(oracleSource);
  const idsB = extractIds(appTweenSource);
  let inter = 0;
  for (const id of idsA) if (idsB.has(id)) inter++;
  const union = idsA.size + idsB.size - inter;
  const jaccard = union > 0 ? inter / union : 0;
  return {
    oracleUniqueIds: idsA.size,
    appUniqueIds: idsB.size,
    sharedIds: inter,
    jaccardSimilarity: Number(jaccard.toFixed(4)),
    independent: jaccard < 0.25
  };
}

module.exports = {
  oracleClassicEase,
  oracleCubicEase,
  oracleInterpolateMotion,
  checkOracleIndependence
};
