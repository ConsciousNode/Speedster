#!/usr/bin/env node
// 01-security-and-determinism.js — Security greps, vendor-name bans, and determinism checks (§0, §1, §7)
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { readSpeedsterHtml, extractCoreSource } = require('./lib/load-core');

const html = readSpeedsterHtml();
const coreSrc = extractCoreSource(html);
const refSrc = fs.readFileSync(path.join(__dirname, 'lib', 'ref-rasteriser.js'), 'utf8');

function checkRegex(name, source, regex) {
  const m = source.match(regex);
  assert.strictEqual(m, null, `Security/determinism violation [${name}]: matched "${m && m[0]}"`);
  return { check: name, passed: true };
}

const checks = [];

// 1. Security greps on shipped speedster.html
checks.push(checkRegex('no-eval', html, /\beval\s*\(/));
checks.push(checkRegex('no-new-Function', html, /\bnew\s+Function\b/));
checks.push(checkRegex('no-innerHTML', html, /\.innerHTML\s*=/));
checks.push(checkRegex('no-fetch', html, /\bfetch\s*\(/));
checks.push(checkRegex('no-XHR', html, /\bXMLHttpRequest\b/));
checks.push(checkRegex('no-WebSocket', html, /\bWebSocket\b/));
checks.push(checkRegex('no-external-http-scripts', html, /<(script|link)[^>]+https?:\/\//i));
checks.push(checkRegex('no-localStorage', html, /\blocalStorage\b/));

// 2. Clean-room naming ban (§0)
checks.push(checkRegex('no-vendor-Flash', html, /\bFlash\b/i));
checks.push(checkRegex('no-vendor-Adobe', html, /\bAdobe\b/i));
checks.push(checkRegex('no-vendor-Macromedia', html, /\bMacromedia\b/i));
checks.push(checkRegex('no-vendor-ActionScript', html, /\bActionScript\b/i));

// 3. Determinism: Math.random banned from core and reference rasteriser
checks.push(checkRegex('no-Math-random-in-core', coreSrc, /\bMath\.random\b/));
checks.push(checkRegex('no-Math-random-in-ref-rasteriser', refSrc, /\bMath\.random\b/));

// 4. Reference rasteriser: transcendental functions banned (§7, mutant #10)
checks.push(checkRegex('no-Math-sin-in-ref', refSrc, /\bMath\.sin\b/));
checks.push(checkRegex('no-Math-cos-in-ref', refSrc, /\bMath\.cos\b/));
checks.push(checkRegex('no-Math-tan-in-ref', refSrc, /\bMath\.tan\b/));
checks.push(checkRegex('no-Math-atan2-in-ref', refSrc, /\bMath\.atan2\b/));
checks.push(checkRegex('no-Math-exp-in-ref', refSrc, /\bMath\.exp\b/));
checks.push(checkRegex('no-Math-log-in-ref', refSrc, /\bMath\.log\b/));
checks.push(checkRegex('no-Math-pow-in-ref', refSrc, /\bMath\.pow\b/));

const outDir = path.join(__dirname, 'results');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, '01-security.json'), JSON.stringify({
  suite: '01-security-and-determinism',
  passed: true,
  checksRun: checks.length,
  htmlBytes: Buffer.byteLength(html, 'utf8')
}, null, 2));

console.log(`PASS 01-security-and-determinism (${checks.length} checks)`);
