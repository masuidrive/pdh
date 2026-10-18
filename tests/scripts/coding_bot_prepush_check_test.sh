#!/usr/bin/env bash
set -euo pipefail
cd "${PDH_TEST_ROOT:?}"
repo_root=$PWD
export SCRIPT_DIR="$(pwd)/.github/coding-bot"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
trap 'echo "coding_bot_prepush_check_test: failed at line $LINENO" >&2; cat "$tmp/push.log" >&2 2>/dev/null || true' ERR
awk '/^install_pdh_pre_push_hook\(\)/{copy=1} copy{print} copy && /^}$/{exit}' \
  .github/coding-bot/run-action.sh > "$tmp/installer.sh"
source "$tmp/installer.sh"
# Do not inherit the developer's hooks, signing, or repository environment.
unset $(git rev-parse --local-env-vars)
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_COUNT=0
export GITHUB_HEAD_REF=wrong-event-branch
unset GITHUB_BASE_REF
mkdir "$tmp/hook-temp"
export TMPDIR="$tmp/hook-temp"

new_repo() {
  local name=$1 with_check=$2
  git init -q --bare "$tmp/$name.git"
  git init -q -b main "$tmp/$name"
  cd "$tmp/$name"
  git config user.name 'Hook test'
  git config user.email 'hook-test@example.invalid'
  git remote add origin "$tmp/$name.git"
  echo initial > README
  if [ "$with_check" = yes ]; then
    mkdir scripts
    # Exercise the real base resolver with shared refs in a detached worktree.
    cp "$repo_root/scripts/pdh-review-range.sh" scripts/
    printf 'default_branch: main\n' > .ticket-config.yaml
    cat > scripts/check-pdh-ticket.sh <<'CHECK'
#!/usr/bin/env bash
set -euo pipefail
source scripts/pdh-review-range.sh
pdh_review_base_tip
test "$pdh_review_base" = "$PDH_EXPECT_BASE"
test "$pdh_review_tip" = "$(git rev-parse HEAD)"
[[ "$GITHUB_HEAD_REF" == $PDH_EXPECT_BRANCH ]]
printf '%s\n' "$pdh_review_tip" >> "$CHECK_LOG"
if [ -f diagnostics ]; then
  cat diagnostics >&2
  exit 1
fi
if [ -f checker-exit-127 ]; then exit 127; fi
if [ -f invalid-ticket ]; then
  echo 'check-pdh-ticket: stub: ticket/note invalid' >&2
  exit 1
fi
CHECK
  fi
  git add .
  git commit -qm initial
  git push -q origin main 2> "$tmp/push.log"
  export CHECK_LOG="$tmp/$name.checks" PDH_EXPECT_BASE=origin/main PDH_EXPECT_BRANCH=main
  : > "$CHECK_LOG"
}

assert_cleaned() {
  test "$(git worktree list --porcelain | awk '/^worktree /{n++} END{print n}')" = 1
  test -z "$(ls -A "$TMPDIR")"
}

test_m1() {
  local scenario expected status
  for scenario in new subset missing-base exit-127; do
    new_repo "m1-$scenario" yes
    export GITHUB_BASE_REF=main
    if [ "$scenario" = missing-base ]; then
      git rm -q scripts/check-pdh-ticket.sh
    elif [ "$scenario" = exit-127 ]; then
      touch checker-exit-127
    else
      printf '%s\n' 'check-pdh-ticket: tickets/task/note.md:12: old failure' \
        '  old continuation' 'check-pdh-ticket: tickets/task/progress.md:20: other failure' > diagnostics
    fi
    git add .
    git commit -qm 'failing base'
    git push -q origin main > "$tmp/push.log" 2>&1
    git checkout -qb feature
    if [ "$scenario" = missing-base ]; then
      git show main^:scripts/check-pdh-ticket.sh > scripts/check-pdh-ticket.sh
    fi
    rm -f checker-exit-127
    printf '%s\n' 'check-pdh-ticket: tickets/task/note.md:99: old failure' \
      '  old continuation' > diagnostics
    expected=refused
    if [ "$scenario" = new ]; then
      echo 'check-pdh-ticket: tickets/task/note.md:100: new failure' >> diagnostics
    elif [ "$scenario" = subset ]; then
      expected=allowed
    fi
    git add .
    git commit -qm feature
    export PDH_EXPECT_BRANCH=feature
    install_pdh_pre_push_hook
    status=0
    git push -q origin feature > "$tmp/push.log" 2>&1 || status=$?
    if { [ "$expected" = refused ] && [ "$status" -eq 0 ]; } || \
       { [ "$expected" = allowed ] && [ "$status" -ne 0 ]; }; then
      echo "M1: FAIL: $scenario expected $expected (push exit $status)" >&2
      cat "$tmp/push.log" >&2
      exit 1
    fi
    if [ "$expected" = refused ]; then
      if git --git-dir="$tmp/m1-$scenario.git" show-ref --verify --quiet refs/heads/feature; then exit 1; fi
      grep -q 'push refused' "$tmp/push.log"
      if [ "$scenario" = new ]; then
        grep -q 'new diagnostics' "$tmp/push.log"
        grep -q '^check-pdh-ticket: tickets/task/note.md: new failure$' "$tmp/push.log"
      fi
    else
      test "$(git --git-dir="$tmp/m1-$scenario.git" rev-parse refs/heads/feature)" = "$(git rev-parse HEAD)"
    fi
    assert_cleaned
    echo "M1: PASS: $scenario $expected"
  done
  unset GITHUB_BASE_REF
}

