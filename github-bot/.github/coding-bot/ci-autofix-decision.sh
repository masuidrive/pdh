#!/usr/bin/env bash
# workflow_run の判定。PR 単位の concurrency を取得した後に decide を呼ぶ。
set -euo pipefail
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$SCRIPT_DIR/trigger-source.sh"
source "$SCRIPT_DIR/ci-autofix-result.sh"
TRIGGER_ERROR=""

ci_autofix_resolve_pr() {
  local number branch prs
  number=$(jq -r '.workflow_run.pull_requests[0].number // empty' "$GITHUB_EVENT_PATH")
  if [ -z "$number" ]; then
    branch=$(jq -er '.workflow_run.head_branch' "$GITHUB_EVENT_PATH")
    # workflow_dispatch の CI では pull_requests が空なので branch から解決する。
    prs=$(gh pr list --repo "$GITHUB_REPOSITORY" --head "$branch" --state open --json number)
    number=$(printf '%s' "$prs" | jq -er 'if length <= 1 then .[0].number // "" else error("ambiguous PR head") end')
  fi
  printf 'pr_number=%s\n' "$number" >> "$GITHUB_OUTPUT"
}

ci_autofix_statuses() {
  local sha="$1" statuses
  statuses=$(gh api "repos/$GITHUB_REPOSITORY/commits/$sha/statuses?per_page=100" --paginate --slurp) || return 1
  printf '%s' "$statuses" | jq -c '[.[][] | select(.context == "coding-bot/ci-autofix")] | sort_by(.id)'
}

ci_autofix_count_status() {
  # 除外の履歴は再処理防止に残し、回数は最新の count/reset だけから読む。
  jq -c '[.[] | select((.description // "") | startswith("数えた:") or startswith("緑:"))] | last // {}'
}

ci_autofix_record() {
  # GITHUB_TOKEN + statuses:write は workflow_run の実地試験で確認する。
  # 権限不足ならここで失敗し、agent の起動も回数の推測による続行もしない。
  gh api --method POST "repos/$GITHUB_REPOSITORY/statuses/$head_sha" \
    -f context=coding-bot/ci-autofix -f state="$1" -f description="$2" \
    -f target_url="$run_url" >/dev/null
}

