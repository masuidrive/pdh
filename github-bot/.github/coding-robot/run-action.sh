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
🤖 [Coding Robot](https://github.com/masuidrive/pdh/tree/main/github-bot)" || true
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
# トリガーの出どころを正しく取る 2 つ（event 別の API / PR の出自）。承認判定とは無関係。
source "$SCRIPT_DIR/trigger-source.sh"
TRUSTED_LINKED_ISSUE=""
TRUSTED_PR_BRANCH=""
TRIGGER_ERROR=""

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

# The exported key names appear in the prompt; never print their values.
# The list describes runner controls and exported keys, not the whole environment.
ENV_JSON_KEY_LINES=""
if [ -n "${ENV_JSON:-}" ]; then
  if printf '%s' "$ENV_JSON" | jq -e . >/dev/null 2>&1; then
    while IFS= read -r _env_key; do
      [ -n "$_env_key" ] || continue
      _env_val="$(printf '%s' "$ENV_JSON" | jq -r --arg k "$_env_key" '.[$k]')"
      echo "::add-mask::$_env_val"
      export "$_env_key=$_env_val"
      echo "🔑 ENV_JSON: exported $_env_key"
      ENV_JSON_KEY_LINES="$ENV_JSON_KEY_LINES
- $_env_key"
    done < <(printf '%s' "$ENV_JSON" | jq -r 'keys[]')
    unset _env_key _env_val
  else
    echo "⚠️  ENV_JSON is set but is not valid JSON; skipping."
  fi
fi

if [ -n "$ENV_JSON_KEY_LINES" ]; then
  ENV_JSON_KEYS_SECTION="
Also exported for you from this repository's ENV_JSON secret (names only — the
values are set in your environment and masked in logs; read them as \$NAME, and
never echo, log, or commit a value):$ENV_JSON_KEY_LINES"
else
  ENV_JSON_KEYS_SECTION="
This repository set no ENV_JSON secret, so no project keys were exported by the
runner. Other variables may still be present from the devcontainer or image."
fi

echo "🤖 Coding Robot starting..."

# 現在のディレクトリを表示
echo "📁 Current directory: $(pwd)"
echo "📁 Contents:"
ls -la

# worktree の .git file も受け付ける。workflow と同じ workspace を既定にする。
if [ ! -e .git ]; then
  cd "${CODING_ROBOT_WORKSPACE:-/workspaces/project}"
fi
[ -e .git ] || { echo "Cannot find git repository" >&2; exit 1; }

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
git config --global --add safe.directory "$(pwd)"
git config --global user.name "github-actions[bot]"
git config --global user.email "github-actions[bot]@users.noreply.github.com"

# 最新の状態を取得
git fetch origin
BASE_BRANCH="${GITHUB_BASE_REF:-$(gh repo view "$GITHUB_REPOSITORY" --json defaultBranchRef --jq .defaultBranchRef.name)}"
CI_WORKFLOW="${CODING_ROBOT_CI_WORKFLOW:-ci.yml}"

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

