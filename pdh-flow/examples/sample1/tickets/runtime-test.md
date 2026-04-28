---
priority: 99
description: "pdh-flow runtime smoke / regression fixture (used by scripts/test-runtime.sh)."
created_at: "2026-04-28T00:00:00Z"
started_at:
closed_at:
---

## runtime-test

### Why

`pdh-flow` runtime のテスト (`scripts/test-runtime.sh`) が seed する fixture が `./ticket.sh start` を回せるように置いてある。プロダクトの ticket ではない。

### What

何もしない。`ticket.sh start runtime-test` で feature branch + current-ticket.md / current-note.md を生成するためだけの placeholder。

### Acceptance Criteria

- [ ] runtime テストが完走する。
