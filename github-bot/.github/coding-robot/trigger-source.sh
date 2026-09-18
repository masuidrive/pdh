#!/bin/bash
# トリガーの «出どころ» を正しく取る 2 つ。どちらも承認判定とは無関係である。
#
#   fetch_trigger_context : event ごとに正しい API を叩いて本文と author を取る。
#                           ⚠ review と review comment は issues comments collection に
#                           «存在しない»。/issues/comments/ だけを叩くと本文が空になり、
#                           agent はユーザの依頼を 1 文字も受け取らないまま走る。
#   validate_pr_context   : PR の出自を確かめる。⚠ fork の PR は拒否する — 拒否しないと、
#                           fork 側で書いたコードを write token を持つ agent が
#                           checkout して実行する経路になる。
#                           あわせて head が `agent/issue-<N>` なら、その Issue 番号を
#                           TRUSTED_LINKED_ISSUE に置く（pdh-hooks.sh へ渡す番号）。

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

# 返り値: fork の PR と、PR API が引けないときだけ 1。それ以外は 0。
#
# ⚠ **head が `agent/issue-<N>` でない PR を拒否しない。**bot が作る branch はこの名前だが
# （`run-action.sh` が `agent/issue-${ISSUE_NUMBER}` で作り、`coding-robot-finalize.yml` が
# `startsWith(..., 'agent/issue-')` で反応する）、**人が手で切った branch の PR で bot を
# 使っている導入先がある。**そこを止めるかどうかは方針の判断なので、この関数では決めない。
#
# 成功時、head が `agent/issue-<N>` で <N> が実在の Issue なら TRUSTED_LINKED_ISSUE を置く。
# ⚠ これは pdh-hooks.sh へ渡す番号でもある — PR run で PR 番号を渡すと、hooks は
# ticket dir（`tickets/*-issue-<Issue 番号>`）を見つけられない。
validate_pr_context() {
  local repository="$1" pr_number="$2" data head_repo head_ref linked issue
  data=$(gh api "repos/$repository/pulls/$pr_number" 2>/dev/null) || { TRIGGER_ERROR="PR context API unavailable"; return 1; }
  head_repo=$(printf '%s' "$data" | jq -r '.head.repo.full_name // empty') || return 1
  head_ref=$(printf '%s' "$data" | jq -r '.head.ref // empty') || return 1
  [ "$head_repo" = "$repository" ] || { TRIGGER_ERROR="fork PRs cannot drive Coding Robot"; return 1; }
  TRUSTED_PR_BRANCH="$head_ref"

  linked=$(printf '%s' "$head_ref" | sed -n 's#^agent/issue-\([1-9][0-9]*\)$#\1#p')
  [ -n "$linked" ] || return 0
  issue=$(gh api "repos/$repository/issues/$linked" 2>/dev/null) || return 0
  printf '%s' "$issue" | jq -e '.number == '"$linked"' and (has("pull_request") | not)' >/dev/null 2>&1 || return 0
  TRUSTED_LINKED_ISSUE="$linked"
}