# PR head SHA に対する直近の CI run を引き、失敗していれば
# 失敗サマリ + 生ログ末尾を返す（成功 / 実行中 / run 無し なら空文字）。head SHA で引くのは、
# agent がこの後 origin/$BASE_BRANCH を merge して push し直す前の「ユーザが 🤖 を押した時点で見えて
# いた失敗 run」を確実に捕まえるため。全文ログは prompt に入れず、agent が run id 経由で
# `gh run view <id> --log-failed` で自前取得できるよう run id と取得手段を併記する。
#
# ログ抽出の設計（実ログ観測に基づく）: `--log-failed` の末尾は job teardown の
# postgres service ログ (`... UTC [NNN] ERROR: duplicate key ...` = idempotency テストが
# 意図的に出す期待ログ。失敗ではない) で埋まり、tail だけだと肝心の失敗サマリ
# (`FAILED ...` / `Passed: N / M`) がノイズに押し出される。そこで失敗 signal 行を grep で
# 抽出して <ci-failure-summary> として先頭に置き、生ログは末尾 400 行だけを併記する。
build_ci_section() {
  local branch="$1" head_sha="$2"
  local run_id conclusion raw summary tail_block summary_block
  run_id=$(gh run list --repo "$GITHUB_REPOSITORY" --workflow "$CI_WORKFLOW" \
    --branch "$branch" --json databaseId,headSha,status --limit 30 2>/dev/null \
    | jq -r --arg sha "$head_sha" \
        'map(select(.headSha == $sha and .status == "completed")) | .[0].databaseId // empty' 2>/dev/null \
    || true)
  [ -n "$run_id" ] || return 0
  conclusion=$(gh run view "$run_id" --repo "$GITHUB_REPOSITORY" --json conclusion --jq '.conclusion' 2>/dev/null || echo "")
  # success / 取得不能 は注入しない（失敗時のみ context に出す）
  [ -n "$conclusion" ] && [ "$conclusion" != "success" ] || return 0
  # 生ログを取得し、各行頭の `<job>\t<step>\t<ISO timestamp> ` prefix を除去して圧縮する。
  raw=$(gh run view "$run_id" --repo "$GITHUB_REPOSITORY" --log-failed 2>/dev/null \
    | sed -E 's/^[^\t]*\t[^\t]*\t[0-9T:.Z-]+ //')
  # 失敗 signal 行を抽出（postgres service ログ `UTC [NNN]` は除外）。
  summary=$(printf '%s\n' "$raw" \
    | grep -iE 'FAILED |[0-9]+ failed|Passed: [0-9]+ ?/|short test summary|AssertionError|Traceback|expect\(|error TS[0-9]|npm ERR!|✘|^FAIL ' \
    | grep -vE 'UTC \[[0-9]+\]' | head -n 200 || true)
  tail_block=$(printf '%s\n' "$raw" | tail -n 400)
  summary_block=""
  [ -n "$summary" ] && summary_block="
<ci-failure-summary>
$summary
</ci-failure-summary>
"
  cat <<EOF

---

# 🔴 CI on this PR head: \`$conclusion\`

最後に push された PR head (\`${head_sha:0:7}\`) に対する CI ($CI_WORKFLOW)
が **$conclusion** で終わっています。ユーザの依頼に着手する前に、まずこの失敗を再現・修正することを
最優先してください。

- Run id: \`$run_id\`
- **全文ログは自分で取得できる**: \`gh run view $run_id --repo $GITHUB_REPOSITORY --log-failed\`
  （diff は \`git diff origin/$BASE_BRANCH...HEAD\` で自分で取得すること）

下記は失敗ステップのログから抽出した **失敗サマリ** と、生ログの**末尾 400 行**です
（行頭の job/step/timestamp prefix は除去済み。postgres の期待 ERROR ログは summary から除外）。
${summary_block}
<ci-failed-log-tail lines="400">
$tail_block
</ci-failed-log-tail>
EOF
}

if [ "$IS_PR" = true ]; then
  # ⚠ PR の出自を fail-closed で検査する。これが無いと、同じ repo の無関係な PR に 🤖 と
  # 書くだけで、write token を持つ agent がその head branch を checkout して起動する。
  if ! validate_pr_context "$GITHUB_REPOSITORY" "$ISSUE_NUMBER"; then
    echo "⛔ Untrusted PR context: $TRIGGER_ERROR"
    # 出自の拒否は障害ではない。理由をコメントし、報告済みとして exit 0 にする。
    gh issue comment "$ISSUE_NUMBER" --repo "$GITHUB_REPOSITORY" --body "$(printf '%s\n\n%s\n\n%s' \
      "**この PR では動きません**（${TRIGGER_ERROR}）。" \
      "Coding Robot が触れるのは、自分が作った \`agent/issue-<番号>\` branch の PR だけです。依頼は元の Issue に 🤖 付きでコメントしてください。" \
      "<!-- coding-robot -->")" >/dev/null 2>&1 \
      || echo "Warning: failed to post the refusal note"
    : > "${GITHUB_WORKSPACE:-.}/.coding-robot-reported" 2>/dev/null || true
    exit 0
  fi
  # PR の場合
  PR_DATA=$(gh pr view $ISSUE_NUMBER \
    --json title,body,comments,headRefName,headRefOid,labels \
    --repo $GITHUB_REPOSITORY)

  ISSUE_TITLE=$(echo "$PR_DATA" | jq -r '.title')
  ISSUE_BODY=$(echo "$PR_DATA" | jq -r '.body // ""')
  ISSUE_LABELS=$(echo "$PR_DATA" | jq -r '[.labels[].name] | join(", ")')

  # PR の場合: head ブランチ名を取得
  BRANCH_NAME=$(echo "$PR_DATA" | jq -r '.headRefName')
  HEAD_SHA=$(echo "$PR_DATA" | jq -r '.headRefOid')
  echo "📌 PR head branch: $BRANCH_NAME ($HEAD_SHA)"

  git checkout "$BRANCH_NAME"
  git pull origin "$BRANCH_NAME" || true

  # PR diff取得
  PR_DIFF=$(gh pr diff $ISSUE_NUMBER --repo $GITHUB_REPOSITORY | head -1000 || echo "")

  # PR head に対する直近 CI (test-all) が失敗していれば失敗ログ末尾を context に注入する。
  CI_SECTION="$(build_ci_section "$BRANCH_NAME" "$HEAD_SHA")"
  # 観測用: 注入有無を workflow ログに残す（内容は出さず長さのみ）。0 bytes = 失敗 CI 無し。
  echo "🔎 build_ci_section: ${#CI_SECTION} bytes injected for $BRANCH_NAME @ ${HEAD_SHA:0:7}"

else
  # Issue の場合
  ISSUE_DATA=$(gh issue view $ISSUE_NUMBER \
    --json title,body,comments,labels \
    --repo $GITHUB_REPOSITORY)

  ISSUE_TITLE=$(echo "$ISSUE_DATA" | jq -r '.title')
  ISSUE_BODY=$(echo "$ISSUE_DATA" | jq -r '.body // ""')
  # ⚠ ラベルを prompt へ渡す。«どの入口から来た依頼か» はラベルにしか出ない。
  # Issue フォーム（.github/ISSUE_TEMPLATE/）は作成時にラベルを付けるが、`gh issue create` は
  # テンプレートを素通りするので付かない。bot はこの差で «repo を知らない人からの依頼» と
  # «書き慣れた人からの依頼» を見分ける（判定材料は metadata であって、人が書いた文ではない）。
  ISSUE_LABELS=$(echo "$ISSUE_DATA" | jq -r '[.labels[].name] | join(", ")')

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
  CI_SECTION=""
fi

# REST API で全コメント取得（数値 ID 付き。COMMENT_ID とのマッチングに必要）
ALL_COMMENTS_JSON=$(gh api repos/$GITHUB_REPOSITORY/issues/$ISSUE_NUMBER/comments --paginate \
  --jq '[.[] | {id: .id, login: .user.login, body: .body}]' 2>/dev/null || echo '[]')

# PR の場合、対応する issue (head ブランチ agent/issue-<N>) のコメントも会話履歴に含める。
# AC 議論など PR 以前の文脈は issue 側に残っているため、PR スレッドだけだと欠落する。
# issue コメントを時系列で前に、PR コメントを後ろに連結する（GitHub のコメント ID は
# グローバル一意なので両者を混ぜても COMMENT_ID マッチングは壊れない）。
if [ "$IS_PR" = true ]; then
  LINKED_ISSUE_NUMBER=$(printf '%s' "$BRANCH_NAME" | sed -n 's#^agent/issue-\([0-9]\{1,\}\)$#\1#p')
  if [ -n "$LINKED_ISSUE_NUMBER" ] && [ "$LINKED_ISSUE_NUMBER" != "$ISSUE_NUMBER" ]; then
    LINKED_ISSUE_COMMENTS_JSON=$(gh api repos/$GITHUB_REPOSITORY/issues/$LINKED_ISSUE_NUMBER/comments --paginate \
      --jq '[.[] | {id: .id, login: .user.login, body: .body}]' 2>/dev/null || echo '[]')
    ALL_COMMENTS_JSON=$(jq -n \
      --argjson issue "$LINKED_ISSUE_COMMENTS_JSON" \
      --argjson pr "$ALL_COMMENTS_JSON" \
      '$issue + $pr' 2>/dev/null || echo "$ALL_COMMENTS_JSON")
    echo "🧵 Merged $(echo "$LINKED_ISSUE_COMMENTS_JSON" | jq 'length') comment(s) from linked issue #$LINKED_ISSUE_NUMBER"
  fi
fi


# === コメントの構造化: トリガーコメント vs 過去ログ ===
# COMMENT_ID が設定されている場合、そのコメントがトリガー（＝ユーザの指示）
# それ以外のコメントは過去の会話ログとして参考情報扱い

if [ -n "$COMMENT_ID" ]; then
  # トリガーコメントの本文を直接取得（GitHub API、1回で body + login 両方取得）
  # ⚠ event ごとに正しい API を叩く。review と review comment は issues comments collection に
  # «存在しない» ので、/issues/comments/ だけだと本文が空になりユーザの依頼が失われる。
  TRIGGER_DATA=$(fetch_trigger_context "$EVENT_TYPE" "$GITHUB_REPOSITORY" "$ISSUE_NUMBER" "$COMMENT_ID" 2>/dev/null || echo '{}')
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
echo "🔀 Merging origin/$BASE_BRANCH into $BRANCH_NAME..."
MERGE_OUTPUT=$(git merge origin/$BASE_BRANCH --no-edit 2>&1) || MERGE_EXIT_CODE=$?
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
2. Understand both changes (current branch vs $BASE_BRANCH)
3. Resolve conflicts by editing files (remove conflict markers <<<<<<, =======, >>>>>>>)
4. Stage resolved files: \`git add <file>\`
5. Commit the merge: \`git commit -m \"Merge $BASE_BRANCH into $BRANCH_NAME\"\`
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
# ⚠ 本文だけでなく全コメントを走査する。以前は本文だけで、コメントに貼られた画像は
# engine に届かなかった（非画像の添付は本文 + 全コメントを走査していたのに、画像だけ非対称）。
# «違う» と言うために依頼者が注記つきのスクショを返しても、bot はそれを見ずに進んでいた。
ORIGINAL_IMAGE_URLS=$(printf '%s\n%s\n' "$ISSUE_BODY" "$(printf '%s' "$ALL_COMMENTS_JSON" | jq -r '.[].body // empty' 2>/dev/null)" | \
  grep -oE '(https?://[^)"\s]+\.(png|jpg|jpeg|gif|webp|svg))|(https?://github\.com/user-attachments/assets/[^)"\s]+)|(https?://user-images\.githubusercontent\.com/[^)"\s]+)' | \
  sort -u)

# GraphQL API を使って bodyHTML を取得（JWT付きの実際の画像URLを含む）
if [ "$IS_PR" = true ]; then
  BODY_HTML=$(gh api graphql -f query="
    query {
      repository(owner: \"$(echo $GITHUB_REPOSITORY | cut -d/ -f1)\", name: \"$(echo $GITHUB_REPOSITORY | cut -d/ -f2)\") {
        pullRequest(number: $ISSUE_NUMBER) {
          bodyHTML
          comments(last: 50) { nodes { bodyHTML } }
        }
      }
    }
  " --jq '[.data.repository.pullRequest.bodyHTML] + [.data.repository.pullRequest.comments.nodes[].bodyHTML] | join("\n")' 2>/dev/null || echo "")
else
  BODY_HTML=$(gh api graphql -f query="
    query {
      repository(owner: \"$(echo $GITHUB_REPOSITORY | cut -d/ -f1)\", name: \"$(echo $GITHUB_REPOSITORY | cut -d/ -f2)\") {
        issue(number: $ISSUE_NUMBER) {
          bodyHTML
          comments(last: 50) { nodes { bodyHTML } }
        }
      }
    }
  " --jq '[.data.repository.issue.bodyHTML] + [.data.repository.issue.comments.nodes[].bodyHTML] | join("\n")' 2>/dev/null || echo "")
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

# 添付ファイル(非画像: PDF / .txt / .csv / ログ等)を抽出してダウンロード。
# 画像と違い user-attachments/files/ は bodyHTML でも署名されず、Actions の
# installation token (secrets.GITHUB_TOKEN) では private repo で 404 になる
# (既知制約)。そのため classic PAT (repo scope) の ATTACHMENTS_TOKEN を使う。
# ファイル添付の URL は markdown 本文/コメントに生のまま入っているので、bodyHTML を
# 経由せず本文 + 全コメントから直接抽出する。GitHub は添付ファイル名を ASCII
# ([A-Za-z0-9._-]) にサニタイズするため、抽出 regex はそれで十分。
echo "📎 Checking for attached files..."
FILE_DIR="/tmp/issue-${ISSUE_NUMBER}-files"
mkdir -p "$FILE_DIR"

ATTACH_TOKEN="${ATTACHMENTS_TOKEN:-$GITHUB_TOKEN}"
if [ -z "${ATTACHMENTS_TOKEN:-}" ]; then
  echo "⚠️  ATTACHMENTS_TOKEN is not set; falling back to GITHUB_TOKEN."
  echo "    Private-repo file attachments (user-attachments/files/) return 404 with"
  echo "    the Actions installation token, so downloads below will likely be skipped."
  echo "    Set a classic PAT (repo scope): gh secret set ATTACHMENTS_TOKEN --body '<pat>'"
fi

# 本文 + 全コメントの markdown から user-attachments/files/ URL を抽出（重複排除）。
# 末尾 sort -u で pipeline exit を 0 に保ち set -e に引っかからないようにする。
FILE_URLS=$( { printf '%s\n' "$ISSUE_BODY"; echo "$ALL_COMMENTS_JSON" | jq -r '.[].body // ""'; } \
  | grep -oE 'https://github\.com/user-attachments/files/[0-9]+/[A-Za-z0-9._-]+' \
  | sort -u )

FILE_COUNT=0
FILE_LIST=""
while IFS= read -r furl; do
  [ -n "$furl" ] || continue
  fname=$(basename "$furl")
  FILE_COUNT=$((FILE_COUNT + 1))
  dest="$FILE_DIR/${FILE_COUNT}-${fname}"
  echo "  - Downloading: $furl"
  http_code=$(curl -sL -H "Authorization: Bearer $ATTACH_TOKEN" -w '%{http_code}' -o "$dest" "$furl" 2>/dev/null || echo "000")
  if [ "$http_code" = "200" ] && [ -s "$dest" ]; then
    sz=$(wc -c < "$dest" | tr -d ' ')
    FILE_LIST="$FILE_LIST
- $dest (source: $furl, ${sz} bytes)"
    echo "    ✓ Saved to: $dest (${sz} bytes)"
  else
    echo "    ✗ Failed (HTTP $http_code) — token lacks access, or the file was removed"
    rm -f "$dest"
    FILE_COUNT=$((FILE_COUNT - 1))
  fi
done <<< "$FILE_URLS"

FILES_SECTION=""
if [ $FILE_COUNT -gt 0 ]; then
  echo "✅ Downloaded $FILE_COUNT file attachment(s)"
  FILES_SECTION="

---

# 📎 Attached Files

**IMPORTANT**: The user attached $FILE_COUNT non-image file(s) (e.g. PDF, .txt, .csv, logs) to this Issue/PR.

## File Paths:
$FILE_LIST

## Instructions:
1. These files are already downloaded to the local filesystem at the paths above.
2. Read / parse each one as needed: the Read tool handles text and PDF; for PDFs you
   may also run project tooling (e.g. the extract pipeline) directly on the file path.
3. Use their contents to fulfill the user's request — do not claim a file is
   inaccessible; it is on disk at the path shown.
"
elif [ -n "$FILE_URLS" ]; then
  echo "ℹ️ File attachment URLs were present but none could be downloaded."
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

# _github-issue.md も prompt に連結し、コメントの規則を必ず届ける。
if [ -f product-brief.md ] && [ -d tickets ]; then
  append_prompt "$SCRIPT_DIR/_pdh.md"
  append_prompt "$SCRIPT_DIR/_github-issue.md"
fi

# Deadline awareness: tell the agent how much wall-clock budget it has.
# Must be computed BEFORE the prompt is built so it can be injected.
RUN_TIMEOUT_SECONDS=${CLAUDE_TIMEOUT:-5400}
# 値を検証する。空や非数値のまま timeout へ渡すと、時間の枠が黙って壊れる。
case "$RUN_TIMEOUT_SECONDS" in ''|*[!0-9]*) echo "❌ CLAUDE_TIMEOUT must be an integer"; exit 1 ;; esac
[ "$RUN_TIMEOUT_SECONDS" -ge 60 ] && [ "$RUN_TIMEOUT_SECONDS" -le 86400 ] || { echo "❌ CLAUDE_TIMEOUT must be between 60 and 86400 seconds"; exit 1; }
RUN_START_UNIX=$(date +%s)
RUN_DEADLINE_UNIX=$((RUN_START_UNIX + RUN_TIMEOUT_SECONDS))

# 環境を先に調べ、認証・ブラウザなどの実行可否を prompt に渡す。
ENVIRONMENT_SECTION=""
{
  _browser="無し"
  if command -v agent-browser >/dev/null 2>&1; then _browser="agent-browser が使える"
  elif [ -d "$HOME/.cache/ms-playwright" ]; then _browser="Playwright の chromium が使える"; fi
  _keys=""
  for k in OPENAI_API_KEY ANTHROPIC_API_KEY GEMINI_API_KEY XAI_API_KEY; do
    if [ -n "$(eval printf '%s' "\${$k:-}")" ]; then _keys="$_keys $k"; fi
  done
  [ -n "$_keys" ] || _keys=" （1 つも無い）"
  _pat="無し（PR の CI が承認待ちで止まる）"
  [ -n "${ATTACHMENTS_TOKEN:-}" ] && _pat="有り"
  ENVIRONMENT_SECTION="
<environment>
この run で使えるもの（走り出す前に調べた値である。⚠ **これを前提に計画を立てること。**
**脇の確認に足りないものがあるだけなら、途中で止まらずに «回せない» と書いて先へ進む**。
⚠ **ただし «この依頼が直ったことを示す核心の確認» が回せないなら、進まずに止まる** —
Incomplete のテンプレで category `blocker` として、何が無くて何を確かめられないかを書く。
⚠ **確かめずに «直りました» と報告しない。**）:

- ブラウザ: $_browser
- provider の鍵:$_keys
- ATTACHMENTS_TOKEN: $_pat
</environment>"
} 2>/dev/null || true

# ユーザプロンプト構築（システムプロンプトは --system-prompt で渡す）
USER_PROMPT="<current-request>
$USER_REQUEST
</current-request>

<context>
**Type**: $EVENT_TYPE
**Number**: #$ISSUE_NUMBER
**Title**: $ISSUE_TITLE
**Labels**: ${ISSUE_LABELS:-(none)}

<description>
$ISSUE_BODY
</description>

<conversation-history>
$CONVERSATION_HISTORY_NOTE
</conversation-history>
</context>$ENVIRONMENT_SECTION"

if [ -n "$PR_DIFF" ]; then
  USER_PROMPT="$USER_PROMPT

## PR Diff (first 1000 lines)
\`\`\`
$PR_DIFF
\`\`\`"
fi

USER_PROMPT="$USER_PROMPT
$CONFLICT_SECTION
$CI_SECTION
$IMAGES_SECTION
$FILES_SECTION

---

# Your Working Branch

**Branch**: \`$BRANCH_NAME\`
**GitHub Comparison**: https://github.com/$GITHUB_REPOSITORY/compare/$BASE_BRANCH...$BRANCH_NAME

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
$ENV_JSON_KEYS_SECTION

⚠ **This section is not an inventory of your environment.** It lists what this
runner sets. The devcontainer image, \`.env\`, and the repository add more that
never appear here. Before you report a variable, credential, or tool as missing
— and especially before you stop as a blocker over one — **measure it**:

\`\`\`bash
[ -n \"\${THE_VAR_YOU_NEED:-}\" ] && echo present || echo absent
env | sed -n 's/^\([A-Z0-9_]*\)=.*/\1/p' | sort   # names only; never print values
\`\`\`

\"It is not in the list above\" is not evidence of absence, and a run that stops
on it burns a turn and hands the reader a task they did not need to do.

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
- **There is no reserve. Work until the deadline.** Do not stop early to
  keep a margin for yourself. Budget left unspent is budget wasted.
- **Because there is no reserve, commit and push after every completed unit
  of work** — one fix, one test that passes, one review round written into
  the note. SIGKILL then costs you the unit in flight, not the run. ⚠ **Never
  hold finished work in the worktree while you start the next thing.** This
  bullet is what makes a zero reserve safe; without it a hard kill loses
  everything, which is why the reserve existed.
- **Keep \`/tmp/agent-result.md\` written as you go**, not at the end.
  Refresh it whenever the done / not-done / next-steps picture changes, so a
  hard kill still leaves a usable report behind instead of silence.
- **Before any potentially long-running command** (\`scripts/test-all.sh\`,
  full pytest, full vitest, large dependency install, etc.) compare its
  expected runtime against \$REMAINING. If it would not finish before the
  deadline, run a scoped subset instead — the point is to spend the
  remaining time on something that completes, not to idle into the kill.
  Record what you scoped down and why in the note / final report.
- **Never sit idle waiting for a long process to finish.** If something runs
  longer than expected, spend the wait on work you can commit, and keep the
  report current. ⚠ **Do not exit early just because the deadline is near** —
  exit early only when the request is done, or when you are blocked and have
  said so.
"

# プロンプトをファイルに保存
echo "$USER_PROMPT" > "/tmp/agent-prompt-$ISSUE_NUMBER.txt"

# gh の既定は GITHUB_TOKEN（bot 名義）。PAT は push と PR 作成だけに局所指定する。
export GH_TOKEN="$GITHUB_TOKEN"

source "$ENGINE_FILE"

# 初期コメント投稿
echo "💬 Posting initial progress comment..."
PROGRESS_COMMENT_ID=$(gh api repos/$GITHUB_REPOSITORY/issues/$ISSUE_NUMBER/comments \
  -f body="🤖 **作業中...**" --jq '.id')

echo "Progress comment ID: $PROGRESS_COMMENT_ID"

# CI 環境でのエンジン認証設定（エンジン実装に委譲）
engine_setup_auth

# 選んだ engine と別の worker にも認証を用意する。
# CODEX_AUTH_JSON があれば auth.json を用意する。値はログへ出さず umask 077 で書く。
if [ -n "${CODEX_AUTH_JSON:-}" ] && [ ! -f "$HOME/.codex/auth.json" ]; then
  if printf '%s' "$CODEX_AUTH_JSON" | jq -e . >/dev/null 2>&1; then
    mkdir -p "$HOME/.codex"
    chmod 700 "$HOME/.codex"
    ( umask 077; printf '%s' "$CODEX_AUTH_JSON" | jq -c . > "$HOME/.codex/auth.json" )
    chmod 600 "$HOME/.codex/auth.json"
    echo "🔑 委譲先の codex 用に $HOME/.codex/auth.json を用意した ($(wc -c < "$HOME/.codex/auth.json") bytes)"
  else
    echo "⚠️  CODEX_AUTH_JSON が JSON として読めない（jq -c で minify したか）— codex worker は OPENAI_API_KEY に頼る"
  fi
fi

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

# engine 起動直後に待ち印を外す。終了後だけでは、run 中も人の番と表示される。
if [ -f "$SCRIPT_DIR/pdh-hooks.sh" ] && [ -f product-brief.md ] && [ -d tickets ]; then
  bash "$SCRIPT_DIR/pdh-hooks.sh" start "${TRUSTED_LINKED_ISSUE:-$ISSUE_NUMBER}" "$BRANCH_NAME" || true
fi

# GitHub Actions URL を取得
ACTIONS_URL="https://github.com/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"

# 開始時刻を記録（agent に渡したものと同じ値）
START_TIME=$RUN_START_UNIX

# 生存確認は 10 秒、進捗コメントの PATCH は既定 60 秒ごとにする。
PROGRESS_UPDATE_INTERVAL=${PROGRESS_UPDATE_INTERVAL:-60}
case "$PROGRESS_UPDATE_INTERVAL" in ''|*[!0-9]*) echo "❌ PROGRESS_UPDATE_INTERVAL must be an integer"; exit 1 ;; esac
[ "$PROGRESS_UPDATE_INTERVAL" -ge 10 ] || { echo "❌ PROGRESS_UPDATE_INTERVAL must be >= 10 seconds"; exit 1; }

UPDATE_COUNT=0
LAST_UPDATE_AT=0
while kill -0 $ENGINE_PID 2>/dev/null; do
  sleep 10
  NOW_UNIX=$(date +%s)
  [ $((NOW_UNIX - LAST_UPDATE_AT)) -ge "$PROGRESS_UPDATE_INTERVAL" ] || continue
  LAST_UPDATE_AT=$NOW_UNIX
  UPDATE_COUNT=$((UPDATE_COUNT + 1))

  # 経過時間を計算（MM:SS形式）
  CURRENT_TIME=$(date +%s)
  ELAPSED_SECONDS=$((CURRENT_TIME - START_TIME))
  ELAPSED_MINUTES=$((ELAPSED_SECONDS / 60))
  ELAPSED_SECS=$((ELAPSED_SECONDS % 60))
  ELAPSED_TIME=$(printf "%d:%02d" $ELAPSED_MINUTES $ELAPSED_SECS)

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

  # PDH 側パッチ: AC の進み具合を計画要約の直後に出す（github-bot/pdh-hooks.sh。PDH mode のみ）。
  # ⚠ AC の本当の状態は ticket.md にあるので、そこから読む。API は呼ばない。
  if [ -f "$SCRIPT_DIR/pdh-hooks.sh" ] && [ -f product-brief.md ] && [ -d tickets ]; then
    AC_BLOCK=$(bash "$SCRIPT_DIR/pdh-hooks.sh" progress "${TRUSTED_LINKED_ISSUE:-$ISSUE_NUMBER}" 2>/dev/null || true)
    if [ -n "$AC_BLOCK" ]; then
      COMMENT_BODY="${COMMENT_BODY}

${AC_BLOCK}"
    fi
  fi

  # Add task status if exists (outside code block)
  if [ -n "$TASK_STATUS" ]; then
    COMMENT_BODY="${COMMENT_BODY}

${TASK_STATUS}"
  fi

  # agent の出力（ログの末尾）は作業中コメントに貼らない。Actions のログへのリンクを出す。
  COMMENT_BODY="${COMMENT_BODY}

🔗 [View job details]($ACTIONS_URL)"

  gh api -X PATCH repos/$GITHUB_REPOSITORY/issues/comments/$PROGRESS_COMMENT_ID \
    -f body="$COMMENT_BODY" || echo "Warning: Failed to update comment"
done

# 完了後、最終結果を投稿
# `|| ENGINE_EXIT_CODE=$?` so a non-zero engine exit is captured for graceful
# handling below instead of tripping `set -e` / the ERR trap.
ENGINE_EXIT_CODE=0
wait $ENGINE_PID || ENGINE_EXIT_CODE=$?
# ⚠ engine が残した通知ファイルは消す。host が確かめるのは issue（と PR 起動の run の pr）と値の形だけで、
# kind は同じ issue について書き換えられうる。
export CODING_ROBOT_NOTIFY_FILE="${GITHUB_WORKSPACE:-.}/.coding-robot-notify"
rm -f -- "$CODING_ROBOT_NOTIFY_FILE" || true

# 後処理の commit で head が変わる場合、その最終 SHA の CI が必要なので変更前を覚える。
HEAD_BEFORE_POST=$(git rev-parse HEAD 2>/dev/null || echo "")

# 空ファイルの tail は成功するので || では切り替わらない。中身がある出力を選ぶ。
engine_output_tail() {
  local n="${1:-200}" f
  for f in "$PROGRESS_OUTPUT_FILE" "$JSON_OUTPUT_FILE"; do
    if [ -s "$f" ]; then tail -n "$n" "$f"; return 0; fi
  done
  echo "No output available"
}

echo "Engine finished with exit code: $ENGINE_EXIT_CODE"
if [ "$ENGINE_EXIT_CODE" -ne 0 ]; then
  # ⚠ log にも出す。issue のコメントだけに入れると、コメントを投稿する前に落ちた run が
  # 何も残さない。engine 自身の出力がここに無いと、原因を追う手がかりが 1 つも無くなる。
  echo "---- engine output (last 60 lines) ----"
  engine_output_tail 60
  echo "---- end engine output ----"
fi

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
    PR_LINK=" | 📋 [Create Pull Request](https://github.com/$GITHUB_REPOSITORY/compare/$BASE_BRANCH...$BRANCH_NAME?expand=1&title=$PR_TITLE_ENCODED&body=$PR_BODY_ENCODED)"
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
  # （main を汚さない）。レポート内の参照は後段で bot-artifacts の raw URL へ書き換える
  # （⚠ inline ![]() は ![]() のまま、リンク []() は []() のまま。形は変えない）。
  ARTIFACT_MAP=""   # "workingpath<TAB>boturl" の行
  IMG_NOTE=""       # 画像を読む人に届けられなかったときの注記。run は緑のまま終わるのでレポートに出す
  IMG_FILES=$(git diff --numstat origin/$BASE_BRANCH...HEAD 2>/dev/null \
    | awk -F'\t' '$1=="-" && $2=="-" {print $3}' \
    | grep -iE '\.(png|jpe?g|gif|webp|bmp|pdf)$' || true)
  if [ -n "$IMG_FILES" ]; then
    echo "🖼️ Relocating review image artifacts to bot-artifacts: $(echo "$IMG_FILES" | tr '\n' ' ')"
    BA_W="$(mktemp -d)/ba"
    # bot-artifacts の push に使う認証を、作業 branch と同様に設定する。
    BA_REMOTE="https://x-access-token:${ATTACH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
    BA_READY=0
    BA_PUSHED=0
    BA_MAP=""
    PRE_RM_SHA=$(git rev-parse HEAD)
    if git -c "http.https://github.com/.extraheader=" fetch -q "$BA_REMOTE" \
         "+refs/heads/bot-artifacts:refs/remotes/origin/bot-artifacts" 2>/dev/null \
       || git fetch -q origin bot-artifacts 2>/dev/null; then
      git worktree add -q --detach "$BA_W" origin/bot-artifacts 2>/dev/null && BA_READY=1
    else
      # 新しく作ってよいのは «まだ無い» ときだけ（ls-remote --exit-code は、無いと 2 を返す）
      BA_LS=0
      git -c "http.https://github.com/.extraheader=" ls-remote --exit-code "$BA_REMOTE" \
        refs/heads/bot-artifacts >/dev/null 2>&1 || BA_LS=$?
      if [ "$BA_LS" = 2 ]; then
        git worktree add -q --detach "$BA_W" 2>/dev/null \
          && git -C "$BA_W" checkout -q --orphan bot-artifacts-new 2>/dev/null \
          && { git -C "$BA_W" rm -rfq . >/dev/null 2>&1 || true; } \
          && BA_READY=1
      else
        echo "Warning: bot-artifacts could not be fetched (exit $BA_LS)"
      fi
    fi
    if [ "$BA_READY" = 1 ]; then
      while IFS= read -r bf; do
        [ -z "$bf" ] || [ ! -f "$bf" ] && continue
        dest="issue-${ISSUE_NUMBER}/$(basename "$bf")"
        mkdir -p "$BA_W/$(dirname "$dest")"
        cp "$bf" "$BA_W/$dest"
        git -C "$BA_W" add "$dest"
        BA_MAP="${BA_MAP}${bf}	https://github.com/${GITHUB_REPOSITORY}/raw/bot-artifacts/${dest}
"
      done <<< "$IMG_FILES"
      if ! git -C "$BA_W" diff --cached --quiet 2>/dev/null \
         && git -C "$BA_W" commit -q -m "artifacts: issue-${ISSUE_NUMBER}"; then
        if git -C "$BA_W" -c "http.https://github.com/.extraheader=" push -q "$BA_REMOTE" \
             HEAD:refs/heads/bot-artifacts \
           || git -C "$BA_W" push -q origin HEAD:refs/heads/bot-artifacts; then
          BA_PUSHED=1
        else
          echo "Warning: bot-artifacts push failed"
        fi
      fi
      git worktree remove --force "$BA_W" 2>/dev/null || true
    fi
    if [ "$BA_PUSHED" = 1 ]; then
      ARTIFACT_MAP="$BA_MAP"
    else
      # 置けなかったときは、画像を消す直前の commit を指す。作業 branch からは消すので main は
      # 汚れず、その commit は PR の履歴に残るので URL は切れない
      echo "Warning: images are linked at $PRE_RM_SHA instead of bot-artifacts"
      IMG_NOTE="${IMG_NOTE}
> ⚠ 画像を \`bot-artifacts\` へ置けなかったので、commit \`${PRE_RM_SHA:0:7}\` の画像を指しています。"
      while IFS= read -r bf; do
        [ -n "$bf" ] && ARTIFACT_MAP="${ARTIFACT_MAP}${bf}	https://github.com/${GITHUB_REPOSITORY}/raw/${PRE_RM_SHA}/${bf}
"
      done <<< "$IMG_FILES"
    fi
    # working ブランチから画像を除去して push（main 汚染防止）
    while IFS= read -r bf; do [ -n "$bf" ] && git rm -q --ignore-unmatch "$bf" >/dev/null 2>&1 || true; done <<< "$IMG_FILES"
    if ! git diff --cached --quiet 2>/dev/null; then
      git commit -q -m "chore: move review image artifacts off $BRANCH_NAME to bot-artifacts"
      # PAT があれば後処理の push にも使う。checkout の extraheader はこの操作だけ無効にする。
      if git -c "http.https://github.com/.extraheader=" \
           push -q "https://x-access-token:${ATTACH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" \
           "HEAD:$BRANCH_NAME" 2>/dev/null; then
        ARTIFACT_PUSH_AUTH=pat
      elif git push -q origin "$BRANCH_NAME" 2>/dev/null; then
        ARTIFACT_PUSH_AUTH=github_token
      else
        echo "Warning: failed to push artifact cleanup"
        [ "${BA_PUSHED:-0}" = 1 ] || IMG_NOTE="${IMG_NOTE}
> ⚠ 画像を含む commit を push できなかったので、画像が表示されない可能性があります。"
      fi
    fi
  fi

  # 変更ファイル(画像除去後)の bare path を blob リンクに、artifact 参照を bot-artifacts リンクに、
  # 決定的に書き換える（コードフェンス内・既存リンクは触らない。⚠ inline ![]() は ![]() のまま残す）。
  CHANGED_FILES=$(git diff --name-only --diff-filter=d origin/$BASE_BRANCH...HEAD 2>/dev/null || true)
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
    # 画像 URL は GitHub の /raw/ 形式を使う。private repo のブラウザ表示にも対応する。
    for p, u in sorted(artifacts.items(), key=lambda kv: len(kv[0]), reverse=True):
        base = os.path.basename(p)
        seg = re.sub(r'(!?)\[([^\]]*)\]\([^)]*' + re.escape(p) + r'[^)]*\)',
                     lambda m: "%s[%s](%s)" % (m.group(1), m.group(2) or base, u), seg)
        seg = re.sub(r'`' + re.escape(p) + r'`', "![%s](%s)" % (base, u), seg)
        seg = re.sub(r'(?<![\[`/\w.-])' + re.escape(p) + r'(?!\]\()(?![\w/.-])',
                     "![%s](%s)" % (base, u), seg)
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
      printf("![%s](%s)\n", base, $2);   # ⚠ 画像なので inline。[]() にすると読む人に見えない
    }')
    if [ -n "$SCREENSHOTS_BLOCK" ]; then
      CLAUDE_OUTPUT_CLEAN="${CLAUDE_OUTPUT_CLEAN}

