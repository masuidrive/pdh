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
# 混雑時は codex exec を同じ session で再開し、codex exec review は最初から起動し直す。
#   PDH_CODEX_RESUME_MAX=4                    再開の上限（0 で無効）
#   PDH_CODEX_RESUME_DELAY_SECONDS=60         最初の待ち秒数。以後は倍増（60/120/240/480）
#   値は非負整数。不正値なら再開せず、混雑時だけ supervisor.log に理由を1行残す。
#   0 で無効にした場合は記録ファイルを追加せず、--wait の表示も従来どおり。
#   判定は stderr の行頭 ERROR: の最後の1行が Selected model is at capacity のとき。
#   --json は stdout の最後の error / turn.failed を判定し、exec は thread.started の id を使う。
#   初回=0、再開/起動し直し=1〜。混雑時だけ resume.log、stdout.<回>.txt / stderr.<回>.txt
#   を追加する。stdout.txt / stderr.txt は最後の回。resume.log の各回の行には
#   action=exec-resume / action=review-restart を付ける。
#   再開指示は「モデルの混雑で止まったので、最初の指示の範囲だけで続けて終えて」
#   + 改行 + 最初の指示全文を resume-<回>.prompt.txt に保存し、stdin で渡す。
#   review は元の引数・cwd・起動時に保存した stdin で起動し直し、再開指示は作らない。
#   --wait は DONE / RUNNING に resumes=<実際に再開した回数> を添える。
#   上限・signal・混雑以外の失敗で止まる。exec は session id 欠落や組み立てられない
#   引数でも止まる。review の起動し直しには session id は要らない。
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
      printf 'round=%s phase=%s at=%s signal=%s rc=%s action=%s\n' "$resume_pending" "$resume_phase" \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$signame" "$((128 + signo))" "$retry_action" >> "$out/resume.log"
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
    local executable="$1" arg value positional=0 options=1
    [ "${executable##*/}" = codex ] && [ "${2:-}" = exec ] || return 1
    case "$executable" in
      */*) executable="$(cd "$(dirname "$executable")" && pwd)/$(basename "$executable")" ;;
    esac
    resume_command=("$executable" exec resume "$session_id")
    resume_cwd="$PWD"
    original_prompt=""
    shift 2
    while [ "$#" -gt 0 ]; do
      arg="$1"
      shift
      if [ "$options" = 1 ]; then
        case "$arg" in
          --) options=0; continue ;;
          -c|--config|-m|--model|--enable|--disable)
            [ "$#" -gt 0 ] || return 1
            resume_command+=("$arg" "$1"); shift; continue ;;
          -o|--output-last-message|--output-last-message=*|--output-schema|--output-schema=*|-i|-i=*|--image|--image=*)
            if [ "$arg" = "${arg#*=}" ]; then
              [ "$#" -gt 0 ] || return 1
              value="$1"; shift
            else
              value="${arg#*=}"
            fi
            # exec は出力・schema・画像のパスを -C の先でなく、プロセスの cwd 基準で解決する。
            case "$value" in /*) ;; *) value="$PWD/$value" ;; esac
            if [ "$arg" = "${arg#*=}" ]; then
              resume_command+=("$arg" "$value")
            else
              resume_command+=("${arg%%=*}=$value")
            fi
            continue ;;
          --config=*|--model=*|--enable=*|--disable=*|--json|--skip-git-repo-check|--dangerously-bypass-approvals-and-sandbox|--strict-config|--ignore-user-config|--ignore-rules|--dangerously-bypass-hook-trust)
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
          -) ;;
          -*) return 1 ;;
        esac
      fi
      [ "$positional" = 0 ] || return 1
      original_prompt="$arg"
      positional=1
    done
    # stdin と引数 prompt は exec 側で合成される。再現できない形は落とさず止める。
    if [ -n "$_child_stdin" ] && [ "$positional" = 1 ] && [ "$original_prompt" != - ]; then return 1; fi
    [ -d "$resume_cwd" ] || return 1
    resume_command+=(-)
  }

  json_mode=0
  # option の値や -- の後の prompt を --json や review subcommand と取り違えない。
  json_options=1
  json_value=0
  retry_action=exec-resume
  command_position=1
  for arg in "${@:3}"; do
    [ "$json_options" = 1 ] || break
    if [ "$json_value" = 1 ]; then json_value=0; continue; fi
    case "$arg" in
      --) json_options=0 ;;
      --json) json_mode=1 ;;
      -c|--config|-m|--model|-o|--output-last-message|-s|--sandbox|-C|--cd|--base|--commit|--output-schema|-i|--image|--enable|--disable|-p|--profile|--local-provider|--add-dir|--thread-source|--cyber-access-program|--color|--title) json_value=1 ;;
      review)
        if [ "$command_position" = 1 ]; then retry_action=review-restart; fi
        command_position=0 ;;
      -*) ;;
      *) command_position=0 ;;
    esac
  done

  json_events() {
    # Codex の JSONL を文字列・階層ごとに読む。ツール出力内の JSON や文言は判定しない。
    # 対象は実 CLI の thread.started / error / turn.failed。未知の error は停止側に倒す。
    # 大きなツール本文は parser に渡さない。候補でも階層は awk で検査する。
    grep -E '"type"[[:space:]]*:[[:space:]]*"(thread\.started|error|turn\.failed)"' "$out/stdout.txt" | awk -v mode="$1" '
      function string_value(    c, value) {
        value=""
        for (pos++; pos <= length($0); pos++) {
          c=substr($0,pos,1)
          if (c == "\"") return value
          if (c == "\\") {
            c=substr($0,++pos,1)
            if (c == "n") c="\n"
            else if (c == "r") c="\r"
            else if (c == "t") c="\t"
          }
          value=value c
        }
        malformed=1
        return value
      }
      {
        depth=0; event=""; id=""; message=""; nested_message=""; malformed=0
        for (pos=1; pos <= length($0); pos++) {
          c=substr($0,pos,1)
          if (c == "{" || c == "[") {depth++; key[depth]=""; value_next[depth]=0}
          else if (c == "}" || c == "]") depth--
          else if (c == ":") value_next[depth]=1
          else if (c == ",") {key[depth]=""; value_next[depth]=0}
          else if (c == "\"") {
            value=string_value()
            if (!value_next[depth]) key[depth]=value
            else if (depth == 1) {
              if (key[1] == "type") event=value
              else if (key[1] == "thread_id") id=value
              else if (key[1] == "message") message=value
            } else if (depth == 2 && key[1] == "error" && key[2] == "message") nested_message=value
          }
        }
        if (depth != 0 || malformed) next
        if (mode == "session" && event == "thread.started") {print id; exit}
        if (event == "error") last_error=message
        else if (event == "turn.failed") last_error=nested_message
      }
      END {
        if (mode == "capacity") {
          exit !(last_error ~ /^(stream disconnected before completion: )?Selected model is at capacity([. ]|$)/)
        }
      }
    '
  }

  is_capacity() {
    # signal による終了は、混雑の文言が残っていても再開しない。
    [ "$rc" -gt 0 ] && [ "$rc" -lt 128 ] || return 1
    if [ "$json_mode" = 1 ]; then
      json_events capacity
    else
      # ERROR の後に tracing や token 数が続いても、最後の ERROR だけで決める。
      awk '/^ERROR:/ {last_error=$0} END {exit !(last_error ~ /^ERROR: Selected model is at capacity([. ]|$)/)}' "$out/stderr.txt"
    fi
  }

  if [ "${1##*/}" = codex ] && [ "${2:-}" = exec ] && is_capacity; then
    session_id=""
    if [ "$retry_action" = exec-resume ]; then
      if [ "$json_mode" = 1 ]; then
        session_id="$(json_events session)"
      else
        session_id="$(awk '/^[[:space:]]*session id:/ {sub(/^[[:space:]]*session id:[[:space:]]*/, ""); print $1; exit}' "$out/stderr.txt")"
      fi
    fi
    resume_max="${PDH_CODEX_RESUME_MAX-4}"
    resume_delay="${PDH_CODEX_RESUME_DELAY_SECONDS-60}"
    valid_settings=1
    case "$resume_max" in ''|*[!0-9]*) valid_settings=0 ;; esac
    case "$resume_delay" in ''|*[!0-9]*) valid_settings=0 ;; esac
    if [ "$valid_settings" = 0 ]; then
      printf '自動再開しない: PDH_CODEX_RESUME_MAX=<%s> / PDH_CODEX_RESUME_DELAY_SECONDS=<%s> は非負整数が必要\n' "$resume_max" "$resume_delay"
    else
      resume_max=$((10#$resume_max))
      resume_delay=$((10#$resume_delay))
    fi
    retry_ready=0
    if [ "$valid_settings" = 1 ] && [ "$resume_max" -gt 0 ]; then
      if [ "$retry_action" = review-restart ]; then
        retry_ready=1
      elif [ -n "$session_id" ] && build_resume "$@"; then
        retry_ready=1
      fi
    fi
    if [ "$retry_ready" = 1 ]; then
      resume_active=1
      printf 'round=0 started_at=%s wait=0s rc=%s action=%s\n' "$started_at" "$rc" "$retry_action" > "$out/resume.log"
      cp "$out/stdout.txt" "$out/stdout.0.txt"
      cp "$out/stderr.txt" "$out/stderr.0.txt"
      while is_capacity; do
        if [ "$resume_round" -ge "$resume_max" ]; then
          printf 'モデルの混雑で %s 回再開したが終わらなかった\n' "$resume_round" >> "$out/resume.log"
          break
        fi
        resume_pending=$((resume_round + 1))
        resume_phase=waiting
        printf 'round=%s phase=waiting at=%s wait=%ss action=%s\n' "$resume_pending" \
          "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$resume_delay" "$retry_action" >> "$out/resume.log"
        sleep "$resume_delay" &
        child=$!
        wait "$child"
        child=""
        resume_round="$resume_pending"
        if [ "$retry_action" = exec-resume ]; then
          {
            printf 'モデルの混雑で止まったので、最初の指示の範囲だけで続けて終えて\n'
            if [ -n "$_child_stdin" ]; then
              printf '%s' "$original_stdin"
            elif [ "$original_prompt" != - ]; then
              printf '%s' "$original_prompt"
            fi
          } > "$out/resume-$resume_round.prompt.txt"
        fi
        started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        resume_phase=started
        printf 'round=%s phase=started started_at=%s wait=%ss action=%s\n' "$resume_round" \
          "$started_at" "$resume_delay" "$retry_action" >> "$out/resume.log"
        if [ "$retry_action" = review-restart ]; then
          # resume は reviewer の指示と元の review prompt を引き継がない。
          # ファイルを読み直さず、初回起動時に保存した stdin をそのまま渡す。
          "$@" < <(printf '%s' "$original_stdin") > "$out/stdout.txt" 2> "$out/stderr.txt" &
        else
          (
            cd "$resume_cwd" || exit 1
            exec "${resume_command[@]}"
          ) < "$out/resume-$resume_round.prompt.txt" > "$out/stdout.txt" 2> "$out/stderr.txt" &
        fi
        child=$!
        printf '%s\n' "$child" > "$out/child-pid.txt" 2>/dev/null || true
        wait "$child"
        rc=$?
        child=""
        cp "$out/stdout.txt" "$out/stdout.$resume_round.txt"
        cp "$out/stderr.txt" "$out/stderr.$resume_round.txt"
        printf 'round=%s started_at=%s wait=%ss rc=%s action=%s\n' "$resume_round" \
          "$started_at" "$resume_delay" "$rc" "$retry_action" >> "$out/resume.log"
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
