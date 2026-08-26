#!/usr/bin/env bash
# 判断ボード kit v2 — token の知覚コントラスト検査（APCA-W3 0.0.98G-4g）。
#
# tokens.css を書き換えたら実行する。目標:
#   本文 ink/(paper|bg|fill) |Lc| >= 90 / 補足 muted >= 60 / accent・ok・warn 字 >= 60
#   罫線 line/paper >= 25（形状の輪郭 — 装飾ではない）/ on-accent/accent >= 60
# 面どうし（bg/paper, fill/paper）は APCA でなく WCAG 輝度比 >= 1.08 で測る
# （面の形は輝度差でなく輪郭 line が担う設計。1.08 は「同色に潰れていない」の下限）。
# usage: bash check-contrast.sh [tokens.css]
set -euo pipefail

src="${1:-$(dirname "$0")/tokens.css}"

awk -v FILE="$src" '
function hex2(s,   i, c, n, v) {   # 2 桁 16 進 -> 10 進
  n = 0
  for (i = 1; i <= 2; i++) {
    c = tolower(substr(s, i, 1))
    v = index("0123456789abcdef", c) - 1
    n = n * 16 + v
  }
  return n
}
function Y(h,   r, g, b) {         # APCA の輝度
  sub(/^#/, "", h)
  r = hex2(substr(h, 1, 2)) / 255.0
  g = hex2(substr(h, 3, 2)) / 255.0
  b = hex2(substr(h, 5, 2)) / 255.0
  return 0.2126729 * r^2.4 + 0.7151522 * g^2.4 + 0.0721750 * b^2.4
}
function clamp(y) { return (y < 0.022) ? y + (0.022 - y)^1.414 : y }
function lc(t, b,   yt, yb, s, o) {
  yt = clamp(Y(t)); yb = clamp(Y(b))
  if (yb > yt) { s = (yb^0.56 - yt^0.57) * 1.14; o = (s < 0.1)  ? 0 : s - 0.027 }
  else         { s = (yb^0.65 - yt^0.62) * 1.14; o = (s > -0.1) ? 0 : s + 0.027 }
  return o * 100
}
function ratio(a, b,   ya, yb) {   # WCAG 輝度比
  ya = Y(a) + 0.05; yb = Y(b) + 0.05
  return (ya > yb) ? ya / yb : yb / ya
}
function parse(block, out,   rest, m, kv, k, v) {   # --name:#rrggbb を集める
  rest = block
  while (match(rest, /--[a-z-]+[[:space:]]*:[[:space:]]*#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]/)) {
    kv = substr(rest, RSTART, RLENGTH)
    rest = substr(rest, RSTART + RLENGTH)
    k = kv; sub(/[[:space:]]*:.*$/, "", k); sub(/^--/, "", k)
    v = kv; sub(/^.*#/, "#", v)
    out[k] = v
  }
}
function check(name, toks,   i, t, b, goal, v, ok) {
  for (i = 1; i <= NT; i++) {
    split(TEXT[i], f, " "); t = f[1]; b = f[2]; goal = f[3] + 0
    v = lc(toks[t], toks[b])
    ok = ((v < 0 ? -v : v) >= goal)
    if (!ok) fail++
    printf "%s %s %s/%s: Lc %6.1f (|%d|)\n", (ok ? "OK " : "NG "), name, t, b, v, goal
  }
  for (i = 1; i <= NS; i++) {
    split(SURF[i], f, " "); t = f[1]; b = f[2]; goal = f[3] + 0
    v = ratio(toks[t], toks[b])
    ok = (v >= goal)
    if (!ok) fail++
    printf "%s %s %s/%s: ratio %.2f (>=%s)\n", (ok ? "OK " : "NG "), name, t, b, v, f[3]
  }
}
BEGIN {
  # 本文・補足・有彩色の字、罫線（形状の輪郭 — 装飾ではない）
  NT = split("ink paper 90|ink bg 90|ink fill 90|muted paper 60|muted bg 60|" \
             "accent paper 60|accent accent-soft 60|ok ok-soft 60|warn warn-soft 60|" \
             "on-accent accent 60|ink mark 90|line paper 25", TEXT, "|")
  # 塗り«だけ»で意味を運ぶ面（輪郭を持たない使い方がある面）には bg / paper 両方に下限を課す:
  #   mark（帯）と accent-soft（compare の推奨列セルが塗り単独で使う）。
  #   ok-soft / warn-soft は常に濃色の字・線・輪郭と組で使う面なので、単独の面検査は課さない。
  NS = split("paper bg 1.08|fill paper 1.08|mark bg 1.08|mark paper 1.08|" \
             "accent-soft bg 1.08|accent-soft paper 1.08", SURF, "|")

  src = ""
  while ((getline line < FILE) > 0) src = src line "\n"
  close(FILE)
  if (src == "") { print "FAIL: " FILE " を読めません" > "/dev/stderr"; exit 2 }

  m = index(src, "@media")
  parse(substr(src, 1, m - 1), light)

  d = index(src, "prefers-color-scheme:dark")
  rest = substr(src, d)
  parse(substr(rest, 1, index(rest, "}}") - 1), dark)

  fail = 0
  check("light", light)
  check("dark", dark)
  exit (fail ? 1 : 0)
}
'
