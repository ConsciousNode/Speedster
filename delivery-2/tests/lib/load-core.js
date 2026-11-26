// tests/lib/load-core.js — Loads SpeedsterCore directly from speedster.html
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function getHtmlPath() {
  return path.resolve(__dirname, '..', '..', 'speedster.html');
}

function readSpeedsterHtml() {
  return fs.readFileSync(getHtmlPath(), 'utf8');
}

function extractCoreSource(html) {
  const src = html || readSpeedsterHtml();
  const m = src.match(/<script id="speedster-core">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('Could not find <script id="speedster-core"> in speedster.html');
  return m[1];
}

function loadSpeedsterCore(mutator) {
  let code = extractCoreSource();
  if (typeof mutator === 'function') {
    code = mutator(code);
  }
  const ctx = {
    console, Math, Number, BigInt, Array, Object, Map, Set,
    Uint8Array, Int32Array, Float32Array, ArrayBuffer, DataView,
    JSON, String, Error, Buffer, parseInt, parseFloat, isNaN, isFinite
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.runInNewContext(code, ctx);
  return ctx.SpeedsterCore;
}

module.exports = {
  getHtmlPath,
  readSpeedsterHtml,
  extractCoreSource,
  loadSpeedsterCore
};