### Screenshots
${SCREENSHOTS_BLOCK}"
    fi
  fi

  # 書き換え後も相対 path のまま残った画像参照は、bot-artifacts へ移されなかった画像を指している
  # （commit し忘れ等）。issue コメントでは相対 path が解決されず表示されないので、どれかを注記する。
  if command -v python3 >/dev/null 2>&1; then
    MISSING_IMGS=$(python3 - "$CLAUDE_OUTPUT_CLEAN" <<'PYEOF'
import re, sys
text = re.sub(r'```.*?```', '', sys.argv[1], flags=re.S)
seen = []
for m in re.finditer(r'!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^)\s]+))', text):
    u = m.group(1) or m.group(2)
    if not re.match(r'(?i)(https?:|data:|#)', u) and u not in seen:
        seen.append(u)
sys.stdout.write(', '.join('`%s`' % u for u in seen))
PYEOF
) || MISSING_IMGS=""
    [ -n "$MISSING_IMGS" ] && IMG_NOTE="${IMG_NOTE}
> ⚠ レポートが参照している画像 ${MISSING_IMGS} は相対 path のままなので、issue では表示されません（\`bot-artifacts\` へ移されていない）。"
  fi
  if [ -n "$IMG_NOTE" ]; then
    echo "🖼️ Image note:${IMG_NOTE}"
    CLAUDE_OUTPUT_CLEAN="${CLAUDE_OUTPUT_CLEAN}
${IMG_NOTE}"
  fi

  # PDH 側パッチ: 受け渡し経路（issue）の保証を runner が担う（github-bot/pdh-hooks.sh。PDH mode のみ。VENDOR.md）
  if [ -f "$SCRIPT_DIR/pdh-hooks.sh" ] && [ -f product-brief.md ] && [ -d tickets ]; then
    # ⚠ PR run では ISSUE_NUMBER は PR 番号。ticket dir は tickets/*-issue-<Issue 番号> なので
    # 紐づく Issue 番号（validate_pr_context が設定）を渡す。
    HOOK_ISSUE="${TRUSTED_LINKED_ISSUE:-$ISSUE_NUMBER}"
    HOOKED=$(printf '%s' "$CLAUDE_OUTPUT_CLEAN" | bash "$SCRIPT_DIR/pdh-hooks.sh" final "$HOOK_ISSUE" "$BRANCH_NAME" "$PROGRESS_COMMENT_ID") \
      && [ -n "$HOOKED" ] && CLAUDE_OUTPUT_CLEAN="$HOOKED" || echo "Warning: pdh-hooks.sh failed; posting report unchanged"
  fi

  # 後処理で head が変わったとき、PAT push なら CI は既に起動するので重複 dispatch しない。
  HEAD_AFTER_POST=$(git rev-parse HEAD 2>/dev/null || echo "")
  if [ -n "$HEAD_BEFORE_POST" ] && [ -n "$HEAD_AFTER_POST" ] \
     && [ "$HEAD_BEFORE_POST" != "$HEAD_AFTER_POST" ]; then
    if [ "${ARTIFACT_PUSH_AUTH:-github_token}" = pat ]; then
      echo "head moved ($HEAD_BEFORE_POST -> $HEAD_AFTER_POST); PAT push already started CI — not dispatching"
    else
      echo "⚠️ head moved after the engine finished ($HEAD_BEFORE_POST -> $HEAD_AFTER_POST); re-dispatching CI"
      gh workflow run "$CI_WORKFLOW" --ref "$BRANCH_NAME" --repo "$GITHUB_REPOSITORY" \
        || echo "Warning: failed to re-dispatch CI for $BRANCH_NAME"
    fi
  fi

  # 最終結果を投稿（ブランチ情報付き）
  gh api -X PATCH repos/$GITHUB_REPOSITORY/issues/comments/$PROGRESS_COMMENT_ID \
    -f body="$CLAUDE_OUTPUT_CLEAN

---

🌿 Branch: \`$BRANCH_NAME\`
📝 [View changes](https://github.com/$GITHUB_REPOSITORY/compare/$BASE_BRANCH...$BRANCH_NAME)$PR_LINK"

  # ⚠ 最終レポートを投稿した印。coding-robot.yml の «Report if the run left nothing» が
  # これを見て二重投稿を避ける。置かないと、そちらが必ずもう 1 通出す。
  : > "${GITHUB_WORKSPACE:-.}/.coding-robot-reported" 2>/dev/null || true
else
  echo "❌ Task failed with exit code $ENGINE_EXIT_CODE"

  # ⚠ この経路では pdh-hooks の final が呼ばれない（成功側の中にしかない）。止まっていて人の手が
  # 要るという意味は gate 停止と同じなので、失敗側からも awaiting-reply を付ける。
  if [ -f "$SCRIPT_DIR/pdh-hooks.sh" ] && [ -f product-brief.md ] && [ -d tickets ]; then
    bash "$SCRIPT_DIR/pdh-hooks.sh" failed "${TRUSTED_LINKED_ISSUE:-$ISSUE_NUMBER}" "$BRANCH_NAME" "$PROGRESS_COMMENT_ID" || true
  fi
  # ⚠ PDH の無い repo / hook 失敗でも、engine の失敗は host へ伝える。
  if [ ! -f "$CODING_ROBOT_NOTIFY_FILE" ]; then
    {
      printf 'issue=%s\nkind=failed\ncomment_id=%s\n' \
        "$(printf '%s' "${TRUSTED_LINKED_ISSUE:-$ISSUE_NUMBER}" | tr -d '\r\n=')" \
        "$(printf '%s' "$PROGRESS_COMMENT_ID" | tr -d '\r\n=')"
    } > "$CODING_ROBOT_NOTIFY_FILE" || true
  fi


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
$(engine_output_tail 200)
\`\`\`

</details>"

  # ⚠ 最終レポートを投稿した印。coding-robot.yml の «Report if the run left nothing» が
  # これを見て二重投稿を避ける。置かないと、そちらが必ずもう 1 通出す。
  : > "${GITHUB_WORKSPACE:-.}/.coding-robot-reported" 2>/dev/null || true

  exit $ENGINE_EXIT_CODE
fi

echo "🎉 Coding Robot finished!"
