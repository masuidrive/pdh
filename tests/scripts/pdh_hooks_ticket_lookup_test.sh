#!/usr/bin/env bash
# ticket の対応付けと、対応付けた ticket からの通知・ラベル・AC 表示を検査する。
set -uo pipefail
ROOT_DIR=$(cd "$(dirname "$0")/../.." && pwd) || exit 1
HOOKS="$ROOT_DIR/.github/coding-bot/pdh-hooks.sh"
TMP_DIR=$(mktemp -d) || exit 1
trap 'rm -rf "$TMP_DIR"' EXIT
export LC_ALL=C GITHUB_REPOSITORY=example/project
unset CODING_BOT_GH_PAT
checks=0 failures=0
must() { "$@" || exit 1; }
equal() {
  checks=$((checks + 1))
  if [ "$2" != "$3" ]; then
    printf 'FAIL: %s: expected <%s>, got <%s>\n' "$1" "$3" "$2" >&2
    failures=$((failures + 1))
  fi
}
must mkdir -p "$TMP_DIR/bin"
cat > "$TMP_DIR/bin/gh" <<'MOCK'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$GH_LOG"
case "$1 $2" in
  'pr list') printf '%s\n' "${FAKE_OPEN_PR-11}" ;;
  'issue view') echo OPEN ;;
  'issue edit') ;;
  'label list') printf '%s\n' PDH-open PDH-ticket-review PDH-ticket-human-review PDH-implement PDH-review PDH-verify PDH-human-review PDH-close awaiting-reply ;;
  'api '*) echo true ;;
  *) echo "Unexpected gh: $*" >> "$UNEXPECTED"; exit 1 ;;
esac
MOCK
# この検査では待ち行をあらかじめ置く。git の変更・push が呼ばれたら失敗する。
cat > "$TMP_DIR/bin/git" <<'MOCK'
#!/usr/bin/env bash
echo "Unexpected git: $*" >> "$UNEXPECTED"
exit 1
MOCK
must chmod +x "$TMP_DIR/bin/gh" "$TMP_DIR/bin/git"
export PATH="$TMP_DIR/bin:$PATH"
export UNEXPECTED="$TMP_DIR/unexpected"

ticket() {
  local path=$1 branch=$2 stage=$3 marker=$4 issue=${5:-}
  must mkdir -p "$path"
  printf '%s\n' '---' > "$path/ticket.md"
  [ "$branch" = - ] || printf 'branch: %s\n' "$branch" >> "$path/ticket.md"
  [ -z "$issue" ] || printf 'issue: %s\n' "$issue" >> "$path/ticket.md"
  printf '%s\n' '---' '### What / Acceptance Criteria' \
    "- [x] $marker complete" "- [ ] $marker pending" >> "$path/ticket.md"
  printf '%s\n' "## Status: $stage" '## Checklist' \
    '- [ ] 回答待ち 発行先: https://example.invalid/answer' > "$path/note.md"
}

