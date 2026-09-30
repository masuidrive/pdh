# shellcheck shell=bash
# =============================================================================
# Codex engine for coding-bot
# =============================================================================
# Runs `codex exec --json` (headless) and parses Codex's thread/turn/item
# event stream. Defines: engine_setup_auth / engine_run /
# engine_extract_result / engine_error_details
#
# Codex --json JSONL event model:
#   thread.started {thread_id}
#   turn.started
#   item.started   {item:{type,...}}
#   item.completed {item:{type,...}}
#   turn.completed {usage}
# item.type values: agent_message {text} | command_execution
#   {command,aggregated_output,exit_code,status} | file_change
#   {changes:[{path,kind}],status} | reasoning {text|summary}
#
# Auth: writes CODING_BOT_CODEX_AUTH_JSON secret (single-line minified ~/.codex/auth.json)
# to $CODEX_HOME/auth.json (ChatGPT login only).
# The secret must be minified to one line (jq -c) because
# devcontainers/ci passes env as line-based KEY=VALUE; a multi-line value breaks it.
#
# Final result: `-o` writes the last agent message to a file. We still prefer
# /tmp/agent-result.md when the agent followed system-codex.md (keeps PR-marker flow).
#
# Shared variables provided by run-action.sh: see _claude.sh header.
# Sets: ENGINE_PID
# =============================================================================

CODEX_LAST_MESSAGE_FILE="/tmp/codex-last-${ISSUE_NUMBER}.txt"
CODEX_EXIT_CODE_FILE="/tmp/codex-exit-${ISSUE_NUMBER}.txt"

# -----------------------------------------------------------------------------
# Auth: ChatGPT subscription only, shared with delegated workers.
# -----------------------------------------------------------------------------
engine_setup_auth() {
  codex_prepare_auth
  [ "$CODEX_AUTH_STATUS" = '使える（ChatGPT ログイン）' ] && return 0

  codex_report_auth_failure
  post_error_comment "Codex preflight failed, so this run has stopped. See the separate preflight comment for the reason and next steps."
  # ⚠ この経路は ENGINE_EXIT_CODE の分岐へ入らないので run-action.sh の failed hook が呼ばれない。
  # いちばん多い «止まっていて人の手が要る» 停止なので、ここで直接付ける。
  # ⚠ branch を渡すのは、PR が開いていれば待ち印を PR にだけ付けるため。
  if [ -f "$SCRIPT_DIR/pdh-hooks.sh" ] && [ -f product-brief.md ] && [ -d tickets ]; then
    bash "$SCRIPT_DIR/pdh-hooks.sh" failed "${TRUSTED_LINKED_ISSUE:-$ISSUE_NUMBER}" "${BRANCH_NAME:-}" || true
  fi
  exit 1
}

