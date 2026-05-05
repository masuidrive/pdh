---
priority: 2
description: "Add modulo support to the calc CLI."
created_at: "2026-05-01T00:00:00Z"
started_at:
closed_at:
canceled_at:
---

## calc-modulo

### Why

四則演算の仕上げとして剰余 (`%`) を加える。既存の calc-divide / calc-multiply / calc-subtract で揃えた AST whitelist パターンを踏襲したい。

### What

既存の `calc` CLI に剰余 (`%`) を追加する。挙動は Python の `operator.mod` に揃え、ゼロ剰余は既存の `error: division by zero` と同じ exit 1 で拒否する。未対応の式 (`**` 等) は引き続き exit 2 で拒否する。

### Acceptance Criteria

- [ ] `uv run calc "10%3"` で `1` が出力される。
- [ ] `uv run calc "8%4"` で `0` が出力される。
- [ ] `uv run calc "5%0"` はエラー終了し、stderr に `error: division by zero` を出して exit 1 を返す。
- [ ] 既存の `+ - * /` 動作 (`uv run calc "1+2"`, `"5-3"`, `"2*5+1"`, `"10/2"`) は変わらない。
- [ ] 未対応の `uv run calc "2**10"` は引き続き exit 2 を返す。

### Implementation Notes

`src/calc_demo/cli.py` の `ALLOWED_BINOPS` に `ast.Mod: operator.mod` を追加する 1 行で済む想定。ゼロ剰余は Python の `operator.mod(_, 0)` が `ZeroDivisionError` を投げるので、既存の `main()` 内 `except ZeroDivisionError` がそのまま流用できる (新しい分岐は不要)。`scripts/test-all.sh` には `10%3 → 1`, `8%4 → 0`, `5%0` の exit 1 ケースを追加し、`+ - * /` の既存ケースは回帰として残す。

---
Work notes: `tickets/calc-modulo-note.md`
