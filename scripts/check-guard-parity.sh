#!/usr/bin/env bash
# check-guard-parity.sh — 判断・契約 layer の guard が claude/ と codex/ の両方に在ることを検査する。
#
# なぜ要るか: skill の判断ルール（停止条件・実装許可・禁止操作・証拠要件）は engine で
# 変えてはならない «利用者との契約» である（docs/PDH-AGENTS.md）。だが実体は各セットの
# skill に別コピーで在り、check-distribution.sh の重複検出は «そのセットが配る file 内» しか
# 見ない（cross-set の同一性は見ない）。片方のセットで guard 文が消えても既存検査は落ちない。
# 実測: codex/ の pdh-coding が停止条件を «よしなに でも進む» に緩めた版が配られ、切り出し
# 再生で共通版が踏まなかった禁止操作（F2）を踏んだ（evals/private/results/2026-09-06-split.md）。
# この検査は、load-bearing な guard 文が両セットに «在る» ことだけを見る（文面の完全一致は
# 見ない。engine ごとの言い換えは docs の契約を守る限り許す）。消えたら落ちる。
set -uo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)" || exit 1

# 各 guard は「両セットの skills に 1 file 以上で現れねばならない» 固定句。
# 句は load-bearing（消えると契約が緩む）で、言い換えに強い最小の断片を選ぶ。
guards=(
  "実 API で 1 経路以上 200 確認"      # 外部 path は実 API で検証（stub で完了としない）
  "product / UX / security"            # 実装が独断で決めず明示回答まで止める判断の列挙
  "確定値を聞き返す"                    # 「よしなに」等の曖昧委譲を拒否して確定値を得る
  "完了判定には使わない"                # 手で組んだ入力（stub）を完了判定に使わない
)

failed=0
for g in "${guards[@]}"; do
  c=$(grep -rl -- "$g" claude/skills/ 2>/dev/null | wc -l | tr -d ' ')
  x=$(grep -rl -- "$g" codex/skills/ 2>/dev/null | wc -l | tr -d ' ')
  if [ "$c" -eq 0 ] || [ "$x" -eq 0 ]; then
    printf 'guard-parity: MISSING — "%s" (claude=%s codex=%s)\n' "$g" "$c" "$x" >&2
    failed=1
  fi
done

if [ "$failed" -ne 0 ]; then
  printf 'check-guard-parity: FAILED — a judgment/contract guard is absent from one set\n' >&2
  exit 1
fi
printf 'check-guard-parity: %d guards present in both claude/ and codex/\n' "${#guards[@]}"
