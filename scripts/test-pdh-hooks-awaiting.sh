#!/usr/bin/env bash
# awaiting-reply の宛先を、ネットワークを使わず gh の呼び出しで検査する。
set -uo pipefail
TMP_DIR=$(mktemp -d) || exit 1
trap 'rm -rf "$TMP_DIR"' EXIT
checks=0
failures=0
fail() { printf 'FAIL: %s\n' "$*" >&2; failures=$((failures + 1)); }
must() { "$@" || { fail "準備コマンドが失敗しました: $*"; exit 1; }; }

# 呼び出し元の git 設定・index・hook が一時 repo に干渉しないようにする。
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GITHUB_BASE_REF GIT_CONFIG GIT_CONFIG_PARAMETERS
export GIT_CONFIG_COUNT=0 GIT_TEMPLATE_DIR=
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
export GIT_AUTHOR_NAME='検査用' GIT_AUTHOR_EMAIL='test@example.invalid'
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME" GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
export GIT_AUTHOR_DATE='2026-01-01T00:00:00Z'
export GIT_COMMITTER_DATE="$GIT_AUTHOR_DATE"
unset CODING_ROBOT_NOTIFY_FILE

ROOT_DIR=$(git -C "$(dirname "$0")" rev-parse --show-toplevel) || exit 1
HOOKS=""
for candidate in github-bot/pdh-hooks.sh .github/coding-robot/pdh-hooks.sh; do
  if [ -f "$ROOT_DIR/$candidate" ]; then
    HOOKS="$ROOT_DIR/$candidate"
    break
  fi
done
[ -n "$HOOKS" ] || { fail 'pdh-hooks.sh が見つかりません'; exit 1; }

must mkdir -p "$TMP_DIR/bin"
cat > "$TMP_DIR/bin/gh" <<'MOCK'
#!/usr/bin/env bash
set -uo pipefail
# %q で改行も escape し、1 呼び出しを必ず 1 行にする。引数境界は tab。
{ printf '%q\t' "$@"; printf '\n'; } >> "$GH_LOG"
case "${1:-} ${2:-}" in
  'pr list') printf '%s\n' "${FAKE_OPEN_PR:-}" ;;
  'issue edit') ;;
  'label list')
    printf '%s\n' PDH-open PDH-ticket-review PDH-ticket-human-review \
      PDH-implement PDH-review PDH-verify PDH-human-review PDH-close awaiting-reply ;;
  'api '*) printf 'true\n' ;;
  *) printf '想定外の gh 呼び出し: %s\n' "$*" >&2; exit 1 ;;
esac
MOCK
must chmod +x "$TMP_DIR/bin/gh"
export PATH="$TMP_DIR/bin:$PATH"
export GITHUB_REPOSITORY=example/project
export GH_LOG="$TMP_DIR/gh.log"

expect() {
  local label=$1 cmd=$2 pr=$3 ticket=$4 expected=$5
  local repo output rc
  checks=$((checks + 1))
  repo="$TMP_DIR/repo-$checks"
  must mkdir -p "$repo/tickets"
  must git -C "$repo" init -q -b main
  printf 'github_bot:\n  close: pr-merge\n' > "$repo/.ticket-config.yaml"
  if [ "$ticket" != missing ]; then
    must mkdir -p "$repo/tickets/260101-000000-issue-1"
    printf '# Issue 1\n' > "$repo/tickets/260101-000000-issue-1/ticket.md"
    {
      printf '## Status: PDH-implement\n\n## Checklist\n'
      if [ "$ticket" = waiting ]; then
        printf '%s\n' '- [ ] 回答待ち 発行先: https://github.com/example/project/issues/1#issuecomment-100'
      fi
    } > "$repo/tickets/260101-000000-issue-1/note.md"
  fi
  : > "$GH_LOG"
  # final は stdin から最終レポートを読む。repo に remote は設定しない。
  output=$(cd "$repo" && FAKE_OPEN_PR="$pr" bash "$HOOKS" "$cmd" 1 test-branch 100 2>&1 <<'REPORT'
確認した結果を報告します。
REPORT
  ); rc=$?
  if [ "$rc" -ne 0 ]; then
    fail "$label: exit ${rc}（期待 0）: $output"
    return
  fi
  expect_labels "$label" "$expected"
}

