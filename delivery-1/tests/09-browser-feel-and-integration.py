#!/usr/bin/env python3
"""09-browser-feel-and-integration.py — Headless Chromium integration, XSS probe,
Canvas2D vs Reference Rasteriser check, OfflineAudioContext test, 5 MB sound
IndexedDB kill-and-reopen survival, and §6 FEEL benchmarks on a 500-shape document."""

import http.server
import json
import os
import platform
import socketserver
import subprocess
import threading
import time
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service

TESTS_DIR = Path(__file__).resolve().parent
DIST_DIR = TESTS_DIR.parent
RESULTS_DIR = TESTS_DIR / "results"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIST_DIR), **kwargs)

    def log_message(self, format, *args):
        pass


def start_local_server():
    httpd = socketserver.TCPServer(("127.0.0.2", 0), QuietHandler)
    port = httpd.server_address[1]
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    return httpd, port


def percentile(vals, p):
    if not vals:
        return 0.0
    s = sorted(vals)
    idx = min(len(s) - 1, max(0, int(round((p / 100.0) * (len(s) - 1)))))
    return round(float(s[idx]), 3)


def make_driver():
    opts = Options()
    opts.binary_location = "/usr/bin/chromium"
    opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--window-size=1280,800")
    opts.add_argument("--autoplay-policy=no-user-gesture-required")
    service = Service("/usr/bin/chromedriver")
    driver = webdriver.Chrome(service=service, options=opts)
    driver.set_script_timeout(60)
    return driver


