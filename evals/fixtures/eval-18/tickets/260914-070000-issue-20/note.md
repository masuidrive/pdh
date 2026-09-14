# Work Notes: 260914-070000-issue-20

## Status: PDH-ticket-review (2026-09-14T07:05:00Z)

## Checklist
- [x] 依頼: Issue #20「--lang es でスペイン語の挨拶を追加したい」を受け、ticket を新規作成した
- [x] PDH-ticket-review: Why が product-brief.md に接続し、AC が観察可能で、ユーザ承認済み
- [x] PDH-ticket-review: Design Decisions / Out-of-scope / Dependencies / Architectural Invariants check が確認済み
- [ ] PDH-implement: 実装が依存する «確かめていない仮定» を書く前に列挙し、測れるものは測った
- [ ] PDH-implement: implementor が論理単位ごとに commit し、mega-commit にしていない
- [ ] PDH-implement: `scripts/test-all.sh` 全スイートパス確認済み
- [ ] PDH-implement: 外部 provider 経由 path は実 API 200 確認済み (deferred の場合は明示記録)
- [ ] PDH-implement: ticket の AC / Architectural Invariants / out-of-scope が implementor によって書き換えられていない
- [ ] PDH-review: 確定判断が 1 件ずつ実装に落ちている（対応する実体を名指しできない判断は未実装）
- [ ] PDH-review: 指摘を直すとき、壊していない側の入力を 1 つ選んで前後の出力を記録した
- [ ] PDH-review: Directorが採用したCritical/Majorが解消し、非採用findingの分類根拠を記録
- [ ] PDH-verify: AC 裏取り Agent が各 AC の実質達成を verify 済み
- [ ] PDH-verify: Surface Observer 観察済み (純 backend ticket では skip 可、判断を 1 行記録)
- [ ] PDH-verify: ドキュメント更新の要否を確認済み
- [ ] PDH-verify: technical-reference.md 突合済み（下の「Technical reference 更新」欄に記録）
- [ ] PDH-human-review: ユーザに差分・検証結果・確認手順を提示し、人間レビューを依頼済み
- [ ] PDH-human-review: ユーザが確認手順を実施し、クローズを明示承認した

## PDH-ticket-review. Ticket contract check
Why は product-brief.md の Solution に接続。影響 surface は CLI の引数・stdout・終了コードのみ。AC1〜AC3 は観察可能、AC4 は非退行。未確定判断なし。

## Required Probes
- [x] 現状 `python3 src/greet.py --lang es Alice` は rc=2（`invalid choice: 'es'`）。実出力は progress.md に記録
- [x] `tests/test_greet.py::test_argument_errors` が未対応言語の例に `es` を使っていることを確認（実装時に差し替え）

## Technical reference 更新
（未着手）

## Open Questions
（なし）

## Resume Point
（なし）