if [ "${1:-}" = M1 ]; then test_m1; exit; fi

test_m2() {
  new_repo m2 yes
  unset GITHUB_BASE_REF
  export PDH_EXPECT_BASE=main PDH_EXPECT_BRANCH=feature
  touch invalid-ticket
  git add .
  git commit -qm 'local main ahead of origin'
  install_pdh_pre_push_hook
  if git push -q origin main:refs/heads/feature > "$tmp/push.log" 2>&1; then
    echo 'M2: FAIL: merge-base equal to pushed SHA was allowed' >&2
    cat "$tmp/push.log" >&2
    exit 1
  fi
  test "$(cat "$CHECK_LOG")" = "$(git rev-parse HEAD)"
  test "$(git --git-dir="$tmp/m2.git" rev-parse refs/heads/main)" = "$(git rev-parse HEAD^)"
  grep -q 'push refused' "$tmp/push.log"
  assert_cleaned
  echo 'M2: PASS: merge-base equal to pushed SHA refused; checker ran once'
}

if [ "${1:-}" = M2 ]; then test_m2; exit; fi

test_m3() {
  awk '/^save_unpushed_commits\(\)/{copy=1} copy{print} copy && /^}$/{exit}' \
    "$repo_root/.github/coding-bot/run-action.sh" > "$tmp/save.sh"
  source "$tmp/save.sh"
  awk '/^CLAUDE_OUTPUT=\$\(cat/{copy=1} copy && /^# CI 自動修正/{exit} copy{print}' \
    "$repo_root/.github/coding-bot/run-action.sh" > "$tmp/success-report.sh"
  awk '/^  ERROR_DETAILS=/{copy=1} copy && /^  TIMEOUT_MINUTES=/{exit} copy{print}' \
    "$repo_root/.github/coding-bot/run-action.sh" > "$tmp/failure-report.sh"
  if ! declare -F save_unpushed_commits >/dev/null; then
    # Before the save function exists, exercise the actual post-engine block.
    awk '/^HEAD_BEFORE_POST=/{copy=1} /^# 空ファイル/{exit} copy{print}' \
      "$repo_root/.github/coding-bot/run-action.sh" > "$tmp/post-engine.sh"
    save_unpushed_commits() { source "$tmp/post-engine.sh"; }
  fi
  local scenario before sha expected_report
  for scenario in unpushed no-pr pr-lookup-failure no-change new-branch new-branch-no-change failure inspect-failure ci-autofix ci-autofix-id; do
    new_repo "m3-$scenario" yes
    BRANCH_NAME=main
    CI_AUTOFIX_START_SHA=$(git rev-parse HEAD)
    EVENT_TYPE=issues
    CI_AUTOFIX_RUN_ID=''
    ORIGIN_PUSH_AUTH=pat
    RUNNER_PUSH_NOTE=''
    before=$(git --git-dir="$tmp/m3-$scenario.git" rev-parse refs/heads/main)
    case "$scenario" in
      new-branch*) git checkout -qb feature; BRANCH_NAME=feature ;;
      ci-autofix) EVENT_TYPE=workflow_run ;;
      ci-autofix-id) CI_AUTOFIX_RUN_ID=123 ;;
    esac
    case "$scenario" in
      no-change|new-branch-no-change) ;;
      *) touch invalid-ticket; git add .; git commit -qm 'unpushed work' ;;
    esac
    sha=$(git rev-parse HEAD)
    install_pdh_pre_push_hook
    : > "$tmp/runner-calls"
    git() {
      case "$1" in
        rev-list) if [ "$scenario" = inspect-failure ]; then return 1; fi ;;
        fetch) echo 'unexpected fetch' >&2; return 99 ;;
        push)
          printf '%s\n' "$*" >> "$tmp/runner-calls"
          if [ "$scenario" = failure ]; then return 1; fi
          ;;
      esac
      command git "$@"
    }
    gh() {
      test "$*" = "pr list --head $BRANCH_NAME --state open --json number -q .[0].number"
      case "$scenario" in
        no-pr) ;;
        pr-lookup-failure) return 1 ;;
        *) echo 123 ;;
      esac
    }
    # Invoke directly under set -e; a push failure must not abort the runner.
    save_unpushed_commits > "$tmp/push.log" 2>&1
    unset -f git gh
    RESULT_OUTPUT_FILE="$tmp/engine-result"
    echo 'engine result' > "$RESULT_OUTPUT_FILE"
    source "$tmp/success-report.sh"
    engine_error_details() { echo 'engine result'; }
    source "$tmp/failure-report.sh"
    unset -f engine_error_details
    expected_report='engine result'
    if [ -n "$RUNNER_PUSH_NOTE" ]; then expected_report+=$'\n\n'"$RUNNER_PUSH_NOTE"; fi
    test "$CLAUDE_OUTPUT" = "$expected_report"
    test "$ERROR_DETAILS" = "$expected_report"
    case "$scenario" in
      unpushed|new-branch|no-pr|pr-lookup-failure)
        if [ "$(git --git-dir="$tmp/m3-$scenario.git" rev-parse "refs/heads/$BRANCH_NAME")" != "$sha" ]; then
          echo 'M3: FAIL: unpushed commit was not saved (remote still at run start)' >&2
          exit 1
        fi
        grep -q "^push --no-verify .*origin .*refs/heads/$BRANCH_NAME" "$tmp/runner-calls"
        test ! -s "$CHECK_LOG"
        test "$RUNNER_SAVED_PUSH" = 1
        if [ "$scenario" = no-pr ]; then
          test -z "$RUNNER_PUSH_NOTE"
          grep -q '^coding-bot: saved unpushed commits for main$' "$tmp/push.log"
        else
          [[ "$RUNNER_PUSH_NOTE" == *'ticket の検査を通さずに push しました'* ]]
        fi
        ;;
      inspect-failure)
        test ! -s "$tmp/runner-calls"
        [[ "$RUNNER_PUSH_NOTE" == *'確かめられませんでした'* ]]
        test "$RUNNER_SAVED_PUSH" = 0
        ;;
      failure)
        grep -q 'Warning: failed to save unpushed commits' "$tmp/push.log"
        [[ "$RUNNER_PUSH_NOTE" == *'push できませんでした'* ]]
        test "$(git --git-dir="$tmp/m3-$scenario.git" rev-parse refs/heads/main)" = "$before"
        ;;
      *) test ! -s "$tmp/runner-calls"; test -z "$RUNNER_PUSH_NOTE" ;;
    esac
    assert_cleaned
    echo "M3: PASS: $scenario"
  done
  # Check the production call and note integration, including engine failures.
  awk '/^wait \$ENGINE_PID/{after_wait=1}
    after_wait && /if .*ORIGIN_PUSH_AUTH.*use_pat_for_origin/{auth_restored=1}
    after_wait && /^save_unpushed_commits$/{if (!auth_restored) exit 1; saved=1}
    /^engine_extract_result$/{if (!saved) exit 1; extracted=1}
    END{if (!extracted) exit 1}' "$repo_root/.github/coding-bot/run-action.sh"
}

