#!/usr/bin/env bash
# bot の初回・再実行でも base checkout を残し、ticket は同じ worktree を使う。
set -euo pipefail
resolved_link() {
  python3 -c 'import os, sys; print(os.path.realpath(sys.argv[1]))' "$1"
}
ROOT_DIR=${PDH_TEST_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}
ENTER="$ROOT_DIR/.github/coding-bot/enter-branch-worktree.sh"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT
export LC_ALL=C GIT_CONFIG_GLOBAL="$TMP_DIR/gitconfig" GIT_CONFIG_NOSYSTEM=1
export GIT_TERMINAL_PROMPT=0
checks=0 failures=0
equal() {
  checks=$((checks + 1))
  if [ "$2" != "$3" ]; then
    printf 'FAIL: %s: expected <%s>, got <%s>\n' "$1" "$3" "$2" >&2
    failures=$((failures + 1))
  fi
}
must() { "$@" || exit 1; }
count_worktrees() { git -C "$repo" worktree list --porcelain | awk '/^worktree /{n++} END{print n}'; }
enter() { (cd "$repo" && bash "$ENTER" "$@"); }

# 空白を含む path でも stdout は絶対パス 1 行だけになる。
repo="$TMP_DIR/project space"
branch=agent/issue-1
slug=261014-000001-bot-worktree
expected="$TMP_DIR/project space.worktrees/agent-issue-1"
must mkdir -p "$repo/tickets" "$repo/scripts"
must git -C "$repo" init -q -b main
must git -C "$repo" config user.name 'Worktree Test'
must git -C "$repo" config user.email worktree-test@example.invalid
must cp "$ROOT_DIR/ticket.sh" "$repo/ticket.sh"
cat > "$repo/.ticket-config.yaml" <<'CONFIG'
tickets_dir: tickets
default_branch: main
branch_prefix: features/
repository: origin
worktree_mode: true
auto_push: false
note_content: |
  ## Status: PDH-open
  ## Checklist
CONFIG
printf 'worktree test\n' > "$repo/product-brief.md"
printf 'current-ticket\ncurrent-ticket.md\ncurrent-note.md\n' > "$repo/.gitignore"
# hook の実行先・push する SHA を記録し、push は拒否する。
cat > "$repo/scripts/check-pdh-ticket.sh" <<'CHECKER'
#!/usr/bin/env bash
printf '%s\n' "$(git rev-parse --show-toplevel) $(git rev-parse HEAD)" >> "$CHECK_LOG"
[ -f hook-reject ] || exit 0
echo 'check-pdh-ticket: worktree test rejection'
exit 1
CHECKER
must git -C "$repo" add .
must git -C "$repo" commit -qm seed
base_sha=$(git -C "$repo" rev-parse HEAD)
must git clone -q --bare "$repo" "$TMP_DIR/origin.git"
must git -C "$repo" remote add origin "$TMP_DIR/origin.git"
must git -C "$repo" fetch -q origin
equal 'initial worktree count' "$(count_worktrees)" 1

wt=$(enter "$branch" true 2> "$TMP_DIR/enter.log")
equal 'new worktree absolute path / stdout' "$wt" "$expected"
equal 'new worktree count' "$(count_worktrees)" 2
equal 'new worktree branch' "$(git -C "$wt" branch --show-current)" "$branch"
equal 'new branch starts at base HEAD' "$(git -C "$wt" rev-parse HEAD)" "$base_sha"
equal 'base branch after enter' "$(git -C "$repo" branch --show-current)" main

