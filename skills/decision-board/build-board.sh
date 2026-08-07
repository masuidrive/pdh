#!/bin/sh
# decision-board v2: content(db-* コンポーネント)をシェルに差し込んで 1 枚の HTML を書き出す。
# POSIX の sh / awk / grep / sed / head / tail / cat / mktemp のみ。言語ランタイム不要。
#
#   build-board.sh <content.html> <title> [mermaid] > board.html
#
#   <content.html> : db-* コンポーネントで書いた本文（<db-board>…</db-board>）
#   <title>        : <title> と topbar に出す board 名
#   [mermaid]      : 図がある board だけ付ける。"mermaid" = 同梱 bundle を使う /
#                    それ以外の値 = bundle ファイルへの path
#
# 設計（v1 から継承）:
#   ① 短い置換（__TITLE__）だけを awk でやる。index/substr を使い、正規表現も & の特別扱いも通さない
#   ② 大きい置換（__CONTENT__ / __RUNTIME__ / __MERMAID__）は «行を挟み込む»。head/tail/cat しか
#      通らないので、中身が何であっても解釈されない
#   ⚠ ①→② の順序が要点。逆にすると 30 万文字級の 1 行（minified bundle）が awk を通り、
#     実装によっては行長制限に当たる
#
# 生成側チェック（描画は寛容・生成は厳格）:
#   - content 中の未知の db-* タグはエラーで止める。描画側は「既定の表示です」と出して
#     動き続けるが、生成の時点で気づけるものを黙って通さない
#   - <db-embed> に reason= が無い場合もエラー（なぜ既存の語彙で書けなかったかを毎回書く）
#   - 既知タグの一覧は board-runtime.js の KNOWN 配列から読む（二重管理にしない）
set -eu
dir=$(cd "$(dirname "$0")" && pwd)
content=$1; title=$2; mermaid=${3:-}
tpl="$dir/board-kit.tpl"
runtime="$dir/board-runtime.js"

[ -f "$content" ] || { echo "build-board.sh: content が見つからない: $content" >&2; exit 1; }
[ -f "$tpl" ] || { echo "build-board.sh: board-kit.tpl が見つからない（skill ディレクトリごと配置すること）" >&2; exit 1; }
[ -f "$runtime" ] || { echo "build-board.sh: board-runtime.js が見つからない（skill ディレクトリごと配置すること）" >&2; exit 1; }

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

# ── 生成側チェック ─────────────────────────────────────────
# 既知タグを runtime の KNOWN 配列から抽出する
awk '/var KNOWN = /{f=1} f{print} f&&/\];/{exit}' "$runtime" \
  | grep -o "'db-[a-z0-9-]*'" | tr -d "'" | sort -u > "$tmp/known"
[ -s "$tmp/known" ] || { echo "build-board.sh: board-runtime.js から KNOWN 一覧を読めない" >&2; exit 1; }

grep -o '<db-[a-z0-9-]*' "$content" | sed 's/^<//' | sort -u > "$tmp/used"
bad=0
while IFS= read -r tag; do
  [ -n "$tag" ] || continue
  if ! grep -qx "$tag" "$tmp/known"; then
    echo "build-board.sh: 未知のコンポーネント <$tag> が content にある。板書き間違いか、語彙の不足。" >&2
    bad=1
  fi
done < "$tmp/used"

# db-embed の reason 必須（開始タグが 1 行に書かれている前提。跨いだ場合は runtime 側の表示で気づける）
if grep -n '<db-embed' "$content" | grep -v 'reason=' >/dev/null 2>&1; then
  echo "build-board.sh: <db-embed> に reason= が無い行がある。なぜ既存の語彙で書けなかったかを必ず書く:" >&2
  grep -n '<db-embed' "$content" | grep -v 'reason=' >&2
  bad=1
fi
[ "$bad" -eq 0 ] || exit 1

# ── mermaid bundle の解決 ──────────────────────────────────
mmfile=""
if [ -n "$mermaid" ]; then
  if [ "$mermaid" = "mermaid" ]; then mmfile="$dir/mermaid-render.min.js"; else mmfile="$mermaid"; fi
  [ -f "$mmfile" ] || { echo "build-board.sh: mermaid bundle が見つからない: $mmfile" >&2; exit 1; }
fi

# ── ① 短い置換 ────────────────────────────────────────────
awk -v title="$title" '
  {
    line = $0
    key = "__TITLE__"
    val = "<meta charset=\"utf-8\"><title>" title "</title>"
    while ((p = index(line, key)) > 0)
      line = substr(line, 1, p-1) val substr(line, p + length(key))
    print line
  }
' "$tpl" > "$tmp/a"

# ── ② 行の挟み込み。marker 行を消し、その位置にファイルを流し込む ──
splice() {  # splice <in> <marker> <insert|""> <out>
  n=$(grep -n "^$2\$" "$1" | head -1 | cut -d: -f1 || true)
  if [ -z "${n:-}" ]; then cp "$1" "$4"; return; fi
  head -n $((n-1)) "$1" > "$4"
  [ -n "$3" ] && cat "$3" >> "$4"
  tail -n +$((n+1)) "$1" >> "$4"
}
splice "$tmp/a" __CONTENT__ "$content" "$tmp/b"
splice "$tmp/b" __RUNTIME__ "$runtime" "$tmp/c"
splice "$tmp/c" __MERMAID__ "$mmfile" "$tmp/d"
cat "$tmp/d"
