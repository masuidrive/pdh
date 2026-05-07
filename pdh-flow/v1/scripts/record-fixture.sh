#!/usr/bin/env bash
# Wraps a real provider so its stdout + any artifacts the prompt asked it
# to write are captured into a fixture directory consumable by
# scripts/replay-provider.ts.
#
# Usage as a CODEX_BIN / CLAUDE_BIN replacement:
#
#   PDH_REAL_PROVIDER=/path/to/codex \
#   PDH_RECORD_FIXTURE=tests/fixtures/<scenario> \
#   CODEX_BIN=scripts/record-fixture.sh \
#     node src/cli/index.ts run-next --repo <tmp-repo> ...
#
# After the provider exits, the fixture dir has:
#   raw.jsonl                 provider stdout (with volatile fields scrubbed
#                             into ${SESSION_ID} / ${THREAD_ID} placeholders)
#   artifacts/<basename>      every artifact the prompt asked the provider
#                             to write, copied verbatim
#   meta.json                 { "exit": <real provider exit code> }
#
# The user authoring fixtures only ever does this — they don't write the
# JSON content by hand. (See the Test Rules section in AGENTS.md.)

set -euo pipefail

real="${PDH_REAL_PROVIDER:?set to the real provider binary path}"
fixture_root="${PDH_RECORD_FIXTURE:?set to the fixture directory}"
mkdir -p "$fixture_root"

# Each provider invocation gets its own call-N subdir, parallel to the layout
# that scripts/replay-provider.ts expects. Multi-call scenarios (review
# loops, retries, multi-step recordings) accumulate naturally without one
# call overwriting the previous.
count_file="$fixture_root/.count"
n=0
if [ -f "$count_file" ]; then
  n="$(cat "$count_file")"
fi
n="$((n + 1))"
printf '%s\n' "$n" >"$count_file"
fixture="$fixture_root/call-$n"
mkdir -p "$fixture/artifacts"

prompt_file="$(mktemp)"
targets_file="$(mktemp)"
trap 'rm -f "$prompt_file" "$targets_file"' EXIT
cat >"$prompt_file"

# Save the prompt verbatim so the fixture is self-describing (helps when
# diagnosing why a replay diverges from the live run). Different providers
# pass the prompt differently — codex reads it from stdin, claude takes
# it via `-p <prompt>` — so we union stdin + every argv element to make
# the recorder provider-agnostic.
{
  cat "$prompt_file"
  printf '\n'
  for arg in "$@"; do
    printf '%s\n' "$arg"
  done
} >"$fixture/prompt.txt"

# Extract every "Write valid JSON to \`<path>\`" target the runtime asked
# the provider to populate. Same regex set the replayer uses.
{
  grep -oE 'Write valid JSON to `[^`]+`' "$fixture/prompt.txt" || true
  grep -oE 'Write JSON to `[^`]+`' "$fixture/prompt.txt" || true
} | sed -E 's/^Write( valid)? JSON to `([^`]+)`$/\2/' >"$targets_file"

raw_path="$fixture/raw.jsonl"
set +e
"$real" "$@" <"$prompt_file" >"$raw_path"
exit_code=$?
set -e

# Scrub volatile identifiers so the recording is deterministic on replay.
# These match the field names emitted by claude / codex CLI today.
sed -i -E '
  s/"thread_id":[ ]*"[^"]+"/"thread_id":"${THREAD_ID}"/g
  s/"session_id":[ ]*"[^"]+"/"session_id":"${SESSION_ID}"/g
' "$raw_path"

while IFS= read -r target; do
  [ -n "$target" ] || continue
  if [ -f "$target" ]; then
    cp "$target" "$fixture/artifacts/$(basename "$target")"
  fi
done <"$targets_file"

cat >"$fixture/meta.json" <<EOF
{
  "exit": $exit_code
}
EOF

echo "recorded $fixture (exit=$exit_code)" >&2
exit "$exit_code"