ci_autofix_resolve_red_comments() {
  local number comments comment id payload
  for number in "$CI_AUTOFIX_PR" "$TRUSTED_LINKED_ISSUE"; do
    comments=$(gh api "repos/$GITHUB_REPOSITORY/issues/$number/comments?per_page=100" --paginate --slurp) || return 1
    # 過去 SHA の赤も対象。GITHUB_TOKEN の投稿と先頭行の目印で引用を除外する。
    comments=$(printf '%s' "$comments" | jq -c --arg pr "$CI_AUTOFIX_PR" \
      '.[][] | select(.user.login == "github-actions[bot]") |
       select((.body // "") | test("^<!-- coding-bot:ci-red pr=" + $pr + " sha=[0-9a-f]{40} run=[0-9]+ -->\n")) |
       select((.body | startswith("解決済み: CI run ")) | not)') || return 1
    while IFS= read -r comment; do
      [ -n "$comment" ] || continue
      id=$(printf '%s' "$comment" | jq -er '.id') || return 1
      payload=$(printf '%s' "$comment" | jq -c --arg line "解決済み: CI run $run_id で緑 <!-- coding-bot:ci-green sha=$head_sha -->" \
        '{body: ($line + "\n\n" + .body)}') || return 1
      # 既存本文の末尾改行も保持するため、result の -f body= と違い JSON を --input で渡す。
      if ! gh api --method PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$id" --input - <<< "$payload" >/dev/null; then
        # 消されたコメントや本文上限のエラーでも、緑の回数リセットは妨げない。
        printf 'WARNING: CI red comment %s could not be resolved; continuing green status recording\n' "$id" >&2
      fi
    done <<< "$comments"
  done
}

ci_autofix_note_red_after_green() {
  local number comments comment id payload line="その後、CI run $run_id で再び赤"
  for number in "$CI_AUTOFIX_PR" "$TRUSTED_LINKED_ISSUE"; do
    comments=$(gh api "repos/$GITHUB_REPOSITORY/issues/$number/comments?per_page=100" --paginate --slurp) || return 1
    # 解決した緑の head と照合する。元の赤の SHA は修正前なので一致を要求しない。
    # 接頭辞と直後の赤の目印で、引用・別 PR・緑の SHA が不明な旧本文を除外する。
    comments=$(printf '%s' "$comments" | jq -c --arg pr "$CI_AUTOFIX_PR" --arg sha "$head_sha" --arg line "$line" \
      '.[][] | select(.user.login == "github-actions[bot]") |
       select((.body // "") | test("^解決済み: CI run [0-9]+ で緑 <!-- coding-bot:ci-green sha=" + $sha + " -->\n\n<!-- coding-bot:ci-red pr=" + $pr + " sha=[0-9a-f]{40} run=[0-9]+ -->\n")) |
       select((.body | split("\n") | index($line)) == null)') || return 1
    while IFS= read -r comment; do
      [ -n "$comment" ] || continue
      id=$(printf '%s' "$comment" | jq -er '.id') || return 1
      payload=$(printf '%s' "$comment" | jq -c --arg line "$line" '{body: (.body + "\n\n" + $line)}') || return 1
      # 緑の追記と同じ JSON 送信で元の本文を保持する。
      if ! gh api --method PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$id" --input - <<< "$payload" >/dev/null; then
        printf 'WARNING: CI red comment %s could not note red after green; continuing without repair\n' "$id" >&2
      fi
    done <<< "$comments"
  done
}

ci_autofix_decide() {
  local head_sha run_id run_attempt run_url conclusion pr_data reason="" statuses description
  local commits sha status count=0 url summary body jobs draft_skip previous_runs=()
  head_sha=$(jq -er '.workflow_run.head_sha' "$GITHUB_EVENT_PATH")
  run_id=$(jq -er '.workflow_run.id' "$GITHUB_EVENT_PATH")
  run_attempt=$(jq -er '.workflow_run.run_attempt' "$GITHUB_EVENT_PATH")
  conclusion=$(jq -er '.workflow_run.conclusion' "$GITHUB_EVENT_PATH")
  run_url="${GITHUB_SERVER_URL:-https://github.com}/$GITHUB_REPOSITORY/actions/runs/$run_id/attempts/$run_attempt"
  statuses=$(ci_autofix_statuses "$head_sha")
  # 判定 job の再実行は全履歴で照合する。CI 自身の再実行は attempt が異なる。
  if printf '%s' "$statuses" | jq -e --arg url "$run_url" 'any(.[]; .target_url == $url)' >/dev/null; then
    return 0
  fi
  status=$(printf '%s' "$statuses" | ci_autofix_count_status)
  description=$(printf '%s' "$status" | jq -r '.description // ""')

  if [ -z "${CI_AUTOFIX_PR:-}" ]; then
    reason='PR なし'
  elif ! validate_pr_context "$GITHUB_REPOSITORY" "$CI_AUTOFIX_PR"; then
    # API 障害を恒久的な除外記録に変えない。
    case "$TRIGGER_ERROR" in *'API unavailable') echo "$TRIGGER_ERROR" >&2; return 1 ;; esac
    reason='人の PR'
  else
    pr_data=$(gh api "repos/$GITHUB_REPOSITORY/pulls/$CI_AUTOFIX_PR")
    if [ "$(printf '%s' "$pr_data" | jq -r '.state')" != open ]; then
      reason='closed'
    elif [ "$(printf '%s' "$pr_data" | jq -r '.draft')" != false ]; then
      reason='draft'
    elif ! jq -e --arg branch "$TRUSTED_PR_BRANCH" --arg repo "$GITHUB_REPOSITORY" \
      '.workflow_run.head_branch == $branch and .workflow_run.head_repository.full_name == $repo' \
      "$GITHUB_EVENT_PATH" >/dev/null; then
      reason='人の PR'
    elif [ "$(printf '%s' "$pr_data" | jq -r '.head.sha')" != "$head_sha" ]; then
      reason='古い commit'
    fi
  fi
  if [ -z "$reason" ]; then
    case "$conclusion" in
      failure|timed_out|success) ;;
      cancelled) reason='取り消し' ;;
      *) reason="結論 $conclusion" ;;
    esac
  fi
  if [ -z "$reason" ] && { [ "$conclusion" = success ] || [[ "$description" == '緑:'* ]]; }; then
    jobs=$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$run_id/attempts/$run_attempt/jobs?per_page=100" --paginate --slurp) || return 1
    draft_skip=$(printf '%s' "$jobs" | jq -r --arg prefix "${CODING_BOT_CI_DRAFT_SKIP_STEP:-Draft PR: full suite skipped}" \
      'any(.[].jobs[].steps[]?; (.name | startswith($prefix)) and .status == "completed" and .conclusion == "success")') || return 1
    if [ "$draft_skip" = true ]; then reason='draft で skip'; fi
  fi
  if [ -n "$reason" ]; then
    # 同じ SHA の他の判定を消さず、除外した attempt も履歴に残す。
    ci_autofix_record success "除外: $reason"
    return 0
  fi
  if [ "$conclusion" = success ]; then
    ci_autofix_resolve_red_comments || return 1
    # 同一 SHA の再実行でも、対象となる緑は AC 3 に従って reset する。
    [ "$description" = '緑: 0 に戻す' ] || ci_autofix_record success '緑: 0 に戻す'
    return 0
  fi
  # 緑は集計の境界。同じ commit の後続の失敗で境界を消さない。
  case "$description" in
    '緑:'*) ci_autofix_note_red_after_green || return 1; return 0 ;;
    '数えた:'*) return 0 ;;
  esac

  # PR commits の connection をページ順に取得する。
  commits=$(gh api graphql --paginate --slurp \
    -f query='query($owner:String!, $name:String!, $number:Int!, $endCursor:String) {
      repository(owner:$owner, name:$name) { pullRequest(number:$number) {
        commits(first:100, after:$endCursor) {
          nodes { commit { oid } } pageInfo { hasNextPage endCursor }
        }
      } }
    }' -f owner="${GITHUB_REPOSITORY%/*}" -f name="${GITHUB_REPOSITORY#*/}" -F number="$CI_AUTOFIX_PR")
  commits=$(printf '%s' "$commits" | jq -er '[.[].data.repository.pullRequest.commits.nodes[].commit.oid] | reverse | .[]')
  while IFS= read -r sha; do
    [ -n "$sha" ] && [ "$sha" != "$head_sha" ] || continue
    statuses=$(ci_autofix_statuses "$sha")
    status=$(printf '%s' "$statuses" | ci_autofix_count_status)
    description=$(printf '%s' "$status" | jq -r '.description // ""')
    case "$description" in
      '緑:'*) break ;;
      '数えた:'*)
        count=$((count + 1))
        previous_runs+=("$(printf '%s' "$status" | jq -r '.target_url')")
        ;;
    esac
  done <<< "$commits"
  count=$((count + 1))
  if [ "$count" -eq 3 ]; then
    body='3 回続けて CI が落ちたので人が見てほしい'
    for url in "${previous_runs[1]}" "${previous_runs[0]}" "$run_url"; do
      # attempt 付き URL はその attempt の jobs を読む。
      summary=$(ci_failure_steps "$GITHUB_REPOSITORY" "${url#*/actions/runs/}") \
        || summary='失敗 step の情報を取得できませんでした。run のログを確認してください。'
      body+=$(printf '\n\n- %s — %s' "$summary" "$url")
    done
    body=$(printf '%s\n\n%s\n\n<!-- coding-bot -->' "$(ci_autofix_red_marker "$CI_AUTOFIX_PR" "$head_sha" "$run_id")" "$body")
    # 投稿失敗時は未記録のまま残し、同じ run の再実行で通知を再試行する。
    gh issue comment "$TRUSTED_LINKED_ISSUE" --repo "$GITHUB_REPOSITORY" --body "$body" || return 1
  fi
  ci_autofix_record failure "数えた: 失敗 $count 回目"
  if [ "$count" -le 2 ]; then
    printf 'repair=true\nrun_id=%s\nhead_sha=%s\n' "$run_id" "$head_sha" >> "$GITHUB_OUTPUT"
  fi
}

# 無効時は API 呼び出しも status 書き込みもしない。
if [ "${CODING_BOT_CI_AUTOFIX:-}" = true ]; then
  # fork の同名 branch を自 repo の PR に結び付けず、status も書かない。
  if [ "$(jq -r '.workflow_run.head_repository.full_name // ""' "$GITHUB_EVENT_PATH")" != "$GITHUB_REPOSITORY" ]; then
    if [ "${1:-decide}" = resolve ]; then printf 'pr_number=\n' >> "$GITHUB_OUTPUT"; fi
    exit 0
  fi
  case "${1:-decide}" in
    resolve) ci_autofix_resolve_pr ;;
    decide) ci_autofix_decide ;;
    *) exit 2 ;;
  esac
fi
