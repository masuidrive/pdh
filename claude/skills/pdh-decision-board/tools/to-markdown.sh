#!/bin/sh
# 判断ボードの HTML から、経路へ貼る Markdown を作る。
#
# 守るのは «本文が 1 つであること» である。base.md は「主成果物は 1 つにする。同格の本文を
# 2 つ作らない」と定める。Markdown が要る経路（GitHub の issue コメントなど）でも、
# Markdown を «書かせない» — HTML を唯一の本文にして、そこから機械で作る。書かせると、
# 片方だけ直したときに黙ってずれる。
#
# usage: to-markdown.sh <board.html|fragment.html> [--url <発行した board の URL>]
#
# 落とすもの: 目次・style・script・回答 UI（ボタン / 貼り戻し欄 / 進捗）・svg の中身
# （代わりに «図は HTML の board にあります» と出す。--url は出力の先頭に置く）。
# 残すもの（GitHub Flavored Markdown が描くもの）: 見出し・段落・箇条書き・表・引用・
# 畳み（<details>）・mermaid（```mermaid）・注意の枠（> [!WARNING] などの alert）・
# 判定の tag・選択肢（- [ ]）・用語と説明（dl → 太字の行 + 説明の行）。
set -eu

board=""; url=""
while [ "$#" -gt 0 ]; do
  case $1 in
    --url) url=${2:-}; shift 2 ;;
    -h|--help) echo 'usage: to-markdown.sh <board.html> [--url <URL>]' >&2; exit 2 ;;
    *) board=$1; shift ;;
  esac
done
[ -n "$board" ] || { echo 'usage: to-markdown.sh <board.html> [--url <URL>]' >&2; exit 2; }
[ -r "$board" ] || { echo "to-markdown.sh: ERROR: cannot read board: $board" >&2; exit 2; }

# ⚠ 組み上げ済みの HTML には head / style / script が付く。本文だけを切り出してから渡す。
# `<main class="board">` が無い断片は、そのまま全体を本文として扱う。
slice=${TMPDIR:-/tmp}/pdh-md.$$
trap 'rm -f "$slice"' EXIT INT HUP TERM
awk '
  /<main[^>]*class="[^"]*board/ { inb=1 }
  inb { print }
  /<\/main>/ { if (inb) exit }
' "$board" > "$slice"
[ -s "$slice" ] || cp "$board" "$slice"

