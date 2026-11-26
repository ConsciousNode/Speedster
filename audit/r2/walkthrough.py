#!/usr/bin/env python3
"""Kehai, Speedster R2 audit: drive the first-run walkthrough the way a new user would (Playwright, real mouse and
keyboard, no app internals). After each action, read which walkthrough step is highlighted. Also: does clicking the
card advance anything; does it play afterwards. Usage: walkthrough.py <speedster.html> <outdir>"""
import sys, pathlib
from playwright.sync_api import sync_playwright
html = pathlib.Path(sys.argv[1]).resolve(); out = pathlib.Path(sys.argv[2]); out.mkdir(exist_ok=True)
errs = []
STEP_JS = """() => { const c = [...document.querySelectorAll('*')].find(e => /Make your first animation/.test(e.textContent) && e.children.length > 2 && e.getBoundingClientRect().width < 400);
  if (!c) return 'no card'; return (c.innerText || '').replace(/\\s+/g, ' ').slice(0, 400); }"""
def state(pg): return pg.evaluate(STEP_JS)
def frame_label(pg): return pg.evaluate("() => (document.body.innerText.match(/F \\d+ \\/ \\d+/) || [''])[0]")
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(html.as_uri()); pg.wait_for_timeout(1500)
    hl = lambda: pg.evaluate("""() => [...document.querySelectorAll('li, div')].filter(e => /^\\s*[1-5]\\./.test(e.innerText||'') && getComputedStyle(e).borderColor && e.getBoundingClientRect().x > 880).map(e => [ (e.innerText||'').slice(0,30), getComputedStyle(e).backgroundColor, getComputedStyle(e).opacity ]).slice(0,5)""")
    print("0 start:", frame_label(pg)); print("   steps:", hl())
    pg.mouse.click(1000, 200); pg.wait_for_timeout(300)   # click on the card body without acting
    print("0b clicked card:", hl()[:2])
    pg.mouse.move(350, 250); pg.mouse.down(); pg.mouse.move(450, 330, steps=10); pg.mouse.move(550, 260, steps=10); pg.mouse.up(); pg.wait_for_timeout(400)
    print("1 drew:", hl()[:3])
    # click frame 10 cell on the timeline (gold box); find it by the gold border
    box = pg.evaluate("""() => { const e = [...document.querySelectorAll('*')].find(e => { const s = getComputedStyle(e); return /rgb\\(2(1|2|3|4|5)\\d, 1[5-9]\\d, \\d+\\)/.test(s.borderColor) && e.getBoundingClientRect().y > 650; }); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2]; }""")
    print("   gold cell at:", box)
    pg.mouse.click(353, 724); pg.wait_for_timeout(400)   # frame 10 cell, under the gold ruler box (screenshot 00)
    print("2 clicked frame 10:", frame_label(pg), hl()[:3])
    pg.keyboard.press("F6"); pg.wait_for_timeout(300)
    pg.mouse.move(600, 400); pg.mouse.down(); pg.mouse.move(750, 450, steps=10); pg.mouse.up(); pg.wait_for_timeout(400)
    print("3 key + changed:", hl()[:4])
    pg.keyboard.press("u"); pg.wait_for_timeout(300)
    print("4 onion:", hl())
    pg.screenshot(path=str(out / "wt-4-onion.png"))
    pg.keyboard.press("Enter"); pg.wait_for_timeout(1200)
    print("5 play:", frame_label(pg), "| card:", state(pg)[:200])
    pg.screenshot(path=str(out / "wt-5-play.png"))
    b.close()
print("errors:", errs[:5])
