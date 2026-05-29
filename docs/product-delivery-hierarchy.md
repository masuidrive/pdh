# Product Delivery Hierarchy

Product Brief / Ticket の 2 層で、**なぜ作るか**・**いま何をやるか** を構造化する仕組み。人間と coding agent の両方が読み、同じ文脈の中でプロダクトの方向性から日々の実装作業までを追跡する。

時間が空いた後の自分、初めて見る人、コンテキストを持たない agent が「何を・なぜ・どこまで」を最短で把握できることを重視する。

## 構造

Product Brief / Ticket の 2 層で開発を構造化する。各層は上位の「なぜそれをやるか」を受けて、自分の責任範囲だけを引き受ける。

| レイヤ | 何を表すか | 書くこと | 閉じる条件 |
|---|---|---|---|
| **Product Brief** | 人間の意思。解きたい問題と目指す状態 | なぜ作るか、誰のどんな問題か、Architectural Invariants | この問題が解けたと言える状態 |
| **Ticket** | Brief を実現する実装単位。1 ticket = 1 work unit | Why / AC / Architectural Invariants check / 確定判断 / out-of-scope | AC を満たし、レビュー通過し、テスト全件パス、実環境で動作確認できた |

上位ほど「達成した状態」を、下位ほど「確認できる動作」を書く。

Brief → Ticket は「意思を実装可能な単位に分割する」関係。1 つの Brief から複数の ticket が時系列で派生していく。

## ファイル構成

```
project-root/
  product-brief.md                          ← Brief: repo に 1 つ
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
| Ticket | `YYMMDD-hhmmss-slug.md` | `250711-091538-fix-auth.md` |

タイムスタンプは **UTC**。

### ルール

- slug は英語ケバブケース。内容を端的に表す。日本語は使わない。
- Ticket のファイル名は ticket.sh が自動生成する。手動で作る場合も同じ形式に合わせる。
- 実行順序はファイル名ではなく、ticket 間の `Dependencies` フィールドで管理する。

### ファイル形式

Ticket は **YAML frontmatter + Markdown** 形式。frontmatter に `title`, `created_at` 等のメタデータ、本文に内容を書く。

```md
---
title: Rollback endpoint
created_at: 2026-02-15T10:00:00Z
---

### Why
指定 version を active にする PATCH endpoint
...
```

状態は frontmatter で判定する（後述「完了・中止時」参照）。Product Brief は frontmatter を持たない。

### 完了・中止時

Ticket の状態は YAML frontmatter で判定する。

| frontmatter | 状態 |
|---|---|
| `closed_at` も `cancelled_at` もない | open |
| `closed_at` がある | 完了 |
| `cancelled_at` がある | 中止 |

- 完了時 → `closed_at` を追加し、`done/` に移動する。
- 中止時 → `cancelled_at` を追加し、`done/` に移動する。本文に中止理由を残す。
- `done/` への移動は整理のため。状態の正は frontmatter。
- `done/` 内のファイルは消さない。判断の履歴として残す。


## 完了条件の書き方

完了条件のフォーマットは レイヤの性質に応じて適切な形を選ぶ。

- **Product Brief の Done** — 達成した状態を散文で書く。数値目標を入れるなら、実際に計測する手段があるものだけ。チェックリストにすると矮小化しやすいので注意。
- **Ticket の Acceptance Criteria** — coding agent が実装・テストの完了判断に使えるように、**観察可能な振る舞い** で書く。「〜できる」「〜が返る」「〜が表示される」など。曖昧な品質形容詞（「適切に」「正しく」）は避ける。プロセス要件（「レビュー済み」「テストパス」）は AC に書かない。ワークフロー（SKILL.md）と作業ノート（note）が保証する。


## 運用ルール

### 基本

- Product Brief は背景や problem が変わらない限り変えない。Architectural Invariants の変更は破壊的影響が大きいため、ユーザ承認が必須。
- Ticket は Product Brief を参照する。commit は Ticket に紐づける。
- ticket は **1 ticket = 1 work unit**。cross-cutting changes を複数 ticket に切ると layer 間整合性が完成時にしか取れないため、1 ticket で全 layer をカバーする。

### 変更・中止

- 上位レイヤ (Product Brief) の前提が崩れたら、下位の作業を止めて上位を先に更新する。
- やめる判断も明示的に記録する。`cancelled_at` を追加し、本文に中止理由を残してから `done/` に移動する。
- 想定外の問題が発生した場合は、影響範囲を評価し対応する。影響が大きい場合（スコープ変更・技術方針の転換が必要）はユーザに相談する。

### Ticket immutable (絶対遵守)

ticket の以下を implementor が **勝手に書き換えてはいけない**:

- **Acceptance Criteria**
- **Architectural Invariants check**
- **確定判断 (Design Decisions)**
- **Out-of-scope**

変更が必要だと判断したら、**実装を止めて PM に escalate** する。これは「PM の意思を上書きしない」ための gate。違反すると ticket が "PM の意思" を持たなくなり、ticket そのものの価値が消失する。

### ブランチ戦略

Ticket ブランチは原則 main に直接マージする。

```
main ← features/250711-091538-fix-auth (Ticket ブランチ)
     ← features/250715-143824-add-feature
     ← ...
