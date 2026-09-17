#!/bin/bash
# worker を «起動した shell の寿命から切り離して» 走らせ、終わり方を必ず記録する。
#
# ⚠ なぜ切り離すのか（2026-09-15 に実測して分かった）:
#   codex / claude の shell tool は «1 コマンドごとに» timeout を持ち、超えると
#   そのコマンドのプロセスへ SIGTERM を送る。worker をその呼び出しの中で待つと、
#   worker 自身がまだ働いていても約 3 分で刈られる。
#   ある repo の coding-robot の run で 4 回起きた。診断（diag.txt）が捉えた送り主は runner でも
#   OOM でもなく «親の codex プロセス» で、2 件とも «自分が起動してから» 181 秒・
#   183 秒だった（起動時刻は 73 秒ずれていたので、全体の締切ではない）。
#
# したがって worker は別 session（`setsid` が無ければ別 process group）へ出し、
# この script は即座に返る。
# 呼び出し側は --wait で «短く区切って» 待ち、まだなら何度でも呼び直す。
# ⚠ 1 回の --wait を長くしても意味がない。長くした分だけ shell tool の timeout に
#   近づくだけである。
#
# 使い方:
#   bash scripts/spawn-worker.sh <出力ディレクトリ> -- <コマンド...>   # 起動して即返る
#   bash scripts/spawn-worker.sh --wait <出力ディレクトリ> [秒]          # 終了を待つ
#
# 例:
#   d=tmp/worker-qa
#   bash scripts/spawn-worker.sh --stdin "$d/prompt.txt" "$d" -- \
#     codex exec --sandbox danger-full-access -m gpt-5.6-sol -o "$d/last-message.txt" -
#   # …別の tool 呼び出しで…
#   bash scripts/spawn-worker.sh --wait "$d" 150   # 0=終了(rc は rc.txt) / 75=まだ走っている
#
# 出力（すべて <出力ディレクトリ> の下）:
#   rc.txt     終了コード。signal で死んだ場合は 128+signo（SIGTERM なら 143）
#   pid.txt    切り離した supervisor の PID
#   diag.txt   signal を受けたときだけ。受けた signal・時刻・親子関係・生きている子
#   spawn.txt  起動時の親子関係（1 回だけ）
#   stdout.txt / stderr.txt  worker の出力（切り離すので呼び出し側の端末には出ない）
set -u

# ---------------------------------------------------------------- --wait モード
if [ "${1:-}" = "--wait" ]; then
  out="${2:-}"
  [ -n "$out" ] || { echo "usage: spawn-worker.sh --wait <out-dir> [seconds]" >&2; exit 64; }
  secs="${3:-150}"
  waited=0
  while [ "$waited" -lt "$secs" ]; do
    if [ -f "$out/rc.txt" ]; then
      echo "DONE rc=$(cat "$out/rc.txt")"
      exit 0
    fi
    sleep 2
    waited=$((waited + 2))
  done
  # ⚠ «まだ走っている» は失敗ではない。呼び出し側が呼び直すための合図である。
  pid="$(cat "$out/pid.txt" 2>/dev/null || echo unknown)"
  alive=no
  [ "$pid" != unknown ] && kill -0 "$pid" 2>/dev/null && alive=yes
  echo "RUNNING pid=$pid alive=$alive waited=${secs}s — もう一度 --wait を呼ぶ"
  exit 75
fi

# ---------------------------------------------------------------- 起動モード
stdin_file=""
if [ "${1:-}" = "--stdin" ]; then
  stdin_file="${2:-}"
  [ -n "$stdin_file" ] && [ -r "$stdin_file" ] || { echo "spawn-worker.sh: --stdin のファイルが読めない: ${stdin_file:-(未指定)}" >&2; exit 66; }
  stdin_file="$(cd "$(dirname "$stdin_file")" && pwd)/$(basename "$stdin_file")"
  shift 2
fi

out="${1:-}"
[ -n "$out" ] || { echo "usage: spawn-worker.sh [--stdin <file>] <out-dir> -- <command...>" >&2; exit 64; }
shift
[ "${1:-}" = "--" ] || { echo "usage: spawn-worker.sh <out-dir> -- <command...>" >&2; exit 64; }
shift
[ "$#" -gt 0 ] || { echo "spawn-worker.sh: コマンドが指定されていない" >&2; exit 64; }

mkdir -p "$out"
out="$(cd "$out" && pwd)"   # 切り離した先では相対パスが効かない