# -----------------------------------------------------------------------------
# Run: launch codex exec --json in the background, parse items into progress
# -----------------------------------------------------------------------------
engine_run() {
  echo "🚀 Starting Codex CLI (timeout: ${TIMEOUT_VALUE}s)..."

  # Codex has no --system-prompt; prepend system-codex.md to the task input.
  local FULL_PROMPT_FILE="/tmp/codex-fullprompt-${ISSUE_NUMBER}.txt"
  {
    printf '%s\n\n' "$SYSTEM_PROMPT"
    printf '%s\n\n' "================ TASK INPUT ================"
    cat "/tmp/agent-prompt-${ISSUE_NUMBER}.txt"
  } > "$FULL_PROMPT_FILE"

  local MODEL_ARGS=()
  if [ -n "${CODING_BOT_CODEX_MODEL:-}" ]; then
    MODEL_ARGS=(--model "$CODING_BOT_CODEX_MODEL")
  fi

  (
    > "$PROGRESS_OUTPUT_FILE"
    > "$TASK_STATUS_FILE"

    timeout "$TIMEOUT_VALUE" codex exec --json \
      --skip-git-repo-check \
      --dangerously-bypass-approvals-and-sandbox \
      ${MODEL_ARGS[@]+"${MODEL_ARGS[@]}"} \
      -o "$CODEX_LAST_MESSAGE_FILE" \
      - < "$FULL_PROMPT_FILE" 2>&1 | \
    while IFS= read -r line; do
      echo "$line" >> "$JSON_OUTPUT_FILE"

      EV=$(echo "$line" | jq -r '.type // empty' 2>/dev/null) || continue
      [ -z "$EV" ] && continue

      case "$EV" in
        item.started|item.completed)
          ITYPE=$(echo "$line" | jq -r '.item.type // empty' 2>/dev/null)

          # newline guard
          if [ -s "$PROGRESS_OUTPUT_FILE" ]; then
            LAST_CHAR=$(tail -c 1 "$PROGRESS_OUTPUT_FILE" 2>/dev/null)
            if [ -n "$LAST_CHAR" ] && [ "$LAST_CHAR" != $'\n' ]; then
              echo "" >> "$PROGRESS_OUTPUT_FILE"
            fi
          fi

          case "$ITYPE" in
            command_execution)
              # announce on start only
              if [ "$EV" = "item.started" ]; then
                CMD=$(echo "$line" | jq -r '.item.command // empty' 2>/dev/null)
                if [ -n "$CMD" ]; then
                  printf "🔧 [Bash: %s]\n" "$CMD" >> "$PROGRESS_OUTPUT_FILE"
                else
                  printf "🔧 [Bash実行中...]\n" >> "$PROGRESS_OUTPUT_FILE"
                fi
              fi
              ;;
            file_change)
              if [ "$EV" = "item.completed" ]; then
                echo "$line" | jq -r '.item.changes[]? | "✏️ [\(.kind): \(.path)]"' 2>/dev/null >> "$PROGRESS_OUTPUT_FILE" || true
              fi
              ;;
            reasoning)
              if [ "$EV" = "item.completed" ]; then
                THINK=$(echo "$line" | jq -r '.item.text // .item.summary // empty' 2>/dev/null)
                [ -n "$THINK" ] && printf "%s\n" "$THINK" >> "$PROGRESS_OUTPUT_FILE"
              fi
              ;;
            agent_message)
              if [ "$EV" = "item.completed" ]; then
                MSG=$(echo "$line" | jq -r '.item.text // empty' 2>/dev/null)
                [ -n "$MSG" ] && printf "%s\n" "$MSG" >> "$PROGRESS_OUTPUT_FILE"
              fi
              ;;
          esac
          ;;
        turn.completed)
          USAGE=$(echo "$line" | jq -rc '.usage // empty' 2>/dev/null)
          [ -n "$USAGE" ] && echo "DEBUG: turn.completed usage=$USAGE" >&2
          ;;
        error|turn.failed)
          EMSG=$(echo "$line" | jq -r '.message // .error.message // .error // empty' 2>/dev/null)
          if [ -n "$EMSG" ]; then
            echo "❌ Codex error: $EMSG" >&2
            cat > "/tmp/codex-error-${ISSUE_NUMBER}.json" <<EOF
{
  "error_message": "$EMSG",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
          fi
          ;;
      esac
    done
    # Real codex/timeout exit code (left side of the pipe), not the while loop's.
    CODEX_RC=${PIPESTATUS[0]}
    printf '%s' "$CODEX_RC" > "$CODEX_EXIT_CODE_FILE"
    exit "$CODEX_RC"
  ) &
  ENGINE_PID=$!
  echo "Codex PID: $ENGINE_PID"
}

# -----------------------------------------------------------------------------
# Extract final result into RESULT_OUTPUT_FILE
# Priority: /tmp/agent-result.md (system-codex.md report w/ PR markers) > -o output
# -----------------------------------------------------------------------------
engine_extract_result() {
  local AGENT_RESULT_FILE="/tmp/agent-result.md"

  if [ -f "$AGENT_RESULT_FILE" ]; then
    echo "✅ Found /tmp/agent-result.md - using it as final result"
    cat "$AGENT_RESULT_FILE" > "$RESULT_OUTPUT_FILE"
  elif [ -s "$CODEX_LAST_MESSAGE_FILE" ]; then
    echo "✅ Using Codex -o last message as final result"
    cat "$CODEX_LAST_MESSAGE_FILE" > "$RESULT_OUTPUT_FILE"
  else
    echo "WARNING: No Codex output captured!"
    # codex runs with 2>&1, so JSON_OUTPUT_FILE holds raw stdout+stderr.
    local RAW_OUTPUT
    RAW_OUTPUT=$(tail -n 50 "$JSON_OUTPUT_FILE" 2>/dev/null | grep -v '^\s*$' | tail -30)
    {
      echo "## ⚠️ No result was produced"
      echo
      echo "Codex finished without writing a final report and produced no agent message."
      echo "This usually means the request could not be performed (e.g. the target file or symbol does not exist), was too ambiguous to act on, or Codex exited before completing a turn."
      echo
      if [ -n "$RAW_OUTPUT" ]; then
        echo "**Codex output (stdout/stderr):**"
        echo '```'
        echo "$RAW_OUTPUT"
        echo '```'
      else
        echo "Codex emitted no output at all — check the [workflow logs](https://github.com/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID) and verify credentials (\`CODING_BOT_CODEX_AUTH_JSON\`)."
      fi
    } > "$RESULT_OUTPUT_FILE"
  fi
}

