# Product Delivery Hierarchy

Product Brief / Epic / Ticket の 3 層で、**なぜ作るか**・**何を作るか**・**いま何をやるか** を構造化する仕組み。人間と coding agent の両方が読み、同じ文脈の中でプロダクトの方向性から日々の実装作業までを追跡する。

時間が空いた後の自分、初めて見る人、コンテキストを持たない agent が「何を・なぜ・どこまで」を最短で把握できることを重視する。


## 構造

| レイヤ | 役割 | 完了条件の性質 |
|---|---|---|
| **Product Brief** | repo 全体の why。背景・問題・方向性を固定する | **Done** = このプロダクトがうまくいったと言える状態 |
| **Epic** | 大きな施策の what。独立した価値を持つ単位 | **Exit Criteria** = この施策が価値を届けたと言える条件 |
| **Ticket** | 実行作業。1レビュー・1実装単位の粒度 | **Acceptance Criteria** = このタスクが終わったと言える条件 |

上位ほど「達成した状態」を、下位ほど「確認できる動作」を書く。


## ファイル構成

```
project-root/
  product-brief.md                          ← Brief: repo に 1 つ
  epics/
    251115-000000-prompt-registry.md         ← YYMMDD-hhmmss-slug.md (UTC)
    251201-000000-model-profile.md
    done/
      251015-000000-project-scaffolding.md
  tickets/                                  ← ticket.sh が管理
    250711-091538-fix-something.md
    250715-143824-add-feature.md
    done/
      250629-131859-initial-setup.md
```

### 命名規則

| レイヤ | ファイル名 | 例 |
|---|---|---|
| Product Brief | `product-brief.md` | repo ルートに固定。1 つだけ |
| Epic | `YYMMDD-hhmmss-slug.md` | `251115-000000-prompt-registry.md` |
| Ticket | `YYMMDD-hhmmss-slug.md` | `250711-091538-fix-auth.md` |

タイムスタンプは **UTC**。Epic も Ticket も同じ形式。

### ルール

- Epic と Ticket のファイル名形式は同じ。置き場所（`epics/` vs `tickets/`）で区別する。
- slug は英語ケバブケース。内容を端的に表す。日本語は使わない。
- Ticket のファイル名は ticket.sh が自動生成する。手動で作る場合も同じ形式に合わせる。
- 実行順序はファイル名ではなく、ファイル内容または `product-brief.md` の Epic 一覧で管理する。

### ファイル形式

Epic と Ticket は **YAML frontmatter + Markdown** 形式。frontmatter に `title`, `created_at` 等のメタデータ、本文に内容を書く。

```md
---
title: Rollback endpoint
created_at: 2026-02-15T10:00:00Z
---

### Summary
指定 version を active にする PATCH endpoint
...
```

状態は frontmatter で判定する（後述「完了・中止時」参照）。Product Brief は frontmatter を持たない。

### 完了・中止時

Epic / Ticket の状態は YAML frontmatter で判定する。

| frontmatter | 状態 |
|---|---|
| `closed_at` も `cancelled_at` もない | open |
| `closed_at` がある | 完了 |
| `cancelled_at` がある | 中止 |

- 完了時 → `closed_at` を追加し、`done/` に移動する。
- 中止時 → `cancelled_at` を追加し、`done/` に移動する。本文に中止理由を残す。
- Epic は exit criteria を確認してから `closed_at` を追加する。
- `done/` への移動は整理のため。状態の正は frontmatter。
- `done/` 内のファイルは消さない。判断の履歴として残す。


## 完了条件の書き方

完了条件のフォーマットは固定しない。レイヤの性質に応じて適切な形を選ぶ。

- **Product Brief の Done** — 達成した状態を散文で書く。数値目標を入れるなら、実際に計測する手段があるものだけ。チェックリストにすると矮小化しやすいので注意。
- **Epic の Exit Criteria** — Ticket がすべて閉じても自動では閉じない。「何が確認できたら閉じるか」を判断可能な粒度で書く。
- **Ticket の Acceptance Criteria** — coding agent が実装・テストの完了判断に使えるように、**観察可能な振る舞い** で書く。「〜できる」「〜が返る」「〜が表示される」など。曖昧な品質形容詞（「適切に」「正しく」）は避ける。


## 運用ルール

### 基本

- Product Brief は背景や problem が変わらない限り変えない。
- Epic はすべての Ticket が閉じても、exit criteria を確認してから `closed_at` を追加し `epics/done/` に移動する。
- Ticket は Epic へのリンクを持つ。commit は Ticket に紐づける。

### 変更・中止

- 上位レイヤの前提が崩れたら、下位の作業を止めて上位を先に更新する。
- Ticket を進める中で Epic の exit criteria や scope が不適切だと分かったら、Epic を修正してから残りの Ticket を見直す。
- やめる判断も明示的に記録する。`cancelled_at` を追加し、本文に中止理由を残してから `done/` に移動する。

### ブランチ戦略

Ticket ブランチは main に直接マージする。Epic ブランチは作らない。

```
main ← feature/250711-091538-fix-auth (Ticket ブランチ)
     ← feature/250715-143824-add-feature
     ← ...
```

- ticket.sh が Ticket ごとに `feature/<ticket-name>` ブランチを作り、close 時に main にマージする。
- Epic はブランチではなくドキュメントで状態を管理する。main に Epic の一部だけが入っている状態は正常。Epic のドキュメントに何が残っているか書いてある。
- Epic ブランチを作らない理由: Epic 間に依存関係がある場合（epic-3 が epic-1 のコードを必要とする等）、epic ブランチ同士の同期が破綻する。長命ブランチのコンフリクトリスクも高い。

