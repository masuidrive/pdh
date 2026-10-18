#!/usr/bin/env bash
# 現行の Findings 表と review-sha の記録から reviewer・巡・共通の観点を数える。
set -uo pipefail
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd) || exit 2
# tickets_dir の解決は review 区間の検査と共通にする。
source "$SCRIPT_DIR/pdh-review-range.sh"
usage() {
  printf '使い方: bash scripts/pdh-review-tally.sh [--ticket <dir>]...\n引数なし: tickets_dir 直下と done の全 ticket。--ticket は繰り返し指定できます。\n'
}
fail() { printf 'pdh-review-tally: %s\n' "$*" >&2; exit 2; }
files=()
while [ "$#" -gt 0 ]; do
  case "$1" in
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
for file in "${files[@]}"; do
  [ -f "$file" ] && [ -r "$file" ] || fail "progress.md が読めません: $file"
done
# 空の対象は stdin の EOF で処理する。ファイル名を argv で渡すので空白も保持する。
awk '
function trim(s) { sub(/^[[:space:]]+/, "", s); sub(/[[:space:]]+$/, "", s); return s }
function valid(s) { return s == "いま直す" || s == "起票する" || s == "記録だけ残す" || s == "棄却する" }
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
function bad() { errors[++error_count]=names[FILENAME] ":" FNR ": " $0 }
BEGIN {
  header="#|出した人|観点|Sev|要旨|判定|記録先|理由"
  for (i=1; i<ARGC; i++) {
    f=ARGV[i]
    if (f in names) { ARGV[i]=""; continue }
    count=split(f, path, "/"); names[f]=path[count-1]; tickets[++ticket_count]=f
  }
}
FNR == 1 { state=0; round="" }
{
  # pdh_review_sha_records と同じ規則: 行頭の任意の「- 」と、先頭 7〜40 桁だけ。
  line=$0; sub(/^- /, "", line)
  if (line ~ /^review-sha:/) {
    sub(/^[^:]*:[[:space:]]*/, "", line)
    if (match(line, /^[0-9a-fA-F]+/) && RLENGTH>=7 && RLENGTH<=40) {
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
      if (match(change,/^(いま直す|起票する|記録だけ残す|棄却する)/)) {
        decision=substr(change,1,RLENGTH)
        rest=substr(change,RLENGTH+1)
        if (rest == "" || rest ~ /^[[:space:]（(«`]/) overrides[FILENAME SUBSEP id]=decision
      }
    }
  }
  if ($0 ~ /^### Findings-PDH-review-[0-9]+[[:space:]]*$/) {
    round=trim($0); sub(/^### Findings-/, "", round); state=1; next
  }
  if (state == 0) next
  line=trim($0)
  if (state == 1 && line == "") next
  if (line !~ /^\|/) { state=0; next }
  body=line; sub(/^\|/, "", body); sub(/\|$/, "", body)
  n=split(body, cols, "|"); joined=""
  for (i=1; i<=n; i++) { cols[i]=trim(cols[i]); joined=joined (i>1 ? "|" : "") cols[i] }
  if (state == 1) {
    if (joined == header) { state=2; has_table[FILENAME]=1 } else state=0
    next
  }
  if (body ~ /^[[:space:]:|\-]+$/) next
  if (n != 8 || cols[2] == "" || !valid(cols[6])) { bad(); next }
  key=FILENAME SUBSEP round SUBSEP cols[1]
  finding_keys[++finding_count]=key
  authors[key]=cols[2]; lenses[key]=cols[3]; severity[key]=cols[4]; decisions[key]=cols[6]; owner[key]=FILENAME
}
END {
  for (i=1; i<=finding_count; i++) {
    key=finding_keys[i]; f=owner[key]; lens=lenses[key]
    decision=(key in overrides) ? overrides[key] : decisions[key]
    # 同じ finding で同じ人が重複しても、その人には 1 件と数える。
    n=split(authors[key], people, /[+]/)
    for (j=1; j<=n; j++) {
      person=trim(people[j]); pk=key SUBSEP person
      if (person == "" || person_seen[pk]++) continue
      reviewers[person]++; verdicts[person SUBSEP decision]++
      if (severity[key] == "Critical") critical[person]++
      if (severity[key] == "Major") major[person]++
    }
    lens_count[lens]++
    if (!lens_seen[lens SUBSEP f]++) {
      lens_tickets[lens]++; lens_names[lens]=lens_names[lens] (lens_names[lens] ? ", " : "") names[f]
    }
  }
  print "### 出した人ごと"
  print "| 出した人 | finding | Critical | Major | いま直す | 起票する | 記録だけ残す | 棄却する |"
  print "|---|---|---|---|---|---|---|---|"
  n=sorted(reviewers, keys)
  for (i=1; i<=n; i++) {
    p=keys[i]
    printf "| %s | %d | %d | %d | %d | %d | %d | %d |\n", p,reviewers[p],critical[p],major[p],verdicts[p SUBSEP "いま直す"],verdicts[p SUBSEP "起票する"],verdicts[p SUBSEP "記録だけ残す"],verdicts[p SUBSEP "棄却する"]
  }
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
  print "\n### 2 つ以上の ticket で出た観点"
  print "| 観点 | finding | ticket |"
  print "|---|---|---|"
  n=sorted(lens_count, keys)
  for (i=1; i<=n; i++) { lens=keys[i]; if (lens_tickets[lens]>=2) printf "| %s | %d | %s |\n",lens,lens_count[lens],lens_names[lens] }
  printf "\n数えなかった ticket の数: %d\n",skipped
  print "崩れた行:"
  if (!error_count) print "なし"
  for (i=1; i<=error_count; i++) print errors[i]
}
' "${files[@]}" < /dev/null || exit 2
exit 0
