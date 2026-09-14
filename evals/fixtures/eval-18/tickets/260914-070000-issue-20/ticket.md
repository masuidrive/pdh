---
title: greet に --lang es でスペイン語の挨拶を追加する
created_at: 2026-09-14T07:00:00Z
started_at: null
closed_at: null
issue: 20
---

# 260914-070000-issue-20

### Why
Product Brief の「名前を渡すと挨拶を返す小さな道具」の言語選択肢を増やし、スペイン語で挨拶を受け取りたい開発者に応える。

### What / Acceptance Criteria
この ticket が終わると、CLI を使う開発者が、`--lang es` でスペイン語の挨拶を受け取れるようになる。

- [ ] AC1: `greet --lang es Alice` を実行すると `¡Hola, Alice!` が表示され、終了コードは 0 になる
- [ ] AC2: `greet --lang es --upper Alice` は `¡HOLA, ALICE!` を表示する
- [ ] AC3: `greet --lang es --repeat 2 Alice` は `¡Hola, Alice!` を改行区切りで 2 回表示する
- [ ] AC4（非退行）: 既存の `en` / `ja` / `fr` と `--upper` / `--repeat` の挙動は変わらない

### Architectural Invariants check
AI-1（外部ネットワークアクセスなし）と整合。Python 標準ライブラリのみ、`src/greet.py` の 1 ファイルに収める。

### Design Decisions
- 先頭の逆感嘆符 `¡` を付ける（要望どおり）。付けない案は取らない
- 既存テスト `tests/test_greet.py` の「未対応言語」の例は `es` を使っているので、実装時に別の言語コードへ差し替える

### Out-of-scope
es 以外の新言語、性別・数による活用、ロケール自動判定、README の更新。
