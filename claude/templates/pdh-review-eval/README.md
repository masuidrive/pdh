---
kind: reference
status: active
read-when: reviewer が過去の欠陥を拾えるかを測り、評価結果を解釈するとき
read-at: [PDH-review, PDH-verify]
stale-when:
  - path: scripts/pdh-review-eval.sh
  - path: docs/pdh-review-eval/cases.json
  - path: .claude/agents/pdh-reviewer.md
  - event: before-use
---

# PDH-review の評価

`cases.json` の defect は close の後で欠陥が見つかった変更、control は後から欠陥が見つかっていない変更である。control の指摘も実在する欠陥の場合があるため、誤検出と決めずに内容を読む。

## 実行と結果

`bash scripts/pdh-review-eval.sh --help` で実行方法を読む。評価は実際の engine を使うため、CI へは入れない。対象の差分・reviewer の定義・dataset を固定して比較する。

`results/` は過去の実測であり、現在の規則として使わない。各結果に残る測定日時・対象 SHA・model・条件と raw 出力を根拠に読む。新しい条件での結果は既存の結果を書き換えずに追加する。

## 限界

LLM の判定は推定である。欠陥を拾ったとする evidence が実際にその欠陥を指すかを読み、起動失敗や判定失敗は成功に数えない。評価用の正解・後の修正・judge の結果は、評価される reviewer に渡さない。

## project の評価セットを作る

初回は同梱の空の `cases.json` をコピーし、project の履歴から記入する。過去の欠陥や実測結果は他の project から写さない。

```json
{"format":1,"cases":[{"id":"example","kind":"defect","measure":true,"ticket":null,"base":"<base SHA>","sha":"<target SHA>","defect":{"summary":"後で見つかった欠陥","location":"path:line"}}]}
```

`kind: control` は既知の欠陥がない比較対象で、`defect` を省ける。`base` と `sha` はその repo で解決できる 7〜40 桁の commit SHA にする。結果の `results/` は追記して条件を固定し、既存の実測を上書きしない。

集計は `bash scripts/pdh-review-tally.sh`。評価には `git`・`jq`・`claude`（codex reviewer を選ぶなら `codex`）が要る。集計と評価は手動で回し、実 engine を使う評価を CI に入れない。
