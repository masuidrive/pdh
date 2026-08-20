#!/usr/bin/env python3
"""判断ボード kit v2 — token の知覚コントラスト検査（APCA-W3 0.0.98G-4g）。

tokens.css を書き換えたら実行する。目標:
  本文 ink/(paper|bg|fill) |Lc| >= 90 / 補足 muted >= 60 / accent・ok・warn 字 >= 60
  罫線 line/paper >= 25（形状の輪郭 — 装飾ではない）/ on-accent/accent >= 60
面どうし（bg/paper, fill/paper）は APCA でなく WCAG 輝度比 >= 1.08 で測る
（面の形は輝度差でなく輪郭 line が担う設計。1.08 は「同色に潰れていない」の下限）。
usage: python3 check-contrast.py [tokens.css]
"""
import re, sys, pathlib

def Y(h):
    h = h.lstrip('#'); r, g, b = (int(h[i:i+2], 16)/255.0 for i in (0, 2, 4))
    return 0.2126729*r**2.4 + 0.7151522*g**2.4 + 0.0721750*b**2.4

def lc(t, b):
    c = lambda y: y + (0.022-y)**1.414 if y < 0.022 else y
    yt, yb = c(Y(t)), c(Y(b))
    if yb > yt: s = (yb**0.56 - yt**0.57)*1.14; o = 0 if s < 0.1 else s-0.027
    else:       s = (yb**0.65 - yt**0.62)*1.14; o = 0 if s > -0.1 else s+0.027
    return o*100

def ratio(a, b):
    ya, yb = Y(a)+0.05, Y(b)+0.05
    return max(ya, yb)/min(ya, yb)

def parse(block):
    return dict(re.findall(r'--([a-z-]+)\s*:\s*(#[0-9a-fA-F]{6})', block))

src = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else pathlib.Path(__file__).parent/'tokens.css').read_text()
mdark = re.search(r'prefers-color-scheme:dark.*?\{(.*?)\}\}', src, re.S)
light = parse(src[:src.find('@media')])
dark = parse(mdark.group(1))

TEXT = [('ink','paper',90),('ink','bg',90),('ink','fill',90),('muted','paper',60),('muted','bg',60),
        ('accent','paper',60),('accent','accent-soft',60),('ok','ok-soft',60),('warn','warn-soft',60),
        ('on-accent','accent',60),('ink','mark',90)]
LINE = [('line','paper',25)]
# 塗り«だけ»で意味を運ぶ面（輪郭を持たない使い方がある面）には bg / paper 両方に下限を課す:
#   mark（帯）と accent-soft（compare の推奨列セルが塗り単独で使う）。
# ok-soft / warn-soft は常に濃色の字・線・輪郭と組で使う面なので、単独の面検査は課さない。
SURF = [('paper','bg',1.08),('fill','paper',1.08),('mark','bg',1.08),('mark','paper',1.08),
        ('accent-soft','bg',1.08),('accent-soft','paper',1.08)]
fail = 0
for name, toks in (('light', light), ('dark', dark)):
    for t, b, goal in TEXT + LINE:
        v = lc(toks[t], toks[b])
        ok = abs(v) >= goal
        fail += (not ok)
        print(('OK ' if ok else 'NG '), f'{name} {t}/{b}: Lc {v:6.1f} (|{goal}|)')
    for a, b, goal in SURF:
        v = ratio(toks[a], toks[b])
        ok = v >= goal
        fail += (not ok)
        print(('OK ' if ok else 'NG '), f'{name} {a}/{b}: ratio {v:.2f} (>={goal})')
sys.exit(1 if fail else 0)
