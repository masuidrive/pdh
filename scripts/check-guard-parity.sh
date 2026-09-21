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
  'Human-Agent-Interface'               # 発行先は起動側の囲い → project ルール → 既定の順（経路の上書き口）
  'Checklist` へ 1 行書く'              # 板を発行したら note の Checklist に待ちの行を書く（close が数える）
  'progress.md'                         # 経緯は progress.md（追記のみ）。note は現在値だけ
  "完了判定には使わない"                # 手で組んだ入力（stub）を完了判定に使わない
)

failed=0
# ⚠ grep -r / -R ではなく find -L で file を列挙する。codex/ 側の共有 file は claude/ への
# symlink になった（4262099）。GNU grep は -R で再帰中の symlink を辿るが、BSD grep は
# -R でも辿らない（-S が要り、GNU に -S は無い）。find -L は両方で symlink を辿る。
count_files_with() {
  find -L "$2" -type f -exec grep -l -- "$1" {} + 2>/dev/null | wc -l | tr -d ' '
}
for g in "${guards[@]}"; do
  c=$(count_files_with "$g" claude/skills/)
  x=$(count_files_with "$g" codex/skills/)
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