if [ "${1:-}" = M3 ]; then test_m3; exit; fi

test_f1() {
  awk '/^dispatch_branch_ci\(\)/{copy=1} copy{print} copy && /^}$/{exit}' \
    "$repo_root/.github/coding-bot/run-action.sh" > "$tmp/dispatch-helper.sh"
  source "$tmp/dispatch-helper.sh"
  awk '/^save_unpushed_commits\(\)/{copy=1} copy{print} copy && /^}$/{exit}' \
    "$repo_root/.github/coding-bot/run-action.sh" > "$tmp/save.sh"
  source "$tmp/save.sh"
  awk '/^  HEAD_AFTER_POST=/{copy=1} copy && /^  # 最終結果/{exit} copy{print}' \
    "$repo_root/.github/coding-bot/run-action.sh" > "$tmp/dispatch.sh"
  local scenario expected
  for scenario in saved-token saved-pat no-change failure moved-token moved-pat \
    saved-token-artifact-pat saved-token-moved-artifact-pat saved-pat-artifact-token; do
    new_repo "f1-$scenario" yes
    BRANCH_NAME=main
    CI_AUTOFIX_START_SHA=$(git rev-parse HEAD)
    EVENT_TYPE=issues
    CI_AUTOFIX_RUN_ID=''
    ORIGIN_PUSH_AUTH=github_token
    unset ARTIFACT_PUSH_AUTH RUNNER_SAVED_PUSH
    case "$scenario" in
      saved-pat|moved-pat|saved-pat-artifact-token) ORIGIN_PUSH_AUTH=pat ;;
    esac
    case "$scenario" in
      saved-token*artifact-pat) ARTIFACT_PUSH_AUTH=pat ;;
      saved-pat-artifact-token) ARTIFACT_PUSH_AUTH=github_token ;;
    esac
    case "$scenario" in
      saved-*|failure) echo work >> README; git commit -qam 'unpushed work' ;;
    esac
    HEAD_BEFORE_POST=$(git rev-parse HEAD)
    : > "$tmp/dispatch-calls"
    git() {
      if [ "$1" = push ] && [ "$scenario" = failure ]; then return 1; fi
      command git "$@"
    }
    gh() { echo 123; }
    save_unpushed_commits > "$tmp/push.log" 2>&1
    unset -f git gh
    case "$scenario" in
      moved-*|saved-token-moved-artifact-pat) echo post >> README; git commit -qam 'post-engine work' ;;
    esac
    CI_WORKFLOW=ci.yml
    GITHUB_REPOSITORY=example/project
    gh() { printf '%s\n' "$*" >> "$tmp/dispatch-calls"; }
    source "$tmp/dispatch.sh" >> "$tmp/push.log" 2>&1
    unset -f gh
    expected=0
    case "$scenario" in saved-token|moved-token|saved-token-artifact-pat) expected=1 ;; esac
    if [ "$(wc -l < "$tmp/dispatch-calls")" -ne "$expected" ]; then
      echo "F1: FAIL: $scenario expected $expected CI dispatch(es), got $(wc -l < "$tmp/dispatch-calls")" >&2
      exit 1
    fi
    if [ "$expected" -eq 1 ]; then
      grep -qxF 'workflow run ci.yml --ref main --repo example/project' "$tmp/dispatch-calls"
    fi
    assert_cleaned
    echo "F1: PASS: $scenario dispatches=$expected"
  done
}

