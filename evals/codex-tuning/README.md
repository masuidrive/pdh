# Codex 向け PDH チューニング

[実測結果と採用判断](results.md) に初回比較・修正後の確認・残る制約をまとめた。
目的、判定条件、作業記録は [evaluation-plan.md](evaluation-plan.md) に記録する。
`candidate-core.md` は最初の短い診断候補であり、配布版そのものではない。
配布文面の比較では、以下のコマンドで対象版を固定する。

```bash
python3 scripts/prepare-codex-probes.py --revision 37f1763 \
  --kind decisions --output /tmp/pdh-old-decisions
python3 scripts/prepare-codex-probes.py --kind decisions \
  --output /tmp/pdh-new-decisions
python3 scripts/codex-eval.py --prompt /tmp/pdh-new-decisions/prompt.md \
  --output-root evals/private/codex-tuning/runs \
  --task decisions --variant distributed \
  --model gpt-5.6-sol --effort high --codex /absolute/path/to/codex
```

Node を直接指定する環境では `--node /absolute/path/to/node` と、`--codex` に Codex の JS エントリポイントを渡す。
`--kind evidence` は証拠の既知・未知を分けた対照課題を作る。
出力先は毎回新しいディレクトリにし、同じ条件の繰り返しでも実行記録を上書きしない。

ランナーは ChatGPT 認証を指定して API キーを子プロセスから除き、ツールを無効化する。
実行記録は要求したモデル・推論強度、prompt hash、経過時間、当該実行の JSON 使用量を持つ。
実際に提供されたモデルは JSON 出力だけでは確認できないため、不明として記録する。
終了成功と品質の PASS は別である。

採点者へは状況、回答、対応する `*-rubric.json` だけを渡し、モデル・版の対応表を渡さない。
実行者へ採点基準や過去の回答を渡さない。
D3 の元の採点条件は本文の観測漏れを直接採点しないため、達成の過大主張は別途留保として記録する。
証拠の有無を明示した E1/E2 の結果と混ぜない。

ここで測るのは指示の解釈であり、実際のツール利用、独立 agent の起動、実案件全体の完遂ではない。
非公開実案件の切り出しと成果物評価は `evals/private/codex-tuning/replay/` に隔離する。
公開レポートには集計と制約だけを載せ、入力原文や個人情報を転載しない。
