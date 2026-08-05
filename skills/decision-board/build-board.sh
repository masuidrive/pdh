#!/bin/sh
# テンプレートの 4 マーカーを置換して 1 枚の HTML を書き出す。POSIX の sh / awk / grep / head / tail / cat のみ。
#
#   build-board.sh <tpl> <content.html> <title> [mermaid.html] > board.html
#
# 設計:
#   ① 短い置換（__TITLE__ / __BOARDTITLE__）だけを awk でやる。中身は自分が決めた文字列なので安全。
#      index/substr を使い、正規表現も & の特別扱いも通さない。
#   ② 大きい置換（__CONTENT__ / __MERMAID__）は «行を挟み込む»。head/tail/cat しか通らないので、
#      中身が何であっても解釈されない。
#   ⚠ ①→② の «順序» が要点。逆にすると 30 万文字級の 1 行（minified bundle）が awk を通り、
#     実装によっては行長制限に当たる。この順序なら awk はテンプレートしか見ない。
set -eu
tpl=$1; content=$2; title=$3; mermaid=${4:-}

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

# ① 短い置換
awk -v title="$title" '
  {
    line = $0
    for (m = 1; m <= 2; m++) {
      key = (m == 1) ? "__TITLE__" : "__BOARDTITLE__"
      val = (m == 1) ? ("<meta charset=\"utf-8\"><title>" title "</title>") : title
      while ((p = index(line, key)) > 0)
        line = substr(line, 1, p-1) val substr(line, p + length(key))
    }
    print line
  }
' "$tpl" > "$tmp/a"

# ② 行の挟み込み。marker 行を消し、その位置にファイルを流し込む
splice() {  # splice <in> <marker> <insert|""> <out>
  n=$(grep -n "^$2\$" "$1" | head -1 | cut -d: -f1 || true)
  if [ -z "${n:-}" ]; then cp "$1" "$4"; return; fi
  head -n $((n-1)) "$1" > "$4"
  [ -n "$3" ] && cat "$3" >> "$4"
  tail -n +$((n+1)) "$1" >> "$4"
}
splice "$tmp/a" __CONTENT__ "$content" "$tmp/b"
splice "$tmp/b" __MERMAID__ "$mermaid" "$tmp/c"
cat "$tmp/c"