if [ "${1:-}" = F1 ]; then test_f1; exit; fi

test_f2() {
  local scenario status ticket=tickets/190101-000000-why-evidence
  for scenario in subset new-missing; do
    new_repo "f2-$scenario" yes
    cp "$repo_root/scripts/check-pdh-ticket.sh" scripts/
    # 根拠欄の導入前の日付の ticket でも、根拠の欠落を検査する。
    printf '# Reproduction-or-measurement:\n' >> .ticket-config.yaml
    mkdir -p "$ticket"
    printf '%s\n' '---' 'branch: feature' '---' '### Why' > "$ticket/ticket.md"
    if [ "$scenario" = new-missing ]; then
      echo 'Why-not-fix-now: 該当なし' >> "$ticket/ticket.md"
    fi
    echo '# Progress: why-evidence' > "$ticket/progress.md"
    git add .
    GIT_COMMITTER_DATE=2020-01-01T00:00:00Z git commit -qm 'base Why failure'
    git push -q origin main > "$tmp/push.log" 2>&1
    export GITHUB_BASE_REF=main
    status=0
    GITHUB_HEAD_REF=feature bash scripts/check-pdh-ticket.sh > "$tmp/base.log" 2>&1 || status=$?
    test "$status" -eq 1
    grep -qxF 'Reproduction-or-measurement:' "$tmp/base.log"
    if [ "$scenario" = new-missing ]; then
      if grep -qxF 'Why-not-fix-now:' "$tmp/base.log"; then exit 1; fi
    fi
    git checkout -qb feature
    if [ "$scenario" = new-missing ]; then
      sed '/^Why-not-fix-now:/d' "$ticket/ticket.md" > "$tmp/ticket.md"
      mv "$tmp/ticket.md" "$ticket/ticket.md"
    else
      echo 'Why-not-fix-now: 該当なし' >> "$ticket/ticket.md"
    fi
    git commit -qam 'branch Why change'
    status=0
    GITHUB_HEAD_REF=feature bash scripts/check-pdh-ticket.sh > "$tmp/branch.log" 2>&1 || status=$?
    test "$status" -eq 1
    grep -qxF 'Reproduction-or-measurement:' "$tmp/branch.log"
    install_pdh_pre_push_hook
    status=0
    git push -q origin feature > "$tmp/push.log" 2>&1 || status=$?
    if [ "$scenario" = new-missing ]; then
      grep -qxF 'Why-not-fix-now:' "$tmp/branch.log"
      if [ "$status" -eq 0 ]; then
        echo 'F2: FAIL: additional missing Why item allowed by real checker' >&2
        exit 1
      fi
      grep -q 'new diagnostics:' "$tmp/push.log"
      grep -q ' | Why-not-fix-now:$' "$tmp/push.log"
      if git --git-dir="$tmp/f2-$scenario.git" show-ref --verify --quiet refs/heads/feature; then exit 1; fi
      echo 'F2: PASS: additional missing Why item refused (real checker)'
    else
      test "$status" -eq 0
      grep -q 'pre-existing failure on the base branch; allowing push' "$tmp/push.log"
      echo 'F2: PASS: subset of missing Why items allowed (real checker)'
    fi
    assert_cleaned
  done
  unset GITHUB_BASE_REF
}

if [ "${1:-}" = F2 ]; then test_f2; exit; fi

test_f3() {
  local scenario status
  for scenario in summary-only internal-error; do
    new_repo "f3-$scenario" yes
    printf '%s\n' 'check-pdh-ticket: tickets/task/note.md:12: old failure' \
      'check-pdh-ticket: FAILED' > diagnostics
    git add diagnostics
    git commit -qm 'failing base with summary'
    git push -q origin main > "$tmp/push.log" 2>&1
    git checkout -qb feature
    : > diagnostics
    if [ "$scenario" = internal-error ]; then echo 'awk: internal failure' >> diagnostics; fi
    echo 'check-pdh-ticket: FAILED' >> diagnostics
    git commit -qam 'checker failure without diagnostic'
    export GITHUB_BASE_REF=main PDH_EXPECT_BRANCH=feature
    install_pdh_pre_push_hook
    status=0
    git push -q origin feature > "$tmp/push.log" 2>&1 || status=$?
    if [ "$status" -eq 0 ]; then
      echo "F3: FAIL: $scenario failure without diagnostics allowed" >&2
      exit 1
    fi
    grep -q 'push refused' "$tmp/push.log"
    if grep -q 'pre-existing failure on the base branch; allowing push' "$tmp/push.log"; then exit 1; fi
    if git --git-dir="$tmp/f3-$scenario.git" show-ref --verify --quiet refs/heads/feature; then exit 1; fi
    assert_cleaned
    echo "F3: PASS: $scenario failure without diagnostics refused"
  done
  unset GITHUB_BASE_REF
}

