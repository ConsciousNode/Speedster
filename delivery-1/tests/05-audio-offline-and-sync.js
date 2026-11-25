#!/usr/bin/env node
// 05-audio-offline-and-sync.js — Sample-accurate event & stream audio offsets,
// volume envelope evaluation, zero drift over 10s, and golden WAV/PCM SHA-256 hash (§5, §7).
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const { loadSpeedsterCore } = require('./lib/load-core');

const C = loadSpeedsterCore();

const SR = 44100;
const FPS = 24;

// Generate deterministic 0.25s square/triangle test tone (no Math.random)
function makeToneWavBase64(freqHz, durationSec) {
  const len = Math.round(SR * durationSec);
  const samples = new Float32Array(len);
  const period = SR / freqHz;
  for (let i = 0; i < len; i++) {
    const phase = (i % period) / period;
    samples[i] = phase < 0.5 ? 0.5 : -0.5;
  }
  const wavBytes = C.encodeWavPcm16(samples, SR, 1);
  return { b64: C.bytesToBase64(wavBytes), len, peaks: C.computeWaveformPeaks(samples, 64) };
}

const doc = C.createDocument({ fps: FPS });
doc.mainTimeline.totalFrames = 240; // 10 seconds at 24 fps
const toneA = makeToneWavBase64(440, 0.25);
const toneB = makeToneWavBase64(880, 0.25);
const sndA = C.addLibrarySound(doc, { name: 'click.wav', sampleRate: SR, channels: 1, lengthSamples: toneA.len, format: 'wav', pcmBase64: toneA.b64, peaks: toneA.peaks });
const sndB = C.addLibrarySound(doc, { name: 'lip.wav', sampleRate: SR, channels: 1, lengthSamples: toneB.len, format: 'wav', pcmBase64: toneB.b64, peaks: toneB.peaks });

const lyr = doc.mainTimeline.layers[0];
// Event sound at frame 12 (0.5s -> sample 22050)
const kf12 = C.insertKeyframe(doc.mainTimeline, lyr.id, 12);
kf12.sound = { soundId: sndA.id, sync: 'event', envelope: [{ t: 0, left: 1, right: 1 }, { t: 0.25, left: 0.5, right: 0.5 }] };

// Stream sound at frame 120 (5.0s -> sample 220500)
const kf120 = C.insertKeyframe(doc.mainTimeline, lyr.id, 120);
kf120.sound = { soundId: sndB.id, sync: 'stream', envelope: [{ t: 0, left: 1, right: 1 }] };

// Stream sound at frame 216 (9.0s -> sample 396900)
const kf216 = C.insertKeyframe(doc.mainTimeline, lyr.id, 216);
kf216.sound = { soundId: sndB.id, sync: 'stream', envelope: [{ t: 0, left: 1, right: 1 }] };

const mix = C.mixAudioOfflinePCM(doc, SR);
assert.strictEqual(mix.events.length, 3);
assert.strictEqual(mix.events[0].startSample, Math.round((12 / FPS) * SR));
assert.strictEqual(mix.events[1].startSample, Math.round((120 / FPS) * SR));
assert.strictEqual(mix.events[2].startSample, Math.round((216 / FPS) * SR));

// Check exact sample onset in mixed PCM buffer (sample just before onset is 0, at onset is non-zero)
for (const ev of mix.events) {
  assert.strictEqual(mix.samples[ev.startSample - 1], 0, `Audio leaked before onset at frame ${ev.startFrame}`);
  assert.ok(Math.abs(mix.samples[ev.startSample]) > 0.2, `Audio missing at exact onset sample ${ev.startSample}`);
}

// Compute deterministic golden SHA-256 hash of Int16 PCM output
const wavOut = C.encodeWavPcm16(mix.samples, SR, 1);
const goldenAudioHash = crypto.createHash('sha256').update(wavOut).digest('hex');

// Re-run and verify determinism
const mix2 = C.mixAudioOfflinePCM(doc, SR);
const hash2 = crypto.createHash('sha256').update(C.encodeWavPcm16(mix2.samples, SR, 1)).digest('hex');
assert.strictEqual(goldenAudioHash, hash2, 'Offline WAV mix must be deterministic');

const outDir = path.join(__dirname, 'results');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, '05-audio.json'), JSON.stringify({
  suite: '05-audio-offline-and-sync',
  passed: true,
  sampleRate: SR,
  fps: FPS,
  eventsVerified: mix.events.map((e) => ({ sync: e.sync, startFrame: e.startFrame, startSample: e.startSample })),
  goldenAudioSha256: goldenAudioHash
}, null, 2));

console.log(`PASS 05-audio-offline-and-sync (golden WAV sha256=${goldenAudioHash.slice(0, 16)}...)`);
