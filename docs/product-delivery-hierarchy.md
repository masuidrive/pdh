# Product Delivery Hierarchy

Product Brief / Ticket の 2 層で、**なぜ作るか**・**いま何をやるか** を構造化する仕組み。人間と coding agent の両方が読み、同じ文脈の中でプロダクトの方向性から日々の実装作業までを追跡する。

時間が空いた後の自分、初めて見る人、コンテキストを持たない agent が「何を・なぜ・どこまで」を最短で把握できることを重視する。

## 構造

Product Brief / Ticket の 2 層で開発を構造化する。各層は上位の「なぜそれをやるか」を受けて、自分の責任範囲だけを引き受ける。

| レイヤ | 何を表すか | 書くこと | 閉じる条件 |
|---|---|---|---|
| **Product Brief** | 人間の意思。解きたい問題と目指す状態 | なぜ作るか、誰のどんな問題か、Architectural Invariants | この問題が解けたと言える状態 |
| **Ticket** | Brief を実現する実装単位。1 ticket = 1 work unit | Why / AC / Architectural Invariants check / Design Decisions / out-of-scope | AC を満たし、レビュー通過し、テスト全件パス、実環境で動作確認できた |

上位ほど「達成した状態」を、下位ほど「確認できる動作」を書く。

Brief → Ticket は「意思を実装可能な単位に分割する」関係。1 つの Brief から複数の ticket が時系列で派生していく。

## ファイル構成

```
project-root/
  product-brief.md                          ← Brief: repo に 1 つ
  tickets/                                  ← ticket.sh が管理
    .gitignore                              ← 各 ticket の tmp/ を除外
    250711-091538-fix-something/            ← per-ticket ディレクトリ
      ticket.md                             ← Ticket 本文
      note.md                               ← 作業ノート
      tests/                                ← ticket-local-test（必要時に agent が作成）
      tmp/                                  ← 一時領域（ticket.sh が作成。git 管理外）
    done/
      250629-131859-initial-setup/
```

旧 flat 形式（`tickets/250711-091538-fix-something.md` 単一ファイル）も後方互換で扱える。実体のパスは `ticket.sh start`/`restore` 出力の `ticket:`/`note:` 行にある。

### 命名規則

| レイヤ | ファイル名 | 例 |
|---|---|---|
| Product Brief | `product-brief.md` | repo ルートに固定。1 つだけ |
| Technical Reference | `technical-reference.md` | repo ルートに固定。1 つだけ。常に現在形の How（意思は持たない） |
| Ticket | `YYMMDD-hhmmss-slug/`（中に `ticket.md` / `note.md`） | `250711-091538-fix-auth/ticket.md` |

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

- 完了時 → `closed_at` を追加し、`done/` に移動する（ticket ディレクトリごと移動する）。
- 中止時 → `cancelled_at` を追加し、`done/` に移動する。本文に中止理由を残す。
- `done/` への移動は整理のため。状態は frontmatter で決まる。
- `done/` 内のファイルは消さない。判断の履歴として残す。


## 完了条件の書き方

完了条件のフォーマットは レイヤの性質に応じて適切な形を選ぶ。

- **Product Brief の Done** — 達成した状態を散文で書く。数値目標を入れるなら、実際に計測する手段があるものだけ。チェックリストにすると矮小化しやすいので注意。
- **Ticket の Acceptance Criteria** — **観察可能な振る舞い** で書く。「〜できる」「〜が返る」「〜が表示される」など。曖昧な品質形容詞（「適切に」「正しく」）は避ける。プロセス要件（「レビュー済み」「テストパス」）は AC に書かない。ワークフロー（SKILL.md）と作業ノート（note）が保証する。

  **誰にとって観察可能かまで決める。読み手は ticket を承認する人であって、実装する agent ではない。** AC は `PDH-ticket-human-review` で人が承認する契約であり、実装のゴールはそこから決まる。AC は `What` の冒頭に置く 1 文「この ticket が終わると、〈誰〉が、いままでできなかった〈何〉をできるようになる」の分割として書く。

  **読めているかの判定基準は `pdh-dev` skill の「AC に書いてよいもの / 書いてはいけないもの」にある。ここには書かない。**判定の 1 問、取り違えやすい点、書き直しの例はすべてあちらが持つ。


