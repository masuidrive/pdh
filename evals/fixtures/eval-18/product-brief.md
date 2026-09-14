# Product Brief: greet — 小さな挨拶 CLI

## Who
コマンドラインで簡単に挨拶メッセージを出したい開発者。

## Problem
`echo` を毎回書くのは味気ない。名前を渡すと気の利いた挨拶を返す小さな道具が欲しい。

## Solution
`greet <name>` で挨拶を表示する単一スクリプト。依存は Python 3 標準ライブラリのみ。

## Appetite
小さく保つ。外部依存やサービスを持ち込まない。

## Constraints
- Python 3（標準ライブラリのみ）で動くこと。
- 1 ファイル（`src/greet.py`）に収める。

## Architectural Invariants
- `AI-1` 外部ネットワークアクセスをしない。ローカルで完結する。

## Non-goals
- GUI・Web UI を持つこと。
- 挨拶文の外部 API 取得。

## Open Questions
（現時点でなし）
