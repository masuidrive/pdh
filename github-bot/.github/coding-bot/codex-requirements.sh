#!/usr/bin/env bash
# Install the login policy in a disposable bot container, never replace host policy.
set -euo pipefail

codex_place_login_requirement() {
  local directory="$1"
  local requirement="$2"
  mkdir -p "$directory" || return 1
  # A persistent container may already have the exact policy from a previous run.
  if cmp -s "$directory/requirements.toml" <(printf '%s\n' "$requirement"); then
    return 0
  fi
  # Reused containers can change login mode. Replace only the exact legacy bot
  # policy or our complete generated policy; administrator additions are kept.
  if [ -f "$directory/requirements.toml" ] &&
     { cmp -s "$directory/requirements.toml" <(printf 'allowed_login_methods = ["chatgpt"]\n') ||
       { grep -q '^# Managed by coding-bot: subscription provider$' "$directory/requirements.toml" &&
         python3 "$(dirname "${BASH_SOURCE[0]}")/siwc-config.py" --owns "$directory/requirements.toml"; }; }; then
    local temporary
    temporary=$(mktemp "$directory/.requirements.XXXXXX") || return 1
    if printf '%s\n' "$requirement" > "$temporary" && chmod 644 "$temporary" &&
       mv -f "$temporary" "$directory/requirements.toml"; then
      return 0
    fi
    rm -f "$temporary"
    return 1
  fi
  # Existing administrator requirements may include unrelated restrictions.
  # Leave them intact and let the caller retain the config.toml guard instead.
  ( umask 022; set -o noclobber
    printf '%s\n' "$requirement" > "$directory/requirements.toml"
  ) 2>/dev/null || return 1
}

codex_install_login_requirement() {
  local directory="$1"
  shift
  local requirement='allowed_login_methods = ["chatgpt"]' diagnostic status=0 siwc=false
  if [ "${CODING_BOT_CODEX_AUTH_MODE:-}" = siwc ]; then
    siwc=true
    requirement=$(python3 "$(dirname "${BASH_SOURCE[0]}")/siwc-config.py") || return 1
  fi
  if ! "$siwc" && cmp -s "$directory/requirements.toml" <(printf '%s\n' "$requirement"); then
    return 0
  fi
  # Only file placement needs root. Keep Codex and its interpreter on the bot's
  # original PATH: sudo's secure_path need not contain a user-installed CLI.
  if [ "$#" -gt 0 ]; then
    "$@" bash -c 'source "$1"; codex_place_login_requirement "$2" "$3"' \
      bash "${BASH_SOURCE[0]}" "$directory" "$requirement" || return 1
  else
    codex_place_login_requirement "$directory" "$requirement" || return 1
  fi
  cmp -s "$directory/requirements.toml" <(printf '%s\n' "$requirement") || return 1
  # This local-only command reads managed requirements before checking login state.
  # Not logged in (exit 1) is fine; only a requirements loading error rolls back.
  diagnostic=$(codex login status 2>&1) || status=$?
  if grep -qi 'requirements' <<< "$diagnostic" &&
     grep -qiE 'failed|error|invalid|could not|unable' <<< "$diagnostic"; then
    # Never remove an administrator's replacement made during the check.
    if cmp -s "$directory/requirements.toml" <(printf '%s\n' "$requirement"); then
      "$@" rm -f "$directory/requirements.toml" || return 1
    fi
    echo '::warning::Codex が requirements を読み込めないため、今回配置した制限は使いません。'
    return 1
  fi
  if [ "$status" -ne 0 ] &&
     { [ "$status" -ne 1 ] || ! grep -qi '^Not logged in' <<< "$diagnostic"; }; then
    if "$siwc"; then
      echo "::error::SIWC の requirements を確認できないため Codex を使いません（終了コード: $status）。"
      return 1
    fi
    echo "::warning::Codex が requirements を読み込めるか確認できなかったため、配置したまま続けます（終了コード: $status）。"
  fi
  cmp -s "$directory/requirements.toml" <(printf '%s\n' "$requirement") || return 1
  return 0
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  if [ "$(id -u)" -ne 0 ]; then
    codex_install_login_requirement /etc/codex sudo -n
  else
    codex_install_login_requirement /etc/codex
  fi
fi
