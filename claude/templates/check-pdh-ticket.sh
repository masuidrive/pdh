#!/usr/bin/env bash
# check-pdh-ticket.sh — ticket dir の受け渡し記録を、agent の申告に依らず確かめる。
# scripts/test-all.sh の 1 段として走る（PDH-implement の出力と PDH-verify で回る）。
#
#   1. tickets/<name>/ticket.md ごとに progress.md がある（経緯は progress.md へ）
#   2. note の Status が human gate なら、Checklist に «発行先:» を含む未了行がある
#      （PDH-AGENTS.md「受け渡し経路」）。pr-merge の close 承認待ちは、URL か path と定めた skip 理由の行でもよい
#   3. close 前 review の後に、ticket 自身の未 review の commit が残っていない
#   4. 未完了 ticket の note の Checklist に書かれた起票先が実在する。owner/repo#N の起票先は、
#      github_bot.findings_issue_repos に載る repo のときだけ形を認める（実在は確かめない）
#   5. この branch の未完了 ticket の Why に根拠の 2 行がある。
#      Status が PDH-review 以降なら、この branch で新しく作った起票先の Why に derived-from:・pickup-timing: があり、
#      Why-not-fix-now: が «該当なし» でない。pickup-timing が «immediate» なら、Checklist に起票先と «発行先:» の行がある。
#      pickup-timing が «on-symptom-report» なら、起票先の Why に observable-symptom: がある。
#      base にあった起票先（既存への集約）と、各印より前の版で作った起票先は数えない（下の derived_fields_marker）
#   6. ticket の «AC-approved:» の値が、いまの AC と Out-of-scope のハッシュと一致する。
#      PDH-implement 以降なら値がある（AC と Out-of-scope が承認されたこと・承認後に変わっていないこと）
#
#   7. 未完了 ticket は、note の Checklist に、いまの Status の
#      PDH-stage のチェックリスト（scripts/pdh-stage-checklist.sh が skill から出す行）がある
#      PDH-human-review / PDH-close では、PDH-ticket-write〜PDH-verify の各 stage の行もすべてある
#   8. close 時、ticket が変更した PDH の上書き対象が .pdh-lock と一致する
#   9. 未完の ticket の現行 Findings 表の «頻度と 1 回のコスト» が空でない。done は見ない。旧 8 列の表は
#      書き換えないが、印（findings_table_marker）より後に作った ticket では、現行 5 列の表が 1 つも無ければ落とす。
#  10. この branch の ticket は close gate に review 記録があり、pdh-review「収束」の表に従っている:
#      S7・S8 の行が未回答のまま
#      次の巡へ進んでいない（S5）・PDH-verify 以降は S7・S8 の行がすべて回答済み
#  11. close 時、説明対象を変えた docs は、更新か Checklist の済み行がある
#
#  12. 先頭に pdh-note-format: 2 の印がある note は、承認前の記録の節を持つ承認待ち以降の固定キーと S8 のラベルが埋まっている
#
#   bash scripts/check-pdh-ticket.sh --ac-hash <ticket.md>   # いまの AC と Out-of-scope のハッシュを出す
#   bash scripts/check-pdh-ticket.sh --require-branch-ticket <base-ref>
#     bot の pre-push 用。PDH repo の ticket 外の変更には、その branch の ticket を要する。
#
# <tickets_dir>/done/ は、この branch 自身が直下へ追加した ticket の記録だけを見る。
#
# 追記のみの検査は ticket.sh の append_only_files（check / close）が担う。
# 文書 check を有効にした repo は文書をすべて消した場合も base 側を照合する（Python + PyYAML）。
set -uo pipefail
ac_hash_target=''
if [ "${1:-}" = --ac-hash ]; then
  [ -f "${2:-}" ] || { printf 'usage: %s --ac-hash <ticket.md>\n' "$0" >&2; exit 2; }
  ac_hash_target="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"
fi
cd "$(cd "$(dirname "$0")/.." && pwd)" || exit 1

failed=0
seen=0
tickets_dir=tickets
if [ -f .ticket-config.yaml ]; then
  value=$(awk '/^tickets_dir:/ { sub(/^tickets_dir:[[:space:]]*/, ""); sub(/[[:space:]]+#.*/, ""); gsub(/["\047]/, ""); sub(/[[:space:]]+$/, ""); print; exit }' .ticket-config.yaml)
  tickets_dir=${value:-tickets}
