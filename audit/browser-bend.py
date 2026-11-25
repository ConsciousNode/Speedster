#!/usr/bin/env python3
"""Kehai's direct-shaping probe: draw a line and a rectangle, then selection-drag the middle of each edge with the
mouse. The spec says dragging the middle of a line bends it into a curve. Prints how many pixels changed and
screenshots before/after. Usage: python3 browser-bend.py <speedster.html> <outdir>"""
import sys, pathlib
from playwright.sync_api import sync_playwright
from PIL import Image, ImageChops
html = pathlib.Path(sys.argv[1]).resolve(); out = pathlib.Path(sys.argv[2]); out.mkdir(exist_ok=True)
def drag(pg, a, b, steps=15):
    pg.mouse.move(*a); pg.mouse.down(); pg.mouse.move(*b, steps=steps); pg.mouse.up(); pg.wait_for_timeout(300)
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 900})
    pg.goto(html.as_uri()); pg.wait_for_timeout(1200)
    pg.click("text=LIN"); drag(pg, (300, 450), (900, 450))
    pg.click("text=RCT"); drag(pg, (400, 150), (700, 350))
    pg.screenshot(path=str(out / "bend-before.png"))
    pg.click("text=SEL")
    for i, (a, b) in enumerate([((600, 450), (600, 560)), ((550, 150), (550, 90)), ((700, 250), (780, 250))]):
        before = pg.screenshot(); drag(pg, a, b)
        after = pg.screenshot()
        import io
        d = ImageChops.difference(Image.open(io.BytesIO(before)).convert('RGB'), Image.open(io.BytesIO(after)).convert('RGB'))
        print(f"drag {i} {a}->{b}: changed bbox {d.getbbox()}  status: {pg.evaluate('() => document.body.innerText.split(String.fromCharCode(10)).slice(-2).join(\" | \")')}")
    pg.screenshot(path=str(out / "bend-after.png"))
    br.close()
