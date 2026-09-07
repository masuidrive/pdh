# shellcheck shell=bash
# =============================================================================
# Claude engine for Coding Robot
# =============================================================================
# Runs `claude -p` (headless) and parses Anthropic stream-json output.
# Defines: engine_setup_auth / engine_run / engine_extract_result /
#          engine_error_details
#
# Shared variables provided by run-action.sh:
#   ISSUE_NUMBER, GITHUB_REPOSITORY, SYSTEM_PROMPT, TIMEOUT_VALUE,
#   PROGRESS_COMMENT_ID, JSON_OUTPUT_FILE, PROGRESS_OUTPUT_FILE,
#   RESULT_OUTPUT_FILE, TASK_STATUS_FILE, ENGINE_EXIT_CODE
#   post_error_comment()
# Sets:
#   ENGINE_PID (background parser pid)
# =============================================================================

# -----------------------------------------------------------------------------
# Auth: CLAUDE_CODE_OAUTH_TOKEN must be set
# -----------------------------------------------------------------------------
engine_setup_auth() {
  echo "🔑 Setting up Claude CLI authentication..."
  if [ -n "$CLAUDE_CODE_OAUTH_TOKEN" ]; then
    echo "✅ CLAUDE_CODE_OAUTH_TOKEN is set (long-lived token)"
    return 0
  fi

  echo "❌ ERROR: CLAUDE_CODE_OAUTH_TOKEN is not set!"
  post_error_comment "### 🔑 Authentication Error

\`CLAUDE_CODE_OAUTH_TOKEN\` secret is not configured.

**How to obtain a token:**

Run this command on your local machine:
\`\`\`bash
claude setup-token
\`\`\`

This will guide you through the authentication process and provide the token.

**How to set it up in GitHub:**
1. Go to [Repository Secrets Settings](https://github.com/$GITHUB_REPOSITORY/settings/secrets/actions)
2. Click \`New repository secret\`
3. Name: \`CLAUDE_CODE_OAUTH_TOKEN\`
4. Value: Paste the token from \`claude setup-token\`
5. Click \`Add secret\`

For more information, see the [Claude Code documentation](https://docs.anthropic.com/en/docs/claude-code).

---

**Alternatively, use the Codex engine instead of Claude:**
1. Set the repository variable \`CODING_ROBOT_ENGINE\` to \`codex\` at [Repository Variables Settings](https://github.com/$GITHUB_REPOSITORY/settings/variables/actions)
2. Provide Codex credentials as a secret — choose one:
   - \`CODEX_AUTH_JSON\`: run \`codex login\` locally, then \`jq -c . ~/.codex/auth.json\` and paste the single-line output as the secret value.
   - \`OPENAI_API_KEY\`: paste your OpenAI API key.

---

**After setting the token, try commenting 🤖 \`:robot:\` on this thread again!**"
  exit 1
}

# -----------------------------------------------------------------------------
# Run: launch claude -p in the background, parse stream-json into progress files
# -----------------------------------------------------------------------------
# Stream-JSON event structure (Anthropic API):
#   content_block_start (index, type: text|tool_use)
#     content_block_delta (delta.type: text_delta|input_json_delta|thinking_delta)
#   content_block_stop (index)
#   message_stop
# =============================================================================
engine_run() {
  echo "🚀 Starting Claude Code CLI (timeout: ${TIMEOUT_VALUE}s)..."

  (
    > "$PROGRESS_OUTPUT_FILE"  # Initialize progress file
    > "$TASK_STATUS_FILE"       # Initialize task status file

    CURRENT_TOOL=""
    CURRENT_TOOL_INPUT=""
    CURRENT_BLOCK_INDEX=""
    CURRENT_BLOCK_TYPE=""
    MESSAGE_COUNTER=0  # Track which message/turn we're on to avoid block file overwrites
    BLOCKS_DIR="/tmp/claude-blocks-$ISSUE_NUMBER"
    mkdir -p "$BLOCKS_DIR"

    timeout "$TIMEOUT_VALUE" claude -p --dangerously-skip-permissions \
      --system-prompt "$SYSTEM_PROMPT" \
      --output-format stream-json --include-partial-messages --verbose \
      < "/tmp/agent-prompt-$ISSUE_NUMBER.txt" 2>&1 | \
    while IFS= read -r line; do
      echo "$line" >> "$JSON_OUTPUT_FILE"

      # ERROR DETECTION: Claude API errors in streaming response
      ERROR_EVENT=$(echo "$line" | jq -r 'select(.type=="error") | .error' 2>/dev/null)
      if [ -n "$ERROR_EVENT" ] && [ "$ERROR_EVENT" != "null" ]; then
        ERROR_TYPE=$(echo "$ERROR_EVENT" | jq -r '.type // "unknown"')
        ERROR_MESSAGE=$(echo "$ERROR_EVENT" | jq -r '.message // "Unknown error"')

        echo "❌ Claude API Error detected during streaming:" >&2
        echo "   Type: $ERROR_TYPE" >&2
        echo "   Message: $ERROR_MESSAGE" >&2

        cat > "/tmp/claude-error-$ISSUE_NUMBER.json" << EOF
{
  "error_type": "$ERROR_TYPE",
  "error_message": "$ERROR_MESSAGE",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
      fi

      # content_block_start: new content block (text or tool_use)
      BLOCK_START=$(echo "$line" | jq -r 'select(.type=="stream_event" and .event.type=="content_block_start") | .event' 2>/dev/null)
      if [ -n "$BLOCK_START" ] && [ "$BLOCK_START" != "null" ]; then
        CURRENT_BLOCK_INDEX=$(echo "$BLOCK_START" | jq -r '.index')
        CURRENT_BLOCK_TYPE=$(echo "$BLOCK_START" | jq -r '.content_block.type')

        echo "DEBUG: content_block_start - index=$CURRENT_BLOCK_INDEX, type=$CURRENT_BLOCK_TYPE" >&2

        > "$BLOCKS_DIR/block-m$MESSAGE_COUNTER-$CURRENT_BLOCK_INDEX.txt"
        echo "$CURRENT_BLOCK_TYPE" > "$BLOCKS_DIR/block-m$MESSAGE_COUNTER-$CURRENT_BLOCK_INDEX.type"

        if [ "$CURRENT_BLOCK_TYPE" = "tool_use" ]; then
          TOOL_NAME=$(echo "$BLOCK_START" | jq -r '.content_block.name')
          CURRENT_TOOL="$TOOL_NAME"
          CURRENT_TOOL_INPUT=""
        fi
      fi

      # Accumulate tool input JSON
      if [ -n "$CURRENT_TOOL" ]; then
        INPUT_DELTA=$(echo "$line" | jq -r 'select(.type=="stream_event" and .event.type=="content_block_delta" and .event.delta.type=="input_json_delta") | .event.delta.partial_json' 2>/dev/null)
        if [ -n "$INPUT_DELTA" ] && [ "$INPUT_DELTA" != "null" ]; then
          CURRENT_TOOL_INPUT="${CURRENT_TOOL_INPUT}${INPUT_DELTA}"
        fi
      fi

      # content_block_stop
      BLOCK_STOP_INDEX=$(echo "$line" | jq -r 'select(.type=="stream_event" and .event.type=="content_block_stop") | .event.index' 2>/dev/null)
      if [ -n "$BLOCK_STOP_INDEX" ] && [ "$BLOCK_STOP_INDEX" != "null" ]; then
        if [ -n "$CURRENT_TOOL" ]; then
          echo "DEBUG: Tool completed: $CURRENT_TOOL" >&2

          if [ -s "$PROGRESS_OUTPUT_FILE" ]; then
            LAST_CHAR=$(tail -c 1 "$PROGRESS_OUTPUT_FILE" 2>/dev/null)
            if [ -n "$LAST_CHAR" ] && [ "$LAST_CHAR" != $'\n' ]; then
              echo "" >> "$PROGRESS_OUTPUT_FILE"
            fi
          fi

          case "$CURRENT_TOOL" in
            Bash)
              DESCRIPTION=$(echo "$CURRENT_TOOL_INPUT" | jq -r '.description // empty' 2>/dev/null)
              if [ -n "$DESCRIPTION" ]; then
                printf "🔧 [Bash: %s]\n" "$DESCRIPTION" >> "$PROGRESS_OUTPUT_FILE"
              else
                printf "🔧 [Bash実行中...]\n" >> "$PROGRESS_OUTPUT_FILE"
              fi
              ;;
            Read)
              FILE_PATH=$(echo "$CURRENT_TOOL_INPUT" | jq -r '.file_path // empty' 2>/dev/null)
              if [ -n "$FILE_PATH" ]; then
                printf "🔧 [Read: %s]\n" "$FILE_PATH" >> "$PROGRESS_OUTPUT_FILE"
              else
                printf "🔧 [Read実行中...]\n" >> "$PROGRESS_OUTPUT_FILE"
              fi
              ;;
            Write)
              FILE_PATH=$(echo "$CURRENT_TOOL_INPUT" | jq -r '.file_path // empty' 2>/dev/null)
              if [ -n "$FILE_PATH" ]; then
                printf "🔧 [Write: %s]\n" "$FILE_PATH" >> "$PROGRESS_OUTPUT_FILE"
              else
                printf "🔧 [Write実行中...]\n" >> "$PROGRESS_OUTPUT_FILE"
              fi
              ;;
            Edit)
              FILE_PATH=$(echo "$CURRENT_TOOL_INPUT" | jq -r '.file_path // empty' 2>/dev/null)
              if [ -n "$FILE_PATH" ]; then
                printf "🔧 [Edit: %s]\n" "$FILE_PATH" >> "$PROGRESS_OUTPUT_FILE"
              else
                printf "🔧 [Edit実行中...]\n" >> "$PROGRESS_OUTPUT_FILE"
              fi
              ;;
            Glob)
              PATTERN=$(echo "$CURRENT_TOOL_INPUT" | jq -r '.pattern // empty' 2>/dev/null)
              if [ -n "$PATTERN" ]; then
                printf "🔧 [Glob: %s]\n" "$PATTERN" >> "$PROGRESS_OUTPUT_FILE"
              else
                printf "🔧 [Glob実行中...]\n" >> "$PROGRESS_OUTPUT_FILE"
              fi
              ;;
            Grep)
              PATTERN=$(echo "$CURRENT_TOOL_INPUT" | jq -r '.pattern // empty' 2>/dev/null)
              if [ -n "$PATTERN" ]; then
                printf "🔧 [Grep: %s]\n" "$PATTERN" >> "$PROGRESS_OUTPUT_FILE"
              else
                printf "🔧 [Grep実行中...]\n" >> "$PROGRESS_OUTPUT_FILE"
              fi
              ;;
            TodoWrite|TaskCreate|TaskUpdate)
              echo "DEBUG: Processing task tool: $CURRENT_TOOL" >&2
              TASKS=$(echo "$CURRENT_TOOL_INPUT" | jq -r '.todos[]? // .subject? // empty' 2>/dev/null)
              if [ -n "$TASKS" ]; then
                echo "DEBUG: Found tasks, updating TASK_STATUS_FILE" >&2
                > "$TASK_STATUS_FILE"
                echo "$CURRENT_TOOL_INPUT" | jq -r '.todos[]? | "  \(if .status == "completed" then "✅" elif .status == "in_progress" then "🔄" else "◻️" end) \(.content // .subject)"' 2>/dev/null > "$TASK_STATUS_FILE" || true
                echo "DEBUG: TASK_STATUS_FILE content:" >&2
                cat "$TASK_STATUS_FILE" >&2
              else
                echo "DEBUG: No tasks found in tool input" >&2
              fi
              ;;
          esac
          CURRENT_TOOL=""
          CURRENT_TOOL_INPUT=""
        fi

        CURRENT_BLOCK_INDEX=""
        CURRENT_BLOCK_TYPE=""
      fi

      # thinking_delta (progress only)
      THINKING=$(echo "$line" | jq -r 'select(.type=="stream_event" and .event.type=="content_block_delta" and .event.delta.type=="thinking_delta") | .event.delta.thinking' 2>/dev/null)
      if [ -n "$THINKING" ] && [ "$THINKING" != "null" ]; then
        printf "%s" "$THINKING" >> "$PROGRESS_OUTPUT_FILE"
      fi

      # text_delta
      TEXT_DELTA=$(echo "$line" | jq -r 'select(.type=="stream_event" and .event.type=="content_block_delta" and .event.delta.type=="text_delta") | .event' 2>/dev/null)
      if [ -n "$TEXT_DELTA" ] && [ "$TEXT_DELTA" != "null" ]; then
        TEXT=$(echo "$TEXT_DELTA" | jq -r '.delta.text')
        BLOCK_IDX=$(echo "$TEXT_DELTA" | jq -r '.index')

        printf "%s" "$TEXT" >> "$PROGRESS_OUTPUT_FILE"

        if [ -n "$BLOCK_IDX" ] && [ "$BLOCK_IDX" != "null" ]; then
          printf "%s" "$TEXT" >> "$BLOCKS_DIR/block-m$MESSAGE_COUNTER-$BLOCK_IDX.txt"
        fi
      fi

      # message_stop
      MESSAGE_STOP=$(echo "$line" | jq -r 'select(.type=="stream_event" and .event.type=="message_stop") | .type' 2>/dev/null)
      if [ -n "$MESSAGE_STOP" ] && [ "$MESSAGE_STOP" != "null" ]; then
        MESSAGE_COUNTER=$((MESSAGE_COUNTER + 1))
        echo "DEBUG: message_stop detected, incremented MESSAGE_COUNTER to $MESSAGE_COUNTER" >&2
      fi
    done
  ) &
  ENGINE_PID=$!
  echo "Claude PID: $ENGINE_PID"
}

# -----------------------------------------------------------------------------
# Extract final result into RESULT_OUTPUT_FILE
# Priority: /tmp/agent-result.md > last text block across all turns
# -----------------------------------------------------------------------------
engine_extract_result() {
  local AGENT_RESULT_FILE="/tmp/agent-result.md"

  if [ -f "$AGENT_RESULT_FILE" ]; then
    echo "✅ Found /tmp/agent-result.md - using it as final result"
    cat "$AGENT_RESULT_FILE" > "$RESULT_OUTPUT_FILE"
    return 0
  fi

  echo "⚠️  /tmp/agent-result.md not found - falling back to last text block extraction"

  local BLOCKS_DIR="/tmp/claude-blocks-$ISSUE_NUMBER"
  if [ -d "$BLOCKS_DIR" ]; then
    echo "Extracting last text block from all message turns..."
    local LAST_TEXT_BLOCK=""
    local LAST_MESSAGE_NUM=-1
    local LAST_INDEX=-1

    for block_file in "$BLOCKS_DIR"/block-m*-*.txt; do
      if [ -f "$block_file" ]; then
        local BASENAME MSG_NUM BLOCK_IDX TYPE_FILE
        BASENAME=$(basename "$block_file" .txt)
        MSG_NUM=$(echo "$BASENAME" | sed 's/block-m\([0-9]*\)-.*/\1/')
        BLOCK_IDX=$(echo "$BASENAME" | sed 's/block-m[0-9]*-\([0-9]*\)/\1/')
        TYPE_FILE="$BLOCKS_DIR/block-m$MSG_NUM-$BLOCK_IDX.type"

        if [ -f "$TYPE_FILE" ]; then
          local BLOCK_TYPE
          BLOCK_TYPE=$(cat "$TYPE_FILE")
          echo "  Found block-m$MSG_NUM-$BLOCK_IDX: type=$BLOCK_TYPE"

          if [ "$BLOCK_TYPE" = "text" ]; then
            if [ "$MSG_NUM" -gt "$LAST_MESSAGE_NUM" ] || \
               { [ "$MSG_NUM" -eq "$LAST_MESSAGE_NUM" ] && [ "$BLOCK_IDX" -gt "$LAST_INDEX" ]; }; then
              LAST_TEXT_BLOCK="$block_file"
              LAST_MESSAGE_NUM=$MSG_NUM
              LAST_INDEX=$BLOCK_IDX
              echo "    -> Updated LAST_TEXT_BLOCK to block-m$MSG_NUM-$BLOCK_IDX"
            fi
          fi
        fi
      fi
    done

    if [ -n "$LAST_TEXT_BLOCK" ] && [ -f "$LAST_TEXT_BLOCK" ]; then
      echo "Writing last text block ($(basename "$LAST_TEXT_BLOCK")) to RESULT_OUTPUT_FILE"
      cat "$LAST_TEXT_BLOCK" > "$RESULT_OUTPUT_FILE"
    else
      echo "WARNING: No text blocks found!"
    fi
  fi
}

# -----------------------------------------------------------------------------
# Build engine-specific error markdown. Echoes the ERROR_DETAILS body.
# May set TIMEOUT_MINUTES (read by the caller for the debug footer).
# -----------------------------------------------------------------------------
engine_error_details() {
  local ERROR_FILE="/tmp/claude-error-$ISSUE_NUMBER.json"

  # Priority 1: Timeout (exit code 124 from `timeout`). Deterministic — check
  # it BEFORE grep-based heuristics or any error file from earlier in the run,
  # so that a long-running session whose output mentions "authentication" or
  # "unauthorized" in agent reasoning is not misreported as an auth error.
  if [ "$ENGINE_EXIT_CODE" -eq 124 ]; then
    TIMEOUT_MINUTES=$((TIMEOUT_VALUE / 60))
    echo "## ⏱️ Timeout Error

Claude exceeded the timeout limit of **${TIMEOUT_VALUE} seconds** (${TIMEOUT_MINUTES} minutes).

**Suggested actions:**
1. Break down the task into smaller steps
2. Increase \`CLAUDE_TIMEOUT\` in the workflow env
3. Reduce scope - focus on one thing at a time"
    return 0
  fi

  # Priority 2: Authentication errors
  if grep -qi "authentication\|unauthorized\|invalid.*api.*key\|CLAUDE_CODE_OAUTH_TOKEN" "$JSON_OUTPUT_FILE" "$PROGRESS_OUTPUT_FILE" 2>/dev/null; then
    cat <<EOF
## 🔐 Authentication Error

Claude failed to authenticate with Claude API.

**Common causes:**
- \`CLAUDE_CODE_OAUTH_TOKEN\` secret is not set in repository settings
- Token is expired or invalid
- Token doesn't have required permissions

**How to fix:**

1. **Check if secret exists:**
   - Go to: [Repository Settings → Secrets](https://github.com/$GITHUB_REPOSITORY/settings/secrets/actions)
   - Verify \`CLAUDE_CODE_OAUTH_TOKEN\` is listed

2. **Generate new token:**
   - Run \`claude setup-token\` locally and copy the value

3. **Update GitHub Secret:**
   - Go to: https://github.com/$GITHUB_REPOSITORY/settings/secrets/actions
   - Update \`CLAUDE_CODE_OAUTH_TOKEN\` with the new token

4. **Re-run:** Comment \`:robot:\` to retry
EOF
    return 0
  fi

  # Priority 3: Claude API errors detected during streaming
  if [ -f "$ERROR_FILE" ]; then
    local ERROR_TYPE ERROR_MESSAGE
    ERROR_TYPE=$(jq -r '.error_type' "$ERROR_FILE" 2>/dev/null || echo "unknown")
    ERROR_MESSAGE=$(jq -r '.error_message' "$ERROR_FILE" 2>/dev/null || echo "Unknown error")

    case "$ERROR_TYPE" in
      authentication_error)
        echo "## 🔐 Authentication Error

**Error Type:** \`authentication_error\`

**Error Message:**
\`\`\`
$ERROR_MESSAGE
\`\`\`

Your API key is invalid or expired."
        ;;
      overloaded_error)
        echo "## 🚨 API Overloaded

**Error Type:** \`overloaded_error\`

**Error Message:**
\`\`\`
$ERROR_MESSAGE
\`\`\`

The Claude API is temporarily overloaded. Wait a few minutes and comment \`:robot:\` to retry."
        ;;
      rate_limit_error)
        echo "## ⏱️ Rate Limit Exceeded

**Error Type:** \`rate_limit_error\`

**Error Message:**
\`\`\`
$ERROR_MESSAGE
\`\`\`

Your account hit the API rate limit. Wait a few minutes before retrying."
        ;;
      invalid_request_error)
        echo "## ❌ Invalid Request

**Error Type:** \`invalid_request_error\`

**Error Message:**
\`\`\`
$ERROR_MESSAGE
\`\`\`

There's an issue with the request format or content (e.g. too large). Break the task into smaller steps."
        ;;
      *)
        echo "## 🚨 Claude API Error

**Error Type:** \`$ERROR_TYPE\`

**Error Message:**
\`\`\`
$ERROR_MESSAGE
\`\`\`

An error occurred while communicating with Claude API."
        ;;
    esac
    return 0
  fi

  # Priority 4: Generic execution error
  local LAST_OUTPUT
  LAST_OUTPUT=$(tail -n 100 "$PROGRESS_OUTPUT_FILE" 2>/dev/null | grep -v '^\s*$' | tail -20)
  echo "## ❌ Execution Error

Claude failed with exit code: \`$ENGINE_EXIT_CODE\`

**Last output:**
\`\`\`
${LAST_OUTPUT:-No output available}
\`\`\`"
}
