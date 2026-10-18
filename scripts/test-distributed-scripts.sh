#!/usr/bin/env bash
# Run the consuming-project contracts against each actual installed distribution.
set -uo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
failed=0
for engine in claude codex; do
  [[ -z ${PDH_TEST_ENGINE_ONLY:-} || $engine == "$PDH_TEST_ENGINE_ONLY" ]] || continue
  target=$tmp/$engine
  mkdir -p "$target/scripts" "$target/.claude/agents" "$target/.claude/skills" "$target/.codex" "$target/.github/coding-bot"
  cp -RL "$root/$engine/templates/." "$target/scripts/"
  mkdir -p "$target/tests/scripts"
  cp "$root/tests/scripts/"* "$target/tests/scripts/"
  cp "$root/claude/templates/gen-agents-md.sh" "$root/claude/templates/gen-codex-agents.sh" "$target/scripts/"
  # tests use the canonical source layout as input material, even for Codex's
  # behavioral shell contracts. Native-only installation is tested separately.
  if [[ "$engine" == claude ]]; then
    cp -RL "$root/claude/skills/." "$target/.claude/skills/"
  else
    mkdir -p "$target/.agents/skills"
    cp -RL "$root/codex/skills/." "$target/.agents/skills/"
    python3 - "$target/tests/scripts" <<'NATIVE_TESTS'
from pathlib import Path
import sys
for p in Path(sys.argv[1]).iterdir():
    if p.name == 'gen_agents_md_test.sh':continue
    text=p.read_text()
    if p.name == 'docs_policy_test.py':text=text.replace("('AGENTS.md',", "('generated-context.md',")
    if p.name == 'pdh_review_eval_test.sh':
        text=text.replace('.claude/agents/pdh-reviewer.md','.codex/agents/pdh-reviewer.toml').replace('.claude/agents','.codex/agents')
        for label,body in [('historical-reviewer','OLD REVIEWER BODY'),('current-reviewer','CURRENT REVIEWER BODY')]:
            old="printf '%s\\n' '---' 'name: "+label+"' '---' '"+body+"'"
            new="printf '%s\\n' 'developer_instructions = \""+body+"\"'"
            text=text.replace(old,new)
    text=text.replace('.claude/skills', '.agents/skills').replace('CLAUDE.md','AGENTS.md')
    p.write_text(text)
NATIVE_TESTS
  fi
  cp -RL "$root/claude/templates/agents/claude/." "$target/.claude/agents/"
  cp "$root/claude/templates/settings.json" "$target/.claude/settings.json"
  cp "$root/claude/templates/hooks.json" "$target/.codex/hooks.json"
  cp "$root/$engine/templates/.ticket-config.yaml" "$target/.ticket-config.yaml"
  cp -R "$root/github-bot/.github/." "$target/.github/"
  cp "$root/github-bot/_pdh.md" "$root/github-bot/_github-issue.md" "$root/github-bot/pdh-hooks.sh" "$target/.github/coding-bot/"
  chmod +x "$target/scripts/"*.sh
  # The eval's native TOML extraction has its own installation test; all other
  # behavior and error contracts are shared verbatim.

  cp "$root/tests/fixtures/ticket.sh" "$target/ticket.sh"
  git -C "$target" init -q -b fixture
  export PDH_TEST_ENGINE=$engine PDH_TEST_ROOT=$target PYTHONDONTWRITEBYTECODE=1
  for test in "$target/tests/scripts/"*_test.sh; do
    [[ -z ${PDH_TEST_FILTER:-} || ${test##*/} == $PDH_TEST_FILTER ]] || continue
    [[ "$engine" != codex || ${test##*/} != gen_agents_md_test.sh ]] || continue
    printf '\n%s: %s\n' "$engine" "${test##*/}"
    (cd "$target" && bash "$test") || failed=1
  done
  for test in docs_policy_test.py docs_toc_test.py; do
    [[ -z ${PDH_TEST_FILTER:-} || $test == $PDH_TEST_FILTER ]] || continue
    python3 -m unittest discover -s "$target/tests/scripts" -p "$test" || failed=1
  done
done
exit "$failed"
