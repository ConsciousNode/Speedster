#!/usr/bin/env python3
"""Kehai, Speedster R2 audit: wrap SpeedsterCore.buildBrushCapsulePolygons / addFillUnion in the real page (read-only
logging), draw the burst V, and report how many strokes/points/capsules the app committed and filled faces after.
Usage: instrument.py <speedster.html>"""
import sys, pathlib, json
from playwright.sync_api import sync_playwright
html = pathlib.Path(sys.argv[1]).resolve()
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.goto(html.as_uri()); pg.wait_for_timeout(1500)
    if pg.locator("text=Dismiss").count(): pg.locator("text=Dismiss").first.click()
    pg.locator("text=BRS").first.click()
    print(pg.evaluate("""() => { const C = window.SpeedsterCore; if (!C) return 'no SpeedsterCore';
      window.__log = []; const bb = C.buildBrushCapsulePolygons, fu = C.addFillUnion;
      C.buildBrushCapsulePolygons = function (pts, o) { const r = bb.apply(this, arguments);
        window.__log.push({ fn: 'build', n: pts.length, opts: JSON.stringify(o).slice(0, 160), pts: pts.map(q => [Math.round(q.x), Math.round(q.y)]) }); return r; };
      C.addFillUnion = function (m, polys) { const r = fu.apply(this, arguments);
        window.__log.push({ fn: 'union', polys: polys.length, faces: r.map.faces.filter(f => f.fill).length, ok: r.ok, fb: r.fallback }); return r; };
      return 'wrapped'; }"""))
    pts = [(300, 100), (420, 170), (560, 100)]
    pg.mouse.move(*pts[0]); pg.mouse.down()
    for pt in pts[1:]: pg.mouse.move(*pt, steps=10)
    pg.mouse.up(); pg.wait_for_timeout(500)
    log = pg.evaluate("() => window.__log")
    for e in log: print({k: (v if k != 'pts' else v) for k, v in e.items()})
    b.close()
