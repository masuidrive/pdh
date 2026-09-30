#!/usr/bin/env bash
# Source this before the agent starts so the updated CLI paths reach later steps.
set -euo pipefail

coding_bot_update_tools() {
  local has_codex=false has_claude=false codex_ready=true
  local codex_prefix="$HOME/.cache/coding-bot/codex-latest" codex_bin= version
  local claude_update_failed=false
  local entry entry_dir entry_path temporary
  local codex_previous="$codex_prefix.previous" codex_was_verified=false codex_saved=false
  local -A codex_entries=()
  # Recover a verified prefix left aside by a canceled refresh before PATH lookup.
  if ! "$codex_prefix/bin/codex" --version >/dev/null 2>&1 &&
    "$codex_previous/bin/codex" --version >/dev/null 2>&1; then
    if ! { rm -rf -- "$codex_prefix" && mv -T -- "$codex_previous" "$codex_prefix"; }; then
      echo '::warning::Codex interrupted update could not be recovered.'
    fi
  fi
  command -v codex >/dev/null 2>&1 && has_codex=true
  command -v claude >/dev/null 2>&1 && has_claude=true

  if "$has_codex"; then
    if [ -f "$HOME/.nvm/nvm.sh" ]; then
      source "$HOME/.nvm/nvm.sh" || codex_ready=false
    fi
    # Reused containers may already have entries pointing at this prefix.
    # Save its verified contents so a failed refresh can restore those targets.
    if "$codex_prefix/bin/codex" --version >/dev/null 2>&1; then
      codex_was_verified=true
      if "$codex_ready"; then
        if rm -rf -- "$codex_previous" && mv -T -- "$codex_prefix" "$codex_previous"; then
          codex_saved=true
        else
          codex_ready=false
        fi
      fi
    fi
    # Never update the baked global install: npm can remove it before timing out.
    if "$codex_ready" && rm -rf "$codex_prefix" &&
      timeout -k 10s 180s npm install -g --prefix "$codex_prefix" @openai/codex@latest &&
      "$codex_prefix/bin/codex" --version >/dev/null 2>&1; then
      codex_bin="$codex_prefix/bin"
      if "$codex_saved"; then rm -rf -- "$codex_previous" || true; fi
    else
      if "$codex_saved"; then
        if ! { rm -rf -- "$codex_prefix" && mv -T -- "$codex_previous" "$codex_prefix"; }; then
          echo '::warning::Codex previous verified install could not be restored.'
        fi
      elif ! "$codex_was_verified"; then
        rm -rf "$codex_prefix" || true
      fi
      if "$codex_was_verified"; then
        echo '::warning::Codex update failed; using the previously verified version.'
      else
        echo '::warning::Codex update failed; using the baked version.'
      fi
    fi
  fi
  # The native Claude installer writes here.
  export PATH="$HOME/.local/bin:$PATH"
  hash -r
  if "$has_claude"; then
    if ! timeout -k 10s 180s claude update; then
      if ! timeout -k 10s 180s bash -c 'set -euo pipefail; curl -fsSL https://claude.ai/install.sh | bash'; then
        claude_update_failed=true
      fi
    fi
  fi
  if [ -n "$codex_bin" ]; then
    # Resolve parent directories, but never follow the final codex symlink:
    # it can point inside the baked npm package, which must remain untouched.
    while IFS= read -r entry; do
      if ! entry_dir=$(cd -- "$(dirname -- "$entry")" && pwd -P); then
        echo "::warning::Codex entry cannot be resolved: $entry"
        continue
      fi
      entry_path="$entry_dir/codex"
      if [ "$entry_dir" -ef "$codex_bin" ] || [ -n "${codex_entries[$entry_path]:-}" ]; then
        continue
      fi
      codex_entries["$entry_path"]=1
      # Same-directory rename replaces only the entry, including npm's symlinks.
      if temporary=$(mktemp "$entry_dir/.codex-update.XXXXXX"); then
        if ln -sf -- "$codex_bin/codex" "$temporary" && mv -Tf -- "$temporary" "$entry_path"; then
          continue
        fi
        rm -f -- "$temporary" || true
      fi
      echo "::warning::Codex entry could not be replaced: $entry_path; keeping PATH fallback."
    done < <(type -aP codex || true)
    # Secondary fallback for entries whose directories cannot be written.
    export PATH="$codex_bin:$PATH"
  fi
  hash -r
  if "$has_codex"; then
    if version=$(codex --version); then
      echo "::notice::Codex: $version"
    else
      echo '::error::Codex is not runnable'
    fi
  fi
  if "$has_claude"; then
    if version=$(claude --version); then
      if "$claude_update_failed"; then
        echo '::warning::Claude Code update failed; using the baked version.'
      fi
      echo "::notice::Claude Code: $version"
    else
      echo '::error::Claude Code is not runnable'
    fi
  fi
  return 0
}

coding_bot_update_tools