awk -v url="$url" '
function trim(s){ sub(/^[ \t\r\n]+/,"",s); sub(/[ \t\r\n]+$/,"",s); return s }
function unent(s){
  gsub(/&lt;/,"<",s); gsub(/&gt;/,">",s); gsub(/&quot;/,"\"",s)
  gsub(/&#39;/,"'"'"'",s); gsub(/&nbsp;/," ",s); gsub(/&amp;/,"\\&",s); return s
}
# 表の区切りと衝突する | を escape する
function esc(s){ gsub(/\|/,"\\\\|",s); return s }
# class 属性の値だけを取り出す（\< \> は awk の実装で有無が割れるので使わない）
function clsof(t,   c){
  if (t !~ /class="/) return ""
  c = t; sub(/.*class="/,"",c); sub(/".*/,"",c); return c
}
function emit(s){ out = out s }
# 強調の閉じ記号の直前に句読点があり、直後に字が続くと、CommonMark は閉じと認めない
# （右 flanking の規則: 句読点の後ろの ** は、空白か句読点が続くときだけ閉じられる）。
# GitHub で `**出ません。**触った` が記号ごと素で出た（2026-09-18 に実測、1 枚の board で 2 か所）。
# 開き側も同じで、`は**「注」**です` は開けない。句読点・括弧・空白は強調の外へ出す:
# `**出ません**。触った` / `「**注**」です`。at は開き記号を足した直後の buf の長さ。
function wrapclose(b, at, m,   inner, head, tail){
  if (at == 0 || at > length(b)) return b m
  inner = substr(b, at+1)
  head=""; tail=""
  while (match(inner, /(。|、|！|？|：|；|」|』|）| )$/)) { tail = substr(inner, RSTART) tail; inner = substr(inner, 1, RSTART-1) }
  while (match(inner, /^(「|『|（| )/))                { head = head substr(inner, 1, RLENGTH); inner = substr(inner, RLENGTH+1) }
  b = substr(b, 1, at - length(m))
  if (inner == "") return b head tail
  return b head m inner m tail
}
function flushpara(   t){
  t = trim(buf); buf=""
  if (t == "") return
  if (mode == "li" && calldepth > 0) { emit("> " indent listmark " " t "\n"); return }
  if (mode == "li")      { emit(indent listmark " " t "\n"); return }
  if (mode == "quote")   { emit("> " t "\n"); return }
  if (mode == "cell")    { row = row "| " esc(t) " "; return }
  emit(t "\n\n")
}
BEGIN{ RS="<"; mode="para"; listmark="-"; indent=""; skip=0; drop=0 }
{
  tag = $0
  n = index(tag, ">")
  if (NR == 1) { buf = buf unent(tag); next }
  if (n == 0)  { next }
  body = substr(tag, n+1)
  tag  = substr(tag, 1, n-1)
  lt   = tolower(tag)

  # ---- 丸ごと落とす区間 ----
  if (lt ~ /^(style|script|svg|nav)[ >]/ || lt ~ /^(style|script|svg|nav)$/) { drop++; if (lt ~ /^svg/) sawsvg=1 }
  else if (lt ~ /^aside[^>]*class="[^"]*answer-progress/) { drop++; aside=1 }
  else if (lt == "/aside" && aside) { if (drop>0) drop--; aside=0; next }
  # 回答 UI は Markdown では動かない。ボタン・貼り戻し欄・進捗は落とす。
  else if (lt ~ /^(button|textarea)[ >]/ || lt ~ /^(button|textarea)$/) { drop++ }
  else if (lt ~ /^\/(button|textarea)$/) { if (drop>0) drop--; next }
  # 回答欄へのページ内リンクも回答 UI の一部。Markdown 側に回答欄は無いので、残すと行き先の無い link になる。
  else if (lt ~ /^a [^>]*class="[^"]*answer-jump/) { drop++; ajump=1 }
  else if (lt == "/a" && ajump) { if (drop>0) drop--; ajump=0; next }
  else if (lt ~ /^\/(style|script|svg|nav)$/) { if (drop > 0) drop-- ; if (drop==0 && sawsvg) { emit("（図は HTML の board にあります）\n\n"); sawsvg=0 }; next }
  if (drop > 0) next

  # ---- mermaid はそのまま fence へ ----
  if (lt ~ /^pre[^>]*class="[^"]*mermaid/) { emit("```mermaid\n"); mode="mermaid"; buf=""; buf=buf unent(body); next }
  if (lt == "/pre" && mode == "mermaid")   { emit(trim(buf) "\n```\n\n"); buf=""; mode="para"; buf=buf unent(body); next }
  if (mode == "mermaid") { buf = buf "<" tag ">" unent(body); next }

  # ---- 見出し ----
  if (lt ~ /^h1/ && lt !~ /^\//) { flushpara(); hp="# " }
  else if (lt ~ /^h2/ && lt !~ /^\//) { flushpara(); hp="## " }
  else if (lt ~ /^h3/ && lt !~ /^\//) { flushpara(); hp="### " }
  else if (lt ~ /^h4/ && lt !~ /^\//) { flushpara(); hp="#### " }
  else if (lt ~ /^\/h[1-4]$/) { t=trim(buf); buf=""; if (t!="") emit(hp t "\n\n") }

  # ---- 段落・箇条書き ----
  else if (lt ~ /^p[ >]?$|^p$/)      { flushpara() }
  else if (lt == "/p")               { flushpara() }
  else if (lt ~ /^ul/ && lt !~ /^\//){ flushpara(); if(listdepth>0) indent=indent "  "; listdepth++; listmark="-"; mode="para" }
  else if (lt ~ /^ol/ && lt !~ /^\//){ flushpara(); if(listdepth>0) indent=indent "  "; listdepth++; listmark="1."; mode="para" }
  else if (lt == "/ul" || lt == "/ol"){ flushpara(); listdepth--; if(listdepth>0) indent=substr(indent,3); else {indent=""; emit("\n")} }
  else if (lt ~ /^li/ && lt !~ /^\//){ flushpara(); mode="li" }
  else if (lt == "/li")              { flushpara(); mode=(calldepth>0 ? "quote" : "para") }

  # ---- 引用 ----
  else if (lt ~ /^blockquote/ && lt !~ /^\//) { flushpara(); mode="quote" }
  else if (lt == "/blockquote")               { flushpara(); mode="para"; emit("\n") }

  # ---- 用語と説明（.facts などの dl）----
  # dt は太字の行、dd はその下の行にする。⚠ 改行 1 つでは CommonMark が同じ段落へ繋ぐので、
  # dt の行末に \ を置いて改行を固定する（GitHub の comment は素の改行も改行にするが、
  # README や他の描画器では「用語 説明」と 1 行に繋がる）。
  else if (lt ~ /^dl( |$)/)  { flushpara() }
  else if (lt == "/dl")      { flushpara(); emit("\n") }
  else if (lt ~ /^dt( |$)/)  { flushpara(); mode="dt" }
  else if (lt == "/dt")      { t=trim(buf); buf=""; if (t!="") emit("**" t "**\\\n"); mode="para" }
  else if (lt ~ /^dd( |$)/)  { flushpara(); mode="dd" }
  else if (lt == "/dd")      { t=trim(buf); buf=""; if (t!="") emit(t "\n\n"); mode="para" }

  # ---- callout → GitHub Alerts（GFM が枠と色で描く）----
  # .callout は «意味を tone が持つ» 部品なので、GFM の alert へそのまま写せる。
  # ⚠ 段落にすると、注意・良否という意味が消えて地の文に埋まる。
  else if (lt ~ /^div/ && lt !~ /^\// && clsof(lt) ~ /(^| )callout( |$)/) {
    flushpara()
    c=" " clsof(lt) " "
    if      (c ~ / warn /)   emit("> [!WARNING]\n")
    else if (c ~ / ok /)     emit("> [!TIP]\n")
    else if (c ~ / accent /) emit("> [!NOTE]\n")
    else                     emit("> [!NOTE]\n")
    mode="quote"; calldepth++
  }
  else if (lt == "/div" && calldepth > 0 && mode == "quote") { flushpara(); calldepth--; mode="para"; emit("\n") }

  # ---- 表 ----
  else if (lt ~ /^table/ && lt !~ /^\//) { flushpara(); intable=1; cols=0; headdone=0 }
  else if (lt == "/table")               { intable=0; emit("\n") }
  else if (lt ~ /^tr/ && lt !~ /^\//)    { row=""; cols=0 }
  # ⚠ GFM の表は区切り行が無いと表にならない。thead が無い board の表もあるので、
  # 見出し行が来なければ «最初の行» を見出しとして区切りを入れる。
  else if (lt == "/tr")                  { if(row!=""){ emit(row "|\n"); if(!headdone){ sep=""; for(i=0;i<cols;i++) sep=sep "| --- "; emit(sep "|\n"); headdone=1 } } }
  else if (lt ~ /^th/ && lt !~ /^\//)    { flushpara(); mode="cell"; cols++; inhead=1 }
  else if (lt ~ /^td/ && lt !~ /^\//)    { flushpara(); mode="cell"; cols++; inhead=0 }
  else if (lt == "/th" || lt == "/td")   { flushpara(); mode="para" }
  else if (lt ~ /^thead/ && lt !~ /^\//) { inhead=1 }
  else if (lt == "/thead")               { inhead=0 }

  # ---- 畳み（GitHub は details を描く）----
  else if (lt ~ /^details/ && lt !~ /^\//) { flushpara(); emit("<details>\n") }
  else if (lt == "/details")               { flushpara(); emit("</details>\n\n") }
  else if (lt ~ /^summary/ && lt !~ /^\//) { flushpara(); mode="summary" }
  else if (lt == "/summary")               { emit("<summary>" trim(buf) "</summary>\n\n"); buf=""; mode="para" }

  # ---- 図 ----
  else if (lt ~ /^img/) {
    src=lt; sub(/.*src="/,"",src); sub(/".*/,"",src)
    alt=lt; if (lt ~ /alt="/) { sub(/.*alt="/,"",alt); sub(/".*/,"",alt) } else alt="図"
    flushpara(); emit("![" alt "](" src ")\n\n")
  }
  else if (lt ~ /^figcaption/ && lt !~ /^\//) { flushpara() }
  else if (lt == "/figcaption")               { t=trim(buf); buf=""; if(t!="") emit("*" t "*\n\n") }

  # ---- 選択肢（radio は checkbox にする）----
  else if (lt ~ /^input[^>]*type="radio"/) { emit("- [ ] ") ; mode="optline" }
  else if (lt ~ /^\/label/ && mode=="optline") { emit(trim(buf) "\n"); buf=""; mode="para" }

  # ---- span の役割ごとに落とす / 飾る ----
  # .tag は判定なので語のまま `` で囲む。.lab は小見出しなので太字。.badge は括弧。
  # それ以外の span は素通し。⚠ 閉じ方を flag で持つ — buf の中身で判定すると、
  # 他の span の閉じにも当たって余分な記号が残る。
  else if (lt ~ /^span/ && lt !~ /^\//) {
    cls=" " clsof(lt) " "
    if      (cls ~ / tag /)   { buf = buf "`";   spankind="tag" }
    else if (cls ~ / lab /)   { buf = buf "**";  spankind="lab" }
    else if (cls ~ / badge /) { buf = buf " （"; spankind="badge" }
    else spankind=""
  }
  else if (lt == "/span") {
    if (spankind == "tag")   buf = buf "`"
    else if (spankind=="lab")   buf = buf "**"
    else if (spankind=="badge") buf = buf "）"
    spankind=""
  }

  # ---- 行内 ----
  else if (lt ~ /^(strong|b)[ >]?$|^(strong|b)$/) { buf = buf "**"; sopen = length(buf) }
  else if (lt ~ /^\/(strong|b)$/)                 { buf = wrapclose(buf, sopen, "**"); sopen = 0 }
  else if (lt ~ /^(em|i)[ >]?$|^(em|i)$/)         { buf = buf "*"; eopen = length(buf) }
  else if (lt ~ /^\/(em|i)$/)                     { buf = wrapclose(buf, eopen, "*"); eopen = 0 }
  else if (lt ~ /^code/ && lt !~ /^\//)           { buf = buf "`" }
  else if (lt == "/code")                         { buf = buf "`" }
  else if (lt ~ /^a [^>]*href="/) { href=lt; sub(/.*href="/,"",href); sub(/".*/,"",href); buf = buf "["; lasthref=href }
  else if (lt == "/a")            { buf = buf "](" lasthref ")" }
  else if (lt == "br" || lt == "br/" || lt == "br /") { buf = buf " " }

  buf = buf unent(body)
}
END{
  flushpara()
  gsub(/\n\n\n+/,"\n\n",out)
  sub(/^\n+/,"",out)
  # ⚠ URL は先頭に出す（ユーザ指示 2026-09-18「url は最上位に出す」）。読む人が探すのは
  # 図と表のある本物の board で、末尾に置くと長いコメントをスクロールして探すことになる。
  if (url != "") printf "図と表を含む全文はこちら: %s\n\n---\n\n", url
  printf "%s", out
}
' "$slice"