# ⚠ 前回の残骸の掃除は launcher だけが行う。supervisor も掃除すると、launcher が
#   書いた pid.txt を «後から» 消してしまう（2026-09-15 に実測。pid.txt だけが
#   消え、--wait が supervisor の生死を確かめられなくなっていた）。
if [ "${_SPAWN_WORKER_SUPERVISOR:-}" != "1" ]; then
  rm -f "$out/rc.txt" "$out/diag.txt" "$out/pid.txt" "$out/child-pid.txt"
fi

# supervisor 本体。切り離した先で走る。
if [ "${_SPAWN_WORKER_SUPERVISOR:-}" = "1" ]; then
  {
    printf 'started_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'self_pid=%s parent_pid=%s\n' "$$" "$PPID"
    printf 'session_leader=%s\n' "$(ps -o sid= -p "$$" 2>/dev/null | tr -d ' ')"
    printf 'command=%s\n' "$*"
  } > "$out/spawn.txt" 2>/dev/null || true

  child=""

  # signal を受けた «その場» で記録する。事後の ps では子が消えていて追えない。
  on_signal() {
    local signame="$1" signo="$2"
    {
      printf 'signal=%s (%s)\n' "$signame" "$signo"
      printf 'at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      printf 'self_pid=%s parent_pid=%s\n' "$$" "$PPID"
      printf 'parent_chain=%s\n' "$(ps -o pid=,ppid=,comm=,args= -p "$PPID" 2>/dev/null | head -c 400 | tr '\n' ';')"
      printf 'child_pid=%s child_alive=%s\n' "${child:-none}" \
        "$([ -n "$child" ] && kill -0 "$child" 2>/dev/null && echo yes || echo no)"
      printf 'descendants=%s\n' "$(pgrep -P "$$" 2>/dev/null | tr '\n' ' ')"
    } >> "$out/diag.txt" 2>/dev/null || true

    [ -n "$child" ] && kill -s "$signame" "$child" 2>/dev/null
    printf '%s\n' "$((128 + signo))" > "$out/rc.txt" 2>/dev/null || true
    exit "$((128 + signo))"
  }

  trap 'on_signal TERM 15' TERM
  trap 'on_signal INT 2'   INT
  trap 'on_signal HUP 1'   HUP

  # ⚠ 制御用の env を子へ渡さない。渡すと、worker の中でこの script を使い直したとき
  # «既に supervisor である» と誤認して切り離しを飛ばし、しかも親の stdin を読む
  # （2026-09-15、独立 review が実測つきで検出）。
  _child_stdin="${_SPAWN_WORKER_STDIN:-}"
  unset _SPAWN_WORKER_SUPERVISOR _SPAWN_WORKER_STDIN
  if [ -n "$_child_stdin" ]; then
    "$@" < "$_child_stdin" > "$out/stdout.txt" 2> "$out/stderr.txt" &
  else
    "$@" < /dev/null > "$out/stdout.txt" 2> "$out/stderr.txt" &
  fi
  child=$!
  printf '%s\n' "$child" > "$out/child-pid.txt" 2>/dev/null || true
  wait "$child"
  rc=$?

  # 正常に抜けた場合もここで必ず書く。⚠ rc.txt が «無い» ことを «不明» と読まずに済む。
  printf '%s\n' "$rc" > "$out/rc.txt" 2>/dev/null || true
  exit "$rc"
fi

# ---- ここからが入口。別 session / 別 process group へ出し、即座に返る。
# ⚠ `setsid` は macOS に無い。あれば別 session（いちばん強い切り離し）、無ければ
# `set -m` で別 process group へ出す（`_execution-team.md`「並行起動」が定める方法）。
# 後者でも «呼び出し側の group へ送られた signal が worker へ届かない» は満たす。
if command -v setsid >/dev/null 2>&1; then
  _SPAWN_WORKER_SUPERVISOR=1 _SPAWN_WORKER_STDIN="$stdin_file" \
    setsid bash "$0" "$out" -- "$@" < /dev/null \
    > "$out/supervisor.log" 2>&1 &
else
  set -m
  _SPAWN_WORKER_SUPERVISOR=1 _SPAWN_WORKER_STDIN="$stdin_file" \
    bash "$0" "$out" -- "$@" < /dev/null \
    > "$out/supervisor.log" 2>&1 &
  set +m
fi
sv=$!
disown "$sv" 2>/dev/null || true
printf '%s\n' "$sv" > "$out/pid.txt"

echo "SPAWNED pid=$sv out=$out"
echo "待つときは: bash scripts/spawn-worker.sh --wait $out 150"
exit 0