if [ "${1:-}" = F3 ]; then test_f3; exit; fi

test_f4() {
  local scenario base before
  for scenario in configured github-base origin-head; do
    new_repo "f4-$scenario" yes
    unset GITHUB_BASE_REF
    base=main
    case "$scenario" in
      github-base)
        base=release
        git checkout -qb "$base"
        git push -q origin "$base" > "$tmp/push.log" 2>&1
        export GITHUB_BASE_REF=$base
        ;;
      origin-head)
        base=trunk
        git checkout -qb "$base"
        git push -q origin "$base" > "$tmp/push.log" 2>&1
        git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/trunk
        git update-ref -d refs/remotes/origin/main
        git branch -D main > /dev/null
        ;;
    esac
    touch invalid-ticket
    git add invalid-ticket
    git commit -qm 'base branch work'
    install_pdh_pre_push_hook
    if ! git push -q origin "$base" > "$tmp/push.log" 2>&1; then
      echo "F4: FAIL: $scenario base destination refused" >&2
      exit 1
    fi
    test ! -s "$CHECK_LOG"
    test "$(git --git-dir="$tmp/f4-$scenario.git" rev-parse "refs/heads/$base")" = "$(git rev-parse HEAD)"
    # Skipping the base ref must not skip another destination in the same push.
    rm invalid-ticket
    git commit -qam 'fix base for contrast'
    git push --no-verify -q origin "$base" > "$tmp/push.log" 2>&1
    before=$(git rev-parse HEAD)
    echo 'local base work' >> README
    git commit -qam 'base ahead for multi-ref push'
    git checkout -qb feature
    touch invalid-ticket
    git add invalid-ticket
    git commit -qm 'invalid feature work'
    export PDH_EXPECT_BASE="origin/$base" PDH_EXPECT_BRANCH=feature
    if [ "$scenario" = configured ]; then export PDH_EXPECT_BASE=$base; fi
    if [ "$scenario" = origin-head ]; then export PDH_EXPECT_BASE=''; fi
    if git push -q origin "$base" feature > "$tmp/push.log" 2>&1; then exit 1; fi
    grep -q 'push refused' "$tmp/push.log"
    test -s "$CHECK_LOG"
    if git --git-dir="$tmp/f4-$scenario.git" show-ref --verify --quiet refs/heads/feature; then exit 1; fi
    test "$(git --git-dir="$tmp/f4-$scenario.git" rev-parse "refs/heads/$base")" = "$before"
    assert_cleaned
    echo "F4: PASS: $scenario base skipped; feature refused"
  done
  unset GITHUB_BASE_REF
}

if [ "${1:-}" = F4 ]; then test_f4; exit; fi

test_minor_hooks() {
  local stage hooks_dir before status
  for stage in write chmod move success; do
    new_repo "install-$stage" yes
    hooks_dir=$(git rev-parse --git-path hooks)
    printf '#!/bin/bash\n# coding-bot-pdh-pre-push\nexit 42\n' > "$hooks_dir/pre-push"
    chmod +x "$hooks_dir/pre-push"
    before=$(git hash-object "$hooks_dir/pre-push")
    cat() {
      if [ "$stage" = write ]; then printf 'partial hook\n'; return 1; fi
      command cat "$@"
    }
    chmod() {
      if [ "$stage" = chmod ]; then return 1; fi
      command chmod "$@"
    }
    mv() {
      # Replacement happens only after the complete temp hook is executable.
      test ! -e "$hooks_dir/pre-push" || return 1
      test -x "$2" || return 1
      [[ "$2" == "$hooks_dir/.pre-push."* ]] || return 1
      grep -q '^PDH_PRE_PUSH$' "$2" && return 1
      if [ "$stage" = move ]; then return 1; fi
      command mv "$@"
    }
    status=0
    install_pdh_pre_push_hook || status=$?
    unset -f cat chmod mv
    if [ "$stage" = success ]; then
      test "$status" -eq 0
      test "$(git hash-object "$hooks_dir/pre-push")" != "$before"
      test -x "$hooks_dir/pre-push"
      grep -qxF '# coding-bot-pdh-pre-push' "$hooks_dir/pre-push"
      bash -n "$hooks_dir/pre-push"
    else
      test "$status" -ne 0
      test ! -e "$hooks_dir/pre-push"
    fi
    if compgen -G "$hooks_dir/.pre-push.*" >/dev/null; then exit 1; fi
    assert_cleaned
    echo "minor: PASS: atomic hook install $stage"
  done

  new_repo missing-pushed-check yes
  install_pdh_pre_push_hook
  git rm -q scripts/check-pdh-ticket.sh
  git commit -qm 'remove checker from pushed tree'
  # The checkout still has the checker, while the pushed commit does not.
  git show HEAD^:scripts/check-pdh-ticket.sh > scripts/check-pdh-ticket.sh
  git push -q origin main:refs/heads/removed-check > "$tmp/push.log" 2>&1
  test ! -s "$CHECK_LOG"
  test "$(git --git-dir="$tmp/missing-pushed-check.git" rev-parse refs/heads/removed-check)" = "$(git rev-parse HEAD)"
  assert_cleaned
  echo 'minor: PASS: missing checker in pushed tree skipped'
}

