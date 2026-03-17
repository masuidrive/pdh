# Product Delivery Hierarchy

Product Brief / Epic / Ticket の 3 層で、**なぜ作るか**・**何を作るか**・**いま何をやるか** を構造化する仕組み。人間と coding agent の両方が読み、同じ文脈の中でプロダクトの方向性から日々の実装作業までを追跡する。

時間が空いた後の自分、初めて見る人、コンテキストを持たない agent が「何を・なぜ・どこまで」を最短で把握できることを重視する。


## 構造

Product Brief / Epic / Ticket の3層で開発を構造化する。
各層は上位の「なぜそれをやるか」を受けて、自分の責任範囲だけを引き受ける。

| レイヤ | 何を表すか | 書くこと | 閉じる条件 |
|---|---|---|---|
| **Product Brief** | 人間の意思。解きたい問題と目指す状態 | なぜ作るか、誰のどんな問題か | この問題が解けたと言える状態 |
| **Epic** | 意思を届けられる価値の単位に切った仮説 | 何ができる状態になるか | 使える状態になった（使われたかは別） |
| **Ticket** | Epic の成果物を構成する実装単位 | 何を作り、どう動けば正しいか | パーツが正しく動く |

上位ほど「達成した状態」を、下位ほど「確認できる動作」を書く。

Brief → Epic は「意思を仮説に分割する」関係。
Epic → Ticket は「仮説を実装可能な粒度に分解する」関係。

Epic の Outcome は **「この状態を作る価値があると今の時点で信じている」仮説** である。
作って、出して、閉じる。仮説が正しかったかは運用データが溜まってから検証する。
間違っていたら削る Epic を立てる。


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

Ticket ブランチは原則 main に直接マージする。
Epic が大きく、Ticket 単位のマージで main が中間的に壊れる場合は Epic ブランチを切ってよい。

```
原則:
main ← feature/250711-091538-fix-auth (Ticket ブランチ)
     ← feature/250715-143824-add-feature
     ← ...

例外（Epic ブランチ）:
main ← epic/在庫管理 ← feature/250711-091538-fix-auth
                     ← feature/250715-143824-add-feature
```

- ticket.sh が Ticket ごとに `feature/<ticket-name>` ブランチを作り、close 時にマージ先（main または Epic ブランチ）にマージする。
- Epic ブランチを使う場合は Epic の frontmatter に `branch` を記載する。
- Epic はブランチではなくドキュメントで状態を管理する。main に Epic の一部だけが入っている状態は正常。
- Epic ブランチを使う判断基準: **main に Ticket 単位でマージして、各 Ticket マージ後に main が壊れないか？** 壊れるなら Epic ブランチを使う。

注意: Epic ブランチは長命化しやすい。Epic 間に依存関係がある場合は同期が破綻するリスクがある。原則は main 直マージであり、Epic ブランチは例外として使う。

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
<!-- どういう方向で解くか。やらない判断もここに含めてよい。
     主要なユーザフローがあれば 1-2 個書く。
     Epic の Outcome や Ticket の AC を導く素材になる。
     例: スタッフが管理画面を開く → 在庫一覧が見える → 数量を修正 → 反映される -->

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

最小構成は **Outcome + Problem + Scope + Non-goals + Exit Criteria** で成立する。他は該当する情報がある場合のみ書く。

