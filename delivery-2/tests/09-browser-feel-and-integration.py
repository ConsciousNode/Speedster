#!/usr/bin/env python3
"""09-browser-feel-and-integration.py — Headless Chromium R1+R2 integration,
XSS probe, Canvas2D vs Reference Rasteriser, OfflineAudioContext, R2 fast-stroke
browser verification (preview vs commit), action-gated walkthrough completion +
tooltip audit, direct-shape drag latency, >=10s playback fps at 12/24/30 fps,
5 MB WAV IndexedDB kill-and-reopen, and results.jsonl output."""

import http.server
import json
import os
import platform
import socketserver
import subprocess
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service

TESTS_DIR = Path(__file__).resolve().parent
DIST_DIR = TESTS_DIR.parent
RESULTS_DIR = TESTS_DIR / "results"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)
JSONL_PATH = DIST_DIR / "results.jsonl"


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
    driver.set_script_timeout(120)
    return driver


def main():
    httpd, port = start_local_server()
    url = f"http://127.0.0.2:{port}/speedster.html"
    driver = make_driver()
    jsonl_records = []
    ts_now = datetime.now(timezone.utc).isoformat()

    def log_metric(category, metric, value, unit="", extra=None):
        rec = {
            "timestamp": ts_now,
            "suite": "09-browser-feel-and-integration",
            "category": category,
            "metric": metric,
            "value": value,
            "unit": unit,
        }
        if extra:
            rec.update(extra)
        jsonl_records.append(rec)

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
        machine_info = {
            "os": platform.platform(),
            "arch": platform.machine(),
            "python": platform.python_version(),
            "cpuCores": os.cpu_count(),
        }
        log_metric("environment", "machine_and_renderer", gpu_info["webglRenderer"], "", {
            "machine": machine_info,
            "isSoftwareRenderer": gpu_info["isSoftwareRenderer"],
            "userAgent": gpu_info["userAgent"],
        })

        # 2. R2 §2: Tooltip audit, empty-timeline hint, walkthrough action-gating & completion
        discoverability = driver.execute_async_script("""
            const done = arguments[arguments.length - 1];
            (async () => {
              const app = window.SpeedsterApp;
              // 2a. Check every tool and timeline button has tooltip containing its current key
              const tooltips = app.getTooltipInventory();
              const missingTooltips = tooltips.filter(t => !t.title || !t.key || !t.title.includes(t.key));

              // 2b. Check empty-timeline hint is visible on fresh 1-keyframe doc
              const hintVisibleInitially = !document.getElementById('tl-empty-hint').classList.contains('hidden');

              // 2c. Mutant R2-7 check: walkthrough has NO "Next" button and clicking card does not advance steps
              const wtCard = document.getElementById('walkthrough-card');
              const hasNextBtn = Array.from(wtCard.querySelectorAll('button')).some(b => /next/i.test(b.textContent));
              wtCard.click();
              const stateAfterCardClick = app.getWalkthroughState();

              // 2d. Complete all 5 steps of "Make your first animation" with REAL user inputs!
              const stage = document.getElementById('stage-canvas');
              const sRect = stage.getBoundingClientRect();

              // Step 1: Draw on stage
              app.selectTool('brush');
              stage.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, pointerType: 'mouse', clientX: sRect.left + 150, clientY: sRect.top + 150, bubbles: true }));
              stage.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, pointerType: 'mouse', clientX: sRect.left + 250, clientY: sRect.top + 180, bubbles: true }));
              stage.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, pointerType: 'mouse', clientX: sRect.left + 250, clientY: sRect.top + 180, bubbles: true }));
              const afterStep1 = app.getWalkthroughState();

              // Step 2: Click frame 10 on timeline (index 9 * 14px + 7px)
              const tlCanvas = document.getElementById('tl-canvas');
              const tRect = tlCanvas.getBoundingClientRect();
              tlCanvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, clientX: tRect.left + 9 * 14 + 7, clientY: tRect.top + 10, bubbles: true }));
              tlCanvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2, clientX: tRect.left + 9 * 14 + 7, clientY: tRect.top + 10, bubbles: true }));
              const afterStep2 = app.getWalkthroughState();

              // Step 3: Click +Key button, then draw a change on frame 10
              const addKeyBtn = document.querySelector('#tl-toolbar button[data-action="insert_keyframe"]');
              addKeyBtn.click();
              stage.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 3, pointerType: 'mouse', clientX: sRect.left + 280, clientY: sRect.top + 200, bubbles: true }));
              stage.dispatchEvent(new PointerEvent('pointermove', { pointerId: 3, pointerType: 'mouse', clientX: sRect.left + 360, clientY: sRect.top + 240, bubbles: true }));
              stage.dispatchEvent(new PointerEvent('pointerup', { pointerId: 3, pointerType: 'mouse', clientX: sRect.left + 360, clientY: sRect.top + 240, bubbles: true }));
              const afterStep3 = app.getWalkthroughState();
              const hintHiddenAfterKey2 = document.getElementById('tl-empty-hint').classList.contains('hidden');

              // Step 4: Turn on Onion Skin
              document.querySelector('#tl-toolbar button[data-action="onion_toggle"]').click();
              const afterStep4 = app.getWalkthroughState();

              // Step 5: Press Play
              document.querySelector('#tl-toolbar button[data-action="play_toggle"]').click();
              const afterStep5 = app.getWalkthroughState();
              const isPlaying = app.getState().playing;
              const keyframeCount = app.getDoc().mainTimeline.layers[0].keyframes.length;

              // Stop playback and dismiss walkthrough for clean subsequent tests
              document.querySelector('#tl-toolbar button[data-action="play_toggle"]').click();
              document.querySelector('#tl-toolbar button[data-action="onion_toggle"]').click();

              // Verify Help menu and Key Reference modal open cleanly
              document.getElementById('help-btn').click();
              const helpMenuPresent = Boolean(document.getElementById('help-menu'));
              const keyRefBtn = Array.from(document.querySelectorAll('#help-menu button')).find(b => /Key Reference/i.test(b.textContent));
              if (keyRefBtn) keyRefBtn.click();
              const keyRefModalPresent = Boolean(document.getElementById('key-ref-modal'));
              const closeModalBtn = document.querySelector('#key-ref-modal button:last-child');
              if (closeModalBtn) closeModalBtn.click();

              done({
                totalTooltipChecked: tooltips.length,
                missingTooltips,
                hintVisibleInitially,
                hintHiddenAfterKey2,
                hasNextBtn,
                noAdvanceOnCardClick: !stateAfterCardClick.stepsDone[0],
                walkthroughAllDone: afterStep5.allDone,
                stepsProgression: [afterStep1.stepsDone[0], afterStep2.stepsDone[1], afterStep3.stepsDone[2], afterStep4.stepsDone[3], afterStep5.stepsDone[4]],
                keyframeCountAfterWalkthrough: keyframeCount,
                playedAtStep5: isPlaying,
                helpMenuPresent,
                keyRefModalPresent
              });
            })().catch(e => done({ error: e.message }));
        """)
        assert "error" not in discoverability, f"Discoverability error: {discoverability}"
        assert len(discoverability["missingTooltips"]) == 0, f"Missing key tooltips: {discoverability['missingTooltips']}"
        assert discoverability["hintVisibleInitially"] and discoverability["hintHiddenAfterKey2"], "Empty-timeline hint behavior failed"
        assert not discoverability["hasNextBtn"] and discoverability["noAdvanceOnCardClick"], "Walkthrough must not advance without real action"
        assert discoverability["walkthroughAllDone"] and discoverability["keyframeCountAfterWalkthrough"] >= 2 and discoverability["playedAtStep5"], f"Walkthrough failed: {discoverability}"
        assert discoverability["helpMenuPresent"] and discoverability["keyRefModalPresent"], "Help menu / Key Reference failed"
        log_metric("discoverability", "tooltips_with_keys", discoverability["totalTooltipChecked"], "buttons", {"missing": 0})
        log_metric("discoverability", "walkthrough_5steps_completed", True, "bool", {"keyframes": discoverability["keyframeCountAfterWalkthrough"]})

        # 3. R2 §1: Live Browser 4,000 px/s Mouse Drag (Preview vs Commit + Constant Width) & 150° Zig-Zag
        r2_stroke_browser = driver.execute_async_script("""
            const done = arguments[arguments.length - 1];
            (async () => {
              const C = window.SpeedsterCore;
              const app = window.SpeedsterApp;
              app.loadDoc(C.createDocument());
              app.selectTool('brush');
              const canvas = document.getElementById('stage-canvas');
              const rect = canvas.getBoundingClientRect();
              const startX = rect.left + 120, startY = rect.top + 160;

              canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 10, pointerType: 'mouse', clientX: startX, clientY: startY, bubbles: true }));
              const dxPerFrame = 4000 / 60;
              for (let f = 1; f <= 6; f++) {
                await new Promise(r => setTimeout(r, 17));
                const batch = [];
                for (let c = 1; c <= 6; c++) {
                  const frac = (f - 1 + c / 6);
                  batch.push(new PointerEvent('pointermove', {
                    pointerId: 10, pointerType: 'mouse',
                    clientX: startX + frac * dxPerFrame,
                    clientY: startY + Math.sin(frac * 0.8) * 6,
                    bubbles: true
                  }));
                }
                const ev = new PointerEvent('pointermove', {
                  pointerId: 10, pointerType: 'mouse',
                  clientX: batch[5].clientX, clientY: batch[5].clientY, bubbles: true
                });
                ev.getCoalescedEvents = () => batch;
                canvas.dispatchEvent(ev);
              }
              await new Promise(r => requestAnimationFrame(r));
              // Capture live preview ink pixel count on stage canvas
              const ctx = canvas.getContext('2d');
              const prevData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
              let previewInkPx = 0;
              for (let i = 0; i < prevData.length; i += 4) {
                if (prevData[i + 2] > 200 && prevData[i] < 130) previewInkPx++;
              }

              canvas.dispatchEvent(new PointerEvent('pointerup', {
                pointerId: 10, pointerType: 'mouse',
                clientX: startX + 6 * dxPerFrame, clientY: startY, bubbles: true
              }));
              await new Promise(r => requestAnimationFrame(r));
              const commData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
              let commitInkPx = 0;
              for (let i = 0; i < commData.length; i += 4) {
                if (commData[i + 2] > 200 && commData[i] < 130) commitInkPx++;
              }

              const kf = app.getDoc().mainTimeline.layers[0].keyframes[0];
              const faces = kf.planarMap.faces.filter(f => f.fill);
              const holes = faces.reduce((a, f) => a + f.holes.length, 0);
              const previewCommitDiffPct = previewInkPx > 0 ? Math.abs(commitInkPx - previewInkPx) / previewInkPx * 100 : 100;

              // 150° zig-zag in browser
              app.loadDoc(C.createDocument());
              app.selectTool('brush');
              const zPts = [
                { x: startX + 40, y: startY + 80 },
                { x: startX + 240, y: startY + 80 },
                { x: startX + 60, y: startY + 115 },
                { x: startX + 260, y: startY + 115 }
              ];
              canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 11, pointerType: 'mouse', clientX: zPts[0].x, clientY: zPts[0].y, bubbles: true }));
              for (let i = 1; i < zPts.length; i++) {
                await new Promise(r => setTimeout(r, 17));
                canvas.dispatchEvent(new PointerEvent('pointermove', { pointerId: 11, pointerType: 'mouse', clientX: zPts[i].x, clientY: zPts[i].y, bubbles: true }));
              }
              canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 11, pointerType: 'mouse', clientX: zPts[3].x, clientY: zPts[3].y, bubbles: true }));
              const zzFaces = app.getDoc().mainTimeline.layers[0].keyframes[0].planarMap.faces.filter(f => f.fill);
              const zzHoles = zzFaces.reduce((a, f) => a + f.holes.length, 0);

              done({
                fastDragFaces: faces.length,
                fastDragHoles: holes,
                previewInkPx,
                commitInkPx,
                previewCommitDiffPct: Number(previewCommitDiffPct.toFixed(2)),
                zigzagFaces: zzFaces.length,
                zigzagHoles: zzHoles
              });
            })().catch(e => done({ error: e.message }));
        """)
        assert "error" not in r2_stroke_browser, f"R2 browser stroke error: {r2_stroke_browser}"
        assert r2_stroke_browser["fastDragFaces"] == 1 and r2_stroke_browser["fastDragHoles"] == 0, f"Fast drag failed: {r2_stroke_browser}"
        assert r2_stroke_browser["previewCommitDiffPct"] <= 15.0, f"Preview vs commit diverged: {r2_stroke_browser}"
        assert r2_stroke_browser["zigzagFaces"] == 1 and r2_stroke_browser["zigzagHoles"] == 0, f"150° zig-zag failed: {r2_stroke_browser}"
        log_metric("r2_strokes", "fast_4000pxs_preview_vs_commit_diff_pct", r2_stroke_browser["previewCommitDiffPct"], "%", r2_stroke_browser)

        # 4. XSS probe on layer name (R1 mutant #12)
        xss_ok = driver.execute_script("""
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
        assert not xss_ok["triggered"] and xss_ok["renderedLiterally"], f"XSS probe failed: {xss_ok}"
        log_metric("security", "xss_layer_name_blocked", True, "bool")

        # 5. Canvas2D vs Reference Rasteriser comparison on Masked Scene (R1 mutant #16)
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
        within_tol = sum(
            1 for i in range(0, len(ref_data), 4)
            if max(abs(ref_data[i] - c2d_data[i]), abs(ref_data[i+1] - c2d_data[i+1]), abs(ref_data[i+2] - c2d_data[i+2])) <= 24
        )
        match_pct = round(100.0 * within_tol / total_px, 3)
        assert match_pct >= 98.0, f"Canvas2D vs Reference match {match_pct}% < 98.0%"
        log_metric("rendering", "canvas2d_vs_ref_rasteriser_match_pct", match_pct, "%", {"toleranceChannelDiff": 24})

        # 6. Browser OfflineAudioContext test
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
        assert "error" not in audio_browser and audio_browser["beforeVal"] < 0.01 and audio_browser["atVal"] > 0.2
        log_metric("audio", "offline_audio_context_onset_sample", audio_browser["expectedOnset"], "samples", audio_browser)

        # 7. FEEL Benchmarks on 500-shape document (R2 §5: direct-shape drag latency + >=10s playback fps!)
        feel = driver.execute_async_script("""
            const done = arguments[arguments.length - 1];
            (async () => {
              const C = window.SpeedsterCore;
              const app = window.SpeedsterApp;
              const doc = C.createDocument({ stageWidth: 550 * 20, stageHeight: 400 * 20, fps: 24 });
              doc.mainTimeline.totalFrames = 48;
              const rng = C.createSeededRng(500);
              const kf = doc.mainTimeline.layers[0].keyframes[0];
              // Add one planar rectangle on top for direct-shaping drag latency test
              kf.planarMap = C.addFill(kf.planarMap, C.makeRectPath(2000, 1500, 2400, 1600),
                { type: 'solid', color: C.rgba(79, 140, 255, 220) },
                { color: C.rgba(20, 20, 30, 255), width: 40 }).map;
              for (let i = 0; i < 499; i++) {
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

              const canvas = document.getElementById('stage-canvas');
              const rect = canvas.getBoundingClientRect();

              // 7a. Input-to-pixels latency (25 synthetic brush pointermoves)
              app.selectTool('brush');
              canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 20, pointerType: 'mouse', clientX: rect.left + 120, clientY: rect.top + 120, bubbles: true }));
              for (let i = 1; i <= 25; i++) {
                canvas.dispatchEvent(new PointerEvent('pointermove', { pointerId: 20, pointerType: 'mouse', clientX: rect.left + 120 + i * 10, clientY: rect.top + 120 + (i % 5) * 8, bubbles: true }));
                await new Promise(r => requestAnimationFrame(r));
              }
              canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 20, pointerType: 'mouse', clientX: rect.left + 370, clientY: rect.top + 120, bubbles: true }));

              // 7b. Direct-shape drag latency (§5): drag top edge midpoint of planar rect (3200, 1500 twips)
              app.selectTool('select');
              const st = app.getState();
              const edgeScreenX = rect.left + st.panX + (3200 / C.TWIPS_PER_PX) * st.zoom;
              const edgeScreenY = rect.top + st.panY + (1500 / C.TWIPS_PER_PX) * st.zoom;
              canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 21, pointerType: 'mouse', clientX: edgeScreenX, clientY: edgeScreenY, bubbles: true }));
              for (let i = 1; i <= 25; i++) {
                canvas.dispatchEvent(new PointerEvent('pointermove', { pointerId: 21, pointerType: 'mouse', clientX: edgeScreenX, clientY: edgeScreenY - i * 2, bubbles: true }));
              }
              canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 21, pointerType: 'mouse', clientX: edgeScreenX, clientY: edgeScreenY - 50, bubbles: true }));

              // 7c. Live scrubbing frame time (30 frames)
              for (let f = 0; f < 30; f++) app.setCurrentFrame(f % 48, true);

              // 7d. Zoom & pan frame time (20 wheel events)
              for (let i = 0; i < 20; i++) {
                canvas.dispatchEvent(new WheelEvent('wheel', {
                  clientX: rect.left + 300, clientY: rect.top + 200,
                  deltaY: (i % 2 === 0 ? -100 : 100), bubbles: true, cancelable: true
                }));
              }

              const savedInputLat = app.getMetrics().inputToPixelLatenciesMs.slice();
              const savedDirectDragLat = app.getMetrics().directShapeDragLatenciesMs.slice();
              const savedScrubTimes = app.getMetrics().scrubFrameTimesMs.slice();
              const savedZoomPanTimes = app.getMetrics().zoomPanFrameTimesMs.slice();

              // 7e. Playback achieved FPS over >= 10 seconds at 12, 24, 30 fps (§5)
              const playbackResults = {};
              for (const targetFps of [12, 24, 30]) {
                doc.fps = targetFps;
                app.resetMetrics();
                app.togglePlayback();
                const startT = performance.now();
                await new Promise(r => setTimeout(r, 10050));
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
                directShapeDragLatenciesMs: savedDirectDragLat,
                scrubFrameTimesMs: savedScrubTimes,
                zoomPanFrameTimesMs: savedZoomPanTimes,
                playback: playbackResults
              });
            })().catch(e => done({ error: e.message }));
        """)
        assert "error" not in feel, f"FEEL benchmark error: {feel}"
        assert len(feel["directShapeDragLatenciesMs"]) > 0, "Direct-shape drag latency was not captured!"

        feel_summary = {
            "inputToPixelMedianMs": percentile(feel["inputToPixelLatenciesMs"], 50),
            "inputToPixelP95Ms": percentile(feel["inputToPixelLatenciesMs"], 95),
            "directShapeDragMedianMs": percentile(feel["directShapeDragLatenciesMs"], 50),
            "directShapeDragP95Ms": percentile(feel["directShapeDragLatenciesMs"], 95),
            "scrubFrameMedianMs": percentile(feel["scrubFrameTimesMs"], 50),
            "scrubFrameP95Ms": percentile(feel["scrubFrameTimesMs"], 95),
            "zoomPanFrameMedianMs": percentile(feel["zoomPanFrameTimesMs"], 50),
            "zoomPanFrameP95Ms": percentile(feel["zoomPanFrameTimesMs"], 95),
            "playback": feel["playback"],
        }
        log_metric("feel_500shapes", "input_to_pixel_latency_median_ms", feel_summary["inputToPixelMedianMs"], "ms", {"p95_ms": feel_summary["inputToPixelP95Ms"], "samples": len(feel["inputToPixelLatenciesMs"])})
        log_metric("feel_500shapes", "direct_shape_drag_latency_median_ms", feel_summary["directShapeDragMedianMs"], "ms", {"p95_ms": feel_summary["directShapeDragP95Ms"], "samples": len(feel["directShapeDragLatenciesMs"])})
        log_metric("feel_500shapes", "scrub_frame_time_median_ms", feel_summary["scrubFrameMedianMs"], "ms", {"p95_ms": feel_summary["scrubFrameP95Ms"], "samples": len(feel["scrubFrameTimesMs"])})
        log_metric("feel_500shapes", "zoom_pan_frame_time_median_ms", feel_summary["zoomPanFrameMedianMs"], "ms", {"p95_ms": feel_summary["zoomPanFrameP95Ms"], "samples": len(feel["zoomPanFrameTimesMs"])})
        for fps_key in ["12", "24", "30"]:
            pb = feel["playback"][fps_key]
            log_metric("feel_500shapes", f"playback_achieved_fps_{fps_key}", pb["achievedFps"], "fps", pb)

        # 8. 5 MB Sound IndexedDB Kill-and-Reopen Survival Test
        saved_5mb = driver.execute_async_script("""
            const done = arguments[arguments.length - 1];
            (async () => {
              const C = window.SpeedsterCore;
              const app = window.SpeedsterApp;
              const doc = C.createDocument({ fps: 24 });
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
        assert saved_5mb.get("ok"), f"5MB IDB autosave failed: {saved_5mb}"

        driver.get("about:blank")
        time.sleep(0.2)
        driver.get(url)
        time.sleep(0.9)

        restored = driver.execute_script("""
            const app = window.SpeedsterApp;
            return { restoredHash: app.getDocHash() };
        """)
        assert restored["restoredHash"] == saved_5mb["expectedHash"], "5MB IDB kill-and-reopen hash mismatch!"
        log_metric("persistence", "autosave_5mb_wav_kill_reopen", True, "bool", {"soundBytes": saved_5mb["soundBytes"], "restoredHash": restored["restoredHash"]})

        # Write results.jsonl (§5)
        JSONL_PATH.write_text("\n".join(json.dumps(r) for r in jsonl_records) + "\n", encoding="utf-8")

        report = {
            "suite": "09-browser-feel-and-integration",
            "passed": True,
            "machine": machine_info,
            "browser": gpu_info,
            "discoverability": discoverability,
            "r2StrokeBrowser": r2_stroke_browser,
            "xssProbe": xss_ok,
            "canvas2dVsReferenceRasteriser": {
                "matchingPixelsPercent": match_pct,
                "toleranceChannelDiff": 24,
                "insidePixel": canvas_rgba["insidePixel"],
                "outsidePixel": canvas_rgba["outsidePixel"],
            },
            "offlineAudioBrowser": audio_browser,
            "autosave5MBKillReopen": {
                "soundBytes": saved_5mb["soundBytes"],
                "survived": True,
                "restoredHash": restored["restoredHash"],
            },
            "feel500Shapes": feel_summary,
        }
        (RESULTS_DIR / "09-browser-feel.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"PASS 09-browser-feel-and-integration (walkthrough=5/5, tooltips={discoverability['totalTooltipChecked']}/{discoverability['totalTooltipChecked']}, drag p50={feel_summary['directShapeDragMedianMs']}ms, 10s fps={feel_summary['playback']['24']['achievedFps']}@24)")
    finally:
        driver.quit()
        httpd.shutdown()


if __name__ == "__main__":
    main()
