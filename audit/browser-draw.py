#!/usr/bin/env python3
"""Kehai's hands-on drawing pass on Speedster delivery 1 (Playwright Chromium, real mouse events).
Rectangle -> pencil stroke across it (merge model should split the fill) -> bucket-fill one half a new colour ->
selection-drag the middle of the stroke (should bend into a curve) -> new keyframe at frame 12 with an ellipse ->
onion skin -> play. Screenshots each step; prints status-bar text and errors.
Usage: python3 browser-draw.py <speedster.html> <outdir>"""
import sys, pathlib
from playwright.sync_api import sync_playwright
html = pathlib.Path(sys.argv[1]).resolve(); out = pathlib.Path(sys.argv[2]); out.mkdir(exist_ok=True)
errs = []
def status(pg): return pg.evaluate("() => (document.body.innerText.match(/(Ready|Merge|Object|Fallback|Fill|Stroke|Bent|Curve|Key|Frame|Saved|fallback)[^\\n]{0,120}/g)||[]).slice(-3)")
def drag(pg, pts, steps=12):
    pg.mouse.move(*pts[0]); pg.mouse.down()
    for a, b in zip(pts, pts[1:]):
        pg.mouse.move(*b, steps=steps)
    pg.mouse.up(); pg.wait_for_timeout(300)
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.goto(html.as_uri()); pg.wait_for_timeout(1200)
    pg.click("text=RCT"); drag(pg, [(350, 180), (850, 500)])
    pg.screenshot(path=str(out / "02-rect.png")); print("rect:", status(pg))
    pg.click("text=PNC"); drag(pg, [(300, 340), (450, 300), (600, 380), (750, 330), (900, 360)], steps=8)
    pg.screenshot(path=str(out / "03-stroke.png")); print("stroke:", status(pg))
    pg.fill("input[type=color] >> nth=0", "#ff4466") if pg.locator("input[type=color]").count() else None
    pg.click("text=BKT"); pg.mouse.click(600, 450); pg.wait_for_timeout(300)
    pg.screenshot(path=str(out / "04-bucket.png")); print("bucket:", status(pg))
    pg.click("text=SEL"); drag(pg, [(380, 180), (380, 120)], steps=10)
    pg.screenshot(path=str(out / "05-bend.png")); print("bend:", status(pg))
    pg.mouse.click(507, 723); pg.wait_for_timeout(200)  # frame ~21 on the ruler
    pg.click("text=+Key"); pg.click("text=ELP"); drag(pg, [(700, 200), (820, 300)])
    pg.click("text=Onion: OFF"); pg.wait_for_timeout(300)
    pg.screenshot(path=str(out / "06-key-onion.png")); print("key:", status(pg))
    pg.click("text=Play"); pg.wait_for_timeout(1500); pg.screenshot(path=str(out / "07-play.png"))
    doc = pg.evaluate("() => { try { const s = (window.Speedster||window.SPEEDSTER||{}); return Object.keys(s).slice(0,30) } catch(e) { return String(e) } }")
    print("globals:", doc)
    b.close()
print("errors:", errs[:5])