fi
tickets_dir=${tickets_dir%/}
tickets_dir=${tickets_dir#./}
github_bot_value() {
  awk -v key="$1" '
    /^github_bot:[[:space:]]*(#.*)?$/ {section=1; next}
    section && /^[^[:space:]#]/ {section=0}
    section && index($0, "  " key ":") == 1 {sub(/^  [^:]*:[[:space:]]*/, ""); sub(/[[:space:]]+#.*/, ""); gsub(/["\047]/, ""); print; exit}
  ' .ticket-config.yaml 2>/dev/null
}
close_mode=$(github_bot_value close | tr -d '[:space:]')
# 空白区切りの owner/repo。findings の起票先に GitHub の issue を使う repo（github-bot の opt-in）。
findings_issue_repos=" $(github_bot_value findings_issue_repos | tr ',[]' '   ') "

# derived-ticket-fields: v1
# derived-ticket-fields: v2
# findings-table: v1
# 印を持つ版の scripts/check-pdh-ticket.sh で作った ticket から、その印の項目と後から足した PDH-stage の行を求める。
# v1 は別件の項目（derived-from:・pickup-timing:）と late_stage_lines、v2 は on-symptom-report の observable-symptom: と late_stage_lines_v2。
# findings-table: v1 は現行 5 列の Findings 表。印の無い版で作った ticket は、作った時点の規則で閉じられる。
derived_fields_marker='# derived-ticket-fields: v1'
symptom_fields_marker='# derived-ticket-fields: v2'
findings_table_marker='# findings-table: v1'
late_stage_lines=$(cat <<'EOF'
PDH-ticket-write: 同じ原因・対象・期待する修正の ticket を検索した。検索語と件数（該当 0 件を含む）と、新しく作るか既存へ集約するかの判断が progress にある
PDH-ticket-review: この ticket を指す `起票:` の行と、`pickup-timing: when-touching` の ticket のうち同じ箇所に触るものを探し、コマンド・件数（0 件を含む）・取り込むかの判断が progress にある
EOF
)
late_stage_lines_v2=$(cat <<'EOF'
PDH-ticket-write: 報告から書くなら、制約の文書と ticket を症状の言葉で探し、検索語・候補ごとの判断と残すか直すかが progress にある
EOF
)
late_review_evidence_lines=$(cat <<'EOF'
PDH-ticket-write: AC は結果で書き、比較の項目を分け、原文の見た目・相当の要求を AC か Out-of-scope と照合し、照合の差の検出と説明の付かない差が 0 の約束を分けた（「AC の書き方」）
PDH-ticket-review: DB/API の変更時の前提の見直しの結果があり、いちばん悪い初期状態と AC の組の順番を照合した。絶対の形の約束と実装で測る値が矛盾せず、端の場面・順番でも約束が成り立つ根拠が note と progress にある
PDH-review: S7・S8 の各行に利用者の判断が要る理由か PM の決定と覆す条件があり、判断の基準と progress の結論が合っている
EOF
)
# 引数（印・path…）の path を最初に追加した commit の版の検査 script に印が無ければ 0。未 commit なら 1。
created_before_marker() {
  local marker=$1 first
  shift
  [ "${git_ready:-0}" -eq 1 ] || return 1
  first=$(git log --diff-filter=A --format=%H HEAD -- "$@" 2>/dev/null | tail -n 1)
  [ -n "$first" ] || return 1
  # grep -q で先に閉じると、pipefail の下で git show の SIGPIPE が «印が無い» に化ける。
  ! git show "$first:scripts/check-pdh-ticket.sh" 2>/dev/null | grep -xF -- "$marker" >/dev/null
}

# HTML コメントを除き、inline code と元の行番号を保つ。
ticket_visible_lines() {
  awk '
    {
      rest = $0
      visible = ""
      while (length(rest)) {
        if (comment) {
          end = index(rest, "-->")
          if (!end) break
          rest = substr(rest, end + 3)
          comment = 0
        } else {
          start = index(rest, "<!--")
          # 同じ長さの backtick で囲んだ inline code は、そのまま残す。
          # 閉じていない backtick は通常の文字として扱う。
          if (match(rest, /`+/) && (!start || RSTART < start)) {
            ticks = RLENGTH
            head = RSTART + ticks - 1
            tail = substr(rest, head + 1)
            offset = head
            while (match(tail, /`+/)) {
              offset += RSTART + RLENGTH - 1
              if (RLENGTH == ticks) { head = offset; break }
              tail = substr(rest, offset + 1)
            }
            visible = visible substr(rest, 1, head)
            rest = substr(rest, head + 1)
            continue
          }
          if (!start) { visible = visible rest; break }
          visible = visible substr(rest, 1, start - 1)
          rest = substr(rest, start + 4)
          comment = 1
        }
      }
      print visible
    }
  ' "$1"
}

# AC 節（«What» または «Acceptance Criteria»）と Out-of-scope 節を、次の見出しまで読む。
# コメント・«AC-approved:» の行・checkbox の印・空白を除く。Out-of-scope が無ければ AC だけの式になる。
ac_hash() {
  local content
  content=$(ticket_visible_lines "$1" | awk '
    # 最後まで読む: 前の段が書き込み中に終わると SIGPIPE でパイプ全体が落ちる。
    /^#+[[:space:]]/ { section="" }
    !seen_ac && /^#+[[:space:]]+(What([[:space:]]|$)|.*Acceptance Criteria)/ { section="ac"; seen_ac=1; next }
    /^#+[[:space:]]+Out-of-scope([[:space:]]|$)/ { section="scope"; printf "\nOut-of-scope\n"; next }
    section != "" {
      line=$0
      if (tolower(line) ~ /^[[:space:]]*(-[[:space:]]+)?ac-approved:/) next
      gsub(/\[[ xX]\]/, "", line)
      gsub(/[[:space:]]/, "", line)
      if (section == "ac" && length(line)) ac_text=1
      printf "%s", line
    }
    END { if (!ac_text) exit 1 }
  ') || { printf 'check-pdh-ticket: %s: AC の節が無い（見出しが無いか本文が空）\n' "$1" >&2; return 1; }
  printf '%s' "$content" | { sha256sum 2>/dev/null || shasum -a 256; } | cut -c1-16
}
ac_recorded() {
  ticket_visible_lines "$1" | awk '
    { line=tolower($0) }
    line ~ /^[[:space:]]*(-[[:space:]]+)?ac-approved:/ {
      sub(/^[^:]*:[[:space:]]*/, "", line); split(line, w, /[[:space:]]/); v=w[1]
    }
    END { print v }'
}
if [ -n "$ac_hash_target" ]; then
  ac_hash "$ac_hash_target"
  exit
fi

# 未完了 ticket の Checklist に書かれた起票先を検査する。
check_kihyo_ticket_exists() {
  local f=$1 self rows line content name exists reason canceled root
  self=${f#"$tickets_dir/"}
  self=${self%/note.md}
  rows=$(ticket_visible_lines "$f" | awk '
    { gsub(/：/, ":") }
    /^## Checklist[[:space:]]*$/ { checklist=1; next }
    /^##? / { checklist=0 }
    checklist && /^[[:space:]]*[-*] \[[ xX]\][[:space:]]*起票:/ { printf "%d\t%s\n", NR, $0 }
  ') || { failed=1; return; }
  while IFS=$'\t' read -r line content; do
    [ -n "$line" ] || continue
    name=''
    if [[ "$content" == *'→'* ]]; then
      # ticket 名は → を含まないので、anchor 側に → があっても最後の → の後が名前である。
      name=$(printf '%s\n' "${content##*→}" | awk '{gsub(/`/, ""); sub(/（.*/, ""); print $1}')
    fi
    exists=0
    reason='ticket を作ってから名前を書く（./ticket.sh new）'
    # 名前は 1 つの ticket を指す。親ディレクトリなどを実在先に数えない。
    if [ -z "$name" ]; then
      reason="→ の後が空です。$reason"
    elif [[ "$name" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+#[0-9]+$ ]]; then
      # issue の実在と状態は起票した人が gh で確かめる（github-bot/_github-issue.md）。ここは形と opt-in だけを見る。
      if [[ "$findings_issue_repos" == *" ${name%#*} "* ]]; then
        exists=1
      else
        reason="GitHub の issue を起票先にするのは、.ticket-config.yaml の github_bot.findings_issue_repos に載る repo だけ（github-bot の opt-in）。載せるか、ticket を作る"
      fi
    elif [[ ! "$name" =~ ^(CANCELED-)?[0-9]{6}-[0-9]{6}- || "$name" == */* ]]; then
      reason="ticket 名の形ではない（YYMMDD-hhmmss- または CANCELED-YYMMDD-hhmmss- で始まる名前を書く）。$reason"
    elif [ "$name" = "$self" ]; then
      reason='note を持つ ticket 自身は起票先にできない'
    else
      canceled="${name:0:14}CANCELED-${name:14}"
      for root in "$tickets_dir" "$tickets_dir/done"; do
        if [ -f "$root/$name/ticket.md" ] || [ -f "$root/$name.md" ] ||
           [ -f "$root/CANCELED-$name.md" ] ||
           [ -f "$root/$canceled/ticket.md" ]; then
          exists=1
          break
        fi
      done
    fi
    if [ "$exists" -eq 0 ]; then
      printf 'check-pdh-ticket: %s:%s: %s\n  %s\n' "$f" "$line" "$(sed -n "${line}p" "$f")" "$reason" >&2
      failed=1
    fi
  done <<< "$rows"
}

# ticket の Why 節から、ラベルの値を 1 行ずつ「ラベル<TAB>値」で出す。
why_fields() {
  ticket_visible_lines "$1" | awk '
    /^### Why/ { why=1; next }
    /^#(#(#)?)?[[:space:]]/ { why=0 }
    why {
      sub(/^[[:space:]]*/, "")
      sub(/^-([[:space:]]+)(\[[ xX]\][[:space:]]*)?/, "")
      gsub(/：/, ":")
      if (!index($0, ":")) next
      label=$0; sub(/:.*/, "", label)
      sub(/^[^:]*:[[:space:]]*/, "")
      gsub(/`/, "")
      print label "\t" $0
    }
  '
}

# この branch で新しく作った起票先が、別件として拾える項目を持つかを検査する。
# base にあった起票先（既存への集約）と、印より前の版で作った起票先は、作った時点の規則で数える。
check_derived_targets() {
  local n=$1 self d name target fields src timing timing_value wnfn problems
  self=${n#"$tickets_dir/"}
  self=${self%/note.md}
  while IFS= read -r name; do
    [[ "$name" =~ ^[0-9]{6}-[0-9]{6}- && "$name" != */* ]] || continue
    target=''
    for d in "$tickets_dir/$name" "$tickets_dir/done/$name"; do
      [ -f "$d/ticket.md" ] && { target="$d/ticket.md"; break; }
    done
    [ -n "$target" ] || continue
    if [ "${git_ready:-0}" -eq 1 ]; then
      if [ -n "$pdh_review_exclude" ]; then
        git cat-file -e "$pdh_review_exclude:$tickets_dir/$name/ticket.md" 2>/dev/null && continue
        git cat-file -e "$pdh_review_exclude:$tickets_dir/done/$name/ticket.md" 2>/dev/null && continue
      elif [ -n "$(git log -1 --format=%H HEAD -- "$tickets_dir/$name/ticket.md" "$tickets_dir/done/$name/ticket.md" 2>/dev/null)" ]; then
        # base が分からないと、集約か新規かを分けられない。commit 済みの起票先は数えない。
        continue
      fi
      created_before_marker "$derived_fields_marker" "$tickets_dir/$name/ticket.md" "$tickets_dir/done/$name/ticket.md" && continue
    fi
    fields=$(why_fields "$target") || { failed=1; return; }
    src=$(awk -F'\t' '$1 == "derived-from" { print $2; exit }' <<<"$fields")
    timing=$(awk -F'\t' '$1 == "pickup-timing" { print $2; exit }' <<<"$fields")
    wnfn=$(awk -F'\t' 'tolower($1) == "why-not-fix-now" { print $2; exit }' <<<"$fields")
    problems=''
    [[ "$src" == *"$self"* ]] || problems+=$'\n'"  derived-from: に起票元の ticket 名 $self を書く（2 つ以上なら並べる）"
    timing_value=''
    [[ "$timing" =~ ^(immediate|next-selection|when-touching|on-symptom-report)([^-_[:alnum:]]|$) ]] && timing_value=${BASH_REMATCH[1]}
    [ -n "$timing_value" ] ||
      problems+=$'\n''  pickup-timing: に immediate / next-selection / when-touching / on-symptom-report のどれかを書く'
    [[ -n "$wnfn" && "$wnfn" != 該当なし* ]] ||
      problems+=$'\n'"  Why-not-fix-now: に、$self の必須の修正に当たらない理由を書く"
    if [ "$timing_value" = immediate ] &&
       ! awk '/^## Checklist[[:space:]]*$/{f=1;next} /^##? /{f=0} f' "$n" | grep -F -- "$name" | grep -F '発行先:' >/dev/null; then
      problems+=$'\n'"  pickup-timing が immediate なので、$n の Checklist に $name と «発行先:» を含む行を書いて人に渡す"
    fi
    if [ "$timing_value" = on-symptom-report ] &&
       ! created_before_marker "$symptom_fields_marker" "$tickets_dir/$name/ticket.md" "$tickets_dir/done/$name/ticket.md" &&
       [ -z "$(awk -F'\t' '$1 == "observable-symptom" && $2 ~ /[^[:space:]]/ { print $2; exit }' <<<"$fields")" ]; then
      problems+=$'\n''  pickup-timing が on-symptom-report なので、observable-symptom: に、報告者が見る症状と起きる条件を書く'
    fi
    if [ -n "$problems" ]; then
      printf 'check-pdh-ticket: %s: %s から起票した ticket の Why が足りない:%s\n' "$target" "$self" "$problems" >&2
      failed=1
    fi
  done <<< "$(ticket_visible_lines "$n" | awk '
    { gsub(/：/, ":") }
    /^## Checklist[[:space:]]*$/ { checklist=1; next }
    /^##? / { checklist=0 }
    checklist && /^[[:space:]]*[-*] \[[ xX]\][[:space:]]*起票:/ && index($0, "→") {
      sub(/.*→/, ""); gsub(/`/, ""); sub(/（.*/, ""); print $1
    }
  ')"
}

# 未完了 ticket の Why の根拠を検査する。
check_ticket_why_intake_evidence() {
  local f=$1 missing
  [ -f "$f" ] || return
  missing=$(ticket_visible_lines "$f" | awk '
    /^### Why/ { why=1; next }
    /^#(#(#)?)?[[:space:]]/ { why=0 }
    why {
      sub(/^[[:space:]]*/, "")
      sub(/^-([[:space:]]+)(\[[ xX]\][[:space:]]*)?/, "")
      gsub(/：/, ":")
      label=tolower($0); sub(/:.*/, "", label)
      key=""
      if (label == "reproduction-or-measurement") key="Reproduction-or-measurement"
      if (label == "why-not-fix-now") key="Why-not-fix-now"
      if (key != "" && index($0, ":")) {
        sub(/^[^:]*:[[:space:]]*/, "")
        seen[key]=1
        if ($0 ~ /^[[:space:]]*$/) empty[key]=1
      }
    }
    END {
      if (!seen["Reproduction-or-measurement"] || empty["Reproduction-or-measurement"]) print "Reproduction-or-measurement:"
      if (!seen["Why-not-fix-now"] || empty["Why-not-fix-now"]) print "Why-not-fix-now:"
    }
  ') || { failed=1; return; }
  if [ -n "$missing" ]; then
    printf 'check-pdh-ticket: %s: Why 節で次の行が無いか空です:\n%s\n' "$f" "$missing" >&2
    printf '%s\n' '  Why 節に「Reproduction-or-measurement: <確かめた手順と結果>」と「Why-not-fix-now: <理由>」を書く。' \
      '  進行中の ticket から起票したなら、Why-not-fix-now: はその ticket の必須の修正に当たらない理由。' \
      '  要望起点なら「Why-not-fix-now: 該当なし（要望起点。進行中の ticket から派生していない）」でよい。' >&2
    failed=1
  fi
}

# close gate の review 記録と、未回答の S7・S8 を残して進んでいないことを確かめる。
check_ticket_review_handover() {
  local d=${1%/ticket.md} reviews result kind round status
  [ -f "$d/progress.md" ] || return 0
  reviews=$(pdh_review_sha_records "$d/progress.md" review | awk 'NF && !seen[$0]++ { count++ } END { print count+0 }')
  if grep -Eq '^(- )?close-gate-sha:' "$d/progress.md" && [ "$reviews" -eq 0 ]; then
    printf 'check-pdh-ticket: %s は close-gate-sha: があるのに有効な review-sha: が 0 件（各巡で reviewer が読んだ SHA を progress.md に review-sha: <SHA> として追記する）\n' "$d" >&2
    failed=1
  fi
  result=$(awk -F '|' -v reviews="$reviews" '
    function trim(value) { sub(/^[[:space:]]+/, "", value); sub(/[[:space:]]+$/, "", value); return value }
    FILENAME == ARGV[1] {
      if ($0 ~ /^## Status: PDH-(verify|human-review|close)([^A-Za-z-]|$)/) {
        status=$0; sub(/^## Status:[[:space:]]*/, "", status); sub(/[[:space:]].*$/, "", status)
      }
      if ($0 ~ /^## Checklist[[:space:]]*$/) { checklist=1; next }
      if ($0 ~ /^##? /) checklist=0
      if (checklist && /^- \[[ xX-]\]/ && /発行先:/ && match($0, /[^A-Za-z0-9_]S[78]([^0-9]|$)/)) {
        kind=substr($0, RSTART + 2, 1)
        if (!match($0, /PDH-review-[0-9]+/)) next
        number=substr($0, RSTART, RLENGTH); sub(/^PDH-review-/, "", number); number+=0
        done=($0 ~ /^- \[[xX-]\]/)
        key=number SUBSEP kind
        if (!(key in gate)) gate[key]=1
        gate[key]=gate[key] && done
        if (kind == 7 && (first7 == "" || number < first7)) first7=number
        if (number > last) last=number
      }
      next
    }
    END {
      if (reviews > last) last=reviews
      for (n=1; n<=last; n++) {
        for (kind=7; kind<=8; kind++) if (((n SUBSEP kind) in gate) && !gate[n SUBSEP kind]) {
          if (n < reviews) print "S5\t" n "\t" kind
          else if (status != "") print "WAIT\t" n "\t" kind "\t" status
        }
      }
    }
  ' <(if [ -f "$d/note.md" ]; then ticket_visible_lines "$d/note.md"; fi) \
    <(ticket_visible_lines "$d/progress.md")) || { failed=1; return; }
  while IFS=$'\t' read -r kind round extra status; do
    case "$kind" in
      S5) printf 'check-pdh-ticket: %s は S5 で止まるべき: PDH-review-%s の S%s の行が未回答のまま、次の review-sha: が増えた（答えを反映して [x] にしてから次の巡へ進む）\n' "$d" "$round" "$extra" >&2 ;;
      WAIT) printf 'check-pdh-ticket: %s は S%s の答えを待ったまま %s に進んだ: PDH-review-%s の S%s の行が未回答（答えを反映して [x] にする）\n' "$d" "$extra" "$status" "$round" "$extra" >&2 ;;
      *) continue ;;
    esac
    failed=1
  done <<<"$result"
}

# note の雛形の先頭行を読む。
note_format_v2() {
  sed -n '1p' "$1" | grep -Eq '^[[:space:]]*<!-- pdh-note-format: 2 -->[[:space:]]*$'
}

check_note_format() {
  local n=$1
  if grep -q 'pdh-note-format' "$n"; then
    if ! note_format_v2 "$n"; then
      printf 'check-pdh-ticket: %s: 印が壊れている（先頭行を <!-- pdh-note-format: 2 --> にする）\n' "$n" >&2
      failed=1
    fi
  elif ticket_visible_lines "$n" | grep -Eq '^## 承認前の記録[[:space:]]*$'; then
    printf 'check-pdh-ticket: %s: 印が欠けている（承認前の記録がある note の先頭行に <!-- pdh-note-format: 2 --> を置く）\n' "$n" >&2
    failed=1
  fi
}

# 固定キーだけを数える。結果の妥当性は skill の判断の Checklist で確かめる。
check_ticket_review_evidence() {
  local t=$1 n=$2 st=$3 ac_count result
  case "$st" in
    PDH-ticket-human-review|PDH-implement|PDH-review|PDH-verify|PDH-human-review|PDH-close) ;;
    *) return 0 ;;
  esac
  ticket_visible_lines "$n" | grep -Eq '^## 承認前の記録[[:space:]]*$' || return 0
  ac_count=$(ticket_visible_lines "$t" | awk '
    /^#+[[:space:]]/ {section=0}
    !seen_ac && /^#+[[:space:]]+(What([[:space:]]|$)|.*Acceptance Criteria)/ {section=1; seen_ac=1; next}
    section && /^[[:space:]]*-[[:space:]]+(\[[ xX-]\]|AC[[:space:]]+[0-9]+:)/ {count++}
    END {print count+0}
  ') || { failed=1; return; }
  result=$(ticket_visible_lines "$n" | awk -v ac_count="$ac_count" '
    /^## / {
      contract=($0 ~ /^## PDH-ticket-review\. Ticket contract check[[:space:]]*$/)
      evidence=($0 ~ /^## 承認前の記録[[:space:]]*$/)
      next
    }
    contract || evidence {
      line=$0; sub(/^[[:space:]]*(-[[:space:]]+)?/, "", line)
      if (!match(line, /:/)) next
      key=substr(line, 1, RSTART-1); value=substr(line, RSTART+1)
      sub(/^[[:space:]]+/, "", value); sub(/[[:space:]]+$/, "", value)
      if (contract) cost[key]=value
      if (evidence) record[key]=value
    }
    END {
      db=cost["DB-changes"]; api=cost["API-changes"]
      if (db !~ /^(あり|なし)$/ || api !~ /^(あり|なし)$/)
        print "DB-changes:・API-changes: の値は あり か なし の1語だけを書く（例: DB-changes: なし ／ DB-changes の内容: 変更しない）"
      review=record["前提の見直し"]
      if (!(review == "済み" || (db == "なし" && api == "なし" && review == "不要")))
        print "前提の見直し: は 済み か 不要 の1語だけを書く（例: 前提の見直し: 済み ／ 前提の見直しの記録: progress.md。DB/API とも なし なら 不要 も可）"
      if (record["いちばん悪い初期状態"] !~ /^(測った|当たらない)$/)
        print "いちばん悪い初期状態: は 測った か 当たらない の1語だけを書く（例: いちばん悪い初期状態: 測った ／ いちばん悪い初期状態の記録: progress.md）"
      sequence=record["AC の組の順番"]
      if (ac_count >= 2 && sequence !~ /^(表|当たる組なし)$/)
        print "AC の組の順番: は 表 か 当たる組なし の1語だけを書く（例: AC の組の順番: 当たる組なし ／ AC の組の順番の理由: 別々の状態）"
    }
  ') || { failed=1; return; }
  if [ -n "$result" ]; then
    printf 'check-pdh-ticket: %s: 承認前の記録:\n%s\n' "$n" "$result" >&2
    failed=1
  fi
}

check_s8_decisions() {
  local n=$1 rows line
  note_format_v2 "$n" || return 0
  rows=$(ticket_visible_lines "$n" | awk '
    /^## Checklist[[:space:]]*$/ {section=1; next}
    /^##? / {section=0}
    section && /^- \[[ xX-]\] S8([^0-9]|$)/ {
      content=$0
      if (content !~ /^- \[[ xX-]\] S8 PDH-review-[0-9]+[[:space:]]+/) {print NR; next}
      sub(/^- \[[ xX-]\] S8 PDH-review-[0-9]+[[:space:]]+/, "", content)
      if (content ~ /^利用者の判断が要る理由:/ && content ~ /発行先:/) next
      if (content ~ /^PM が決めた:/ && content ~ /覆す条件:/) next
      print NR
    }
  ') || { failed=1; return; }
  while read -r line; do
    [ -n "$line" ] || continue
    printf 'check-pdh-ticket: %s:%s: S8 の行を書式どおりに書く（例: - [ ] S8 PDH-review-1 利用者の判断が要る理由: 出力を変える 発行先: /board ／ - [x] S8 PDH-review-1 PM が決めた: 修正する 覆す条件: 再発）\n' "$n" "$line" >&2
    failed=1
  done <<< "$rows"
}

# AC と Out-of-scope の承認の記録（«AC-approved: <いまの AC と Out-of-scope のハッシュ>»）を確かめる。
check_ac_approved() {
  local t=$1 st=$2 rec cur
  rec=$(ac_recorded "$t")
  cur=$(ac_hash "$t") || { failed=1; return; }
  if [ -n "$rec" ]; then
    if [ "$rec" != "$cur" ]; then
      printf 'check-pdh-ticket: %s の AC か Out-of-scope が承認の後に変わっています（承認したとき %s・いま %s）。変えたならユーザの承認を取り直し、AC-approved: に --ac-hash の値を書き直す\n' "$t" "$rec" "$cur" >&2
      failed=1
    fi
    return
  fi
  case "$st" in PDH-implement|PDH-review|PDH-verify|PDH-human-review|PDH-close) ;; *) return ;; esac
  printf 'check-pdh-ticket: %s は %s なのに、AC の承認の記録（AC-approved:）が無い。PDH-ticket-human-review で AC と Out-of-scope の承認を得たら、AC-approved: に bash scripts/check-pdh-ticket.sh --ac-hash の値を書く\n' "$t" "$st" >&2
  failed=1
}

# 指定した PDH-stage のチェックリスト全件が note の Checklist に写してあるかを確かめる。
check_stage_checklist() {
  local n=$1 st=$2 current=${3:-$2} expected have missing
  [ -f scripts/pdh-stage-checklist.sh ] || {
    printf 'check-pdh-ticket: scripts/pdh-stage-checklist.sh がありません\n' >&2
    failed=1
    return
  }
  expected=$(bash scripts/pdh-stage-checklist.sh "$st" | sed 's/^- \[ \] //; s/[[:space:]]*$//') || {
    printf 'check-pdh-ticket: %s の Status %s のチェックリストを skill から取り出せない\n' "$n" "$st" >&2
    failed=1
    return 0
  }
  [ -n "$expected" ] || {
    printf 'check-pdh-ticket: %s の Status %s のチェックリストの行が skill に無い\n' "$n" "$st" >&2
    failed=1
    return 0
  }
  # 印より前の版で作った ticket には、後から足した行を求めない。
  local d=${n%/note.md}
  if created_before_marker "$derived_fields_marker" "$d/ticket.md" "$tickets_dir/${d##*/}/ticket.md"; then
    expected=$(printf '%s\n' "$expected" | grep -vxF -- "$late_stage_lines")
    [ -n "$expected" ] || return 0
  fi
  if created_before_marker "$symptom_fields_marker" "$d/ticket.md" "$tickets_dir/${d##*/}/ticket.md"; then
    expected=$(printf '%s\n' "$expected" | grep -vxF -- "$late_stage_lines_v2")
    [ -n "$expected" ] || return 0
  fi
  if ! note_format_v2 "$n"; then
    expected=$(printf '%s\n' "$expected" | grep -vxF -- "$late_review_evidence_lines")
    [ -n "$expected" ] || return 0
  fi
  have=$(awk '/^## Checklist[[:space:]]*$/{f=1;next} /^##? /{f=0} f' "$n" | sed -n 's/^- \[[ xX-]\] //p' | sed 's/ - skip: .*$//; s/[[:space:]]*$//')
  have=$(printf '%s\n' "$have" | sed '
    s|^PDH-ticket-write: 上のコマンドが 0 で終わった$|PDH-ticket-write: `pdh-ticket-write`「機械で確かめるもの」のコマンドが 0 で終わった|
    s|^PDH-ticket-write: `Key-User-Journeys:` の番号が Why の内容と合っている。«該当なし» なら、その理由が書いてある（形だけは上のコマンドが確かめる）$|PDH-ticket-write: `Key-User-Journeys:` の番号が Why の内容と合っている。«該当なし» なら、その理由が書いてある（形だけは`pdh-ticket-write`「機械で確かめるもの」のコマンドが確かめる）|
    s|^PDH-ticket-review: 上のコマンドが 0 で終わった$|PDH-ticket-review: `pdh-ticket-review`「機械で確かめるもの」のコマンドが 0 で終わった|
    s|^PDH-ticket-human-review: 上の 2 つのコマンドが 0 で終わった$|PDH-ticket-human-review: `pdh-pm`「承認の PDH-stage」内の「機械で確かめるもの」の 2 つのコマンドが 0 で終わった|
    s|^PDH-ticket-human-review: `pdh-pm`「承認の PDH-stage」内の「機械で確かめるもの」の 2 つのコマンドが 0 で終わった$|PDH-ticket-human-review: 承認者へ渡す前の `check-pdh-ticket.sh` と、回答反映後の 2 つのコマンドが 0 で終わった|
    s|^PDH-human-review: 上の 1 つ目のコマンドが 0 で終わった$|PDH-human-review: `pdh-pm`「承認の PDH-stage」内の「機械で確かめるもの」の 1 つ目のコマンドが 0 で終わった|
  ')
  missing=$(printf '%s\n' "$expected" | while IFS= read -r line; do
    grep -qxF -- "$line" <<<"$have" || printf '%s\n' "$line"
  done)
  if [ -n "$missing" ]; then
    if [ "$st" = "$current" ]; then
      printf 'check-pdh-ticket: %s は %s なのに、Checklist にその PDH-stage のチェックリストの行が無い（bash scripts/pdh-stage-checklist.sh %s --enter %s で写す）:\n%s\n' "$n" "$st" "$st" "$n" "$missing" >&2
    else
      # --enter はその stage の行を全部 [ ] に戻すので、済んだ stage には案内しない。
      printf 'check-pdh-ticket: %s は Status %s。前の PDH-stage %s の行が Checklist に無い（--enter は済んだ印を消すので使わない。下の行を手で足して確かめ、当てはまらなければ - [-] … - skip: <理由> にする）:\n%s\n' "$n" "$current" "$st" "$missing" >&2
    fi
    failed=1
  fi
}

# 旧 8 列の記録は保持し、現行 5 列の頻度・コストだけを検査する。印より後に作った ticket では、
# 旧 8 列の表しか無ければ落とす（互換の逃げ道が、移行しない project を無検査のままにしないため）。
check_findings_cost() {
  local f=$1 legacy_ok=${2:-1}
  [[ "$f" != "$tickets_dir/done/"* ]] || return 0
  [ -f "$f" ] || return 0
  if ! ticket_visible_lines "$f" | awk -F '|' -v file="$f" -v legacy_ok="$legacy_ok" '
    function trim(v) { sub(/^[[:space:]]+/, "", v); sub(/[[:space:]]+$/, "", v); return v }
    /^#+ / { findings=($0 ~ /^###+ Findings(-| ?(（|\())PDH-review-[0-9]+/); cost=0 }
    findings && /^\|[[:space:]]*#[[:space:]]*\|/ {
      cost=legacy=0
      for (i=2; i<NF; i++) {
        label=trim($i)
        if (label == "頻度と 1 回のコスト") cost=i
        if (label == "Sev" || label == "出した人" || label == "記録先") legacy=1
      }
      if (legacy) { cost=0; if (!legacy_ok && !legacy_line) legacy_line=NR }
      else {
        current=1
        if (!cost) {
          printf "check-pdh-ticket: %s:%d: Findings 表の «頻度と 1 回のコスト» が無い\n", file, NR
          bad=1
        }
      }
      next
    }
    !/^\|/ { cost=0 }
    cost && $0 !~ /^[[:space:]|:-]+$/ && trim($cost) == "" {
      printf "check-pdh-ticket: %s:%d: Findings 表の «頻度と 1 回のコスト» が空\n", file, NR
      bad=1
    }
    END {
      if (legacy_line && !current) {
        printf "check-pdh-ticket: %s:%d: Findings 表が旧 8 列だけ（この印より後に作った ticket は、次の巡から現行 5 列で追記する。旧表は書き換えない）\n", file, legacy_line
        bad=1
      }
      exit bad ? 1 : 0
    }
  ' >&2; then failed=1; fi
}

# base から分岐した後、branch 自身の commit が done へ移した ticket も検査する。
done_tickets=()
git_ready=0
if git rev-parse --verify HEAD >/dev/null 2>&1; then
  git_ready=1
  if [ ! -f scripts/pdh-review-range.sh ]; then
    printf 'check-pdh-ticket: scripts/pdh-review-range.sh がありません。INSTALL.md の配置表どおりに置いてください\n' >&2
    exit 1
  fi
  source scripts/pdh-review-range.sh
  pdh_review_base_tip || exit 1
fi
if [ "$git_ready" -eq 1 ] && [ -n "$pdh_review_base" ]; then
  # 区間の取り方は pdh-review-range.sh と同じ（base から届く commit を除く）。
  if ! git merge-base --is-ancestor "$pdh_review_tip" "$pdh_review_exclude"; then
    added=$(git log --no-merges --diff-filter=A --name-only --format= \
      "$pdh_review_tip" --not "$pdh_review_exclude" -- ":(top)$tickets_dir/done/*/ticket.md") || exit 1
  else
    branch_start=$(git merge-base "$pdh_review_base" "$pdh_review_tip") || exit 1
    added=$(git log --first-parent --no-merges --diff-filter=A --name-only --format= \
      "$branch_start..$pdh_review_tip" -- ":(top)$tickets_dir/done/*/ticket.md") || exit 1
  fi
  while IFS= read -r t; do
    [[ "$t" == "$tickets_dir/done/"*/ticket.md && "${t#"$tickets_dir/done/"}" != */*/* && "$t" != *-CANCELED-* ]] || continue
    done_tickets+=("$t")
  done <<< "$(printf '%s\n' "$added" | awk 'NF && !seen[$0]++')"
fi

for n in "$tickets_dir"/*/note.md "$tickets_dir"/done/*/note.md; do
  [ ! -f "$n" ] || check_note_format "$n"
done

for n in "$tickets_dir"/*/note.md; do
  [ -f "$n" ] || continue
  check_kihyo_ticket_exists "$n"
done

# ticket の状態（progress・待ち行・close 前 review）は、その ticket の branch でだけ検査する。
# 別の branch の ticket が base に載っていても、その記録でこの branch の検査を落とさない。
# その branch の ticket とは、branch 名（frontmatter の branch:、無ければ branch_prefix + 名前）が
# いまの branch と一致するか、いまの branch の commit が ticket dir に触っているものである。
# いまの branch が分からない（detached HEAD）ときは全部を検査する。
current_branch=''
touched_dirs=''
branch_prefix=features/
if [ "$git_ready" -eq 1 ]; then
  current_branch=${GITHUB_HEAD_REF:-$(git symbolic-ref -q --short HEAD 2>/dev/null || true)}
  if [ -f .ticket-config.yaml ]; then
    branch_prefix=$(awk '/^branch_prefix:/ { sub(/^branch_prefix:[[:space:]]*/, ""); gsub(/["\047]/, ""); print $1; exit }' .ticket-config.yaml)
    branch_prefix=${branch_prefix:-features/}
  fi
  if [ -n "$pdh_review_exclude" ] && ! git merge-base --is-ancestor "$pdh_review_tip" "$pdh_review_exclude"; then
    touched_dirs=$(git log --name-only --format= "$pdh_review_tip" --not "$pdh_review_exclude" -- ":(top)$tickets_dir" |
      awk -v root="$tickets_dir/" 'index($0, root) == 1 {path=substr($0, length(root)+1); n=split(path, p, "/"); if (p[1] == "done") {if (n >= 3) print root "done/" p[2]} else if (n >= 2) print root p[1]}'  | sort -u) || exit 1
  fi
fi
ticket_is_on_this_branch() {
  local d=$1 name own
  [ -n "$current_branch" ] || return 0
  name=${d##*/}
  own=$(awk 'NR == 1 && $0 != "---" { exit } NR > 1 && $0 == "---" { exit } /^branch:/ { sub(/^branch:[[:space:]]*/, ""); gsub(/["\047]/, ""); print $1; exit }' "$d/ticket.md" 2>/dev/null)
  [ "${own:-$branch_prefix$name}" = "$current_branch" ] && return 0
  grep -qxF -- "$d" <<<"$touched_dirs" && return 0
  # done へ移したのが branch 上なら、移す前の dir 名で触っている
  [[ "$d" == "$tickets_dir/done/"* ]] && grep -qxF -- "$tickets_dir/$name" <<<"$touched_dirs"
}

# hook が解決した base と push 対象の HEAD を使う。通常の検査には ticket 無しを許す。
# done の ticket を使う CI 自動修正も、同じ所属判定で扱う。
if [ "${1:-}" = --require-branch-ticket ] && [ -n "$current_branch" ] &&
   [ -f product-brief.md ] && [ -d "$tickets_dir" ]; then
  branch_has_ticket=0
  for t in "$tickets_dir"/*/ticket.md "$tickets_dir"/done/*/ticket.md; do
    [ -f "$t" ] || continue
    if ticket_is_on_this_branch "${t%/ticket.md}"; then
      branch_has_ticket=1
      break
    fi
  done
  if [ "$branch_has_ticket" -eq 0 ]; then
    if merge_base=$(git merge-base HEAD "${2:-}"); then
      outside_status=0
      git diff --quiet --no-renames "$merge_base" HEAD -- . ":(top,exclude,literal)$tickets_dir" || outside_status=$?
      if [ "$outside_status" -eq 1 ]; then
        printf 'check-pdh-ticket: branch %s の ticket が無いのに、%s 外の変更があります。 .github/coding-bot/_pdh.md の find-or-create に従ってこの branch の ticket を作り、commit してから push してください\n' "$current_branch" "$tickets_dir" >&2
        failed=1
      elif [ "$outside_status" -ne 0 ]; then
        printf 'check-pdh-ticket: ticket 外の変更を検査できません（git diff exit %s）\n' "$outside_status" >&2
        failed=1
      fi
    else
      printf 'check-pdh-ticket: ticket 外の変更を検査する merge-base を解決できません（base: %s）\n' "${2:-}" >&2
      failed=1
    fi
  fi
fi
lock_checked=0
for t in "$tickets_dir"/*/ticket.md ${done_tickets[@]+"${done_tickets[@]}"}; do
  [ -f "$t" ] || continue
  d=${t%/ticket.md}
  ticket_is_on_this_branch "$d" || continue
  seen=1

  if [ ! -f "$d/progress.md" ]; then
    printf 'check-pdh-ticket: %s/progress.md が無い（経緯は progress.md へ。1 行目は "# Progress: <ticket-name>"）\n' "$d" >&2
    failed=1
  fi
  check_ticket_review_handover "$t"
  # Why の根拠も、別の branch の ticket（旧い書式で起票されたものを含む）では落とさない。
  [[ "$t" == "$tickets_dir/done/"* ]] || check_ticket_why_intake_evidence "$t"
  if created_before_marker "$findings_table_marker" "$d/ticket.md" "$tickets_dir/${d##*/}/ticket.md"; then
    check_findings_cost "$d/progress.md" 1
  else
    check_findings_cost "$d/progress.md" 0
  fi

  n="$d/note.md"
  if [[ "$t" == "$tickets_dir/done/"* ]]; then
    st=PDH-close
  else
    [ -f "$n" ] || continue
    st=$(awk '/^## Status:/{sub(/^## Status:[[:space:]]*/,""); print; exit}' "$n" \
         | sed -E 's/^[[:space:]]*(PDH-[a-z-]+).*/\1/')
  fi
  if [[ "$t" != "$tickets_dir/done/"* ]]; then
    check_s8_decisions "$n"
    check_ticket_review_evidence "$t" "$n" "$st"
  fi
  check_ac_approved "$t" "$st"
  case "$st" in
    PDH-review|PDH-verify|PDH-human-review|PDH-close)
      [[ "$t" == "$tickets_dir/done/"* ]] || check_derived_targets "$n" ;;
  esac
  [[ "$t" == "$tickets_dir/done/"* ]] || check_stage_checklist "$n" "$st"
  case "$st" in
    PDH-human-review|PDH-close)
      # 定義が skill から消えたときも照合を省かない（check_stage_checklist が «行が無い» で落とす）。
      pasts='PDH-ticket-write PDH-open PDH-ticket-review PDH-ticket-human-review PDH-implement PDH-review PDH-verify'
      [ "$st" = PDH-close ] && pasts="$pasts PDH-human-review"
      for past in $pasts; do
        check_stage_checklist "$n" "$past" "$st"
      done ;;
  esac
  case "$st" in
    PDH-ticket-human-review|PDH-human-review)
      waiting=$(awk '/^## Checklist[[:space:]]*$/{f=1;next} /^##? /{f=0} f' "$n")
      merge_wait=0
      if [ "$st" = PDH-human-review ] && [ "$close_mode" = pr-merge ] &&
         grep -Eq '^- \[-\].*発行先:.*(https?://|/).*- skip: close の承認は PR の merge で受ける' <<<"$waiting"; then
        merge_wait=1
      fi
      if [ "$merge_wait" -eq 0 ] && ! grep -Eq '^- \[ \].*発行先:.*(https?://|/)' <<<"$waiting"; then
        if [ "$st" = PDH-human-review ] && [ "$close_mode" = pr-merge ]; then
          printf 'check-pdh-ticket: %s は pr-merge の承認待ちの行の形が違う（例: - [-] close の回答待ち 発行先: /board - skip: close の承認は PR の merge で受ける）\n' "$n" >&2
        else
          printf 'check-pdh-ticket: %s は %s なのに、Checklist に «発行先:» + URL か path の未了行が無い（何の答えを待つかと発行先の URL か path を 1 行書く）\n' "$n" "$st" >&2
        fi
        failed=1
      fi ;;
  esac
  case "$st" in
    PDH-human-review|PDH-close)
      [ "$git_ready" -eq 1 ] || continue
      if [ -n "$pdh_review_base" ] && { [ -f scripts/checks/docs-metadata.check ] || [ -f scripts/checks/docs-references.check ]; }; then
        python3 scripts/docs-policy.py review --note "$n" --base "$pdh_review_base" --tip "$pdh_review_tip" || failed=1
      fi
      if [ "$lock_checked" -eq 0 ] && [ -f scripts/pdh-lock.sh ]; then
        lock_checked=1
        # review と同じ base を使う。PR merge ref では第 1 親を base にする。
        # base を解決できないとき、lock のある repo の close は素通りさせない。
        if [ -z "$pdh_review_exclude" ] && [ -f .pdh-lock ]; then
          printf 'check-pdh-ticket: .pdh-lock の検査に使う ticket の base を解決できません\n' >&2
          failed=1
        elif ! bash scripts/pdh-lock.sh check --paths-from "${pdh_review_exclude:-HEAD}..HEAD"; then
          printf 'check-pdh-ticket: 上流へ同期して pdh-lock.sh write で lock を進めるか、上流の版に戻す\n' >&2
          failed=1
        fi
      fi
      [ -f "$d/progress.md" ] || continue
      if ! grep -Eq '^(- )?close-gate-sha:' "$d/progress.md"; then
        # PDH-verify では test-all（手順 3）が close 前 review（手順 6）より先に回るので数えない。
        if [ "$st" = PDH-close ]; then
          printf 'check-pdh-ticket: %s は close 前 review を回していない。close 前 review を回し、progress.md に close-gate-sha: <HEAD の SHA> を追記する\n' "$d" >&2
          failed=1
        fi
        continue
      fi
      gate_sha=$(pdh_review_sha_records "$d/progress.md" close-gate | awk 'END { print }')
      if [[ "$gate_sha" =~ ^[0-9a-fA-F]{7,40}$ ]] &&
         ! git cat-file -e "$gate_sha^{commit}" 2>/dev/null &&
         [ "$(git rev-parse --is-shallow-repository)" = true ]; then
        printf 'check-pdh-ticket: 警告: %s の起点 SHA %s は shallow clone なので確かめられなかった\n' "$d" "$gate_sha" >&2
        continue
      fi
      if ! commits=$(bash scripts/pdh-review-range.sh "$d" --from close-gate --commits); then
        printf 'check-pdh-ticket: %s の起点 SHA %s を検査できません。close 前 review の記録を確認する\n' "$d" "$gate_sha" >&2
        failed=1
      elif [ -n "$commits" ]; then
        stats=$(bash scripts/pdh-review-range.sh "$d" --from close-gate --stat) || failed=1
        printf 'check-pdh-ticket: %s の起点 SHA %s 以降に ticket 自身の変更があります（%s）。もう一度 close 前 review を回し、progress.md に close-gate-sha: <HEAD の SHA> を追記する\n' "$d" "$gate_sha" "$stats" >&2
        failed=1
      fi
      ;;
  esac
done

if [ "$failed" -ne 0 ]; then
  printf 'check-pdh-ticket: FAILED\n' >&2
  exit 1
fi
if [ "$seen" -eq 0 ]; then
  printf 'check-pdh-ticket: 検査対象の ticket なし・起票先の検査を通過\n'
else
  printf 'check-pdh-ticket: progress.md・gate の待ち行・close 前 review の記録と区間・起票先・起票した ticket の項目・Why の根拠・AC の承認の記録・PDH-stage のチェックリストの検査を通過\n'
fi
