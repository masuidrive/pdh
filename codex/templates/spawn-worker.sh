#!/bin/bash
# worker を «起動した shell の寿命から切り離して» 走らせ、終わり方を必ず記録する。
#
# ⚠ なぜ切り離すのか（2026-09-15 に実測して分かった）:
#   codex / claude の shell tool は «1 コマンドごとに» timeout を持ち、超えると
#   そのコマンドのプロセスへ SIGTERM を送る。worker をその呼び出しの中で待つと、
#   worker 自身がまだ働いていても約 3 分で刈られる。
#   ある repo の coding-bot の run で 4 回起きた。診断（diag.txt）が捉えた送り主は runner でも
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
#     codex exec --sandbox danger-full-access -o "$d/last-message.txt" -
#   # …別の tool 呼び出しで…
#   bash scripts/spawn-worker.sh --wait "$d" 150   # 0=終了(rc は rc.txt) / 75=まだ走っている
#
# 出力（すべて <出力ディレクトリ> の下）:
#   rc.txt     終了コード。signal で死んだ場合は 128+signo（SIGTERM なら 143）
#   pid.txt    切り離した supervisor の PID
#   diag.txt   signal を受けたときだけ。受けた signal・時刻・親子関係・生きている子
#   spawn.txt  起動時の親子関係（1 回だけ）
#   stdout.txt / stderr.txt  worker の出力（切り離すので呼び出し側の端末には出ない）
#
# codex exec / codex exec review の混雑時は、同じ session を自動再開する。
#   PDH_CODEX_RESUME_MAX=4                    再開の上限（0 で無効）
#   PDH_CODEX_RESUME_DELAY_SECONDS=60         最初の待ち秒数。以後は倍増（60/120/240/480）
#   値は非負整数。不正値なら再開しない。
#   初回=0、再開=1〜。混雑時だけ resume.log、stdout.<回>.txt / stderr.<回>.txt、
#   resume-<回>.prompt.txt を追加する。stdout.txt / stderr.txt は最後の回。
#   再開指示は「モデルの混雑で止まったので、最初の指示の範囲だけで続けて終えて」
#   + 改行 + 最初の指示全文（review は範囲指定も）を保存し、stdin で渡す。
#   --wait は DONE / RUNNING に resumes=<実際に再開した回数> を添える。
#   上限・session id 欠落・組み立てられない引数・signal・混雑以外の失敗で止まる。
#   再開した回の混雑以外の失敗は resume.log と --wait に同じ診断を出す。
set -u