expect_labels() {
  local label=$1 expected=$2 actual
  # stage ラベルの操作は除外し、番号と add/remove を引数単位で比較する。
  # 全操作を比較するので、期待する操作の欠落も、逆の操作の混入も検出する。
  actual=$(awk -F '\t' '
    $1 == "issue" && $2 == "edit" {
      for (i = 4; i < NF; i++) {
        if ($(i + 1) != "awaiting-reply") continue
        if ($i == "--add-label") print $3 " add"
        if ($i == "--remove-label") print $3 " remove"
      }
    }
  ' "$GH_LOG" | LC_ALL=C sort)
  expected=$(printf '%s\n' "$expected" | LC_ALL=C sort)
  if [ "$actual" != "$expected" ]; then
    fail "$label"
    printf '  期待:\n%s\n  実際:\n%s\n' "$expected" "$actual" >&2
  else
    printf 'PASS: %s\n' "$label"
  fi
}

expect_auth_failure() {
  local label=$1 engine=$2 branch=$3 expected=$4
  local engine_file="" candidate repo script_dir output rc
  checks=$((checks + 1))
  for candidate in "github-bot/.github/coding-robot/engines/_$engine.sh" ".github/coding-robot/engines/_$engine.sh"; do
    if [ -f "$ROOT_DIR/$candidate" ]; then
      engine_file="$ROOT_DIR/$candidate"
      break
    fi
  done
  if [ -z "$engine_file" ]; then
    fail "$label: engine ファイルが見つかりません"
    return
  fi
  repo="$TMP_DIR/repo-$checks"
  script_dir="$TMP_DIR/script-$checks"
  must mkdir -p "$repo/tickets" "$script_dir" "$TMP_DIR/home-$checks" "$TMP_DIR/codex-home-$checks"
  must git -C "$repo" init -q -b main
  must touch "$repo/product-brief.md"
  must cp "$HOOKS" "$script_dir/pdh-hooks.sh"
  : > "$GH_LOG"
  output=$({
    cd "$repo" || exit 2
    # run-action.sh と同様に、未設定の認証変数を空として評価する。
    set +u
    post_error_comment() { :; }
    ISSUE_NUMBER=1  # Codex は source 時にも参照する。
    source "$engine_file" || exit 2
    unset CLAUDE_CODE_OAUTH_TOKEN CODEX_AUTH_JSON OPENAI_API_KEY TRUSTED_LINKED_ISSUE
    export CODEX_HOME="$TMP_DIR/codex-home-$checks" HOME="$TMP_DIR/home-$checks"
    if [ -n "$branch" ]; then
      BRANCH_NAME="$branch"
    else
      unset BRANCH_NAME
    fi
    SCRIPT_DIR="$script_dir"
    export FAKE_OPEN_PR=11
    engine_setup_auth
  } 2>&1); rc=$?
  if [ "$rc" -ne 1 ]; then
    fail "$label: exit ${rc}（期待 1）: $output"
    return
  fi
  expect_labels "$label" "$expected"
}

expect '1. failed + open PR 11' failed 11 none $'1 remove\n11 add'
expect '2. failed + PR 無し' failed '' none '1 add'
expect '3. start + open PR 11' start 11 none $'1 remove\n11 remove'
expect '4. start + PR 無し' start '' none '1 remove'
expect '5. final（待ち行あり）+ open PR 11' final 11 waiting $'1 remove\n11 add'
expect '6. final（待ち行あり）+ PR 無し' final '' waiting '1 add'
expect '7. final（待ち行なし）+ open PR 11' final 11 none $'1 remove\n11 remove'
expect '8. final（ticket 未作成）+ PR 無し' final '' missing '1 add'

# 共通関数への集約を、コメント以外のラベル操作行が 2 行以下かで検査する。
# --add-label / --remove-label と "--${action}-label" の両方を数える。
checks=$((checks + 1))
label_lines=$(awk '
  /^[[:space:]]*#/ {next}
  /-label"?[[:space:]]+"\$AWAITING_LABEL"/ {n++}
  END {print n + 0}
' "$HOOKS")
if [ "$label_lines" -le 2 ]; then
  printf 'PASS: 9. 構造検査（ラベル操作が 2 行以下）\n'
else
  fail "9. 構造検査（ラベル操作が 2 行以下）: $label_lines 行"
fi

expect_auth_failure '10. codex の認証失敗 + open PR 11' codex test-branch $'1 remove\n11 add'
expect_auth_failure '11. claude の認証失敗 + open PR 11' claude test-branch $'1 remove\n11 add'
expect_auth_failure '12. codex の認証失敗 + BRANCH_NAME 未設定' codex '' '1 add'

if [ "$failures" -ne 0 ]; then
  printf 'FAIL: pdh-hooks awaiting-reply (%s/%s checks failed)\n' "$failures" "$checks" >&2
  exit 1
fi
printf 'PASS: pdh-hooks awaiting-reply (%s checks)\n' "$checks"
