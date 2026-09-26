#!/bin/bash
# トリガーの本文と PR の出自を取得する。gate の承認判定とは分離する。

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
# ticket dir（tickets/*-issue-<Issue 番号>）が見つからない。
validate_pr_context() {
  local repository="$1" pr_number="$2" data head_repo head_ref linked issue
  data=$(gh api "repos/$repository/pulls/$pr_number" 2>/dev/null) || { TRIGGER_ERROR="PR context API unavailable"; return 1; }
  head_repo=$(printf '%s' "$data" | jq -r '.head.repo.full_name // empty') || return 1
  head_ref=$(printf '%s' "$data" | jq -r '.head.ref // empty') || return 1
  [ "$head_repo" = "$repository" ] || { TRIGGER_ERROR="fork PRs cannot drive Coding Robot"; return 1; }
  linked=$(printf '%s' "$head_ref" | sed -n 's#^agent/issue-\([1-9][0-9]*\)$#\1#p')
  [ -n "$linked" ] || { TRIGGER_ERROR="PR head must be exactly agent/issue-<linked-issue>"; return 1; }
  issue=$(gh api "repos/$repository/issues/$linked" 2>/dev/null) || { TRIGGER_ERROR="linked Issue API unavailable"; return 1; }
  printf '%s' "$issue" | jq -e '.number == '"$linked"' and (has("pull_request") | not)' >/dev/null 2>&1 || {
    TRIGGER_ERROR="PR head does not identify a real linked Issue"
    return 1
  }
  TRUSTED_LINKED_ISSUE="$linked"
  TRUSTED_PR_BRANCH="$head_ref"
}
