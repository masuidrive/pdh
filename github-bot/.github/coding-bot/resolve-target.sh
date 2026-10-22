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
      validate_issue_context "$GITHUB_REPOSITORY" "$issue" || return $?
    fi
  fi
}

validate_issue_context() {
  local repository="$1" number="$2" resource
  [[ "$number" =~ ^[1-9][0-9]*$ ]] || return 1
  resource=$(target_api "repos/$repository/issues/$number") || return $?
  printf '%s' "$resource" | python3 "$(dirname "${BASH_SOURCE[0]}")/discussion.py" verify "$number" >/dev/null
}

# 成功すると TRUSTED_LINKED_ISSUE（紐づく Issue 番号）と TRUSTED_PR_BRANCH を設定する。
# ⚠ TRUSTED_LINKED_ISSUE は pdh-hooks.sh へ渡す番号でもある — PR run で PR 番号を渡すと
# ticket が見つからない。ticket は Issue 番号で探す
# （名前 *-issue-<N> か frontmatter の branch: agent/issue-<N> / issue: <N>）。
validate_pr_context() {
  local repository="$1" pr_number="$2" data head_repo head_ref linked issue
  data=$(target_api "repos/$repository/pulls/$pr_number") || { TRIGGER_ERROR="$(target_failure_reason $? PR)"; return 1; }
  linked=$(printf '%s' "$data" | python3 "$(dirname "${BASH_SOURCE[0]}")/discussion.py" resolve "$repository") || {
    TRIGGER_ERROR="対象外: PR head must be a same-repository agent/issue-<linked-issue>"; return 1;
  }
  head_ref="agent/issue-$linked"
  issue=$(target_api "repos/$repository/issues/$linked") || { TRIGGER_ERROR="$(target_failure_reason $? 'linked Issue')"; return 1; }
  printf '%s' "$issue" | python3 "$(dirname "${BASH_SOURCE[0]}")/discussion.py" verify "$linked" >/dev/null || {
    TRIGGER_ERROR="対象外: PR head does not identify a real linked Issue"; return 1;
  }
  TARGET_PR_STATE=$(printf '%s' "$data" | jq -r .state)
  TRUSTED_LINKED_ISSUE="$linked"
  TRUSTED_PR_BRANCH="$head_ref"
}


target_failure_reason() {
  if [ "$1" = 75 ]; then printf '一時的な失敗: %s API unavailable' "$2"
  else printf '対象外: %s API unavailable' "$2"; fi
}

target_api() {
  local error attempt value
  error=$(mktemp "$RUNNER_TEMP/target-api.XXXXXX") || return 1
  for attempt in 0 1 2 3; do
    if value=$(gh api "$@" 2>"$error"); then rm -f "$error"; printf '%s\n' "$value"; return 0; fi
    cat "$error" >&2
    if ! grep -Eiq 'HTTP (5[0-9]{2}|429)|rate limit|timed? ?out|timeout|connection (refused|reset)|dial tcp|no such host|network is unreachable|TLS handshake|unexpected EOF' "$error"; then
      rm -f "$error"; return 1
    fi
    [ "$attempt" != 3 ] || { rm -f "$error"; return 75; }
    sleep 2
  done
}

resolve_target() {
  local issue="" pr="" reason="" number="${EVENT_NUMBER:-}" requested_pr
  if [ "${GITHUB_EVENT_NAME:-}" = workflow_dispatch ]; then
    if validate_dispatch_request "${DISPATCH_ISSUE:-}" "${DISPATCH_PR:-}" "${PR_INSTRUCTION:-}" "${RESOLVE_CONFLICT_PR:-}"; then
      requested_pr="${RESOLVE_CONFLICT_PR:-${DISPATCH_PR:-}}"
      if [ -n "$requested_pr" ]; then
        if validate_pr_context "$GITHUB_REPOSITORY" "$requested_pr"; then
          if [ "$TRUSTED_LINKED_ISSUE" = "$DISPATCH_ISSUE" ]; then
            issue="$TRUSTED_LINKED_ISSUE"; pr="$requested_pr"
            if [ "$TARGET_PR_STATE" != open ]; then reason='PR が閉じています'; fi
          else
            reason='dispatch の issue と PR が一致しません'
          fi
        else reason="$TRIGGER_ERROR"; fi
      else issue="${DISPATCH_ISSUE:-}"; fi
    else reason="$(target_failure_reason $? dispatch)"; fi
  elif [ "${EVENT_IS_PR:-false}" = true ]; then
    if [[ "$number" =~ ^[1-9][0-9]*$ ]] && validate_pr_context "$GITHUB_REPOSITORY" "$number"; then
      issue="$TRUSTED_LINKED_ISSUE"; pr="$number"
      if [ "$TARGET_PR_STATE" != open ]; then reason='PR が閉じています'; fi
    else reason="${TRIGGER_ERROR:-PR 番号を確認できません}"; fi
  elif [[ "$number" =~ ^[1-9][0-9]*$ ]]; then
    issue="$number"
  else reason='issue 番号を確認できません'; fi
  printf 'issue=%s\npr=%s\nreason=%s\n' "$issue" "$pr" "$reason" >> "$GITHUB_OUTPUT"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then resolve_target; fi
