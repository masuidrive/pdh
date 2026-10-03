#!/usr/bin/env bash
# Source this file to test the judgement and comment handling without network.

issue_body_only_ticket_reference() {
  # jq length counts Unicode code points. Newlines/blank padding do not count.
  jq -Rse '
    def ticket_path: "tickets/[A-Za-z0-9._-]+/[A-Za-z0-9._/-]*";
    # ASCII URL characters stop before Japanese prose; ?/# start query/fragment.
    def url_path_char: "[A-Za-z0-9._~:/%\\[\\]@!$&\u0027()*+,;=-]";
    def ticket_url: "https?://" + url_path_char + "+/" + ticket_path + "(?:" + url_path_char + "|[?#])*";
    def ticket_link: "(?:ticket:\\s*)?\\[[^\\]]*\\]\\(<?(?:" + ticket_url + "|(?:(?:https?://)?[A-Za-z0-9._/-]*/)?" + ticket_path + ")>?(?:\\s+(?:\"[^\"]*\"|\u0027[^\u0027]*\u0027|\\([^)]*\\)))?\\)";
    gsub("(?s)<!--.*?-->"; "")
    | split("\n")
    | map(gsub("^\\s+|\\s+$"; "")
          | sub("^#{1,6}\\s*"; "") | sub("\\s+#+$"; ""))
    | any(.[]; test(ticket_path; "i")) and (
      map(gsub(ticket_link; ""; "i")
          | gsub("(?:ticket:\\s*)?<?" + ticket_url + ">?"; ""; "i")
          | gsub("(?:ticket:\\s*)?`?(\\./)?" + ticket_path + "`?"; ""; "i")
          | select(test("^([=-]+|\\s*)$") | not))
      | join("") | length < 80)
  ' >/dev/null
}

issue_body_warning() {
  cat <<'WARNING'
<!-- coding-bot:issue-body-short -->
本文が ticket の参照だけのため、issue を開いた人が課題を判断できません。
本文に、誰が何をすると困るか、何が起きているか（具体例・実測値）、原因（`file:行`）、直すと何ができるようになるかを書いてください。
決めること（あれば）、大きさと関連 issue も書き、最後に `ticket: tickets/<名前>/ticket.md` を 1 行置いてください。
書き方: `.github/coding-bot/_github-issue.md`「issue の作り方」。
WARNING
}

check_issue_body() {
  local issue body comments warning_ids judgement id
  issue=$(gh api "repos/$REPO/issues/$ISSUE_NUMBER") || return
  body=$(printf '%s' "$issue" | jq -r '.body // ""') || return
  [[ "$body" != *'<!-- coding-bot -->'* ]] || return 0
  comments=$(gh api "repos/$REPO/issues/$ISSUE_NUMBER/comments" --paginate) || return
  warning_ids=$(printf '%s' "$comments" | jq -r --arg marker '<!-- coding-bot:issue-body-short -->' \
    '.[] | select(.user.login == "github-actions[bot]")
     | select((.body // "") | startswith($marker)) | .id') || return

  if issue_body_only_ticket_reference <<< "$body"; then
    if [ -z "$warning_ids" ]; then
      issue_body_warning | gh api "repos/$REPO/issues/$ISSUE_NUMBER/comments" \
        --method POST --field body=@- --silent || return
    fi
  else
    judgement=$?
    [ "$judgement" -eq 1 ] || return "$judgement"
    while IFS= read -r id; do
      [ -n "$id" ] || continue
      gh api "repos/$REPO/issues/comments/$id" --method DELETE --silent || return
    done <<< "$warning_ids"
  fi
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  set -euo pipefail
  check_issue_body
fi
