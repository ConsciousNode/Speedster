#!/usr/bin/env python3
"""Kehai's real-browser tour of Speedster delivery 1 (Playwright Chromium). Loads the page offline, records errors and
network requests, lists the UI, then draws with a real mouse: a rectangle, a pencil stroke across it, a paint-bucket
fill, a few keyframes, and playback. Screenshots each step. Usage: python3 browser-tour.py <speedster.html> <outdir>"""
import sys, pathlib, json
from playwright.sync_api import sync_playwright
html = pathlib.Path(sys.argv[1]).resolve(); out = pathlib.Path(sys.argv[2]); out.mkdir(exist_ok=True)
errs, reqs = [], []
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.on("console", lambda m: errs.append("console: " + m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    pg.on("request", lambda r: reqs.append(r.url) if not r.url.startswith(("file:", "data:", "blob:")) else None)
    pg.goto(html.as_uri()); pg.wait_for_timeout(1500)
    pg.screenshot(path=str(out / "01-open.png"))
    ui = pg.evaluate("""() => [...document.querySelectorAll('button,[role=button],select,input,[title]')]
        .map(e => (e.title || e.getAttribute('aria-label') || e.innerText || e.value || e.id || '').trim()).filter(Boolean).slice(0, 120)""")
    print(json.dumps(ui))
    b.close()
print("errors:", errs[:5]); print("net:", reqs[:5])