(
  cd "$wt"
  bash ticket.sh new bot-worktree --branch "$branch" --created-at 261014-000001
  git add tickets
  git commit -qm ticket
  bash ticket.sh start "$slug"
) > "$TMP_DIR/ticket.log" 2>&1 || { cat "$TMP_DIR/ticket.log"; exit 1; }
equal 'start reuses bot worktree' "$(count_worktrees)" 2
equal 'start keeps ticket branch' "$(git -C "$wt" branch --show-current)" "$branch"
equal 'base branch after start' "$(git -C "$repo" branch --show-current)" main
equal 'base HEAD after start' "$(git -C "$repo" rev-parse HEAD)" "$base_sha"
for file in ticket.md note.md; do
  equal "worktree has $file" "$([ -f "$wt/tickets/$slug/$file" ] && echo yes)" yes
  equal "base has no $file" "$([ ! -e "$repo/tickets/$slug/$file" ] && echo yes)" yes
done
equal 'current ticket points into worktree' "$(resolved_link "$wt/current-ticket.md")" "$wt/tickets/$slug/ticket.md"
equal 'current note points into worktree' "$(resolved_link "$wt/current-note.md")" "$wt/tickets/$slug/note.md"

# remote に無い新規 branch の再試行でも、既存 worktree の未保存ファイルを残す。
printf 'unsaved\n' > "$wt/unsaved.txt"
equal 'reuse new branch' "$(enter "$branch" true 2> "$TMP_DIR/reuse.log")" "$wt"
equal 'reuse preserves unsaved file' "$(cat "$wt/unsaved.txt")" unsaved
must rm "$wt/unsaved.txt"
# 使い捨て remote に branch を保存し、既存 branch の pull も実際に通す。
must git -C "$TMP_DIR/origin.git" fetch -q "$repo" "$branch:refs/heads/$branch"
must git -C "$repo" fetch -q origin
equal 'reuse existing branch' "$(enter "$branch" false 2> "$TMP_DIR/reuse.log")" "$wt"
equal 'reuse does not add worktree' "$(count_worktrees)" 2
must git -C "$repo" worktree remove "$wt"
equal 'removed ticket worktree' "$(count_worktrees)" 1
wt=$(enter "$branch" false 2> "$TMP_DIR/reenter.log")
(
  cd "$wt"
  bash ticket.sh restore
) > "$TMP_DIR/restore.log" 2>&1 || { cat "$TMP_DIR/restore.log"; exit 1; }
equal 'restore reuses recreated worktree' "$(count_worktrees)" 2
equal 'restore keeps base branch' "$(git -C "$repo" branch --show-current)" main
equal 'restore keeps base HEAD' "$(git -C "$repo" rev-parse HEAD)" "$base_sha"
equal 'restored current ticket' "$(resolved_link "$wt/current-ticket.md")" "$wt/tickets/$slug/ticket.md"
equal 'restored current note' "$(resolved_link "$wt/current-note.md")" "$wt/tickets/$slug/note.md"

# 元の checkout だけ信頼されている状態では、linked worktree は信頼されない。
export GIT_SAFE_DIRECTORY="$repo"
must git config --global --unset-all safe.directory
must git config --global --add safe.directory "$GIT_SAFE_DIRECTORY"
rc=0
GIT_TEST_ASSUME_DIFFERENT_OWNER=1 git -C "$wt" status --porcelain > "$TMP_DIR/unsafe.log" 2>&1 || rc=$?
equal 'untrusted worktree is rejected' "$rc" 128
equal 'ownership error is reproduced' "$(grep -c 'dubious ownership' "$TMP_DIR/unsafe.log")" 1
equal 'reuse registers safe.directory' "$(GIT_TEST_ASSUME_DIFFERENT_OWNER=1 enter "$branch" false 2> "$TMP_DIR/safe.log")" "$wt"
must env GIT_TEST_ASSUME_DIFFERENT_OWNER=1 git -C "$wt" status --porcelain > "$TMP_DIR/safe-status.log"
equal 'explicit worktree trust' "$(git config --global --get-all safe.directory | tail -1)" "$wt"

# 共通 hooks dir に実際の installer を置き、linked worktree から hook を実行する。
must awk '/^install_pdh_pre_push_hook\(\)/{copy=1} copy{print} copy && /^}$/{exit}' \
  "$ROOT_DIR/.github/coding-bot/run-action.sh" > "$TMP_DIR/install.sh"