# -----------------------------------------------------------------------------
# Build engine-specific error markdown. Echoes the ERROR_DETAILS body.
# May set TIMEOUT_MINUTES (read by the caller for the debug footer).
# -----------------------------------------------------------------------------
engine_error_details() {
  local ERROR_FILE="/tmp/codex-error-${ISSUE_NUMBER}.json"

  # Priority 1: Timeout (exit code 124 from `timeout`). Deterministic — check
  # it BEFORE grep-based heuristics so that a long-running run whose output
  # happens to mention "401" / "unauthorized" / "refresh token" in agent
  # reasoning is not misreported as an auth error.
  if [ "$ENGINE_EXIT_CODE" -eq 124 ]; then
    TIMEOUT_MINUTES=$((TIMEOUT_VALUE / 60))
    echo "## ⏱️ Timeout Error

Codex exceeded the timeout limit of **${TIMEOUT_VALUE} seconds** (${TIMEOUT_MINUTES} minutes).

**Suggested actions:**
1. Break down the task into smaller steps
2. Increase \`CODING_BOT_TIMEOUT\` in the workflow env
3. Reduce scope - focus on one thing at a time"
    return 0
  fi

  # Priority 2: command not found / not executable — also deterministic.
  if [ "$ENGINE_EXIT_CODE" -eq 127 ] || [ "$ENGINE_EXIT_CODE" -eq 126 ]; then
    echo "## ❌ Codex CLI not available

Codex exited with code \`$ENGINE_EXIT_CODE\` (command not found or not executable).
The \`codex\` binary may be missing from the devcontainer or not on \`PATH\`.
Install it (\`npm install -g @openai/codex\`) and ensure the npm global bin is on \`PATH\`."
    return 0
  fi

  # Priority 3: Authentication / token issues (heuristic — only after the
  # deterministic exit-code checks above have failed to match).
  if grep -qi "unauthorized\|401\|invalid.*token\|invalid.*api.*key\|auth.*expired\|refresh.*token" "$JSON_OUTPUT_FILE" "$PROGRESS_OUTPUT_FILE" 2>/dev/null; then
    codex_auth_recovery_message
    return 0
  fi

  # Priority 4: Codex error captured during streaming
  if [ -f "$ERROR_FILE" ]; then
    local ERROR_MESSAGE
    ERROR_MESSAGE=$(jq -r '.error_message' "$ERROR_FILE" 2>/dev/null || echo "Unknown error")
    echo "## 🚨 Codex Error

**Error Message:**
\`\`\`
$ERROR_MESSAGE
\`\`\`"
    return 0
  fi

  # Priority 5: Generic execution error — surface raw stdout/stderr.
  # codex runs with 2>&1, so JSON_OUTPUT_FILE holds the raw stdout+stderr;
  # PROGRESS_OUTPUT_FILE holds only parsed events (often empty on early failure).
  local RAW_OUTPUT PARSED_OUTPUT
  RAW_OUTPUT=$(tail -n 50 "$JSON_OUTPUT_FILE" 2>/dev/null | grep -v '^\s*$' | tail -30)
  PARSED_OUTPUT=$(tail -n 100 "$PROGRESS_OUTPUT_FILE" 2>/dev/null | grep -v '^\s*$' | tail -20)

  echo "## ❌ Execution Error

Codex failed with exit code: \`$ENGINE_EXIT_CODE\`

**Raw output (stdout/stderr):**
\`\`\`
${RAW_OUTPUT:-No output available}
\`\`\`

**Parsed progress:**
\`\`\`
${PARSED_OUTPUT:-No parsed output}
\`\`\`"
}
