# Product Brief: sample1 calc

## Background

`pdh-flow` を試すための最小サンプル。実プロジェクトに触らずに PD-C / PD-D の流れを 1 周回せる規模に保つ。

## Who

`pdh-flow` を初めて触る開発者。CLI の `run` / `run-next` / human gate / review loop が実際にどう動くかを、自分の手元で確認したい。

## Problem

実プロジェクトに導入する前に、runtime の動きと structured artifact の中身を見たい。が、空の repo では review step や guard が走らないので感触が掴めない。

## Solution

Python の小さな式評価器 `calc` CLI を題材にした starter サンプル。

- `uv run calc "1+2"` は `3` を返す
- 乗算など未対応の式は非 0 exit で拒否する
- AC を満たす実装を 1 ticket = 1 PD-C cycle で進められる粒度

ticket は `calc-multiply` を初期で同梱しており、`PD-C-3` の計画から実装・レビュー・完了承認までを 1 周通せる。

## Constraints

- Python 3.11+ / uv 利用前提
- 外部依存はゼロ。`ast` module のみで評価する
- 実装規模は `src/calc_demo/` 1 モジュールに収める。CLI コマンド名は `calc` 固定
- runtime tests のフィクスチャを兼ねるので、`current-ticket.md` / `current-note.md` / `scripts/test-all.sh` の構造は壊さない

## Done

`uv run calc "1+2"` と `uv run calc "2*5+1"` が期待通り動き、`uv run calc "2**10"` がエラー終了する。`scripts/test-all.sh` がパスする。