export CHECK_LOG="$TMP_DIR/check.log"
printf 'reject this push\n' > "$wt/hook-reject"
must git -C "$wt" add hook-reject
must git -C "$wt" commit -qm 'hook rejection probe'
(
  cd "$wt"
  source "$TMP_DIR/install.sh"
  install_pdh_pre_push_hook
)
equal 'shared hooks directory' "$(git -C "$wt" rev-parse --git-path hooks)" "$repo/.git/hooks"
equal 'installed shared hook is executable' "$([ -x "$repo/.git/hooks/pre-push" ] && echo yes)" yes
rc=0
git -C "$wt" push origin "$branch" > "$TMP_DIR/push.log" 2>&1 || rc=$?
equal 'linked worktree push runs rejecting hook' "$rc" 1
equal 'hook checks pushed SHA' "$(awk -v sha="$(git -C "$wt" rev-parse HEAD)" '$NF == sha{n++} END{print n+0}' "$CHECK_LOG")" 1
equal 'hook cleans temporary worktree' "$(count_worktrees)" 2

# remote にだけ在る branch も worktree add の追跡 branch 作成を使える。
remote_branch=agent/issue-2
must git -C "$TMP_DIR/origin.git" update-ref "refs/heads/$remote_branch" "$base_sha"
must git -C "$repo" fetch -q origin
remote_wt=$(enter "$remote_branch" false 2> "$TMP_DIR/remote.log")
equal 'remote-only branch path' "$remote_wt" "$TMP_DIR/project space.worktrees/agent-issue-2"
equal 'remote-only branch HEAD' "$(git -C "$remote_wt" rev-parse HEAD)" "$base_sha"
equal 'remote-only keeps base branch' "$(git -C "$repo" branch --show-current)" main
must git clone -q --branch "$remote_branch" "$TMP_DIR/origin.git" "$TMP_DIR/writer"
must git -C "$TMP_DIR/writer" config user.name 'Worktree Test'
must git -C "$TMP_DIR/writer" config user.email worktree-test@example.invalid
printf 'remote update\n' > "$TMP_DIR/writer/remote-update"
must git -C "$TMP_DIR/writer" add remote-update
must git -C "$TMP_DIR/writer" commit -qm 'remote update'
must git -C "$TMP_DIR/origin.git" fetch -q "$TMP_DIR/writer" "$remote_branch:refs/heads/$remote_branch"
equal 'pull keeps stdout to path only' "$(enter "$remote_branch" false 2> "$TMP_DIR/pull.log")" "$remote_wt"
equal 'pull updates existing worktree' "$(cat "$remote_wt/remote-update")" 'remote update'
equal 'pull does not update base checkout' "$([ ! -e "$repo/remote-update" ] && echo yes)" yes

# slash を置換した path が別 branch と衝突しても、その worktree を使わない。
must git -C "$repo" branch agent-issue-2
rc=0
enter agent-issue-2 false > "$TMP_DIR/collision.out" 2> "$TMP_DIR/collision.log" || rc=$?
equal 'path collision is rejected' "$rc" 128
equal 'path collision prints no path' "$(cat "$TMP_DIR/collision.out")" ''
equal 'path collision preserves existing branch' "$(git -C "$remote_wt" branch --show-current)" "$remote_branch"

# 通常と違う場所の worktree も branch で見つけて再利用する。
other_branch=agent/issue-3
must git -C "$repo" worktree add -q -b "$other_branch" "$TMP_DIR/custom tree"
equal 'reuse custom worktree path' "$(enter "$other_branch" true 2> "$TMP_DIR/custom.log")" "$TMP_DIR/custom tree"

