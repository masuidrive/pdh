---
priority: 1
description: "Add multiplication support to the calc CLI."
created_at: "2026-04-28T00:00:00Z"
started_at:
closed_at:
---

## calc-multiply

### Why

デモ用の計算機でも、少しだけ現実的な式を扱えるようにしたい。ただし provider の動作確認に使う fixture なので、実装規模は小さく保つ。

### What

既存の `calc` CLI に乗算を追加し、未対応の式は引き続きエラーとして拒否する。

### Acceptance Criteria

- [ ] `uv run calc "1+2"` で `3` が出力される。
- [ ] `uv run calc "2*5+1"` で `11` が出力される。
- [ ] `uv run calc "2**10"` はエラー終了し、非 0 exit になる。

### Implementation Notes

Python の `ast` module を使う。許可するのは整数リテラル、加算、乗算だけに限定する。CLI コマンド名は `calc` のまま維持する。

---
Work notes: `tickets/calc-multiply-note.md`
