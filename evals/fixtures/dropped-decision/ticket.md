---
priority: 2
branch: features/260828-search-rate-limit
status: doing
---

# Ticket: 検索 API に tenant 別のレート制限を入れる

## Why / Intent

特定 tenant の夜間バッチが検索を連続で叩き、同じ時間帯に検索した他 tenant の応答が 8 秒台まで落ちている。今月このサポート問い合わせが 4 件。

## What / Acceptance Criteria

- AC 1: 1 tenant が 1 分あたり 60 回を超えて検索したとき、61 回目以降が 429 で返る
- AC 2: 429 を受けた利用者が、あと何秒待てばよいかを応答から読み取れる
- AC 3: 運用担当が管理画面で、どの tenant が何回制限に掛かったかを日別に見られる

## Architectural Invariants check

`API stateless` と矛盾しない（カウンタは Redis に置き、プロセスに状態を持たない）。

## 確定判断 (Design Decisions)

- **D1: カウンタは Redis の固定窓で数える。**sliding window は採らない（実装量に対して精度の利得が小さい）
- **D2: 制限は検索の handler の中だけで適用する。**アプリ共通の middleware には置かない（共通に置くと、あとから追加される endpoint へ暗黙に広がる）
  - 2026-08-28 変更: 検索の入口が `/search` と `/search/suggest` の 2 handler に分かれており、handler 単位だと同じ呼び出しを 2 か所へ書くことになる。**検索 router にだけ掛ける middleware** へ移した。アプリ共通の middleware には置いていないので、暗黙に広がる懸念は残らない。
- **D3: 上限値は config で環境ごとに上書きできるようにする。**staging では低く回して挙動を見たい

## Out-of-scope

検索以外の endpoint。既存の課金ロジック。