# runner の Issue / PR 分岐も通し、後続処理の cwd と通知の置き場所を確認する。
must awk '/^if \[ "\$IS_PR" = true \]; then$/{copy=1} /^# REST API/{exit} copy{print}' \
  "$ROOT_DIR/.github/coding-bot/run-action.sh" > "$TMP_DIR/select.sh"
must awk '/^export GITHUB_WORKSPACE=/{print; found=1; exit} END{if (!found) exit 1}' \
  "$ROOT_DIR/.github/coding-bot/run-action.sh" > "$TMP_DIR/workspace.sh"
run_selection() (
  local kind=$1 number=$2 expected_path=$3
  must cd "$repo"
  unset GITHUB_WORKSPACE
  must source "$TMP_DIR/workspace.sh"
  IS_PR=$kind ISSUE_NUMBER=$number GITHUB_REPOSITORY=example/project
  SCRIPT_DIR="$ROOT_DIR/.github/coding-bot" PR_INSTRUCTION='' GITHUB_RUN_ID=1
  validate_pr_context() { TRUSTED_LINKED_ISSUE="${branch#agent/issue-}"; }
  gh() {
    case "$1 $2" in
      'issue view') printf '%s\n' '{"title":"worktree","body":"","labels":[]}' ;;
      'pr view') printf '{"title":"worktree","body":"","labels":[],"headRefName":"%s","headRefOid":"%s"}\n' \
        "$branch" "$(git rev-parse "refs/heads/$branch")" ;;
      "api repos/$GITHUB_REPOSITORY/issues/$TRUSTED_LINKED_ISSUE") printf '%s\n' '{"title":"worktree","body":"","labels":[]}' ;;
      'pr diff') ;;
      *) echo "Unexpected gh: $*" >&2; exit 1 ;;
    esac
  }
  build_ci_section() { printf '%s\n' "$PWD" > "$TMP_DIR/ci-cwd"; }
  must source "$TMP_DIR/select.sh"
  # agent / hooks / 後処理はこの cwd を継承する。通知だけは元の workspace に置く。
  must test "$PWD" = "$expected_path"
  must test "$GITHUB_WORKSPACE" = "$repo"
  must test "$(git branch --show-current)" = "$BRANCH_NAME"
  if [ "$kind" = true ]; then must test "$(cat "$TMP_DIR/ci-cwd")" = "$expected_path"; fi
)
for selection in new existing pr; do
  case "$selection" in
    new) kind=false number=4 selection_path="$TMP_DIR/project space.worktrees/agent-issue-4" ;;
    existing) kind=false number=2 selection_path=$remote_wt ;;
    pr) kind=true number=11 selection_path=$wt ;;
  esac
  rc=0
  run_selection "$kind" "$number" "$selection_path" > "$TMP_DIR/selection-$selection.log" 2>&1 || rc=$?
  if [ "$rc" -ne 0 ]; then cat "$TMP_DIR/selection-$selection.log" >&2; fi
  equal "runner $selection branch / cwd / notification path" "$rc" 0
done
equal 'runner selection preserves base branch' "$(git -C "$repo" branch --show-current)" main

# 古い run が元の checkout に branch を残していても、未保存の作業を壊さない。
before=$(count_worktrees)
printf 'base unsaved\n' > "$repo/unsaved.txt"
rc=0
enter main false > "$TMP_DIR/rejected.out" 2> "$TMP_DIR/rejected.log" || rc=$?
equal 'original checkout branch is rejected' "$rc" 1
equal 'rejection prints no path' "$(cat "$TMP_DIR/rejected.out")" ''
equal 'rejection leaves branch' "$(git -C "$repo" branch --show-current)" main
equal 'rejection leaves uncommitted file' "$(cat "$repo/unsaved.txt")" 'base unsaved'
equal 'rejection leaves worktree count' "$(count_worktrees)" "$before"
printf 'SUMMARY: coding-bot branch worktree: %s checks, %s failures\n' "$checks" "$failures"
[ "$failures" -eq 0 ]