if [ "${1:-}" = minor ]; then test_minor_hooks; exit; fi

test_ticket_required() {
  local scenario ticket_root branch expected status
  for scenario in missing frontmatter prefix touched done ticket-only non-pdh base custom-dir custom-dir-missing github-base inherited-failure pushed-tree; do
    new_repo "ticket-required-$scenario" yes
    export GITHUB_BASE_REF=main
    cp "$repo_root/scripts/check-pdh-ticket.sh" "$repo_root/scripts/pdh-stage-checklist.sh" scripts/
    mkdir -p .claude/skills/pdh-ticket-write
    printf '%s\n' '- [ ] PDH-ticket-write: fixture evidence' > .claude/skills/pdh-ticket-write/SKILL.md
    ticket_root=tickets
    case "$scenario" in custom-dir*) ticket_root=work/tickets; printf 'tickets_dir: "./work/tickets/" # custom root\n' >> .ticket-config.yaml ;; esac
    mkdir -p "$ticket_root/task"
    cat > "$ticket_root/task/ticket.md" <<'TICKET'
---
branch: agent/other
---
### Why
Reproduction-or-measurement: fixture
Why-not-fix-now: fixture
### What
- [ ] Result is observable
TICKET
    printf '## Status: PDH-ticket-write\n## Checklist\n- [x] PDH-ticket-write: fixture evidence\n' > "$ticket_root/task/note.md"
    echo '# Progress: task' > "$ticket_root/task/progress.md"
    echo '# Product brief' > product-brief.md
    branch=feature
    expected=allowed
    case "$scenario" in
      missing|custom-dir-missing|inherited-failure|pushed-tree) expected=refused ;;
      frontmatter|custom-dir|done) sed -i 's@branch: agent/other@branch: feature@' "$ticket_root/task/ticket.md" ;;
      prefix)
        sed -i '/^branch:/d' "$ticket_root/task/ticket.md"
        echo 'branch_prefix: topic/' >> .ticket-config.yaml
        branch=topic/task
        ;;
      non-pdh) rm product-brief.md ;;
      base) branch=main ;;
    esac
    if [ "$scenario" = done ]; then
      mkdir -p "$ticket_root/done"
      mv "$ticket_root/task" "$ticket_root/done/"
    fi
    if [ "$scenario" = inherited-failure ]; then
      # A pre-existing error must not pardon the new missing-ticket failure.
      echo '- [ ] 起票: 260101-010101-absent' >> "$ticket_root/task/note.md"
    fi
    git add .
    git commit -qm 'PDH base fixture'
    git push -q origin main > "$tmp/push.log" 2>&1
    if [ "$scenario" = github-base ]; then
      git checkout -qb release
      echo release >> README
      git commit -qam 'release-only product change'
      git push -q origin release > "$tmp/push.log" 2>&1
      export GITHUB_BASE_REF=release
    fi
    [ "$branch" = main ] || git checkout -qb "$branch"
    case "$scenario" in
      ticket-only) mkdir -p "$ticket_root/draft"; echo draft > "$ticket_root/draft/note.md" ;;
      github-base) echo draft >> "$ticket_root/task/progress.md" ;;
      *) echo feature >> README ;;
    esac
    [ "$scenario" != touched ] || echo touched >> "$ticket_root/task/progress.md"
    git add .
    git commit -qm 'proposed push'
    if [ "$scenario" = pushed-tree ]; then
      # Uncommitted ownership in the checkout must not authorize the pushed SHA.
      sed -i 's@branch: agent/other@branch: feature@' "$ticket_root/task/ticket.md"
    fi
    install_pdh_pre_push_hook
    status=0
    git push -q origin "$branch" > "$tmp/push.log" 2>&1 || status=$?
    if { [ "$expected" = refused ] && [ "$status" -eq 0 ]; } || \
       { [ "$expected" = allowed ] && [ "$status" -ne 0 ]; }; then
      echo "ticket-required: FAIL: $scenario expected $expected (push exit $status)" >&2
      cat "$tmp/push.log" >&2
      exit 1
    fi
    if [ "$expected" = refused ]; then
      grep -q 'push refused' "$tmp/push.log"
      grep -q '.github/coding-bot/_pdh.md' "$tmp/push.log"
      grep -q 'find-or-create' "$tmp/push.log"
      if grep -q 'pre-existing failure on the base branch; allowing push' "$tmp/push.log"; then exit 1; fi
      if git --git-dir="$tmp/ticket-required-$scenario.git" show-ref --verify --quiet "refs/heads/$branch"; then exit 1; fi
    else
      test "$(git --git-dir="$tmp/ticket-required-$scenario.git" rev-parse "refs/heads/$branch")" = "$(git rev-parse HEAD)"
    fi
    assert_cleaned
    echo "ticket-required: PASS: $scenario $expected"
  done
  unset GITHUB_BASE_REF
}

