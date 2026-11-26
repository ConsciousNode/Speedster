#!/usr/bin/env python3
"""Kehai: fast stroke with real Chromium coalescing. Sends 6 CDP mouseMoved events back-to-back per ~16 ms frame
(4,000+ px/s), so Chromium batches them into one pointermove with getCoalescedEvents(), as a fast real mouse does.
Counts how many coalesced events per pointermove the page actually saw, then measures stroke thickness.
Usage: coalesced-stroke.py <speedster.html> <outdir> <label>"""
import sys, pathlib, json, time
import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright
html = pathlib.Path(sys.argv[1]).resolve(); out = pathlib.Path(sys.argv[2]); out.mkdir(exist_ok=True); lab = sys.argv[3]
res = {}
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.goto(html.as_uri()); pg.wait_for_timeout(1500)
    if pg.locator("text=Dismiss").count(): pg.locator("text=Dismiss").first.click()
    pg.locator("text=BRS").first.click(); pg.wait_for_timeout(200)
    pg.evaluate("""() => { window.__k = []; addEventListener('pointermove', e => {
        const c = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
        window.__k.push([c.length, new Set(c.map(x => x.timeStamp)).size]); }, true); }""")
    cdp = pg.context.new_cdp_session(pg)
    def ev(t, x, y, btn="left"):
        cdp.send("Input.dispatchMouseEvent", {"type": t, "x": x, "y": y, "button": btn, "buttons": 1 if t != "mouseReleased" else 0, "clickCount": 1})
    x, y = 260, 300
    ev("mouseMoved", x, y, "none"); ev("mousePressed", x, y)
    for frame in range(14):
        for k in range(6):
            x += 9; y = 300 + (12 if (x // 27) % 2 else -12)
            ev("mouseMoved", x, y)
        time.sleep(0.016)
    ev("mouseReleased", x, y); pg.wait_for_timeout(600)
    k = pg.evaluate("() => window.__k")
    res["pointermoves"] = len(k); res["max_coalesced"] = max(c for c, _ in k) if k else 0
    res["batches_with_shared_stamps"] = sum(1 for c, d in k if c > 1 and d < c)
    pg.screenshot(path=str(out / f"{lab}-coalesced.png"), clip={"x": 211, "y": 200, "width": 794, "height": 200})
    b.close()
im = np.asarray(Image.open(out / f"{lab}-coalesced.png").convert("RGB")).astype(int)
ink = (im[..., 2] > 150) & (im[..., 0] < 140) & (im[..., 2] - im[..., 0] > 60)
cols = [int(ink[:, x].sum()) for x in range(70, 1000 - 211 - 30, 12) if ink[:, x].any() or True]
nz = [c for c in cols if c > 0]
res["thickness_px_samples"] = cols[:60]
res["thickness_min_max_nonzero"] = [min(nz), max(nz)] if nz else None
res["gaps(columns with no ink inside stroke span)"] = sum(1 for c in cols[cols.index(nz[0]):len(cols)-cols[::-1].index(nz[-1])] if c == 0) if nz else None
print(json.dumps(res))