## 運用ルール

### 基本

- Product Brief は背景や problem が変わらない限り変えない。Architectural Invariants の変更は破壊的影響が大きいため、ユーザ承認が必須。
- Brief / Ticket の本文中で未決事項は `[NEEDS CLARIFICATION: 具体的な問い]` を埋め込む。coding agent はこのマーカーに触れる判断を推測で埋めず、確認してから進める。解消したらマーカーを決定内容へ置き換える。
- Brief の変更は 2 種類に分ける。方針の変更（Problem / Solution / Appetite / Architectural Invariants / Non-goals）はユーザ承認が必須。事実の追記（Done への達成追記・Open Questions の追加）は agent が ticket close 時に行ってよい。
- `technical-reference.md` は「現在の実装がどうなっているか」の常設文書（repo root に置く）。ticket close 時に、その ticket の差分に因果がある範囲だけを agent が追記・上書きする。他 ticket 由来の記述は消さない（削除候補は note に記録し、棚卸し ticket で別モデル検証つきで刈る）。
- Ticket は Product Brief を参照する。commit は Ticket に紐づける。
- ticket は **1 ticket = 1 work unit**。cross-cutting changes を複数 ticket に切ると layer 間整合性が完成時にしか取れないため、1 ticket で全 layer をカバーする。

### 変更・中止

- 上位レイヤ (Product Brief) の前提が崩れたら、下位の作業を止めて上位を先に更新する。
- やめる判断も明示的に記録する。`cancelled_at` を追加し、本文に中止理由を残してから `done/` に移動する。
- 想定外の問題が発生した場合は、影響範囲を評価し対応する。影響が大きい場合（スコープ変更・技術方針の転換が必要）はユーザに相談する。

### ticket の変更は再合意で行う (絶対遵守)

すべての判断の基準は Why / Problem を解けるかであり、Acceptance Criteria はその手段である。AC / Architectural Invariants check / Out-of-scope は、**合意し直せば変えてよい。implementor が独断で書き換えてはいけない。**意思決定者の意思を上書きさせないための gate であり、破られると ticket が意思決定を保持しなくなる。

**確定判断 (Design Decisions) はこの 3 つと同じ扱いにしない。**解き方は実装で前提が崩れるため、合意を動かさず記録を残す限り、再合意なしで書き換えてよい。

**実装担当向けの規則は `.claude/skills/pdh-coding/SKILL.md` 「ticket の変更は再合意で行う (絶対遵守)」にある**（AC が何度も変わるときの扱い、確定判断を書き換えてよい条件、escalate 手順、solo / bot 実行時の中断方法を含む）。ここには重複させない。

### ブランチ戦略

Ticket ブランチは原則 main に直接マージする。

```
main ← features/250711-091538-fix-auth (Ticket ブランチ)
     ← features/250715-143824-add-feature
     ← ...
```

- ticket.sh が Ticket ごとに `features/<ticket-name>` ブランチを作り、close 時にマージ先（ticket frontmatter の `branch` フィールド、default `main`）にマージする。
- 並列で複数 ticket を進める場合は worktree 分離を使うと PM (Director) と worker が独立に動ける。手順と gitignored ファイルの持ち込み（`worktree_copy_files`）は `.claude/skills/tmux-director/SKILL.md` 「複数 window による並行チケット実行」参照。

### Stage labels

Stage label は、note の Status・checklist・引き継ぎで使う安定した識別子である。工程を管理する番号ではないので、改名せず、note や報告にはこの文字列をそのまま書いて検索・照合に使う。