if [ "${1:-}" = ticket-required ]; then test_ticket_required; exit; fi

new_repo absent no
install_pdh_pre_push_hook
test ! -e "$(git rev-parse --git-path hooks)/pre-push"

new_repo existing yes
mkdir -p .git/hooks
printf '#!/bin/sh\nexit 42\n' > .git/hooks/pre-push
before=$(git hash-object .git/hooks/pre-push)
output=$(install_pdh_pre_push_hook)
test "$(git hash-object .git/hooks/pre-push)" = "$before"
test "$output" = 'coding-bot: existing pre-push hook; skipping hook installation'

new_repo custom yes
git config core.hooksPath 'custom hooks'
install_pdh_pre_push_hook
test -x 'custom hooks/pre-push'
test ! -e .git/hooks/pre-push
PDH_EXPECT_BRANCH=custom git push -q origin HEAD:refs/heads/custom 2> "$tmp/push.log"
test "$(cat "$CHECK_LOG")" = "$(git rev-parse HEAD)"
assert_cleaned

new_repo inherited yes
export GITHUB_BASE_REF=main
touch invalid-ticket
git add invalid-ticket
git commit -qm 'invalid base'
git push -q origin main 2> "$tmp/push.log"
base_sha=$(git rev-parse HEAD)
git checkout -qb feature
echo feature >> README
git commit -qam feature
feature_sha=$(git rev-parse HEAD)
export PDH_EXPECT_BRANCH=feature
: > "$CHECK_LOG"
install_pdh_pre_push_hook
git push -q origin feature > "$tmp/push.log" 2>&1
test "$(cat "$CHECK_LOG")" = "$(printf '%s\n%s' "$feature_sha" "$base_sha")"
test "$(git --git-dir="$tmp/inherited.git" rev-parse refs/heads/feature)" = "$feature_sha"
grep -q 'pre-existing failure on the base branch; allowing push' "$tmp/push.log"
test "$(grep -c 'stub: ticket/note invalid' "$tmp/push.log")" = 2
assert_cleaned

# Inspect the merge-base even if the remote base has since fixed the failure.
git checkout -q main
git rm -q invalid-ticket
git commit -qm 'fix remote base'
git push --no-verify -q origin main 2> "$tmp/push.log"
git checkout -q feature
: > "$CHECK_LOG"
PDH_EXPECT_BRANCH=diverged git push -q origin feature:refs/heads/diverged > "$tmp/push.log" 2>&1
test "$(cat "$CHECK_LOG")" = "$(printf '%s\n%s' "$feature_sha" "$base_sha")"
test "$(git --git-dir="$tmp/inherited.git" rev-parse refs/heads/diverged)" = "$feature_sha"
grep -q 'pre-existing failure on the base branch; allowing push' "$tmp/push.log"
assert_cleaned

# The PR base wins over a passing default branch on the failure path, too.
git update-ref refs/remotes/origin/release "$base_sha"
: > "$CHECK_LOG"
GITHUB_BASE_REF=release PDH_EXPECT_BASE=origin/release PDH_EXPECT_BRANCH=release-check \
  git push -q origin feature:refs/heads/release-check > "$tmp/push.log" 2>&1
test "$(cat "$CHECK_LOG")" = "$(printf '%s\n%s' "$feature_sha" "$base_sha")"
test "$(git --git-dir="$tmp/inherited.git" rev-parse refs/heads/release-check)" = "$feature_sha"
grep -q 'pre-existing failure on the base branch; allowing push' "$tmp/push.log"
assert_cleaned

# Fall back to origin/HEAD when the canonical resolver has no base candidate.
unset GITHUB_BASE_REF
git update-ref refs/remotes/origin/trunk "$base_sha"
git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/trunk
git update-ref -d refs/remotes/origin/main
git branch -D main > /dev/null
export PDH_EXPECT_BASE=''
: > "$CHECK_LOG"
PDH_EXPECT_BRANCH=fallback git push -q origin feature:refs/heads/fallback > "$tmp/push.log" 2>&1
test "$(cat "$CHECK_LOG")" = "$(printf '%s\n%s' "$feature_sha" "$base_sha")"
test "$(git --git-dir="$tmp/inherited.git" rev-parse refs/heads/fallback)" = "$feature_sha"
grep -q 'pre-existing failure on the base branch; allowing push' "$tmp/push.log"
assert_cleaned