### Coding agent 向け

- Agent は Ticket の Acceptance Criteria と Implementation Notes を主な入力として使う。
- 判断に迷ったら Epic の Scope / Non-goals、Product Brief の Constraints を参照する。
- Ticket に書かれていない仕様判断が必要な場合は、実装を進めずに質問する。
- Ticket の Dependencies に未完了のブロッカーがある場合は、着手せずに報告する。


## テンプレート

### Product Brief

```md
## Product Brief: <product name>

### Background
<!-- いまなぜこれを作るのか。どんな状況・文脈があるか。 -->

### Who
<!-- どんな状態の人が、どんな場面で使うか。
     一人で使うなら一人でいい。ロール名を並べるためのセクションではない。 -->

### Problem
<!-- 何が困っているか。根っこの問題を書く。
     同じ問題の表れ方が複数あっても、無理に分けない。 -->

### Solution
<!-- どういう方向で解くか。やらない判断もここに含めてよい。 -->

### Constraints
<!-- すべての判断を規定する前提条件・技術的制約。
     開発体制、技術スタック、データの形式、既存ワークフローとの関係など。
     coding agent はここを見て技術選定・設計判断の境界を知る。 -->

### Done
<!-- うまくいったと言える状態。自分が判断できる言葉で。
     計測しないメトリクスは書かない。
     フォーマットは自由。散文でも箇条書きでもよい。 -->

### Non-goals
<!-- やりたくなるが、意図的にやらないこと。
     議論にすらならないことは書かない。 -->

### Open Questions
<!-- まだ決まっていないこと。
     答えが実質出ているものは書かない。
     coding agent はここに該当する判断を勝手にしない。 -->
```

### Epic

最小構成は **Summary + Scope + Exit Criteria** で成立する。他は必要なときだけ書く。

```md
---
title: <epic name>
created_at: YYYY-MM-DDTHH:MM:SSZ
# closed_at: YYYY-MM-DDTHH:MM:SSZ     ← 完了時に追加
# cancelled_at: YYYY-MM-DDTHH:MM:SSZ  ← 中止時に追加
---

### Summary
<!-- この epic で達成したいこと。 -->

### Problem
<!-- この epic が直接解く問題。
     Brief の Problem のうち、どの部分を担当するか。 -->

### Outcome
<!-- 完了すると何ができるようになるか。使う人の視点で。 -->

### Scope
<!-- 含めるもの。
     coding agent はここと Non-goals を見て、
     Ticket の実装範囲を判断する。 -->

### Non-goals
<!-- 含めないもの。後続に回すもの。 -->

### Dependencies
<!-- 他の epic・外部要因との依存関係。
     「epic X の〇〇が先に必要」「epic Y と並行可能」など。
     なければ省略。 -->

### Exit Criteria
<!-- すべての Ticket が閉じても自動的には閉じない。
     この条件を満たしたときに閉じる。 -->

### Tickets

### Related Links
```

### Ticket

最小構成は **Why + What + Acceptance Criteria** で成立する。他は必要なときだけ書く。

```md
---
title: <ticket title>
created_at: YYYY-MM-DDTHH:MM:SSZ
# closed_at: YYYY-MM-DDTHH:MM:SSZ     ← 完了時に追加
# cancelled_at: YYYY-MM-DDTHH:MM:SSZ  ← 中止時に追加
---

### Why
<!-- なぜやるのか。Epic ベースの場合、どの Epic のどの問題を解くか明記する。 -->

### What
<!-- 何をするのか。想定方針・関連 module / file / api / UI。
     着手前の仮説でよい。変わったら更新する。 -->

### Acceptance Criteria
<!-- 完了を判定できる条件。観察可能な振る舞いで書く。
     coding agent はここを実装のゴールとして使う。
     例: 「/api/users に GET すると JSON 配列が返る」
     例: 「画面幅 375px 以下でメニューがハンバーガーに切り替わる」 -->

- [ ] ...
- [ ] 計画レビュー（C2）で Critical/Major が解消済み
- [ ] 実装は Engineer が行い、リードは直接コードを書いていない
- [ ] 品質検証（C4）で Critical/Major が解消済み
- [ ] コードの最終変更後に全てのテストが通った（backend / frontend / E2E）
- [ ] E2E: 実環境にアクセスして動作確認済み（UI: Playwright、API: curl）
- [ ] ドキュメント更新済み（/update-docs）
- [ ] ユーザが確認手順を実施し、クローズを承認した

<!-- ▼ 以下は必要なときだけ ▼ -->

### Implementation Notes
<!-- 想定方針の詳細。関連ファイル・影響範囲など。
     着手前の仮説でよい。変わったら更新する。
     設計判断が必要な場合はここに理由を記録する。
     coding agent はここを出発点にコードを書き始める。 -->

### Tests
<!-- テスト観点。unit / integration / e2e / manual など。
     テストに含めるほどではない確認も、Playwright MCP / curl で
     実環境にアクセスして行う。 -->

### Dependencies
<!-- この ticket に着手するために完了が必要な他の ticket。
     「参考情報」ではなく「ブロッカー」だけ書く。なければ省略。
     coding agent は未完了の依存がある場合、着手せず報告する。 -->

### Related Links
```

---

**Product Brief** = repo 全体の why / **Epic** = 大きな施策の what / **Ticket** = 実行作業