# ---------------------------------------------------------------- --wait モード
if [ "${1:-}" = "--wait" ]; then
  out="${2:-}"
  [ -n "$out" ] || { echo "usage: spawn-worker.sh --wait <out-dir> [seconds]" >&2; exit 64; }
  secs="${3:-150}"
  resume_status() {
    if [ -f "$out/resume.log" ]; then
      awk '$2 == "phase=started" && $3 ~ /^started_at=/ {n++} END {printf " resumes=%d", n}' "$out/resume.log"
    fi
  }
  waited=0
  while [ "$waited" -lt "$secs" ]; do
    if [ -f "$out/rc.txt" ]; then
      echo "DONE rc=$(cat "$out/rc.txt")$(resume_status)"
      if [ -f "$out/resume.log" ]; then
        awk '/^再開の [0-9]+ 回目が混雑以外で終わった/ {print}' "$out/resume.log"
      fi
      exit 0
    fi
    sleep 2
    waited=$((waited + 2))
  done
  # ⚠ «まだ走っている» は失敗ではない。呼び出し側が呼び直すための合図である。
  pid="$(cat "$out/pid.txt" 2>/dev/null || echo unknown)"
  alive=no
  [ "$pid" != unknown ] && kill -0 "$pid" 2>/dev/null && alive=yes
  echo "RUNNING pid=$pid alive=$alive waited=${secs}s$(resume_status) — もう一度 --wait を呼ぶ"
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
  rm -f "$out/resume.log" "$out"/stdout.[0-9]*.txt "$out"/stderr.[0-9]*.txt "$out"/resume-[0-9]*.prompt.txt
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
  resume_active=0
  resume_round=0
  resume_pending=0
  resume_phase=""

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
    if [ "$resume_active" = 1 ]; then
      printf 'round=%s phase=%s at=%s signal=%s rc=%s\n' "$resume_pending" "$resume_phase" \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$signame" "$((128 + signo))" >> "$out/resume.log"
      if [ "$resume_phase" = started ]; then
        cp "$out/stdout.txt" "$out/stdout.$resume_round.txt"
        cp "$out/stderr.txt" "$out/stderr.$resume_round.txt"
      fi
    fi
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
  original_stdin=""
  if [ "${1##*/}" = codex ] && [ "${2:-}" = exec ] && [ -n "$_child_stdin" ]; then
    # 末尾の改行も保存する。初回の worker がファイルを書き換えても最初の指示を使う。
    original_stdin="$(cat "$_child_stdin"; printf '.')"
    original_stdin="${original_stdin%.}"
  fi
  started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if [ -n "$_child_stdin" ]; then
    "$@" < "$_child_stdin" > "$out/stdout.txt" 2> "$out/stderr.txt" &
  else
    "$@" < /dev/null > "$out/stdout.txt" 2> "$out/stderr.txt" &
  fi
  child=$!
  printf '%s\n' "$child" > "$out/child-pid.txt" 2>/dev/null || true
  wait "$child"
  rc=$?
  child=""

  # 未対応の引数は落とさず、再開しない。初回の実行には干渉しない。
  build_resume() {
    local executable="$1" arg value review=0 positional=0 options=1
    [ "${executable##*/}" = codex ] && [ "${2:-}" = exec ] || return 1
    case "$executable" in
      */*) executable="$(cd "$(dirname "$executable")" && pwd)/$(basename "$executable")" ;;
    esac
    resume_command=("$executable" exec resume "$session_id")
    resume_cwd="$PWD"
    original_prompt=""
    review_scope=""
    shift 2
    while [ "$#" -gt 0 ]; do
      arg="$1"
      shift
      if [ "$options" = 1 ]; then
        case "$arg" in
          review)
            [ "$review" = 0 ] && [ "$positional" = 0 ] || return 1
            review=1; continue ;;
          --) options=0; continue ;;
          -c|--config|-m|--model|-o|--output-last-message)
            [ "$#" -gt 0 ] || return 1
            resume_command+=("$arg" "$1"); shift; continue ;;
          --config=*|--model=*|--output-last-message=*|--json)
            resume_command+=("$arg"); continue ;;
          -s|--sandbox|--sandbox=*)
            if [ "$arg" = "${arg#*=}" ]; then
              [ "$#" -gt 0 ] || return 1
              value="$1"; shift
            else
              value="${arg#*=}"
            fi
            case "$value" in read-only|workspace-write|danger-full-access) ;; *) return 1 ;; esac
            resume_command+=(-c "sandbox_mode=\"$value\""); continue ;;
          -C|--cd|--cd=*)
            if [ "$arg" = "${arg#*=}" ]; then
              [ "$#" -gt 0 ] || return 1
              value="$1"; shift
            else
              value="${arg#*=}"
            fi
            resume_cwd="$value"; continue ;;
          --base|--commit|--base=*|--commit=*)
            [ "$review" = 1 ] || return 1
            if [ "$arg" = "${arg#*=}" ]; then
              [ "$#" -gt 0 ] || return 1
              review_scope="${review_scope}${arg} $1"$'\n'; shift
            else
              review_scope="${review_scope}${arg}"$'\n'
            fi
            continue ;;
          --uncommitted)
            [ "$review" = 1 ] || return 1
            review_scope="${review_scope}${arg}"$'\n'; continue ;;
          -) ;;
          -*) return 1 ;;
        esac
      fi
      [ "$positional" = 0 ] || return 1
      original_prompt="$arg"
      positional=1
    done
    [ -d "$resume_cwd" ] || return 1
    resume_command+=(-)
  }

  is_capacity() {
    # signal による終了は、混雑の文言が残っていても再開しない。
    [ "$rc" -gt 0 ] && [ "$rc" -lt 128 ] && grep -qF 'Selected model is at capacity' "$out/stderr.txt"
  }

  if is_capacity; then
    session_id="$(awk '/^[[:space:]]*session id:/ {sub(/^[[:space:]]*session id:[[:space:]]*/, ""); print $1; exit}' "$out/stderr.txt")"
    resume_max="${PDH_CODEX_RESUME_MAX:-4}"
    resume_delay="${PDH_CODEX_RESUME_DELAY_SECONDS:-60}"
    valid_settings=1
    case "$resume_max" in ''|*[!0-9]*) valid_settings=0 ;; esac
    case "$resume_delay" in ''|*[!0-9]*) valid_settings=0 ;; esac
    if [ -n "$session_id" ] && [ "$valid_settings" = 1 ] && build_resume "$@"; then
      resume_max=$((10#$resume_max))
      resume_delay=$((10#$resume_delay))
      resume_active=1
      printf 'round=0 started_at=%s wait=0s rc=%s\n' "$started_at" "$rc" > "$out/resume.log"
      cp "$out/stdout.txt" "$out/stdout.0.txt"
      cp "$out/stderr.txt" "$out/stderr.0.txt"
      while is_capacity; do
        if [ "$resume_round" -ge "$resume_max" ]; then
          printf 'モデルの混雑で %s 回再開したが終わらなかった\n' "$resume_round" >> "$out/resume.log"
          break
        fi
        resume_pending=$((resume_round + 1))
        resume_phase=waiting
        printf 'round=%s phase=waiting at=%s wait=%ss\n' "$resume_pending" \
          "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$resume_delay" >> "$out/resume.log"
        sleep "$resume_delay" &
        child=$!
        wait "$child"
        child=""
        resume_round="$resume_pending"
        {
          printf 'モデルの混雑で止まったので、最初の指示の範囲だけで続けて終えて\n'
          printf '%s' "$review_scope"
          if [ -n "$_child_stdin" ]; then
            printf '%s' "$original_stdin"
          elif [ "$original_prompt" != - ]; then
            printf '%s' "$original_prompt"
          fi
        } > "$out/resume-$resume_round.prompt.txt"
        started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        resume_phase=started
        printf 'round=%s phase=started started_at=%s wait=%ss\n' "$resume_round" \
          "$started_at" "$resume_delay" >> "$out/resume.log"
        (
          cd "$resume_cwd" || exit 1
          exec "${resume_command[@]}"
        ) < "$out/resume-$resume_round.prompt.txt" > "$out/stdout.txt" 2> "$out/stderr.txt" &
        child=$!
        printf '%s\n' "$child" > "$out/child-pid.txt" 2>/dev/null || true
        wait "$child"
        rc=$?
        child=""
        cp "$out/stdout.txt" "$out/stdout.$resume_round.txt"
        cp "$out/stderr.txt" "$out/stderr.$resume_round.txt"
        printf 'round=%s started_at=%s wait=%ss rc=%s\n' "$resume_round" \
          "$started_at" "$resume_delay" "$rc" >> "$out/resume.log"
        if [ "$rc" -ne 0 ] && ! is_capacity; then
          printf '再開の %s 回目が混雑以外で終わった（rc=%s）。`stderr.%s.txt` を見る\n' \
            "$resume_round" "$rc" "$resume_round" >> "$out/resume.log"
        fi
        resume_delay=$((resume_delay * 2))
      done
    fi
  fi

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