run_case() (
  # 各ケースは独立した cwd・通知ファイルを使う。親へは集計だけ返す。
  local scenario=$1 selected=$2 state=$3 stage=$4 duplicate=${5:-no}
  local repo="$TMP_DIR/$scenario" cmd output rc expected_kind expected_stage labels expected_labels
  checks=0 failures=0
  must mkdir -p "$repo/tickets"
  cd "$repo" || exit 1
  printf 'github_bot:\n  close: pr-merge\n' > .ticket-config.yaml
  case "$scenario" in
    named) ticket tickets/a-issue-1 unrelated PDH-implement selected ;;
    adopted) ticket tickets/a-adopted agent/issue-1 PDH-implement selected ;;
    gate) ticket tickets/a-adopted agent/issue-1 PDH-ticket-human-review selected ;;
    done-named) ticket tickets/done/a-issue-1 unrelated PDH-human-review selected ;;
    done-adopted) ticket tickets/done/a-adopted agent/issue-1 PDH-human-review selected ;;
    quoted) ticket tickets/a-adopted '"agent/issue-1" # adopted' PDH-implement selected ;;
    single-quoted) ticket tickets/a-adopted "'agent/issue-1'" PDH-implement selected ;;
    issue-only) ticket tickets/a-adopted - PDH-implement selected 1 ;;
    issue-after-branch) ticket tickets/a-adopted unrelated PDH-implement selected 1 ;;
    issue-quoted) ticket tickets/a-adopted - PDH-implement selected '"1" # adopted' ;;
    issue-single-quoted) ticket tickets/a-adopted - PDH-implement selected "'1'" ;;
    done-issue) ticket tickets/done/a-adopted - PDH-human-review selected 1 ;;
    done-without-pr) ticket tickets/done/a-adopted agent/issue-1 PDH-human-review selected ;;
    done-closed) ticket tickets/done/a-adopted agent/issue-1 PDH-close selected ;;
    issue-body-only)
      ticket tickets/a-other - PDH-review wrong 10
      printf '\nissue: 1\n' >> tickets/a-other/ticket.md ;;
    issue-before-done-name)
      ticket tickets/done/a-issue-1 unrelated PDH-human-review wrong
      ticket tickets/z-adopted - PDH-implement selected 1 ;;
    mixed-frontmatter)
      ticket tickets/z-adopted agent/issue-1 PDH-review wrong
      ticket tickets/a-adopted unrelated PDH-implement selected 1 ;;
    branch-with-other-issue) ticket tickets/a-adopted agent/issue-1 PDH-implement selected 10 ;;
    missing) ;;
    body-only)
      ticket tickets/a-other agent/issue-10 PDH-review wrong
      printf '\nbranch: agent/issue-1\n' >> tickets/a-other/ticket.md ;;
    name-priority)
      ticket tickets/a-adopted agent/issue-1 PDH-review wrong
      ticket tickets/z-issue-1 unrelated PDH-implement selected ;;
    done-name-priority)
      ticket tickets/a-adopted agent/issue-1 PDH-implement selected
      ticket tickets/done/z-issue-1 unrelated PDH-human-review wrong ;;
    adopted-after-done)
      ticket tickets/done/a-issue-1 agent/issue-1 PDH-human-review wrong
      ticket tickets/z-adopted agent/issue-1 PDH-ticket-human-review selected ;;
    done-name-before-frontmatter)
      ticket tickets/done/a-adopted agent/issue-1 PDH-review wrong
      ticket tickets/done/z-issue-1 unrelated PDH-human-review selected ;;
    duplicate-names)
      ticket tickets/z-issue-1 unrelated PDH-review wrong
      ticket tickets/a-issue-1 unrelated PDH-implement selected ;;
    duplicate-branches)
      ticket tickets/z-adopted agent/issue-1 PDH-review wrong
      ticket tickets/a-adopted agent/issue-1 PDH-implement selected ;;
    active-done)
      ticket tickets/done/a-adopted agent/issue-1 PDH-review wrong
      ticket tickets/z-adopted agent/issue-1 PDH-implement selected ;;
  esac
  export FAKE_OPEN_PR=11
  [ "$scenario" != done-without-pr ] || FAKE_OPEN_PR=''
  export GH_LOG="$repo/gh.log" CODING_BOT_NOTIFY_FILE="$repo/notify"
  for cmd in progress failed start final; do
    : > "$GH_LOG"
    rm -f "$CODING_BOT_NOTIFY_FILE"
    output=$(bash "$HOOKS" "$cmd" 1 agent/issue-1 100 2> "$repo/stderr" <<< 'Report'); rc=$?
    equal "$scenario/$cmd exit" "$rc" 0
    expected_kind='' expected_stage='' expected_labels=''
    case "$cmd" in
      progress)
        if [ "$state" = active ]; then
          equal "$scenario/progress" "$output" $'**AC 1/2**\n✅ selected complete\n⬜ selected pending'
        else
          equal "$scenario/progress" "$output" ''
        fi ;;
      start) expected_labels=$'1 remove awaiting-reply\n11 remove awaiting-reply' ;;
      failed)
        expected_kind=failed expected_stage=$stage
        expected_labels=$'1 add awaiting-reply\n11 remove awaiting-reply' ;;
      final)
        expected_labels=$'1 add awaiting-reply\n11 remove awaiting-reply'
        expected_stage=$stage
        case "$state/$stage" in
          missing/*) expected_kind=question ;;
          done/PDH-human-review) expected_kind=close_gate ;;
          # close gate 以外の done は、未作成と同じく回答待ちを通知する。
          done/*) expected_kind=question expected_stage='' ;;
          active/PDH-ticket-human-review) expected_kind=ticket_gate ;;
          *) expected_kind=blocked ;;
        esac
        if [ "$state" = active ] || { [ "$state" = done ] && [ "$stage" = PDH-human-review ]; }; then
          expected_labels="1 add $stage"$'\n'"$expected_labels"
        fi
        if [ "$state" = done ]; then
          equal "$scenario/final report" "$output" $'Report\n\n<!-- coding-bot:question -->'
          if [ "$stage" = PDH-human-review ] && [ -n "$FAKE_OPEN_PR" ]; then
            equal "$scenario/close gate log" "$(grep -c 'close gate: PR #11 の Merge 待ち' "$repo/stderr")" 2
          else
            equal "$scenario/close gate log" "$(grep -c 'close gate' "$repo/stderr")" 0
          fi
        fi ;;
    esac
    if [ "$scenario" = done-without-pr ]; then
      case "$cmd" in
        start) expected_labels='1 remove awaiting-reply' ;;
        failed) expected_labels='1 add awaiting-reply' ;;
        final) expected_labels='1 add awaiting-reply' expected_kind=question expected_stage='' ;;
      esac
    fi
    labels=$(awk '$1 == "issue" && $2 == "edit" {for(i=4;i<NF;i++) {if($i=="--add-label") print $3 " add " $(i+1); if($i=="--remove-label" && $(i+1)=="awaiting-reply") print $3 " remove " $(i+1)}}' "$GH_LOG")
    equal "$scenario/$cmd labels" "$labels" "$expected_labels"
    if [ -n "$expected_kind" ]; then
      equal "$scenario/$cmd notify" "$(cat "$CODING_BOT_NOTIFY_FILE" 2>/dev/null)" "$(printf 'issue=1\nkind=%s\nstage=%s\ncomment_id=100\npr=%s' "$expected_kind" "$expected_stage" "$FAKE_OPEN_PR")"
    else
      equal "$scenario/$cmd no notify" "$([ -f "$CODING_BOT_NOTIFY_FILE" ] && echo exists)" ''
    fi
    if [ "$duplicate" = yes ] && [ "$cmd" != start ]; then
      equal "$scenario/$cmd ambiguity log" "$(grep -c '複数' "$repo/stderr")" 1
      equal "$scenario/$cmd selected path log" "$(grep -cF "$selected" "$repo/stderr")" 1
    fi
  done
  printf '%s %s\n' "$checks" "$failures" > "$repo/counts"
)

while read -r scenario selected state stage duplicate; do
  [ "$stage" != - ] || stage=''
  must run_case "$scenario" "$selected" "$state" "$stage" "$duplicate"
  read -r case_checks case_failures < "$TMP_DIR/$scenario/counts"
  checks=$((checks + case_checks)); failures=$((failures + case_failures))
done <<'CASES'
named tickets/a-issue-1 active PDH-implement no
adopted tickets/a-adopted active PDH-implement no
gate tickets/a-adopted active PDH-ticket-human-review no
done-named tickets/done/a-issue-1 done PDH-human-review no
done-adopted tickets/done/a-adopted done PDH-human-review no
quoted tickets/a-adopted active PDH-implement no
single-quoted tickets/a-adopted active PDH-implement no
issue-only tickets/a-adopted active PDH-implement no
issue-after-branch tickets/a-adopted active PDH-implement no
issue-quoted tickets/a-adopted active PDH-implement no
issue-single-quoted tickets/a-adopted active PDH-implement no
done-issue tickets/done/a-adopted done PDH-human-review no
done-without-pr tickets/done/a-adopted done PDH-human-review no
done-closed tickets/done/a-adopted done PDH-close no
issue-body-only - missing - no
issue-before-done-name tickets/z-adopted active PDH-implement no
mixed-frontmatter tickets/a-adopted active PDH-implement yes
branch-with-other-issue tickets/a-adopted active PDH-implement no
missing - missing - no
body-only - missing - no
name-priority tickets/z-issue-1 active PDH-implement no
done-name-priority tickets/a-adopted active PDH-implement no
adopted-after-done tickets/z-adopted active PDH-ticket-human-review no
done-name-before-frontmatter tickets/done/z-issue-1 done PDH-human-review no
duplicate-names tickets/a-issue-1 active PDH-implement yes
duplicate-branches tickets/a-adopted active PDH-implement yes
active-done tickets/z-adopted active PDH-implement no
CASES
equal 'unexpected external operations' "$(cat "$UNEXPECTED" 2>/dev/null)" ''
printf 'SUMMARY: pdh-hooks ticket lookup: %s checks, %s failures\n' "$checks" "$failures"
[ "$failures" -eq 0 ]
