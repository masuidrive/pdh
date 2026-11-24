#!/usr/bin/env bash
# 現行の Findings 表と review-sha の記録から 判定と巡を数える。
set -uo pipefail
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd) || exit 2
# tickets_dir の解決は review 区間の検査と共通にする。
source "$SCRIPT_DIR/pdh-review-range.sh"
usage() {
  printf '使い方: bash scripts/pdh-review-tally.sh [--ticket <dir>]... [--round-counts]\n引数なし: tickets_dir 直下と done の全 ticket。--ticket は繰り返し指定できます。\n'
}
fail() { printf 'pdh-review-tally: %s\n' "$*" >&2; exit 2; }
round_counts=0
files=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --round-counts) round_counts=1; shift ;;
    -h|--help) usage; exit 0 ;;
    --ticket)
      [ "$#" -ge 2 ] && [ -n "$2" ] || fail '--ticket <dir> が必要です'
      dir=$(cd "$2" && pwd) || fail "ticket ディレクトリがありません: $2"
      files+=("$dir/progress.md")
      shift 2 ;;
    *) fail "不明な引数: $1" ;;
  esac
done
if [ "${#files[@]}" -eq 0 ]; then
  pdh_review_tickets_dir || exit 2
  root=$(git rev-parse --show-toplevel) || exit 2
  case "$pdh_tickets" in /*) tickets_dir=$pdh_tickets ;; *) tickets_dir=$root/$pdh_tickets ;; esac
  [ -d "$tickets_dir" ] || fail "tickets_dir がありません: $tickets_dir"
  shopt -s nullglob
  files=("$tickets_dir"/*/progress.md "$tickets_dir"/done/*/progress.md)
fi
for file in ${files[@]+"${files[@]}"}; do
  [ -f "$file" ] && [ -r "$file" ] || fail "progress.md が読めません: $file"
done
# 空の対象は stdin の EOF で処理する。ファイル名を argv で渡すので空白も保持する。
awk -v round_counts="$round_counts" '
function trim(s) { sub(/^[[:space:]]+/, "", s); sub(/[[:space:]]+$/, "", s); return s }
function valid(s) { return s == "受け入れる" || s == "いま直す" || s == "起票する" || s == "記録だけ残す" || s == "棄却する" }
function cells(body, cols,    i,n,c,backslashes) {
  n=1; cols[n]=""; backslashes=0
  for (i=1; i<=length(body); i++) {
    c=substr(body,i,1)
    if (c == "|" && backslashes % 2 == 0) cols[++n]=""
    else cols[n]=cols[n] c
    if (c == "\\") backslashes++; else backslashes=0
  }
  return n
}
function unreadable(reason) {
  printf "pdh-review-tally: %s:%d: %s: %s\n", FILENAME,FNR,round,reason > "/dev/stderr"
  errors=1
}
function sorted(a, keys,    k,n,i,j,v) {
  n=0
  for (k in a) keys[++n]=k
  for (i=2; i<=n; i++) {
    v=keys[i]; j=i-1
    while (j>0 && keys[j]>v) { keys[j+1]=keys[j]; j-- }
    keys[j+1]=v
  }
  return n
}
BEGIN {
  header="#|要旨|頻度と 1 回のコスト|判定|由来"
  for (i=2; i<ARGC; i++) {
    f=ARGV[i]
    if (f in names) { ARGV[i]=""; continue }
    count=split(f, path, "/"); names[f]=path[count-1]; tickets[++ticket_count]=f
    if (count>2 && path[count-2] == "done") shipped[names[f]]=1
    else {
      note=f; sub(/progress.md$/, "note.md", note)
      while ((getline marker < note)>0) if (marker == "<!-- pdh-review-loop: 1 -->") strict[f]=1
      close(note)
    }
  }
}
FILENAME == ARGV[1] {
  sha=$1; subject=substr($0,length(sha)+2)
  if (subject ~ /^\[[^]]+\]/) {
    sub(/^\[/,"",subject); sub(/\].*$/,"",subject)
    commits[sha]=subject
  }
  next
}
FNR == 1 { state=0; round=""; findings=0 }
{
  # pdh_review_sha_records と同じ規則: 行頭の任意の「- 」と、先頭 7〜40 桁だけ。
  line=$0; sub(/^- /, "", line)
  if (line ~ /^review-sha:/) {
    sub(/^[^:]*:[[:space:]]*/, "", line)
    if (match(line, /^[0-9a-fA-F]+/) && RLENGTH>=7 && RLENGTH<=40) {
      review_records[FILENAME]++
      sha=tolower(substr(line,1,RLENGTH)); key=FILENAME SUBSEP sha
      if (!sha_seen[key]++) rounds[FILENAME]++
    }
  }
  # 識別子は処置の前後どちらにあってもよい。理由の文章は判定に含めない。
  if (index($0, "処置の変更:") && match($0, /PDH-review-[0-9]+ #[0-9]+/)) {
    id=substr($0,RSTART,RLENGTH); gsub(/ #/, SUBSEP, id)
    change=$0; sub(/^.*処置の変更:[[:space:]]*/, "", change)
    if (index(change,"→")) {
      sub(/^[^→]*→[[:space:]]*/, "", change); sub(/[[:space:]]*—.*$/, "", change)
      # 識別子を後置した場合の括弧や backtick も判定の一部にしない。
      if (match(change,/^(いま直す|受け入れる|起票する|記録だけ残す|棄却する)/)) {
        decision=substr(change,1,RLENGTH)
        rest=substr(change,RLENGTH+1)
        if (rest == "" || rest ~ /^[[:space:]（(«`]/) {
          overrides[FILENAME SUBSEP id]=decision

        }
      }
    }
  }
  if (strict[FILENAME] && /^#+ /) {
    findings=($0 ~ /^###+ Findings(-| ?(（|\())PDH-review-[0-9]+/)
    state=0
    if (findings) { match($0,/PDH-review-[0-9]+/); round=substr($0,RSTART,RLENGTH) }
  }
  if (strict[FILENAME] && findings && /^\|[[:space:]]*#[[:space:]]*\|/) state=1
  if ($0 ~ /^### Findings-PDH-review-[0-9]+[[:space:]]*$/) {
    round=trim($0); sub(/^### Findings-/, "", round); state=1; next
  }
  if (state == 0) next
  line=trim($0)
  if (state == 1 && line == "") next
  if (line !~ /^\|/) { state=0; next }
  body=line; sub(/^\|/, "", body); sub(/\|$/, "", body)
  n=strict[FILENAME] ? cells(body, cols) : split(body, cols, "|"); joined=""
  for (i=1; i<=n; i++) { cols[i]=trim(cols[i]); joined=joined (i>1 ? "|" : "") cols[i] }
  if (state == 1) {
    if (joined == header) { state=2; has_table[FILENAME]=1 }
    else {
      legacy=0
      for (i=1; i<=n; i++) if (cols[i] == "Sev" || cols[i] == "出した人" || cols[i] == "記録先") legacy=1
      if (strict[FILENAME] && !legacy) unreadable("現行 Findings 表を集計できない（#・要旨・頻度と 1 回のコスト・判定・由来の5列が必要）")
      state=0
    }
    next
  }
  if (body ~ /^[[:space:]:|\-]+$/) next
  if (n != 5 || !valid(cols[4])) {
    if (strict[FILENAME]) unreadable("Findings 行の列数か判定を読めない: " line)
    next
  }
  if (strict[FILENAME] && cols[3] == "") unreadable("Findings 表の «頻度と 1 回のコスト» が空")
  key=FILENAME SUBSEP round SUBSEP cols[1]
  finding_round[key]=round
  if (cols[4] == "いま直す") original[FILENAME SUBSEP round]++
  round_seen[FILENAME SUBSEP round]=1
  finding_keys[++finding_count]=key
  decisions[key]=cols[4]; owner[key]=FILENAME; origins[key]=cols[5]
}
END {
  if (errors) exit 2
  for (i=1; i<=finding_count; i++) {
    key=finding_keys[i]; f=owner[key]
    decision=(key in overrides) ? overrides[key] : decisions[key]
    verdicts[decision]++
    if (!round_counts && decision != "棄却する" && decision != "記録だけ残す") {
      text=origins[key]
      while (match(text, /(持ち込み:[[:space:]]*|上流[[:space:]]+)[0-9a-fA-F]+/)) {
        ref=substr(text,RSTART,RLENGTH); text=substr(text,RSTART+RLENGTH)
        sub(/^(持ち込み:[[:space:]]*|上流[[:space:]]+)/,"",ref)
        if (length(ref)<7 || length(ref)>40) continue
        target=""; matches=0
        for (sha in commits) if (index(sha,tolower(ref)) == 1) {target=commits[sha]; matches++}
        if (matches == 1 && target in shipped && target != names[f] && !defect_seen[key SUBSEP target]++) defects[target]++
      }
    }
    if (decision == "いま直す") current[f SUBSEP finding_round[key]]++
  }
  if (round_counts) {
    n=sorted(round_seen, keys)
    for (i=1; i<=n; i++) {
      split(keys[i], parts, SUBSEP)
      printf "%s\t%d\t%d\t%d\n", parts[2], original[keys[i]], current[keys[i]], review_records[parts[1]]
    }
    exit
  }
  print "### 判定ごと"
  print "| 判定 | finding |"
  print "|---|---|"
  n=sorted(verdicts, keys)
  for (i=1; i<=n; i++) printf "| %s | %d |\n", keys[i],verdicts[keys[i]]
  print "\n### ticket ごとの巡"
  print "| ticket | 巡 |"
  print "|---|---|"
  for (i=1; i<=ticket_count; i++) {
    f=tickets[i]
    if (!has_table[f]) skipped++
    if (rounds[f]) {
      measured++; if (rounds[f] == 1) single++
      printf "| %s | %d |\n", names[f],rounds[f]
    }
  }
  printf "1 巡で抜けた ticket: %d / %d (%.1f%%)\n",single,measured,measured ? 100*single/measured : 0
  printf "\n現行表がない ticket の数: %d\n",skipped
  if (!round_counts) {
    print "\n### ticket ごとの出荷後の欠陥"
    print "| ticket | 出荷後の欠陥 |"
    print "|---|---|"
    for (i=1; i<=ticket_count; i++) {f=tickets[i]; printf "| %s | %d |\n", names[f], defects[names[f]]}
  }
}
' <(if [ "$round_counts" -eq 0 ]; then git log --format='%H%x09%s' HEAD 2>/dev/null; fi) ${files[@]+"${files[@]}"} < /dev/null || exit 2
exit 0