# An unresolved merge-base must never turn a failed check into an allowed push.
git symbolic-ref --delete refs/remotes/origin/HEAD
: > "$CHECK_LOG"
if PDH_EXPECT_BRANCH=no-base git push -q origin feature:refs/heads/no-base > "$tmp/push.log" 2>&1; then exit 1; fi
test "$(cat "$CHECK_LOG")" = "$feature_sha"
if git --git-dir="$tmp/inherited.git" show-ref --verify --quiet refs/heads/no-base; then exit 1; fi
grep -q 'push refused' "$tmp/push.log"
if grep -q 'pre-existing failure on the base branch; allowing push' "$tmp/push.log"; then exit 1; fi
assert_cleaned

new_repo checked yes
# Like a PR run, select the remote base explicitly while the feature advances.
export GITHUB_BASE_REF=main
git checkout -qb feature
export PDH_EXPECT_BRANCH=feature
install_pdh_pre_push_hook
test -x "$(git rev-parse --git-path hooks)/pre-push"

# A fixed working tree must not conceal a broken pushed commit.
touch invalid-ticket
git add invalid-ticket
git commit -qm invalid
bad_sha=$(git rev-parse HEAD)
remote_before=$(git --git-dir="$tmp/checked.git" rev-parse refs/heads/main)
rm invalid-ticket
if git push -q origin feature > "$tmp/push.log" 2>&1; then
  echo 'unexpected success for invalid pushed commit' >&2
  exit 1
fi
test "$(cat "$CHECK_LOG")" = "$(printf '%s\n%s' "$bad_sha" "$remote_before")"
test "$(git --git-dir="$tmp/checked.git" rev-parse refs/heads/main)" = "$remote_before"
test ! -f invalid-ticket
grep -q 'stub: ticket/note invalid' "$tmp/push.log"
grep -q 'fix the ticket/note in a new commit and push again' "$tmp/push.log"
grep -q 'Do not use --no-verify' "$tmp/push.log"
if grep -q 'pre-existing failure on the base branch; allowing push' "$tmp/push.log"; then exit 1; fi
assert_cleaned

# A broken working tree must not block a valid pushed commit.
git add -u
git commit -qm fixed
good_sha=$(git rev-parse HEAD)
touch invalid-ticket
: > "$CHECK_LOG"
GIT_DIR=.git git push -q origin feature > "$tmp/push.log" 2>&1
test "$(cat "$CHECK_LOG")" = "$good_sha"
test "$(git --git-dir="$tmp/checked.git" rev-parse refs/heads/feature)" = "$good_sha"
test -f invalid-ticket
assert_cleaned

# Read the protocol SHA rather than HEAD, and check every ref in a push.
git branch valid "$good_sha"
git checkout -qb invalid "$good_sha"
git add invalid-ticket
git commit -qm 'invalid branch'
invalid_sha=$(git rev-parse HEAD)
git checkout -q feature
touch invalid-ticket
: > "$CHECK_LOG"
if PDH_EXPECT_BRANCH=invalid git push -q origin invalid > "$tmp/push.log" 2>&1; then exit 1; fi
test "$(cat "$CHECK_LOG")" = "$(printf '%s\n%s' "$invalid_sha" "$remote_before")"
assert_cleaned
: > "$CHECK_LOG"
PDH_EXPECT_BRANCH='valid-*' git push -q origin valid:refs/heads/valid-one valid:refs/heads/valid-two > "$tmp/push.log" 2>&1
test "$(awk 'END{print NR}' "$CHECK_LOG")" = 2
test "$(awk -v sha="$good_sha" '$0 != sha{bad=1} END{print bad+0}' "$CHECK_LOG")" = 0
assert_cleaned

# GITHUB_BASE_REF takes priority over the config's default branch.
git update-ref refs/remotes/origin/release "$remote_before"
: > "$CHECK_LOG"
GITHUB_BASE_REF=release PDH_EXPECT_BASE=origin/release PDH_EXPECT_BRANCH=release-check git push -q origin feature:refs/heads/release-check > "$tmp/push.log" 2>&1
test "$(cat "$CHECK_LOG")" = "$good_sha"
assert_cleaned

# A deletion does not run the checker, even with an invalid HEAD.
rm invalid-ticket
git checkout -q invalid
: > "$CHECK_LOG"
git push -q origin :refs/heads/valid-one > "$tmp/push.log" 2>&1
test ! -s "$CHECK_LOG"
if git --git-dir="$tmp/checked.git" show-ref --verify --quiet refs/heads/valid-one; then exit 1; fi
assert_cleaned

# Runner saves can deliberately bypass the hook.
git push --no-verify -q origin invalid > "$tmp/push.log" 2>&1
test ! -s "$CHECK_LOG"
test "$(git --git-dir="$tmp/checked.git" rev-parse refs/heads/invalid)" = "$invalid_sha"
assert_cleaned

if [ "${1:-}" = legacy ]; then echo 'coding_bot_prepush_check_test: 16 cases passed'; exit; fi
test_m1
test_m2
test_m3
test_minor_hooks
test_f1
test_f2
test_f3
test_f4
test_ticket_required
echo 'coding_bot_prepush_check_test: 65 cases passed'
