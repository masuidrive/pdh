#!/usr/bin/env bash
# check-pdh-ticket.sh — ticket dir の受け渡し記録を、agent の申告に依らず確かめる。
# scripts/test-all.sh の 1 段として走る（PDH-implement の出口と PDH-verify で回る）。
#
#   1. tickets/<name>/ticket.md ごとに progress.md がある（経緯は progress.md へ）
#   2. note の Status が human gate なら、Checklist に «発行先:» を含む未了行がある
#      （PDH-AGENTS.md「Handover Routes」）
#   3. close 前 review の後に、ticket 自身の未 review の commit が残っていない
#   4. 未完了 ticket の note の Checklist に書かれた起票先が実在する
#   5. 根拠欄の導入後に作られた未完了 ticket の Why に根拠の 2 行がある
#
# tickets/done/ は、この branch 自身が直下へ追加した ticket の 1・3 だけを見る。
#
# 追記のみの検査は ticket.sh の append_only_files（check / close）が担う。
# bash / awk / grep / sed / git だけ。BSD / GNU 両対応。
set -uo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)" || exit 1

failed=0
seen=0

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

# 未完了 ticket の Checklist に書かれた起票先を検査する。
check_kihyo_ticket_exists() {
  local f=$1 self rows line content name exists reason canceled root
  self=${f#tickets/}
  self=${self%/note.md}
  rows=$(ticket_visible_lines "$f" | awk '
    { gsub(/：/, ":") }
    /^## Checklist([[:space:]]|$)/ { checklist=1; next }
    /^## / { checklist=0 }
    checklist && /^[[:space:]]*[-*] \[[ xX]\][[:space:]]*起票:/ { printf "%d\t%s\n", NR, $0 }
  ') || { failed=1; return; }
  while IFS=$'\t' read -r line content; do
    [ -n "$line" ] || continue
    name=''
    if [[ "$content" == *'→'* ]]; then
      name=$(printf '%s\n' "${content#*→}" | awk '{gsub(/`/, ""); print $1}')
    fi
    exists=0
    reason='ticket を作ってから名前を書く（./ticket.sh new）'
    # 名前は 1 つの ticket を指す。親ディレクトリなどを実在先に数えない。
    if [ -z "$name" ]; then
      reason="→ の後が空です。$reason"
    elif [[ ! "$name" =~ ^(CANCELED-)?[0-9]{6}-[0-9]{6}- || "$name" == */* ]]; then
      reason="ticket 名の形ではない（YYMMDD-hhmmss- または CANCELED-YYMMDD-hhmmss- で始まる名前を書く）。$reason"
    elif [ "$name" = "$self" ]; then
      reason='note を持つ ticket 自身は起票先にできない'
    else
      canceled="${name:0:14}CANCELED-${name:14}"
      for root in tickets tickets/done; do
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

# テンプレートに根拠欄が入った後の ticket だけを検査する。
check_ticket_why_intake_evidence() {
  local f=$1 name created missing
  [ -n "$intake_start" ] || return 0
  name=${f#tickets/}
  name=${name%/ticket.md}
  [[ "$name" =~ ^([0-9]{6})-([0-9]{6})(-|$) ]] || return
  created="20${BASH_REMATCH[1]}${BASH_REMATCH[2]}"
  [[ "$created" < "$intake_start" ]] && return
  [ -f "$f" ] || return
  missing=$(ticket_visible_lines "$f" | awk '
    /^### Why/ { why=1; next }
    /^#(#(#)?)?[[:space:]]/ { why=0 }
    why {
      sub(/^[[:space:]]*/, "")
      sub(/^-([[:space:]]+)(\[[ xX]\][[:space:]]*)?/, "")
      gsub(/：/, ":")
      if (/^再現か実測:/ || /^いま直さない理由:/) {
        key=$0; sub(/:.*/, "", key)
        sub(/^[^:]*:[[:space:]]*/, "")
        seen[key]=1
        if ($0 ~ /^[[:space:]]*$/) empty[key]=1
      }
    }
    END {
      if (!seen["再現か実測"] || empty["再現か実測"]) print "再現か実測:"
      if (!seen["いま直さない理由"] || empty["いま直さない理由"]) print "いま直さない理由:"
    }
  ') || { failed=1; return; }
  if [ -n "$missing" ]; then
    printf 'check-pdh-ticket: %s: Why 節で次の行が無いか空です:\n%s\n' "$f" "$missing" >&2
    printf '%s\n' '  Why 節に「再現か実測: <確かめた手順と結果>」と「いま直さない理由: <理由>」を書く。' \
      '  要望起点なら「いま直さない理由: 該当なし（要望起点。進行中の ticket から派生していない）」でよい。' >&2
    failed=1
  fi
}

# base から分岐した後、branch 自身の commit が done へ移した ticket も検査する。
done_tickets=()
git_ready=0
if git rev-parse --verify HEAD >/dev/null 2>&1; then
  git_ready=1
  source scripts/pdh-review-range.sh
  pdh_review_base_tip || exit 1
fi
if [ "$git_ready" -eq 1 ] && [ -n "$pdh_review_base" ]; then
  branch_start=$(git merge-base "$pdh_review_base" "$pdh_review_tip") || exit 1
  added=$(git log --first-parent --no-merges --diff-filter=A --name-only --format= \
    "$branch_start..$pdh_review_tip" -- ':(top)tickets/done/*/ticket.md') || exit 1
  while IFS= read -r t; do
    [[ "$t" =~ ^tickets/done/[^/]+/ticket\.md$ && "$t" != *-CANCELED-* ]] || continue
    done_tickets+=("$t")
  done <<< "$(printf '%s\n' "$added" | awk 'NF && !seen[$0]++')"
fi

# 最初に根拠欄を導入した commit の committer 日時を UTC で読む。
# shallow clone では開始日時が後ろへずれ、検査対象が減る側に倒れる。
intake_start=''
if [ "$git_ready" -eq 1 ]; then
  intake_start=$(TZ=UTC git log --format=%cd --date=format-local:%Y%m%d%H%M%S \
    -S'再現か実測:' -- .ticket-config.yaml | awk 'END { print }') || {
    printf 'check-pdh-ticket: .ticket-config.yaml の根拠欄の開始日時を読めません\n' >&2
    exit 1
  }
fi
for n in tickets/*/note.md; do
  [ -f "$n" ] || continue
  check_kihyo_ticket_exists "$n"
done
for t in tickets/*/ticket.md; do
  [ -f "$t" ] || continue
  check_ticket_why_intake_evidence "$t"
done

for t in tickets/*/ticket.md ${done_tickets[@]+"${done_tickets[@]}"}; do
  [ -f "$t" ] || continue
  seen=1
  d=${t%/ticket.md}

  if [ ! -f "$d/progress.md" ]; then
    printf 'check-pdh-ticket: %s/progress.md が無い（経緯は progress.md へ。1 行目は "# Progress: <ticket-name>"）\n' "$d" >&2
    failed=1
  fi

  n="$d/note.md"
  if [[ "$t" == tickets/done/* ]]; then
    st=PDH-close
  else
    [ -f "$n" ] || continue
    st=$(grep -m1 '^## Status:' "$n" | sed -E 's/^## Status:[[:space:]]*(PDH-[a-z-]+).*/\1/')
  fi
  case "$st" in
    PDH-ticket-human-review|PDH-human-review)
      if ! awk '/^## Checklist/{f=1;next} /^## /{f=0} f' "$n" | grep -Eq '^- \[ \].*発行先:.*(https?://|/)'; then
        printf 'check-pdh-ticket: %s は %s なのに、Checklist に «発行先:» + URL か path の未了行が無い（何の答えを待つかと発行先の URL か path を 1 行書く）\n' "$n" "$st" >&2
        failed=1
      fi ;;
  esac
  case "$st" in
    PDH-human-review|PDH-close)
      [ "$git_ready" -eq 1 ] || continue
      [ -f "$d/progress.md" ] || continue
      if ! grep -Eq '^(- )?close-gate-sha:' "$d/progress.md"; then
        if [ "$st" = PDH-close ]; then
          printf 'check-pdh-ticket: %s は close 前 review を回していない。close 前 review を回し、progress.md に close-gate-sha: <HEAD の SHA> を追記する\n' "$d" >&2
          failed=1
        fi
        continue
      fi
      gate_sha=$(awk '/^(- )?close-gate-sha:/{sub(/^(- )?close-gate-sha:[[:space:]]*/, ""); sha=$1} END{print sha}' "$d/progress.md")
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
  printf 'check-pdh-ticket: progress.md・gate の待ち行・close 前 review の記録と区間・起票先・導入後の Why の根拠の検査を通過\n'
fi
