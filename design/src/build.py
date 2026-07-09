#!/usr/bin/env python3
import sys, os
BASE = os.path.dirname(os.path.abspath(__file__))

def read(p):
    with open(os.path.join(BASE, p), encoding="utf-8") as f:
        return f.read()

fonts = read("fonts.css")
tokens = read("tokens.css")

for src, dst in [("design-system.src.html", "design-system.html"),
                 ("architecture.src.html", "architecture.html")]:
    if not os.path.exists(os.path.join(BASE, src)):
        continue
    html = read(src)
    html = html.replace("/*@@FONTS@@*/", fonts)
    html = html.replace("/*@@TOKENS@@*/", tokens)
    with open(os.path.join(BASE, dst), "w", encoding="utf-8") as f:
        f.write(html)
    kb = len(html.encode("utf-8")) // 1024
    print(f"built {dst}: {kb}KB")