| Label | 意味 | 出口で誰が何を見るか |
|---|---|---|
| `PDH-open` | ticket を作成・開始・復元し、読む対象を確定する | 書き手が、読む対象と「終わると誰が何をできるか」の 1 文を確定したか |
| `PDH-ticket-review` | agent が ticket の Why / AC / Design Decisions / Out-of-scope / blocker を確認し、実装前に提示できる形へ整える | 書き手が、AC 全件について「承認者ならどう確かめるか」を書けたか |
| `PDH-ticket-human-review` | 実装前に ticket review の修正点・全体概要・達成するもの・AC をユーザとすり合わせ、AC 承認を明示する | **承認者が、AC 全件を読んで「終わると誰が何をできるか」を再生できるか** |
| `PDH-implement` | AC を満たす実装・必要なテスト・作業ログを残す | 書き手が、実装が依存する仮定のうち測れるものを測ったか |
| `PDH-review` | risk に応じて独立レビューし、重要指摘を解消する | reviewer が、修正が壊していない側を反例で確かめたか |
| `PDH-verify` | AC、`scripts/test-all.sh`、docs impact、実動確認を照合する | 書き手が、実データと終端操作で AC の達成を確かめたか |
| `PDH-human-review` | coding agent がやったこと・達成したことがユーザの想定と合っているかをすり合わせ、差し戻しまたは close 承認を明示する | **承認者が、やったことと達成したことを自分の想定と突き合わせられるか** |
| `PDH-close` | ユーザ承認、merge/push/deploy 状態、残課題を記録して閉じる | 承認・merge/push 状態・残課題が、後から辿れるか |

**stage の «意味» は工程が何をするかで、«出口で誰が何を見るか» はその工程が守るものである。**規則を足すときは後者を先に 1 文で書く（`PDH-AGENTS.md`「Where A Rule Belongs」)。

gate の規則と検証の証拠要件は `PDH-AGENTS.md`（「Stage Flow」「Verification」「Human Gate Materials」）に、`permanent-test` と `ticket-local-test` の区別・置き場所は `pdh-coding` skill「テスト設計ルール」に、各 stage の手順は `pdh-dev` skill にある。ここには重複させない。

### テストの層

テストは目的とコストの違う層に分ける。混ぜず、それぞれの入口を1つに保つ。

| 層 | 実体（例） | コスト | いつ走らせるか |
|---|---|---|---|
| fast-check（超軽量・決定論） | `scripts/fast-checks.sh` + `scripts/checks/*.check` | ミリ秒 | 毎変更。`scripts/test-all.sh` の最初のステージとして、また `ticket-local-test` の前提ゲートとして |
| 全体スイート（重量級） | `scripts/test-all.sh`（型検査・単体・E2E 等をまとめる） | 秒〜分 | `PDH-implement` の完了時と `PDH-verify` |
| ticket-local-test（一時） | `tickets/<ticket-name>/tests/` 配下の `test-ticket-local.sh` | 可変 | その ticket の検証中だけ。CI・`test-all` に入れず、close 時に刈る |
| mutation testing（任意の重検査） | 言語ごとの専用ツール（JS/TS: Stryker、Python: mutmut 等） | 分〜十分超 | 定期棚卸しのみ（導入は各プロジェクト判断）。コストが大きいので CI・`test-all` に入れない |

包含関係: fast-check ⊂ `test-all`（`test-all` は fast-check を最初に含む）。ticket-local-test も先頭で fast-check を通す。mutation testing は「テストがある」ではなく「テストが欠陥を検出できる」を測る別軸で、`test-all` の外に置く。fast-check の役割と書き方は `pdh-check-writing` skill と `scripts/checks/README.md` に従う。


## テンプレート

テンプレートの正本は次の 2 箇所にある。ここには複製を置かない。

- **Ticket / note** — `.ticket-config.yaml` の `default_content` / `note_content`。`./ticket.sh new` が記入ガイドのコメント付きで実体化する。YAML frontmatter（`title` / `created_at`、完了時の `closed_at`、中止時の `cancelled_at`）は ticket.sh が扱う
- **Product Brief** — 導入時に repo root へ配置される `product-brief.md`（PDH リポジトリの Product Brief テンプレートが元。記入ガイドは本文にある）。frontmatter は持たない

Ticket の最小構成は **Why + What/Acceptance Criteria + Architectural Invariants check + Design Decisions + Out-of-scope** で成立する。他の節（Implementation Notes / Dependencies）は該当する情報がある場合のみ書く。

<!-- Based on https://github.com/masuidrive/pdh/blob/XXXXXXX/docs/product-delivery-hierarchy.md -->
