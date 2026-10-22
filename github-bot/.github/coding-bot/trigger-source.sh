#!/bin/bash
# イベント本文の取得と、共有の宛先検証。

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

