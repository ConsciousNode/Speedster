import sys, pathlib
from playwright.sync_api import sync_playwright
html = pathlib.Path(sys.argv[1]).resolve(); out = pathlib.Path(sys.argv[2]); out.mkdir(exist_ok=True)
errs=[]
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.goto(html.as_uri()); pg.wait_for_timeout(1500)
    pg.screenshot(path=str(out/"00-first-open.png"))
    print(pg.evaluate("() => document.body.innerText.slice(0,1500)"))
    print("buttons:", pg.evaluate("() => [...document.querySelectorAll('button')].map(b=>(b.innerText||b.title||'').trim()+' | '+(b.title||'')).slice(0,60)"))
    b.close()
print("errors:", errs[:5])