def main():
    httpd, port = start_local_server()
    url = f"http://127.0.0.2:{port}/speedster.html"
    driver = make_driver()
    try:
        driver.get(url)
        time.sleep(0.6)

        # 1. Machine & GPU / Renderer telemetry
        gpu_info = driver.execute_script("""
            const c = document.createElement('canvas');
            let webglRenderer = 'Canvas2D-only (WebGL unavailable)';
            let isSoftware = true;
            try {
              const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
              if (gl) {
                const dbg = gl.getExtension('WEBGL_debug_renderer_info');
                webglRenderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
                isSoftware = /swiftshader|llvmpipe|software|mesa/i.test(webglRenderer);
              }
            } catch (_) {}
            return {
              userAgent: navigator.userAgent,
              hardwareConcurrency: navigator.hardwareConcurrency || 0,
              devicePixelRatio: window.devicePixelRatio || 1,
              webglRenderer,
              isSoftwareRenderer: isSoftware
            };
        """)

        # 2. XSS probe on layer name (mutant #12)
        xss_ok = driver.execute_script("""
            const C = window.SpeedsterCore;
            const app = window.SpeedsterApp;
            const doc = app.getDoc();
            doc.mainTimeline.layers[0].name = '<img src=x onerror="window.__xss=1">';
            app.loadDoc(doc);
            const names = Array.from(document.querySelectorAll('.tl-layer-name')).map(n => n.textContent);
            return {
              triggered: Boolean(window.__xss),
              renderedLiterally: names.some(t => t.includes('<img src=x onerror="window.__xss=1">'))
            };
        """)
        assert not xss_ok["triggered"], "XSS probe triggered!"
        assert xss_ok["renderedLiterally"], "XSS layer name did not render as literal text!"

        # 3. Canvas2D vs Reference Rasteriser comparison on Masked Scene (mutant #16)
        canvas_rgba = driver.execute_script("""
            const C = window.SpeedsterCore;
            const app = window.SpeedsterApp;
            const doc = C.createDocument({ stageWidth: 120 * 20, stageHeight: 120 * 20, fps: 24 });
            const maskLyr = C.createLayer(doc, 'TriMask', 'mask', null);
            const contentLyr = doc.mainTimeline.layers[0];
            contentLyr.parentId = maskLyr.id;
            doc.mainTimeline.layers.unshift(maskLyr);
            contentLyr.keyframes[0].objects.push({
              id: 'red_sq', paths: [C.makeRectPath(200, 200, 2000, 2000)],
              fill: { type: 'solid', color: C.rgba(220, 30, 30, 255) }, stroke: null, matrix: C.identityMatrix()
            });
            maskLyr.keyframes[0].objects.push({
              id: 'tri_mask',
              paths: [[
                { type: 'line', x0: 200, y0: 200, x1: 2200, y1: 2200 },
                { type: 'line', x0: 2200, y0: 2200, x1: 200, y1: 2200 },
                { type: 'line', x0: 200, y0: 2200, x1: 200, y1: 200 }
              ]],
              fill: { type: 'solid', color: C.rgba(0, 0, 0, 255) }, stroke: null, matrix: C.identityMatrix()
            });
            app.loadDoc(doc);
            const res = app.renderFrameToRgba(0);
            const w = res.width, d = res.data;
            const insideIdx = (90 * w + 30) * 4;
            const outsideIdx = (30 * w + 90) * 4;
            return {
              width: w, height: res.height,
              insidePixel: [d[insideIdx], d[insideIdx+1], d[insideIdx+2]],
              outsidePixel: [d[outsideIdx], d[outsideIdx+1], d[outsideIdx+2]],
              data: d
            };
        """)
        assert canvas_rgba["insidePixel"] == [220, 30, 30], f"Inside mask pixel wrong: {canvas_rgba['insidePixel']}"
        assert canvas_rgba["outsidePixel"] == [255, 255, 255], f"Outside mask pixel leaked: {canvas_rgba['outsidePixel']}"

        # Compare pixel-by-pixel against Node ref-rasteriser
        ref_out = subprocess.check_output(["node", "-e", """
            const { loadSpeedsterCore } = require('./lib/load-core');
            const { renderDocumentFrame } = require('./lib/ref-rasteriser');
            const C = loadSpeedsterCore();
            const doc = C.createDocument({ stageWidth: 120 * 20, stageHeight: 120 * 20, fps: 24 });
            const maskLyr = C.createLayer(doc, 'TriMask', 'mask', null);
            const contentLyr = doc.mainTimeline.layers[0];
            contentLyr.parentId = maskLyr.id;
            doc.mainTimeline.layers.unshift(maskLyr);
            contentLyr.keyframes[0].objects.push({
              id: 'red_sq', paths: [C.makeRectPath(200, 200, 2000, 2000)],
              fill: { type: 'solid', color: C.rgba(220, 30, 30, 255) }, stroke: null, matrix: C.identityMatrix()
            });
            maskLyr.keyframes[0].objects.push({
              id: 'tri_mask',
              paths: [[
                { type: 'line', x0: 200, y0: 200, x1: 2200, y1: 2200 },
                { type: 'line', x0: 2200, y0: 2200, x1: 200, y1: 2200 },
                { type: 'line', x0: 200, y0: 2200, x1: 200, y1: 200 }
              ]],
              fill: { type: 'solid', color: C.rgba(0, 0, 0, 255) }, stroke: null, matrix: C.identityMatrix()
            });
            const r = renderDocumentFrame(doc, 0);
            process.stdout.write(JSON.stringify(Array.from(r.data)));
        """], cwd=str(TESTS_DIR))
        ref_data = json.loads(ref_out)
        c2d_data = canvas_rgba["data"]
        total_px = canvas_rgba["width"] * canvas_rgba["height"]
        within_tol = 0
        for i in range(0, len(ref_data), 4):
            diff = max(abs(ref_data[i] - c2d_data[i]),
                       abs(ref_data[i+1] - c2d_data[i+1]),
                       abs(ref_data[i+2] - c2d_data[i+2]))
            if diff <= 24:
                within_tol += 1
        match_pct = round(100.0 * within_tol / total_px, 3)
        assert match_pct >= 98.0, f"Canvas2D vs Reference Rasteriser match {match_pct}% < 98.0%"

        # 4. Browser OfflineAudioContext test (§7)
        audio_browser = driver.execute_async_script("""
            const done = arguments[arguments.length - 1];
            (async () => {
              const C = window.SpeedsterCore;
              const app = window.SpeedsterApp;
              const sr = 44100;
              const doc = C.createDocument({ fps: 24 });
              doc.mainTimeline.totalFrames = 48;
              const len = Math.round(sr * 0.1);
              const samples = new Float32Array(len);
              for (let i = 0; i < len; i++) samples[i] = (i % 100) < 50 ? 0.5 : -0.5;
              const wavB64 = C.bytesToBase64(C.encodeWavPcm16(samples, sr, 1));
              const snd = C.addLibrarySound(doc, { name: 'beep.wav', sampleRate: sr, channels: 1, lengthSamples: len, format: 'wav', pcmBase64: wavB64 });
              const kf = C.insertKeyframe(doc.mainTimeline, doc.mainTimeline.layers[0].id, 12);
              kf.sound = { soundId: snd.id, sync: 'stream', envelope: [{ t: 0, left: 1, right: 1 }] };
              app.loadDoc(doc);
              const res = await app.renderAudioOffline(sr);
              const expectedOnset = Math.round((12 / 24) * sr);
              const beforeVal = Math.abs(res.samples[expectedOnset - 10] || 0);
              const atVal = Math.abs(res.samples[expectedOnset + 2] || 0);
              done({ expectedOnset, beforeVal, atVal, totalSamples: res.samples.length });
            })().catch(e => done({ error: e.message }));
        """)
        assert "error" not in audio_browser, f"OfflineAudioContext error: {audio_browser}"
        assert audio_browser["beforeVal"] < 0.01 and audio_browser["atVal"] > 0.2, f"Audio onset failed: {audio_browser}"

        # 5. FEEL Benchmark on 500-shape document (§6.1, §6.3, §6.4, §6.7)
        feel = driver.execute_async_script("""
            const done = arguments[arguments.length - 1];
            (async () => {
              const C = window.SpeedsterCore;
              const app = window.SpeedsterApp;
              const doc = C.createDocument({ stageWidth: 550 * 20, stageHeight: 400 * 20, fps: 24 });
              doc.mainTimeline.totalFrames = 48;
              const rng = C.createSeededRng(500);
              const kf = doc.mainTimeline.layers[0].keyframes[0];
              for (let i = 0; i < 500; i++) {
                const x = Math.round(rng() * 10000);
                const y = Math.round(rng() * 7000);
                const w = 200 + Math.round(rng() * 600);
                const h = 200 + Math.round(rng() * 600);
                kf.objects.push({
                  id: 's_' + i,
                  paths: [C.makeRectPath(x, y, w, h)],
                  fill: { type: 'solid', color: C.rgba(Math.round(rng()*255), Math.round(rng()*255), Math.round(rng()*255), 180) },
                  stroke: { color: C.rgba(20, 20, 30, 255), width: 20 },
                  matrix: C.identityMatrix()
                });
              }
              C.recomputeKeyframeBlank(kf);
              app.loadDoc(doc);
              app.resetMetrics();

              // 5a. Synthetic pointer stroke input-to-pixels latency (25 events)
              app.selectTool('brush');
              const canvas = document.getElementById('stage-canvas');
              const rect = canvas.getBoundingClientRect();
              canvas.dispatchEvent(new PointerEvent('pointerdown', {
                pointerId: 1, clientX: rect.left + 120, clientY: rect.top + 120, bubbles: true
              }));
              for (let i = 1; i <= 25; i++) {
                canvas.dispatchEvent(new PointerEvent('pointermove', {
                  pointerId: 1, clientX: rect.left + 120 + i * 10, clientY: rect.top + 120 + (i % 5) * 8, bubbles: true
                }));
                await new Promise(r => requestAnimationFrame(r));
              }
              canvas.dispatchEvent(new PointerEvent('pointerup', {
                pointerId: 1, clientX: rect.left + 370, clientY: rect.top + 120, bubbles: true
              }));

              // 5b. Live scrubbing frame time across 30 frames
              for (let f = 0; f < 30; f++) {
                app.setCurrentFrame(f % 48, true);
              }

              // 5c. Zoom & pan frame time (20 wheel events)
              for (let i = 0; i < 20; i++) {
                canvas.dispatchEvent(new WheelEvent('wheel', {
                  clientX: rect.left + 300, clientY: rect.top + 200,
                  deltaY: (i % 2 === 0 ? -100 : 100), bubbles: true, cancelable: true
                }));
              }

              // Snapshot input/scrub/zoom metrics BEFORE playback loop resets counters
              const savedInputLat = app.getMetrics().inputToPixelLatenciesMs.slice();
              const savedScrubTimes = app.getMetrics().scrubFrameTimesMs.slice();
              const savedZoomPanTimes = app.getMetrics().zoomPanFrameTimesMs.slice();

              // 5d. Playback achieved fps at 12, 24, 30 fps (0.6s window each)
              const playbackResults = {};
              for (const targetFps of [12, 24, 30]) {
                doc.fps = targetFps;
                app.resetMetrics();
                app.togglePlayback();
                const startT = performance.now();
                await new Promise(r => setTimeout(r, 600));
                const elapsed = (performance.now() - startT) / 1000;
                const m = app.getMetrics();
                const rendered = m.playbackFramesRendered;
                app.togglePlayback();
                playbackResults[targetFps] = {
                  targetFps,
                  achievedFps: Number((rendered / elapsed).toFixed(2)),
                  framesRendered: rendered,
                  elapsedSec: Number(elapsed.toFixed(3))
                };
              }

              done({
                inputToPixelLatenciesMs: savedInputLat,
                scrubFrameTimesMs: savedScrubTimes,
                zoomPanFrameTimesMs: savedZoomPanTimes,
                playback: playbackResults
              });
            })().catch(e => done({ error: e.message }));
        """)
        assert "error" not in feel, f"FEEL benchmark error: {feel}"

        # Save a visual screenshot of the 500-shape studio for inspection
        screenshot_path = RESULTS_DIR / "studio-screenshot.png"
        driver.save_screenshot(str(screenshot_path))

        # 6. 5 MB Sound IndexedDB Kill-and-Reopen Survival Test (§6.6, mutant #15)
        saved_5mb = driver.execute_async_script("""
            const done = arguments[arguments.length - 1];
            (async () => {
              const C = window.SpeedsterCore;
              const app = window.SpeedsterApp;
              const doc = C.createDocument({ fps: 24 });
              // Create a ~5.0 MB WAV (5,250,000 bytes -> 2,625,000 Int16 samples)
              const byteLen = 5 * 1024 * 1024;
              const raw = new Uint8Array(byteLen);
              for (let i = 0; i < 1024; i++) raw[i] = i & 255;
              const b64 = C.bytesToBase64(raw);
              C.addLibrarySound(doc, {
                name: 'big-5mb.wav', sampleRate: 44100, channels: 1,
                lengthSamples: byteLen / 2, format: 'wav', pcmBase64: b64
              });
              app.loadDoc(doc);
              const expectedHash = app.getDocHash();
              const ok = await app.forceAutosaveNow();
              done({ ok, expectedHash, soundBytes: byteLen });
            })().catch(e => done({ error: e.message }));
        """)
        assert saved_5mb.get("ok"), f"5MB IndexedDB autosave failed: {saved_5mb}"

        # Simulate kill-and-reopen by navigating to about:blank then reopening speedster.html
        driver.get("about:blank")
        time.sleep(0.2)
        driver.get(url)
        time.sleep(0.9)

        restored = driver.execute_script("""
            const app = window.SpeedsterApp;
            const doc = app.getDoc();
            return {
              restoredHash: app.getDocHash(),
              soundCount: doc.library.sounds.length,
              soundName: doc.library.sounds[0] ? doc.library.sounds[0].name : null,
              b64Len: doc.library.sounds[0] ? doc.library.sounds[0].pcmBase64.length : 0
            };
        """)
        assert restored["restoredHash"] == saved_5mb["expectedHash"], \
            f"5MB IndexedDB kill-and-reopen hash mismatch! {restored} vs {saved_5mb}"

        report = {
            "suite": "09-browser-feel-and-integration",
            "passed": True,
            "machine": {
                "os": platform.platform(),
                "arch": platform.machine(),
                "python": platform.python_version(),
                "cpuCores": os.cpu_count()
            },
            "browser": gpu_info,
            "xssProbe": xss_ok,
            "canvas2dVsReferenceRasteriser": {
                "matchingPixelsPercent": match_pct,
                "toleranceChannelDiff": 24,
                "insidePixel": canvas_rgba["insidePixel"],
                "outsidePixel": canvas_rgba["outsidePixel"]
            },
            "offlineAudioBrowser": audio_browser,
            "autosave5MBKillReopen": {
                "soundBytes": saved_5mb["soundBytes"],
                "survived": True,
                "restoredHash": restored["restoredHash"]
            },
            "feel500Shapes": {
                "inputToPixelMedianMs": percentile(feel["inputToPixelLatenciesMs"], 50),
                "inputToPixelP95Ms": percentile(feel["inputToPixelLatenciesMs"], 95),
                "scrubFrameMedianMs": percentile(feel["scrubFrameTimesMs"], 50),
                "scrubFrameP95Ms": percentile(feel["scrubFrameTimesMs"], 95),
                "zoomPanFrameMedianMs": percentile(feel["zoomPanFrameTimesMs"], 50),
                "zoomPanFrameP95Ms": percentile(feel["zoomPanFrameTimesMs"], 95),
                "playback": feel["playback"]
            }
        }
        (RESULTS_DIR / "09-browser-feel.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"PASS 09-browser-feel-and-integration (Canvas2D match={match_pct}%, 5MB IDB survived, input p50={report['feel500Shapes']['inputToPixelMedianMs']}ms)")
    finally:
        driver.quit()
        httpd.shutdown()


if __name__ == "__main__":
    main()
