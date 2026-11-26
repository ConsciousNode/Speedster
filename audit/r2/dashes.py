#!/usr/bin/env python3
"""Kehai, Speedster R2 audit: is the brush stroke broken into dashes when pointer events arrive with near-zero time
between them (Playwright mouse.move(steps=N) fires N events back-to-back, as a fast real mouse's raw events can)?
Draws the same V three ways: steps=10 no waits, steps=10 with 16 ms waits, steps=1 per 70 px. Counts blobs.
Usage: dashes.py <speedster.html> <outdir> <label>"""
import sys, pathlib, json, numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright
html = pathlib.Path(sys.argv[1]).resolve(); out = pathlib.Path(sys.argv[2]); lab = sys.argv[3]
def blobs(mask):
    from collections import deque
    h, w = mask.shape; seen = np.zeros_like(mask, bool); n = []
    for y0, x0 in zip(*np.nonzero(mask)):
        if seen[y0, x0]: continue
        q = deque([(y0, x0)]); seen[y0, x0] = True; c = 0
        while q:
            y, x = q.popleft(); c += 1
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    yy, xx = y + dy, x + dx
                    if 0 <= yy < h and 0 <= xx < w and mask[yy, xx] and not seen[yy, xx]: seen[yy, xx] = True; q.append((yy, xx))
        if c >= 15: n.append(c)
    return n
res = {}
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.goto(html.as_uri()); pg.wait_for_timeout(1500)
    if pg.locator("text=Dismiss").count(): pg.locator("text=Dismiss").first.click()
    pg.locator("text=BRS").first.click()
    def V(y0, mode):
        pts = [(300, y0), (420, y0 + 70), (560, y0)]
        pg.mouse.move(*pts[0]); pg.mouse.down()
        for pt in pts[1:]:
            if mode == "burst": pg.mouse.move(*pt, steps=10)
            elif mode == "paced":
                cx, cy = pg.evaluate("() => 0") or 0, 0
                for k in range(1, 11): pg.mouse.move(pts[pts.index(pt)-1][0] + (pt[0]-pts[pts.index(pt)-1][0])*k/10, pts[pts.index(pt)-1][1] + (pt[1]-pts[pts.index(pt)-1][1])*k/10); pg.wait_for_timeout(16)
            else: pg.mouse.move(*pt, steps=1); pg.wait_for_timeout(16)
        pg.mouse.up(); pg.wait_for_timeout(400)
    V(100, "burst"); V(260, "paced"); V(420, "jump")
    pg.screenshot(path=str(out / f"{lab}-dashes.png"), clip={"x": 211, "y": 59, "width": 794, "height": 576})
    b.close()
im = np.asarray(Image.open(out / f"{lab}-dashes.png").convert("RGB")).astype(int)
ink = (im[..., 2] > 150) & (im[..., 0] < 140) & (im[..., 2] - im[..., 0] > 60)
for name, (a, z) in {"burst(0 ms apart)": (20, 170), "paced(16 ms)": (180, 330), "jump(70px/16ms)": (340, 500)}.items():
    res[name] = blobs(ink[a:z])
print(json.dumps(res))
