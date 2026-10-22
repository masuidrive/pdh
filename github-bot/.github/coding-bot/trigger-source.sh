#!/bin/bash
# トリガーの本文と PR の出自を取得する。gate の承認判定とは分離する。

# dispatch は Actions の実行権限で認可される。入力を shell として評価しない。
validate_dispatch_request() {
  local issue="$1" pr="$2" instruction="$3" resolve="${4:-}"
  if [ -n "$resolve" ]; then
    [[ "$issue" =~ ^[1-9][0-9]*$ ]] && [[ "$resolve" =~ ^[1-9][0-9]*$ ]] && [ -z "$pr$instruction${PR_TASK_ALLOWED_PATHS:-}" ]
    return $?
  fi
  if [ -n "$pr" ]; then
    [[ "$pr" =~ ^[1-9][0-9]*$ ]] && [[ "$issue" =~ ^[1-9][0-9]*$ ]] && [ -n "$instruction" ] || return 1
  else
    [ -z "$instruction" ] || return 1
    if [ -n "$issue" ]; then
      validate_issue_context "$GITHUB_REPOSITORY" "$issue" || return 1
    fi
  fi
}

validate_issue_context() {
  local repository="$1" number="$2" resource
  [[ "$number" =~ ^[1-9][0-9]*$ ]] || return 1
  resource=$(gh api "repos/$repository/issues/$number") || return 1
  printf '%s' "$resource" | python3 "$(dirname "${BASH_SOURCE[0]}")/discussion.py" verify "$number" >/dev/null
}

fetch_trigger_context() {
  local event_type="$1" repository="$2" issue_number="$3" comment_id="$4"
  case "$event_type" in
    issue_comment)
      gh api "repos/$repository/issues/comments/$comment_id"
      ;;
    pull_request_review_comment)
      gh api "repos/$repository/pulls/comments/$comment_id"
      ;;
    pull_request_review)
      gh api "repos/$repository/pulls/$issue_number/reviews/$comment_id"
      ;;
    *)
      printf '{}\n'
      ;;
  esac
}

# 成功すると TRUSTED_LINKED_ISSUE（紐づく Issue 番号）と TRUSTED_PR_BRANCH を設定する。
# ⚠ TRUSTED_LINKED_ISSUE は pdh-hooks.sh へ渡す番号でもある — PR run で PR 番号を渡すと
# ticket が見つからない。ticket は Issue 番号で探す
# （名前 *-issue-<N> か frontmatter の branch: agent/issue-<N> / issue: <N>）。
validate_pr_context() {
  local repository="$1" pr_number="$2" data head_repo head_ref linked issue
  data=$(gh api "repos/$repository/pulls/$pr_number" 2>/dev/null) || { TRIGGER_ERROR="PR context API unavailable"; return 1; }
  if [ -n "${PR_INSTRUCTION:-}${RESOLVE_CONFLICT_PR:-}" ] && [ "$(printf '%s' "$data" | jq -r '.state')" != open ]; then
    TRIGGER_ERROR="dispatched tasks require an open PR"
    return 1
  fi
  linked=$(printf '%s' "$data" | python3 "$(dirname "${BASH_SOURCE[0]}")/discussion.py" resolve "$repository") || {
    TRIGGER_ERROR="PR head must be a same-repository agent/issue-<linked-issue>"; return 1;
  }
  head_ref="agent/issue-$linked"
  issue=$(gh api "repos/$repository/issues/$linked" 2>/dev/null) || { TRIGGER_ERROR="linked Issue API unavailable"; return 1; }
  printf '%s' "$issue" | python3 "$(dirname "${BASH_SOURCE[0]}")/discussion.py" verify "$linked" >/dev/null || {
    TRIGGER_ERROR="PR head does not identify a real linked Issue"; return 1;
  }
  TRUSTED_LINKED_ISSUE="$linked"
  TRUSTED_PR_BRANCH="$head_ref"
}

validate_conflict_dispatch() {
  validate_dispatch_request "$1" "${PR_INSTRUCTION:+invalid}" "${PR_INSTRUCTION:-}" "$2" || return 1
  validate_pr_context "$GITHUB_REPOSITORY" "$2" || return 1
  [ "$TRUSTED_LINKED_ISSUE" = "$1" ] || { TRIGGER_ERROR='conflict dispatch issue does not match PR head'; return 1; }
}
