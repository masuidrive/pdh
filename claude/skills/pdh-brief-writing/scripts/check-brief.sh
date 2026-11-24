#!/usr/bin/env bash
# Failure Tolerance の固定された欄だけを数える。値の意味は PM が判断する。
set -uo pipefail
brief=${1:-product-brief.md}
[ -r "$brief" ] || { printf 'check-brief: 使う人と量・許す失敗・許さない失敗: Brief が読めない: %s\n' "$brief" >&2; exit 1; }
awk '
function trim(s) { sub(/^[[:space:]]+/, "", s); sub(/[[:space:]]+$/, "", s); return s }
/^## / { inside=($0 ~ /^## Failure Tolerance[[:space:]]*$/); next }
inside {
  line=$0; sub(/^[[:space:]]*(-[[:space:]]+)?/, "", line)
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
  exit failed
}
' "$brief"