```

- ticket.sh が Ticket ごとに `features/<ticket-name>` ブランチを作り、close 時にマージ先（ticket frontmatter の `branch` フィールド、default `main`）にマージする。
- 並列で複数 ticket を進める場合は、worktree 分離 (`claude --worktree <slug>` or `EnterWorktree({name: "<slug>"})`) を使うと PM (Director) と worker が独立に動ける。詳細は `skills/tmux-director/SKILL.md` 「複数 window による並行チケット実行」参照。

### Coding agent 向け

- Agent は Ticket の **Why / Acceptance Criteria / Architectural Invariants check / 確定判断 / out-of-scope / Implementation Notes** を主な入力として使う。
- 判断に迷ったら Product Brief の **Constraints / Architectural Invariants** を参照する。
- Ticket に書かれていない仕様判断が必要な場合の対応は `skills/pdh-coding/SKILL.md` 「Open Questions protocol (batch escalate)」を参照する (デフォルト値で進め、ASSUMPTION commit + note 記録、PM に batch escalate)。
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
<!-- どういう方向で解くか。やらない判断もここに含めてよい。
     主要なユーザフローがあれば 1-2 個書く。
     Ticket の Acceptance Criteria を導く素材になる。
     例: スタッフが管理画面を開く → 在庫一覧が見える → 数量を修正 → 反映される -->

### Constraints
<!-- すべての判断を規定する前提条件・技術的制約。
     開発体制、技術スタック、データの形式、既存ワークフローとの関係など。
     coding agent はここを見て技術選定・設計判断の境界を知る。 -->

### Architectural Invariants
<!-- 根本不変則。Ticket / 実装の全てがこれと矛盾しないこと。
     例: - Hub stateless: API はリクエストごとに完結、サーバ側で state を持たない
         - Process immutable: publish 後は変更不可、tag で参照を切り替える
     ticket は実装前にこの Invariants との整合性を 1 行宣言する責務がある。
     変更には破壊的影響があるためユーザ承認が必須。 -->

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

### Ticket

最小構成は **Why + What/Acceptance Criteria + Architectural Invariants check + 確定判断 + Out-of-scope** で成立する。他は該当する情報がある場合のみ書く。

```md
---
title: <ticket title>
created_at: YYYY-MM-DDTHH:MM:SSZ
# closed_at: YYYY-MM-DDTHH:MM:SSZ     ← 完了時に追加
# cancelled_at: YYYY-MM-DDTHH:MM:SSZ  ← 中止時に追加
---

### Why
<!-- ユーザ価値・解きたい問題を 1〜3 行で書く。
     Product Brief の Problem / Solution のどの部分を担うか明記する。 -->

### What / Acceptance Criteria
<!-- 完了を判定できる条件。プロダクトの観察可能な振る舞いだけを書く。
     coding agent はここを実装のゴールとして使う。
     例: 「/api/users に GET すると JSON 配列が返る」
     例: 「画面幅 375px 以下でメニューがハンバーガーに切り替わる」

     プロセス要件 (レビュー済み、テストパス等) はここには書かない。
     ワークフロー (SKILL.md) と作業ノート (note) が保証する。

     runtime で UX/Security invariant を強制する ticket では、AC に「runtime enforce の
     保証メカニズム」を 1 行明記する (例: editor 警告だけでなく 422 reject されること)。 -->
- [ ] AC 1: ...
- [ ] AC 2: ...

### Architectural Invariants check
<!-- product-brief.md の Architectural Invariants と矛盾しないことを 1 行宣言する。
     矛盾しない場合: 「Hub stateless / Process immutable と矛盾しない」等。
     新規 Invariant を要求する場合: 実装を止めて Product Brief 更新から始める。 -->

### 確定判断 (Design Decisions)
<!-- 既知の設計判断と理由を箇条書きで明示。
     例: - データ保存形式: data URI (Files API は将来検討、本 ticket では不要)
     例: - error code: 422 (validation error として扱う) -->
-

### Out-of-scope
<!-- やらないこと (scope creep 防止)。
     「ついでにやりそう」「次の ticket でやる」を明記する。 -->
-

▼ 以下は該当する情報がある場合のみ ▼

### Implementation Notes
<!-- ユーザの明示指示、またはユーザが会話で言及した事項のみ書く (関数名 / module 名レベルまで)。
     設計判断は「確定判断 (Design Decisions)」に書く。
     Coding Engineer は Implementation Notes が空でも実装できる責務を持つ。
     PM が自主的に実装詳細を書いてはならない (下流の自由度を奪う)。 -->

### Dependencies
<!-- この ticket に着手するために完了が必要な他の ticket。
     「参考情報」ではなく「ブロッカー」だけ書く。なければ省略。
     ブロッカー = これが未完了だと実装・テストが物理的にできない依存。
     例: 「DB migration の ticket が先に必要」「認証 API が存在しないと結合できない」
     参考情報 (設計の参考にした ticket 等) は書かない。
     coding agent は未完了の依存がある場合、着手せず報告する。 -->
```

---

**Product Brief**: repo 全体の why + Architectural Invariants / **Ticket**: Brief を実現する実装単位 (1 ticket = 1 work)

<!-- Based on https://github.com/masuidrive/pdh/blob/XXXXXXX/docs/product-delivery-hierarchy.md -->
