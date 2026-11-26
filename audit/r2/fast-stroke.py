#!/usr/bin/env python3
"""Kehai's independent fast-stroke check (Speedster R2 audit). Real Playwright mouse events, no app internals.
Brush (default tool), fresh profile. Draws a fast zig-zag (~70 px per pointer event, i.e. ~4,200 px/s at 60 Hz)
and a fast long sweep, then counts connected blobs of stroke-coloured pixels in a screenshot of the stage, and
measures stroke thickness across the sweep. Usage: fast-stroke.py <speedster.html> <outdir> <label>"""
import sys, pathlib, json
import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright
html = pathlib.Path(sys.argv[1]).resolve(); out = pathlib.Path(sys.argv[2]); out.mkdir(exist_ok=True); lab = sys.argv[3]
def components(mask):
    h, w = mask.shape; seen = np.zeros_like(mask, bool); sizes = []
    for y0, x0 in zip(*np.nonzero(mask)):
        if seen[y0, x0]: continue
        st = [(y0, x0)]; seen[y0, x0] = True; n = 0
        while st:
            y, x = st.pop(); n += 1
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    yy, xx = y+dy, x+dx
                    if 0 <= yy < h and 0 <= xx < w and mask[yy, xx] and not seen[yy, xx]:
                        seen[yy, xx] = True; st.append((yy, xx))
        sizes.append(n)
    return sorted(sizes, reverse=True)
res = {}
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1440, "height": 900})
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(html.as_uri()); pg.wait_for_timeout(1500)
    for t in ("text=Dismiss", "text=Close"):
        if pg.locator(t).count(): pg.locator(t).first.click(); pg.wait_for_timeout(200)
    pg.locator("text=BRS").first.click()
    # fast zig-zag: 70 px per event, sharp turns
    zz = [(260 + 70*i, 160 if i % 2 == 0 else 300) for i in range(10)]
    pg.mouse.move(*zz[0]); pg.mouse.down()
    for pt in zz[1:]: pg.mouse.move(*pt, steps=1); pg.wait_for_timeout(16)
    pg.mouse.up(); pg.wait_for_timeout(400)
    # fast horizontal sweep, 70 px per event
    pg.mouse.move(260, 480); pg.mouse.down()
    for x in range(330, 960, 70): pg.mouse.move(x, 480 + (8 if (x//70) % 2 else -8), steps=1); pg.wait_for_timeout(16)
    pg.mouse.up(); pg.wait_for_timeout(500)
    pg.screenshot(path=str(out / f"{lab}-fast.png"), clip={"x": 211, "y": 59, "width": 794, "height": 576})
    res["errors"] = errs[:5]
    b.close()
im = np.asarray(Image.open(out / f"{lab}-fast.png").convert("RGB")).astype(int)
r, g, bl = im[..., 0], im[..., 1], im[..., 2]
ink = (bl > 150) & (r < 140) & (bl - r > 60)          # the default blue fill
top, bot = ink[:300], ink[360:]
res["zigzag_components(>=20px)"] = [s for s in components(top) if s >= 20]
res["sweep_components(>=20px)"] = [s for s in components(bot) if s >= 20]
cols = [int(bot[:, x].sum()) for x in range(80, 680, 20)]
res["sweep_thickness_px_every20"] = cols
res["sweep_thickness_min_max"] = [min(cols), max(cols)]
print(json.dumps(res))
