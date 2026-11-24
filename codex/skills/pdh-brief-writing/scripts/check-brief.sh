#!/usr/bin/env bash
# Failure Tolerance の固定された欄だけを数える。値の意味は PM が判断する。
set -uo pipefail
brief=${1:-product-brief.md}
[ -r "$brief" ] || { printf 'check-brief: 使う人と量・許す失敗・許さない失敗: Brief が読めない: %s\n' "$brief" >&2; exit 1; }
awk '
function trim(s) { sub(/^[[:space:]]+/, "", s); sub(/[[:space:]]+$/, "", s); return s }
{
  line=$0
  if (fence != "") {
    close_line=line; sub(/^ ? ? ?/, "", close_line)
    if (match(close_line, /^(```+|~~~+)[[:space:]]*$/) && substr(close_line,1,1) == fence) {
      sub(/[[:space:]]*$/, "", close_line)
      if (length(close_line) >= fence_length) fence=""
    }
    next
  }
  visible=""; rest=line
  while (length(rest)) {
    if (comment) {
      end=index(rest,"-->"); if (!end) break
      rest=substr(rest,end+3); comment=0
    } else {
      start=index(rest,"<!--")
      if (!start) { visible=visible rest; break }
      visible=visible substr(rest,1,start-1); rest=substr(rest,start+4); comment=1
    }
  }
  line=visible
  if (match(line, /^ ? ? ?(```+|~~~+)/)) {
    marker=substr(line,RSTART,RLENGTH); sub(/^ */, "", marker)
    fence=substr(marker,1,1); fence_length=length(marker); next
  }
  if (line ~ /^## /) { inside=(line ~ /^## Failure Tolerance[[:space:]]*$/); next }
}
inside {
  sub(/^[[:space:]]*(-[[:space:]]+)?/, "", line)
  colon=index(line, ":"); if (!colon) next
  key=substr(line,1,colon-1); value=trim(substr(line,colon+1))
  if (key == "許す失敗の目安") key="許す失敗"
  if (key != "使う人と量" && key != "許す失敗" && key != "許さない失敗") next
  if (value != "" && value !~ /<[^>]*>/ && (key != "許す失敗" || value ~ /([0-9]|０|１|２|３|４|５|６|７|８|９)/)) valid[key]=1
}
END {
  n=split("使う人と量 許す失敗 許さない失敗", keys, " ")
  for (i=1;i<=n;i++) if (!valid[keys[i]]) {
    print "check-brief: " keys[i] ": が無い・空・雛形、または許す失敗に数字が無い"; failed=1
  }
  if (failed) print "check-brief: Failure Tolerance は pdh-brief-writing を読んで直す（Brief の変更は利用者の承認後）"
  exit failed
}
' "$brief"
