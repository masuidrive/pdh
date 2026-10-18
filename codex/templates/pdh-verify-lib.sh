# pdh-verify-lib.sh — shared helpers for the PDH verify scripts.
#
# Sourced (not executed) by scripts/dev-server.sh and scripts/seed-pdh-verify.sh.
# Keep this to pure helper functions; no top-level side effects.

# upsert_env FILE KEY VALUE
#   Insert or replace a `KEY=value` line in FILE (chmod 600). The value is
#   written with `printf %q` so the file stays safe to `source` even when the
#   value contains spaces or quotes (e.g. a full psql cleanup command). This is
#   the single writer of keys.env for both scripts, so secret handling can never
#   diverge between them.
upsert_env() {
  local file="$1" key="$2" val="$3" tmp
  touch "$file"
  chmod 600 "$file"
  tmp="$(mktemp)"
  grep -v -E "^${key}=" "$file" > "$tmp" 2>/dev/null || true
  printf '%s=%q\n' "$key" "$val" >> "$tmp"
  mv "$tmp" "$file"
  chmod 600 "$file"
}
