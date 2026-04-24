---
pdh:
  ticket: calc-multiply
  flow: pdh-ticket-core
  variant: light
  status: ready
---

# current-note.md

## Status

`pdh-flowchart` のデモ実行を開始できる状態です。現在の ticket は計画済みで、実装承認待ちです。

## PD-C-3. 計画

- 計算 evaluator を拡張し、整数の加算に加えて乗算も扱えるようにする。
- 未対応の式は非 0 exit で拒否する。
- `scripts/test-all.sh` を実行し、その結果を実装記録に残す。

## PD-C-6

## PD-C-7. 品質検証結果

品質レビュー待ち。

## PD-C-8. 目的妥当性確認

目的妥当性確認待ち。

## PD-C-9. プロセスチェックリスト

最終検証待ち。

## AC 裏取り結果

| Item | Classification | Status | Evidence | Deferral Ticket |
| --- | --- | --- | --- | --- |
| `uv run calc "1+2"` で `3` が出る | product | unverified | - | - |
| `uv run calc "2*5+1"` で `11` が出る | product | unverified | - | - |
| `uv run calc "2**10"` は非 0 exit で失敗する | product | unverified | - | - |

## Discoveries

- この fixture は、PD-C-6 で小さい実変更が発生するように、初期状態では乗算を未対応にしている。

## Step History
