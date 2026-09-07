#!/bin/bash
set -e

# Function to post error comments
post_error_comment() {
  local error_message="$1"
  local workflow_url="https://github.com/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"

  if [ -n "$PROGRESS_COMMENT_ID" ] && [ -n "$GITHUB_REPOSITORY" ] && [ -n "$ISSUE_NUMBER" ]; then
    echo "📝 Posting error comment..."
    gh api -X PATCH repos/$GITHUB_REPOSITORY/issues/comments/$PROGRESS_COMMENT_ID \
      -f body="## ❌ Error Occurred

$error_message

### 📋 Details
- **Workflow Run**: [View logs]($workflow_url)
- **Run ID**: $GITHUB_RUN_ID

---
🤖 [Coding Robot](https://github.com/masuidrive/github-bots/tree/main/coding-robot)" || true
  fi
}

# Handler for unexpected errors
handle_unexpected_error() {
  local exit_code=$?
  local line_number=$1
  if [ $exit_code -ne 0 ]; then
    echo "💥 Unexpected error at line $line_number (exit code: $exit_code)"
    post_error_comment "### 💥 Unexpected Error

An error occurred during script execution.

- **Exit Code**: $exit_code
- **Line**: $line_number

Please check the workflow logs for more details."
  fi
}

# Set error trap (enabled after PROGRESS_COMMENT_ID is set)
trap 'handle_unexpected_error $LINENO' ERR

# Resolve this script's directory before any cd, so we can source engine files.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Select execution engine (claude | codex). MUST be set explicitly — no default.
ENGINE="${CODING_ROBOT_ENGINE:-}"
if [ -z "$ENGINE" ]; then
  echo "❌ CODING_ROBOT_ENGINE is not set. Set the repository variable to 'claude' or 'codex'."
  echo "   gh variable set CODING_ROBOT_ENGINE --body 'claude'   # or codex"
  exit 1
fi
ENGINE_FILE="$SCRIPT_DIR/engines/_${ENGINE}.sh"
if [ ! -f "$ENGINE_FILE" ]; then
  echo "❌ Unknown engine '$ENGINE' (expected file: $ENGINE_FILE)"
  exit 1
fi
echo "🔌 Engine: $ENGINE"

# Project-specific env passthrough. A single optional secret ENV_JSON carries a
# JSON object of {KEY: value} pairs to export into the agent and its subprocesses
# (e.g. test suites needing provider API keys), so this generic workflow need not
# enumerate app-specific keys. Values are masked in Actions logs, never printed.
if [ -n "${ENV_JSON:-}" ]; then
  if printf '%s' "$ENV_JSON" | jq -e . >/dev/null 2>&1; then
    while IFS= read -r _env_key; do
      [ -n "$_env_key" ] || continue
      _env_val="$(printf '%s' "$ENV_JSON" | jq -r --arg k "$_env_key" '.[$k]')"
      echo "::add-mask::$_env_val"
      export "$_env_key=$_env_val"
      echo "🔑 ENV_JSON: exported $_env_key"
    done < <(printf '%s' "$ENV_JSON" | jq -r 'keys[]')
    unset _env_key _env_val
  else
    echo "⚠️  ENV_JSON is set but is not valid JSON; skipping."
  fi
fi

echo "🤖 Coding Robot starting..."

# 現在のディレクトリを表示
echo "📁 Current directory: $(pwd)"
echo "📁 Contents:"
ls -la

# Gitリポジトリが現在のディレクトリにあるか確認
if [ ! -d ".git" ]; then
  echo "⚠️ .git directory not found in current directory"

  # 作業ディレクトリを探す
  if [ -d "/workspaces/review-apps/.git" ]; then
    cd /workspaces/review-apps
    echo "✅ Changed to /workspaces/review-apps"
  elif [ -d "/workspace/.git" ]; then
    cd /workspace
    echo "✅ Changed to /workspace"
  else
    echo "❌ Cannot find git repository"
    exit 1
  fi
fi

echo "📁 Working directory: $(pwd)"

# 環境変数チェック
if [ -z "$ISSUE_NUMBER" ] || [ -z "$GITHUB_REPOSITORY" ]; then
  echo "❌ Required environment variables are missing"
  echo "ISSUE_NUMBER: $ISSUE_NUMBER"
  echo "GITHUB_REPOSITORY: $GITHUB_REPOSITORY"
  exit 1
fi

echo "📋 Issue/PR: #$ISSUE_NUMBER"
echo "📦 Repository: $GITHUB_REPOSITORY"
echo "🎯 Event type: $EVENT_TYPE"

# Git 設定
git config --global --add safe.directory /workspaces/review-apps
git config --global user.name "github-actions[bot]"
git config --global user.email "github-actions[bot]@users.noreply.github.com"

# 最新の状態を取得
git fetch origin

# Issue/PR情報の取得
echo "📝 Fetching Issue/PR data..."

# PR か Issue かを判定する。issue_comment は Issue / PR 両方で発火するため、
# その場合は対象番号が実際に PR かどうかを gh で確認する（PR への 🤖 コメントを
# PR 扱いにし、PR の head ブランチで作業 + _pr.md を読むため）。
IS_PR=false
if [[ "$EVENT_TYPE" == "pull_request"* ]]; then
  IS_PR=true
elif [[ "$EVENT_TYPE" == "issue_comment" ]] && gh pr view "$ISSUE_NUMBER" --repo "$GITHUB_REPOSITORY" --json number >/dev/null 2>&1; then
  IS_PR=true
fi

if [ "$IS_PR" = true ]; then
  # PR の場合
  PR_DATA=$(gh pr view $ISSUE_NUMBER \
    --json title,body,comments,headRefName \
    --repo $GITHUB_REPOSITORY)

  ISSUE_TITLE=$(echo "$PR_DATA" | jq -r '.title')
  ISSUE_BODY=$(echo "$PR_DATA" | jq -r '.body // ""')

  # PR の場合: head ブランチ名を取得
  BRANCH_NAME=$(echo "$PR_DATA" | jq -r '.headRefName')
  echo "📌 PR head branch: $BRANCH_NAME"

  git checkout "$BRANCH_NAME"
  git pull origin "$BRANCH_NAME" || true

  # PR diff取得
  PR_DIFF=$(gh pr diff $ISSUE_NUMBER --repo $GITHUB_REPOSITORY | head -1000 || echo "")

else
  # Issue の場合
  ISSUE_DATA=$(gh issue view $ISSUE_NUMBER \
    --json title,body,comments \
    --repo $GITHUB_REPOSITORY)

  ISSUE_TITLE=$(echo "$ISSUE_DATA" | jq -r '.title')
  ISSUE_BODY=$(echo "$ISSUE_DATA" | jq -r '.body // ""')

  # Issue の場合: 新しいブランチ名を作成
  BRANCH_NAME="agent/issue-${ISSUE_NUMBER}"
  echo "📌 Issue branch: $BRANCH_NAME"

  if git ls-remote --heads origin "$BRANCH_NAME" | grep -q "$BRANCH_NAME"; then
    # ブランチが存在 → checkout
    git checkout "$BRANCH_NAME"
    git pull origin "$BRANCH_NAME" || true
  else
    # ブランチが存在しない → 作成
    git checkout -b "$BRANCH_NAME"
  fi

  PR_DIFF=""
fi

# REST API で全コメント取得（数値 ID 付き。COMMENT_ID とのマッチングに必要）
ALL_COMMENTS_JSON=$(gh api repos/$GITHUB_REPOSITORY/issues/$ISSUE_NUMBER/comments --paginate \
  --jq '[.[] | {id: .id, login: .user.login, body: .body}]' 2>/dev/null || echo '[]')

# === コメントの構造化: トリガーコメント vs 過去ログ ===
# COMMENT_ID が設定されている場合、そのコメントがトリガー（＝ユーザの指示）
# それ以外のコメントは過去の会話ログとして参考情報扱い

if [ -n "$COMMENT_ID" ]; then
  # トリガーコメントの本文を直接取得（GitHub API、1回で body + login 両方取得）
  TRIGGER_DATA=$(gh api repos/$GITHUB_REPOSITORY/issues/comments/$COMMENT_ID 2>/dev/null || echo '{}')
  TRIGGER_COMMENT=$(echo "$TRIGGER_DATA" | jq -r '.body // ""')
  TRIGGER_AUTHOR=$(echo "$TRIGGER_DATA" | jq -r '.user.login // "unknown"')
  # /code や 🤖 トリガー文字列を除去
  USER_REQUEST=$(echo "$TRIGGER_COMMENT" | sed -E 's/\/(code|🤖)//gi; s/^[[:space:]]*//; s/[[:space:]]*$//')
  echo "📌 Trigger comment by $TRIGGER_AUTHOR (ID: $COMMENT_ID)"
else
  # COMMENT_ID がない場合（issues opened 等）: issue body 自体が指示
  USER_REQUEST=$(echo "$ISSUE_BODY" | sed -E 's/\/(code|🤖)//gi; s/^[[:space:]]*//; s/[[:space:]]*$//')
  TRIGGER_COMMENT=""
  TRIGGER_AUTHOR=""
  COMMENT_ID=""
fi

# 過去の会話ログ構築（トリガーコメントを除外）
# 直近10件はプロンプトにインライン、それより前は /tmp/conversation-history.md に書き出し
ALL_FILTERED=$(echo "$ALL_COMMENTS_JSON" | jq -r --arg comment_id "${COMMENT_ID:-0}" '
  [.[] | select(.id != ($comment_id | tonumber? // -1))] | .[-32:]' 2>/dev/null || echo '[]')

TOTAL_COMMENTS=$(echo "$ALL_FILTERED" | jq 'length')

if [ "$TOTAL_COMMENTS" -gt 10 ]; then
  # 古いコメントをファイルに書き出し
  OLDER_COUNT=$((TOTAL_COMMENTS - 10))
  echo "$ALL_FILTERED" | jq -r ".[0:$OLDER_COUNT][] | \"[\" + .login + \"] \" + .body" > /tmp/conversation-history.md
  echo "📄 Wrote $OLDER_COUNT older comments to /tmp/conversation-history.md"

  # 直近10件をインライン
  CONVERSATION_HISTORY=$(echo "$ALL_FILTERED" | jq -r '.[-10:][] | "[" + .login + "] " + .body')
  CONVERSATION_HISTORY_NOTE="(${OLDER_COUNT} older comments available in /tmp/conversation-history.md)

$CONVERSATION_HISTORY"
else
  CONVERSATION_HISTORY_NOTE=$(echo "$ALL_FILTERED" | jq -r '.[] | "[" + .login + "] " + .body' 2>/dev/null || echo "(no previous comments)")
fi

# main を merge
echo "🔀 Merging origin/main into $BRANCH_NAME..."
MERGE_OUTPUT=$(git merge origin/main --no-edit 2>&1) || MERGE_EXIT_CODE=$?
MERGE_EXIT_CODE=${MERGE_EXIT_CODE:-0}

CONFLICT_SECTION=""
if [ $MERGE_EXIT_CODE -ne 0 ]; then
  echo "⚠️ Merge conflict detected!"

  # conflict があれば、エージェントに解決させる
  CONFLICT_FILES=$(git diff --name-only --diff-filter=U)

  CONFLICT_SECTION="

---

# 🚨 IMPORTANT: Git Merge Conflict Detected

**You MUST resolve the merge conflicts BEFORE starting the user's task.**

## Conflicted Files:
\`\`\`
$CONFLICT_FILES
\`\`\`

## Steps to Resolve:
1. Read each conflicted file
2. Understand both changes (current branch vs main)
3. Resolve conflicts by editing files (remove conflict markers <<<<<<, =======, >>>>>>>)
4. Stage resolved files: \`git add <file>\`
5. Commit the merge: \`git commit -m \"Merge main into $BRANCH_NAME\"\`
6. Verify: \`git status\` should show no conflicts

**After resolving conflicts, proceed with the user's original request.**
"
else
  echo "✅ Merge successful (no conflicts)"
fi

# 画像URLを抽出してダウンロード
echo "🖼️ Checking for attached images..."
IMAGE_DIR="/tmp/issue-${ISSUE_NUMBER}-images"
mkdir -p "$IMAGE_DIR"

# 元のMarkdownから画像URLを抽出（表示用）
ORIGINAL_IMAGE_URLS=$(echo "$ISSUE_BODY" | \
  grep -oE '(https?://[^)"\s]+\.(png|jpg|jpeg|gif|webp|svg))|(https?://github\.com/user-attachments/assets/[^)"\s]+)|(https?://user-images\.githubusercontent\.com/[^)"\s]+)' | \
  sort -u)

# GraphQL API を使って bodyHTML を取得（JWT付きの実際の画像URLを含む）
if [ "$IS_PR" = true ]; then
  BODY_HTML=$(gh api graphql -f query="
    query {
      repository(owner: \"$(echo $GITHUB_REPOSITORY | cut -d/ -f1)\", name: \"$(echo $GITHUB_REPOSITORY | cut -d/ -f2)\") {
        pullRequest(number: $ISSUE_NUMBER) {
          bodyHTML
        }
      }
    }
  " --jq '.data.repository.pullRequest.bodyHTML' 2>/dev/null || echo "")
else
  BODY_HTML=$(gh api graphql -f query="
    query {
      repository(owner: \"$(echo $GITHUB_REPOSITORY | cut -d/ -f1)\", name: \"$(echo $GITHUB_REPOSITORY | cut -d/ -f2)\") {
        issue(number: $ISSUE_NUMBER) {
          bodyHTML
        }
      }
    }
  " --jq '.data.repository.issue.bodyHTML' 2>/dev/null || echo "")
fi

# bodyHTML から画像URLを抽出（JWT付きのprivate-user-images URLと通常の画像URL）
# sed を使って href と src 属性から URL を抽出
DOWNLOAD_IMAGE_URLS=$(echo "$BODY_HTML" | \
  sed -n 's/.*\(href\|src\)="\([^"]*\)".*/\2/p' | \
  grep -E 'https?://(private-user-images\.githubusercontent\.com/[^[:space:]]+|[^[:space:]]+\.(png|jpg|jpeg|gif|webp|svg)(\?[^[:space:]]*)?|user-images\.githubusercontent\.com/[^[:space:]]+)' | \
  sort -u)

# 元のURLとダウンロードURLを配列化
IFS=$'\n' read -d '' -r -a ORIGINAL_URLS_ARRAY <<< "$ORIGINAL_IMAGE_URLS" || true
IFS=$'\n' read -d '' -r -a DOWNLOAD_URLS_ARRAY <<< "$DOWNLOAD_IMAGE_URLS" || true

IMAGE_COUNT=0
IMAGE_LIST=""
for i in "${!DOWNLOAD_URLS_ARRAY[@]}"; do
  download_url="${DOWNLOAD_URLS_ARRAY[$i]}"
  original_url="${ORIGINAL_URLS_ARRAY[$i]:-$download_url}"  # 元URLがなければダウンロードURLを使う

  if [ -n "$download_url" ]; then
    IMAGE_COUNT=$((IMAGE_COUNT + 1))
    # ファイル拡張子を抽出（URLパラメータの前の部分から）
    EXT=$(echo "$download_url" | sed -E 's/^.*\.([a-z]+)(\?.*)?$/\1/' | grep -E '^(png|jpg|jpeg|gif|webp|svg)$' || echo "png")
    FILENAME="image-${IMAGE_COUNT}.${EXT}"
    IMAGE_PATH="$IMAGE_DIR/$FILENAME"

    echo "  - Downloading: ${download_url:0:80}..."
    if curl -sL "$download_url" -o "$IMAGE_PATH" 2>/dev/null && [ -s "$IMAGE_PATH" ]; then
      # ファイルが正しくダウンロードされたか確認
      FILE_TYPE=$(file -b "$IMAGE_PATH" 2>/dev/null)
      if echo "$FILE_TYPE" | grep -qE "image|RIFF.*Web/P"; then
        IMAGE_LIST="$IMAGE_LIST
- $IMAGE_PATH (source: $original_url)"
        echo "    ✓ Saved to: $IMAGE_PATH ($FILE_TYPE)"
      else
        echo "    ✗ Not a valid image file: $FILE_TYPE"
        rm -f "$IMAGE_PATH"
        IMAGE_COUNT=$((IMAGE_COUNT - 1))
      fi
    else
      echo "    ✗ Failed to download"
      IMAGE_COUNT=$((IMAGE_COUNT - 1))
    fi
  fi
done

if [ $IMAGE_COUNT -gt 0 ]; then
  echo "✅ Downloaded $IMAGE_COUNT image(s)"
elif [ -n "$DOWNLOAD_IMAGE_URLS" ]; then
  echo "ℹ️ No images found in Issue/PR"
fi

# 画像セクションを構築
IMAGES_SECTION=""
if [ $IMAGE_COUNT -gt 0 ]; then
  IMAGES_SECTION="

---

# 📸 Attached Images

**IMPORTANT**: The user has attached $IMAGE_COUNT image(s) to this Issue/Pull Request.

## Image Files:
$IMAGE_LIST

## Instructions:
1. **Read each image** using the Read tool to understand the visual content
2. **Analyze the images** in the context of the user's request
3. **Reference the images** in your response when relevant

Use these images to better understand the user's requirements, bugs, design requests, or other visual information.
"
fi

# システムプロンプト読み込み：共通 system.md と engine 固有 system-${ENGINE}.md を
# concat したものを 1 つの system prompt として渡す。共通部に Output Language /
# Self-update / Output Contract / PR metadata / Auxiliary Artifacts を集約し、
# engine 固有ファイルはそれ以外の engine-specific 振る舞いのみを記述する。
SHARED_PROMPT_FILE="$SCRIPT_DIR/system.md"
ENGINE_PROMPT_FILE="$SCRIPT_DIR/system-${ENGINE}.md"
for f in "$SHARED_PROMPT_FILE" "$ENGINE_PROMPT_FILE"; do
  if [ ! -f "$f" ]; then
    echo "❌ System prompt missing: $f"
    exit 1
  fi
done
echo "📄 System prompt: $SHARED_PROMPT_FILE + $ENGINE_PROMPT_FILE"
SYSTEM_PROMPT=$(cat "$SHARED_PROMPT_FILE" "$ENGINE_PROMPT_FILE" \
  | sed "s|{DEVCONTAINER_CONFIG_PATH}|$DEVCONTAINER_CONFIG_PATH|g")

# 追加プロンプトを連結するヘルパー（あれば末尾に append）。
append_prompt() {
  local file="$1"
  [ -f "$file" ] || return 0
  echo "📄 Appending $(basename "$file")"
  local extra
  extra=$(sed "s|{DEVCONTAINER_CONFIG_PATH}|$DEVCONTAINER_CONFIG_PATH|g" "$file")
  SYSTEM_PROMPT="$SYSTEM_PROMPT

$extra"
}

# コンテキスト別の追加プロンプト: PR なら _pr.md、Issue なら _issue.md
if [ "${IS_PR:-false}" = "true" ]; then
  append_prompt "$SCRIPT_DIR/_pr.md"
else
  append_prompt "$SCRIPT_DIR/_issue.md"
fi

# PDH プロジェクト（project root に product-brief.md と tickets/ がある）なら _pdh.md
if [ -f product-brief.md ] && [ -d tickets ]; then
  append_prompt "$SCRIPT_DIR/_pdh.md"
fi

# Deadline awareness: tell the agent how much wall-clock budget it has.
# Must be computed BEFORE the prompt is built so it can be injected.
RUN_TIMEOUT_SECONDS=${CLAUDE_TIMEOUT:-5400}
RUN_START_UNIX=$(date +%s)
RUN_DEADLINE_UNIX=$((RUN_START_UNIX + RUN_TIMEOUT_SECONDS))

# ユーザプロンプト構築（システムプロンプトは --system-prompt で渡す）
USER_PROMPT="<current-request>
$USER_REQUEST
</current-request>

<context>
**Type**: $EVENT_TYPE
**Number**: #$ISSUE_NUMBER
**Title**: $ISSUE_TITLE

<description>
$ISSUE_BODY
</description>

<conversation-history>
$CONVERSATION_HISTORY_NOTE
</conversation-history>
</context>"

if [ -n "$PR_DIFF" ]; then
  USER_PROMPT="$USER_PROMPT

## PR Diff (first 1000 lines)
\`\`\`
$PR_DIFF
\`\`\`"
fi

USER_PROMPT="$USER_PROMPT
$CONFLICT_SECTION
$IMAGES_SECTION

---

# Your Working Branch

**Branch**: \`$BRANCH_NAME\`
**GitHub Comparison**: https://github.com/$GITHUB_REPOSITORY/compare/main...$BRANCH_NAME

You are working on this branch. All commits will be pushed here.
Users can view your changes by visiting the comparison page.

---

# Environment Variables Available
- ISSUE_NUMBER: $ISSUE_NUMBER
- GITHUB_REPOSITORY: $GITHUB_REPOSITORY
- BRANCH_NAME: $BRANCH_NAME
- START_TIME_UNIX: $RUN_START_UNIX     # wall-clock at run start
- TIMEOUT_SECONDS: $RUN_TIMEOUT_SECONDS  # the hard kill budget
- DEADLINE_UNIX: $RUN_DEADLINE_UNIX     # START_TIME_UNIX + TIMEOUT_SECONDS

# Wall-clock budget
You are running inside a hard \`timeout $RUN_TIMEOUT_SECONDS\` envelope. When
you go past it the process is killed by SIGKILL and ALL uncommitted work is
lost (this has happened in production). Check your remaining time before
any long-running operation:

\`\`\`bash
REMAINING=\$(( \$DEADLINE_UNIX - \$(date +%s) ))
echo \"remaining: \$REMAINING s\"
\`\`\`

Rules:
- **If REMAINING drops below 20% of TIMEOUT_SECONDS** (so for the default
  90 min budget, < ~18 min), stop starting new work. Commit/push whatever
  state you have, write a final report to \`/tmp/agent-result.md\`
  explaining what is done / not done / next steps, and exit. Do not start
  another full test run.
- **Before any potentially long-running command** (\`scripts/test-all.sh\`,
  full pytest, full vitest, large dependency install, etc.) compare its
  expected runtime against \$REMAINING. If it would not finish with at
  least 5 min of margin, skip it or run a scoped subset, and record the
  reason in the note / final report.
- **Never sit idle waiting for a long process to finish.** If something is
  taking longer than expected and you're approaching the deadline,
  proactively decide to commit + report + exit rather than letting the
  hard timeout kill you with no commit.
"

# プロンプトをファイルに保存
echo "$USER_PROMPT" > "/tmp/agent-prompt-$ISSUE_NUMBER.txt"

# エンジン実装を読み込む（ISSUE_NUMBER 等が確定してから source する）
# shellcheck source=/dev/null
source "$ENGINE_FILE"

# 初期コメント投稿
echo "💬 Posting initial progress comment..."
PROGRESS_COMMENT_ID=$(gh api repos/$GITHUB_REPOSITORY/issues/$ISSUE_NUMBER/comments \
  -f body="🤖 **作業中...**" --jq '.id')

echo "Progress comment ID: $PROGRESS_COMMENT_ID"

# CI 環境でのエンジン認証設定（エンジン実装に委譲）
engine_setup_auth

# 共通の出力ファイル（エンジンはこれらに書き込む）
JSON_OUTPUT_FILE="/tmp/agent-output-$ISSUE_NUMBER.json"
PROGRESS_OUTPUT_FILE="/tmp/agent-progress-$ISSUE_NUMBER.txt"  # 進捗用（thinking + text）
RESULT_OUTPUT_FILE="/tmp/agent-result-$ISSUE_NUMBER.txt"      # 最終結果用（textのみ）
TASK_STATUS_FILE="/tmp/agent-tasks-$ISSUE_NUMBER.txt"         # タスク状態（常に最新）
# RUN_TIMEOUT_SECONDS / RUN_START_UNIX were computed earlier so they could be
# injected into the agent prompt; reuse them for the rest of the harness.
TIMEOUT_VALUE=$RUN_TIMEOUT_SECONDS

# 実行（エンジン実装に委譲）。バックグラウンドで起動し ENGINE_PID をセットする。
engine_run

# GitHub Actions URL を取得
ACTIONS_URL="https://github.com/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"

# 開始時刻を記録（agent に渡したものと同じ値）
START_TIME=$RUN_START_UNIX

# 進捗を定期的に更新（10秒ごと）
UPDATE_COUNT=0
while kill -0 $ENGINE_PID 2>/dev/null; do
  sleep 10
  UPDATE_COUNT=$((UPDATE_COUNT + 1))

  # 経過時間を計算（MM:SS形式）
  CURRENT_TIME=$(date +%s)
  ELAPSED_SECONDS=$((CURRENT_TIME - START_TIME))
  ELAPSED_MINUTES=$((ELAPSED_SECONDS / 60))
  ELAPSED_SECS=$((ELAPSED_SECONDS % 60))
  ELAPSED_TIME=$(printf "%d:%02d" $ELAPSED_MINUTES $ELAPSED_SECS)

  # 出力の最後の部分を取得（最大2000文字）
  CURRENT_OUTPUT=$(tail -c 2000 "$PROGRESS_OUTPUT_FILE" 2>/dev/null || echo "（出力待機中...）")

  # タスク状態を取得
  TASK_STATUS=""
  if [ -s "$TASK_STATUS_FILE" ]; then
    TASK_STATUS=$(cat "$TASK_STATUS_FILE")
  fi

  # GitHub Actionsログに進捗の最後20行を出力
  echo "========== Agent Progress (last 20 lines) =========="
  tail -20 "$PROGRESS_OUTPUT_FILE" 2>/dev/null || echo "（出力待機中...）"
  echo "====================================================="

  # コメントを更新（タスク状態はcode blockの外）
  echo "📝 Updating progress comment (update $UPDATE_COUNT, elapsed: $ELAPSED_TIME)..."

  # Build comment body
  COMMENT_BODY="🤖 **作業中...** ($ELAPSED_TIME)"

  # Add plan summary if exists (1-3 lines explaining the approach)
  PLAN_SUMMARY_FILE="/tmp/agent-plan-summary-$ISSUE_NUMBER.txt"
  if [ -f "$PLAN_SUMMARY_FILE" ]; then
    PLAN_SUMMARY=$(cat "$PLAN_SUMMARY_FILE")
    if [ -n "$PLAN_SUMMARY" ]; then
      COMMENT_BODY="${COMMENT_BODY}

${PLAN_SUMMARY}"
    fi
  fi

  # Add task status if exists (outside code block)
  if [ -n "$TASK_STATUS" ]; then
    COMMENT_BODY="${COMMENT_BODY}

${TASK_STATUS}"
  fi

  # Add output in code block
  COMMENT_BODY="${COMMENT_BODY}

~~~~~~~~~
${CURRENT_OUTPUT}
~~~~~~~~~

🔗 [View job details]($ACTIONS_URL)"

  gh api -X PATCH repos/$GITHUB_REPOSITORY/issues/comments/$PROGRESS_COMMENT_ID \
    -f body="$COMMENT_BODY" || echo "Warning: Failed to update comment"
done

# 完了後、最終結果を投稿
# `|| ENGINE_EXIT_CODE=$?` so a non-zero engine exit is captured for graceful
# handling below instead of tripping `set -e` / the ERR trap.
ENGINE_EXIT_CODE=0
wait $ENGINE_PID || ENGINE_EXIT_CODE=$?

echo "Engine finished with exit code: $ENGINE_EXIT_CODE"

# 最終結果を RESULT_OUTPUT_FILE に抽出（エンジン実装に委譲）
engine_extract_result

# 最終結果を投稿（text outputのみ、thinkingは除外）
CLAUDE_OUTPUT=$(cat "$RESULT_OUTPUT_FILE")

if [ $ENGINE_EXIT_CODE -eq 0 ]; then
  echo "✅ Task completed successfully"

  # 成功: 👀 リアクションを削除してから 👍 を追加
  REACTIONS_URL=""
  DELETE_URL_PREFIX=""

  if [ -n "$COMMENT_ID" ]; then
    # コメントへの返信の場合: コメントのリアクションを操作
    if [ "$EVENT_TYPE" = "issue_comment" ]; then
      REACTIONS_URL="repos/$GITHUB_REPOSITORY/issues/comments/$COMMENT_ID/reactions"
      DELETE_URL_PREFIX="repos/$GITHUB_REPOSITORY/issues/comments/$COMMENT_ID/reactions"
    elif [ "$EVENT_TYPE" = "pull_request_review_comment" ]; then
      REACTIONS_URL="repos/$GITHUB_REPOSITORY/pulls/comments/$COMMENT_ID/reactions"
      DELETE_URL_PREFIX="repos/$GITHUB_REPOSITORY/pulls/comments/$COMMENT_ID/reactions"
    elif [ "$EVENT_TYPE" = "pull_request_review" ]; then
      REACTIONS_URL="repos/$GITHUB_REPOSITORY/pulls/comments/$COMMENT_ID/reactions"
      DELETE_URL_PREFIX="repos/$GITHUB_REPOSITORY/pulls/comments/$COMMENT_ID/reactions"
    fi
  else
    # 新規 Issue/PR の場合: Issue/PR 自体のリアクションを操作
    if [[ "$EVENT_TYPE" == "issues" ]]; then
      REACTIONS_URL="repos/$GITHUB_REPOSITORY/issues/$ISSUE_NUMBER/reactions"
      DELETE_URL_PREFIX="repos/$GITHUB_REPOSITORY/issues/$ISSUE_NUMBER/reactions"
    elif [[ "$EVENT_TYPE" == "pull_request"* ]]; then
      REACTIONS_URL="repos/$GITHUB_REPOSITORY/issues/$ISSUE_NUMBER/reactions"
      DELETE_URL_PREFIX="repos/$GITHUB_REPOSITORY/issues/$ISSUE_NUMBER/reactions"
    fi
  fi

  if [ -n "$REACTIONS_URL" ]; then
    # 👀 リアクションを削除
    echo "Removing 👀 reaction from $REACTIONS_URL..."
    REACTIONS=$(gh api "$REACTIONS_URL" 2>/dev/null || echo "[]")
    echo "$REACTIONS" | jq -r '.[] | select(.content == "eyes") | .id' | while read REACTION_ID; do
      if [ -n "$REACTION_ID" ]; then
        echo "  Deleting reaction ID: $REACTION_ID"
        gh api -X DELETE "$DELETE_URL_PREFIX/$REACTION_ID" 2>/dev/null || echo "  Warning: Failed to delete reaction"
      fi
    done

    # 👍 リアクションを追加
    echo "Adding 👍 reaction..."
    gh api -X POST "$REACTIONS_URL" \
      -f content="+1" || echo "Warning: Failed to add reaction"
  fi

  # PR用のタイトルと本文をパース
  # 最終結果（RESULT_OUTPUT_FILE）から{{{{{pull-request-*...}}}}}を抽出
  PR_TITLE_RAW=""
  PR_BODY_RAW=""

  if [ -f "$RESULT_OUTPUT_FILE" ]; then
    # Extract pull-request-title block (between {{{{{pull-request-title and pull-request-title}}}}})
    PR_TITLE_RAW=$(sed -n '/{{{{{pull-request-title/,/pull-request-title}}}}}/p' "$RESULT_OUTPUT_FILE" | sed '1d;$d')
    # Extract pull-request-body block
    PR_BODY_RAW=$(sed -n '/{{{{{pull-request-body/,/pull-request-body}}}}}/p' "$RESULT_OUTPUT_FILE" | sed '1d;$d')
  fi

  # Create PR link only if both title and body are provided
  PR_LINK=""
  if [ -n "$PR_TITLE_RAW" ] && [ -n "$PR_BODY_RAW" ]; then
    # URL encode using jq
    PR_TITLE_ENCODED=$(printf "%s" "$PR_TITLE_RAW" | jq -sRr @uri)
    PR_BODY_ENCODED=$(printf "%s" "$PR_BODY_RAW" | jq -sRr @uri)
    PR_LINK=" | 📋 [Create Pull Request](https://github.com/$GITHUB_REPOSITORY/compare/main...$BRANCH_NAME?expand=1&title=$PR_TITLE_ENCODED&body=$PR_BODY_ENCODED)"
    echo "✅ PR metadata found - Create PR link will be included"
  else
    echo "ℹ️  No PR metadata found - Create PR link will be omitted"
  fi

  # コメント投稿用の出力を準備（PR metadataマーカーを削除）
  CLAUDE_OUTPUT_CLEAN=$(echo "$CLAUDE_OUTPUT" | sed '/{{{{{pull-request-title/,/pull-request-title}}}}}/d' | sed '/{{{{{pull-request-body/,/pull-request-body}}}}}/d')

  # Strip trailing blank/separator lines AND any branch-footer block the agent
  # may have written (`🌿 Branch:` / `📝 [View changes]` / `📋 [Create Pull
  # Request]`). The harness ALWAYS appends its canonical footer below, so any
  # agent-authored footer would duplicate. python is used because POSIX awk
  # regex on multibyte emoji is not portable.
  CLAUDE_OUTPUT_CLEAN=$(python3 - "$CLAUDE_OUTPUT_CLEAN" <<'PYEOF'
import sys, re
text = sys.argv[1]
lines = text.split('\n')
junk = re.compile(r'^\s*$|^---\s*$|^🌿\s*Branch:|^📝\s*\[View changes\]|^📋\s*\[Create Pull Request\]')
while lines and junk.match(lines[-1]):
    lines.pop()
sys.stdout.write('\n'.join(lines))
PYEOF
)

  # ===== 補助成果物(画像)の決定的処理 + ファイルリンク化（harness が担保。LLM 遵守に頼らない）=====
  # working ブランチに追加された画像バイナリは bot-artifacts へ移送し working から除去する
  # （main を汚さない）。レポート内の参照は後段で bot-artifacts のクリックリンクに書き換える。
  ARTIFACT_MAP=""   # "workingpath<TAB>boturl" の行
  IMG_FILES=$(git diff --numstat origin/main...HEAD 2>/dev/null \
    | awk -F'\t' '$1=="-" && $2=="-" {print $3}' \
    | grep -iE '\.(png|jpe?g|gif|webp|bmp|pdf)$' || true)
  if [ -n "$IMG_FILES" ]; then
    echo "🖼️ Relocating review image artifacts to bot-artifacts: $(echo "$IMG_FILES" | tr '\n' ' ')"
    BA_W="$(mktemp -d)/ba"
    if git fetch origin bot-artifacts 2>/dev/null; then
      git worktree add "$BA_W" bot-artifacts 2>/dev/null
    else
      git worktree add --detach "$BA_W" 2>/dev/null
      git -C "$BA_W" checkout --orphan bot-artifacts 2>/dev/null
      git -C "$BA_W" rm -rf . >/dev/null 2>&1 || true
    fi
    while IFS= read -r bf; do
      [ -z "$bf" ] || [ ! -f "$bf" ] && continue
      dest="issue-${ISSUE_NUMBER}/$(basename "$bf")"
      mkdir -p "$BA_W/$(dirname "$dest")"
      cp "$bf" "$BA_W/$dest"
      git -C "$BA_W" add "$dest"
      ARTIFACT_MAP="${ARTIFACT_MAP}${bf}	https://github.com/${GITHUB_REPOSITORY}/blob/bot-artifacts/${dest}
"
    done <<< "$IMG_FILES"
    if ! git -C "$BA_W" diff --cached --quiet 2>/dev/null; then
      git -C "$BA_W" commit -q -m "artifacts: issue-${ISSUE_NUMBER}" \
        && git -C "$BA_W" push -q origin bot-artifacts || echo "Warning: bot-artifacts push failed"
    fi
    git worktree remove --force "$BA_W" 2>/dev/null || true
    # working ブランチから画像を除去して push（main 汚染防止）
    while IFS= read -r bf; do [ -n "$bf" ] && git rm -q --ignore-unmatch "$bf" >/dev/null 2>&1 || true; done <<< "$IMG_FILES"
    if ! git diff --cached --quiet 2>/dev/null; then
      git commit -q -m "chore: move review image artifacts off $BRANCH_NAME to bot-artifacts"
      git push -q origin "$BRANCH_NAME" 2>/dev/null || echo "Warning: failed to push artifact cleanup"
    fi
  fi

  # 変更ファイル(画像除去後)の bare path を blob リンクに、artifact 参照を bot-artifacts リンクに、
  # 決定的に書き換える（コードフェンス内・既存リンクは触らない。inline ![]() は []() に変換）。
  CHANGED_FILES=$(git diff --name-only --diff-filter=d origin/main...HEAD 2>/dev/null || true)
  if command -v python3 >/dev/null 2>&1 && { [ -n "$CHANGED_FILES" ] || [ -n "$ARTIFACT_MAP" ]; }; then
    LINKIFIED=$(REPO="$GITHUB_REPOSITORY" BRANCH="$BRANCH_NAME" CHANGED="$CHANGED_FILES" ARTIFACTS="$ARTIFACT_MAP" \
      python3 - "$CLAUDE_OUTPUT_CLEAN" <<'PYEOF'
import os, re, sys
repo = os.environ["REPO"]; branch = os.environ["BRANCH"]
changed = [f for f in os.environ.get("CHANGED", "").splitlines() if f.strip()]
artifacts = {}
for line in os.environ.get("ARTIFACTS", "").splitlines():
    if "\t" in line:
        p, u = line.split("\t", 1)
        artifacts[p.strip()] = u.strip()
text = sys.argv[1]
parts = re.split(r'(```.*?```)', text, flags=re.S)  # コードフェンスは触らない
def rewrite(seg):
    # 1) 画像 artifact の参照 → bot-artifacts のクリックリンク（inline ![] は [] に変換）
    for p, u in sorted(artifacts.items(), key=lambda kv: len(kv[0]), reverse=True):
        base = os.path.basename(p)
        seg = re.sub(r'!?\[([^\]]*)\]\([^)]*' + re.escape(p) + r'[^)]*\)',
                     lambda m: "[%s](%s)" % (m.group(1) or base, u), seg)
        seg = re.sub(r'`' + re.escape(p) + r'`', "[%s](%s)" % (base, u), seg)
        seg = re.sub(r'(?<![\[`/\w.-])' + re.escape(p) + r'(?!\]\()(?![\w/.-])',
                     "[%s](%s)" % (base, u), seg)
    # 2) 通常の変更ファイル → blob リンク
    for f in sorted(changed, key=len, reverse=True):
        url = "https://github.com/%s/blob/%s/%s" % (repo, branch, f)
        link = "[%s](%s)" % (f, url)
        seg = re.sub(r'`' + re.escape(f) + r'`', link, seg)
        seg = re.sub(r'(?<![\[`/\w.-])' + re.escape(f) + r'(?!\]\()(?![\w/.-])', link, seg)
    return seg
sys.stdout.write(''.join(p if p.startswith('```') else rewrite(p) for p in parts))
PYEOF
)
    if [ -n "$LINKIFIED" ]; then CLAUDE_OUTPUT_CLEAN="$LINKIFIED"; fi
  fi

  # Safety net: if image artifacts were moved to bot-artifacts but the
  # rewritten report contains no clickable links to them (the agent forgot
  # to mention individual paths), auto-append a Screenshots section so the
  # user is not left without access. Per-image visual diff explanations are
  # the agent's job — this only guarantees the links are present.
  if [ -n "$ARTIFACT_MAP" ] && \
     ! printf '%s' "$CLAUDE_OUTPUT_CLEAN" | grep -q "bot-artifacts/issue-${ISSUE_NUMBER}/"; then
    echo "🖼️ Agent did not link any artifact; appending Screenshots safety-net section."
    SCREENSHOTS_BLOCK=$(printf '%s' "$ARTIFACT_MAP" | awk -F'\t' 'NF==2 {
      n=split($1, parts, "/"); base=parts[n];
      printf("- [%s](%s)\n", base, $2);
    }')
    if [ -n "$SCREENSHOTS_BLOCK" ]; then
      CLAUDE_OUTPUT_CLEAN="${CLAUDE_OUTPUT_CLEAN}

### Screenshots
${SCREENSHOTS_BLOCK}"
    fi
  fi

  # 最終結果を投稿（ブランチ情報付き）
  gh api -X PATCH repos/$GITHUB_REPOSITORY/issues/comments/$PROGRESS_COMMENT_ID \
    -f body="$CLAUDE_OUTPUT_CLEAN

---

🌿 Branch: \`$BRANCH_NAME\`
📝 [View changes](https://github.com/$GITHUB_REPOSITORY/compare/main...$BRANCH_NAME)$PR_LINK"
else
  echo "❌ Task failed with exit code $ENGINE_EXIT_CODE"

  # エラー詳細はエンジン実装が生成する
  ERROR_DETAILS="$(engine_error_details)"
  TIMEOUT_MINUTES=$((TIMEOUT_VALUE / 60))

  # =========================================================================
  # POST ERROR REPORT TO GITHUB
  # =========================================================================
  gh api -X PATCH repos/$GITHUB_REPOSITORY/issues/comments/$PROGRESS_COMMENT_ID \
    -f body="$ERROR_DETAILS

---

**Debug Information:**
- **Engine:** \`$ENGINE\`
- **Exit Code:** \`$ENGINE_EXIT_CODE\`
- **Timeout:** ${TIMEOUT_VALUE}s (${TIMEOUT_MINUTES:-N/A} minutes)
- **Branch:** \`$BRANCH_NAME\`
- **Workflow Run:** [View logs](https://github.com/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID)

<details>
<summary>📋 Full output (last 200 lines - click to expand)</summary>

\`\`\`
$(tail -n 200 "$PROGRESS_OUTPUT_FILE" 2>/dev/null || tail -n 200 "$JSON_OUTPUT_FILE" 2>/dev/null || echo "No output available")
\`\`\`

</details>"

  exit $ENGINE_EXIT_CODE
fi

echo "🎉 Coding Robot finished!"