```md
---
title: <epic name>
created_at: YYYY-MM-DDTHH:MM:SSZ
# branch: epic/<slug>               ← Epic ブランチを使う場合のみ
# closed_at: YYYY-MM-DDTHH:MM:SSZ   ← 完了時に追加
# cancelled_at: YYYY-MM-DDTHH:MM:SSZ ← 中止時に追加
---

### Outcome
<!-- この Epic が完了すると、何ができる状態になっているか。
     「誰が」「何を」「どうできる状態」を1-3文で書く。
     実際にユーザーが使って価値を感じたかは Product Brief の責任。
     ここに書くのは「使える状態として存在する」こと。

     例: 店舗スタッフが、管理画面から在庫数を確認・修正できる状態になっている。 -->

### Problem
<!-- この Epic が直接解く問題。
     Brief の Problem のうち、どの部分を担当するか。
     done/ に移動した後の振り返りで「当時何が困っていたか」を残す。

     例: 店舗スタッフが在庫数を確認するには本部に電話するしかなく、
         対応に30分以上かかっている。 -->

### Scope
<!-- Outcome を実現するために具体的に作るもの。
     成果物（endpoint, 画面, migration 等）が分かる粒度で書く。
     AI はここを見て Ticket を切り出す。

     「検索機能」ではなく
     「商品名・カテゴリでの検索 API + 検索 UI」のように
     何が手に入るか分かる書き方にする。 -->

### Non-goals
<!-- この Epic では意図的にやらないこと。
     AI が「ついでにやりそう」なものを明記する。
     将来やるかもしれないものは、その旨も書く。

     例: 全文検索は次の Epic で扱う
         管理画面からの商品マスタ編集は対象外 -->

### Exit Criteria
<!-- この条件を満たしたら閉じる。
     全 Ticket が閉じても自動では閉じない。
     人間か AI がデプロイ後に手で確認して Yes/No 判定できる粒度で書く。
     数値目標を含む場合はその確認方法もインラインで添える。 -->

▼ 以下は該当する情報がある場合のみ ▼

### Dependencies
<!-- 他の Epic・外部要因との依存関係。
     「epic X の〇〇が先に必要」「epic Y と並行可能」など。
     なければ省略。 -->

### Tickets
<!-- Ticket 切り出し後に記載。 -->

### Related Links
```

### Ticket

最小構成は **Why + What + Acceptance Criteria** で成立する。他は該当する情報がある場合のみ書く。

```md
---
title: <ticket title>
created_at: YYYY-MM-DDTHH:MM:SSZ
# closed_at: YYYY-MM-DDTHH:MM:SSZ     ← 完了時に追加
# cancelled_at: YYYY-MM-DDTHH:MM:SSZ  ← 中止時に追加
---

### Why
<!-- なぜやるのか。Epic ベースの場合、どの Epic のどの部分を担うか明記する。
     Epic の Outcome のうち、この Ticket が実現する範囲を書く。 -->

### What
<!-- 何をするのか。想定方針・関連 module / file / api / UI。
     着手前の仮説でよい。変わったら更新する。 -->

### Acceptance Criteria
<!-- 完了を判定できる条件。プロダクトの観察可能な振る舞いだけを書く。
     coding agent はここを実装のゴールとして使う。
     例: 「/api/users に GET すると JSON 配列が返る」
     例: 「画面幅 375px 以下でメニューがハンバーガーに切り替わる」

     プロセス要件（PD-4レビュー済み、テストパス等）はここには書かない。
     ワークフロー（SKILL.md）と作業ノート（note）が保証する。 -->

- [ ] ...

▼ 以下は該当する情報がある場合のみ ▼

### Implementation Notes
<!-- 想定方針の詳細。関連ファイル・影響範囲など。
     着手前の仮説でよい。変わったら更新する。
     設計判断が必要な場合はここに理由を記録する。
     試したが却下した方法も残す（後世への記録）。
     coding agent はここを出発点にコードを書き始める。 -->

### Dependencies
<!-- この ticket に着手するために完了が必要な他の ticket。
     「参考情報」ではなく「ブロッカー」だけ書く。なければ省略。
     ブロッカー = これが未完了だと実装・テストが物理的にできない依存。
     例: 「DB migration の ticket が先に必要」「認証 API が存在しないと結合できない」
     参考情報（設計の参考にした ticket 等）は書かない。
     coding agent は未完了の依存がある場合、着手せず報告する。 -->
```

---

**Product Brief**: repo 全体の why / **Epic**: 意思を価値の単位に切った仮説 / **Ticket**: 仮説を構成する実装単位

<!-- Based on https://github.com/masuidrive/pdh/blob/XXXXXXX/docs/product-delivery-hierarchy.md -->