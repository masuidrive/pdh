#!/usr/bin/env bash
# 板の «読む量» を測る。判断の数 N、主線の面数、主線の量（byte）を出す。
#
# 主線と裏付けの境目:
#   HTML     — 最初の data-backing 属性
#   Markdown — 本文が「裏付け」で始まる見出し行
# 境目が無ければ、板全体を主線として測る（それ自体が指摘である）。
#
# usage: bash measure.sh <board.html|board.md> [--prev <byte>]
#   --prev を渡すと、主線の量が前の周より増えたときに exit 1 を返す。
set -euo pipefail

board=${1:?usage: measure.sh <board.html|board.md> [--prev <byte>]}
prev=
if [ "${2:-}" = "--prev" ]; then prev=${3:?--prev には前の周の byte 数を渡す}; fi
[ -f "$board" ] || { echo "measure.sh: ERROR: $board を読めません" >&2; exit 2; }

# ⚠ script / style の中身を先に落とす。埋め込んだ kit の CSS / JS も data-q や
# section を含むため、素朴に数えると板の中身と混ざる。
extract() {   # $1 = cut (主線だけ) | full (板全体)
  awk -v mode="$1" '
  function strip(s, tag,   a, b, rest, out, op, cl) {
    op = "<" tag; cl = "</" tag ">"; out = ""
    while ((a = index(s, op)) > 0) {
      out = out substr(s, 1, a - 1)
      rest = substr(s, a)
      b = index(rest, cl)
      if (b == 0) return out
      s = substr(rest, b + length(cl))
    }
    return out s
  }
  { src = src $0 "\n" }
  END {
    src = strip(src, "script")
    src = strip(src, "style")
    if (mode == "cut") {
      cut = index(src, "data-backing")
      if (cut == 0 && match(src, /\n#+[ \t]*裏付け/)) cut = RSTART
      if (cut > 0) src = substr(src, 1, cut - 1)
    }
    printf "%s", src
  }' "$board"
}

occurrences() { grep -o "$1" | grep -c . || true; }   # grep -c は行数なので、出現数で数える

main=$(extract cut)
full=$(extract full)

faces=$(printf '%s' "$main" | occurrences "<section")
if [ "$faces" -gt 0 ]; then
  decisions=$(printf '%s' "$full" | grep -o 'data-q="[^"]*"' | sort -u | grep -c . || true)
else
  faces=$(printf '%s' "$main" | occurrences '^## ')
  decisions=$(printf '%s' "$full" | occurrences '^### 判断 ')
fi
bytes=$(printf '%s' "$main" | sed 's/<[^>]*>/ /g' | tr -d '[:space:]' | wc -c | tr -d ' ')

printf '判断の数 N: %s\n主線の面数: %s\n主線の量: %s byte\n' "$decisions" "$faces" "$bytes"
printf '%s' "$full" | grep -q 'data-backing\|^#\{1,6\}[ 　]*裏付け' \
  || echo '⚠ 主線と裏付けの境目が無い。板全体を主線として測った。' >&2

if [ -n "$prev" ]; then
  if [ "$bytes" -gt "$prev" ]; then
    printf '打ち切り: 主線が前の周より増えた（%s -> %s byte）。読む量が増えて決めやすくなることは、ほとんどない。この周で出す。\n' \
      "$prev" "$bytes" >&2
    exit 1
  fi
  printf '前の周から: %s -> %s byte\n' "$prev" "$bytes"
fi
