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
| Technical Reference | `technical-reference.md` | repo ルートに固定。1 つだけ。常に現在形の How（意思は持たない） |
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
- Brief / Ticket の本文中で未決事項は `[NEEDS CLARIFICATION: 具体的な問い]` を埋め込む。coding agent はこのマーカーに触れる判断を推測で埋めず、確認してから進める。解消したらマーカーを決定内容へ置き換える。
- Brief の変更は 2 種類に分ける。方針の変更（Problem / Solution / Appetite / Architectural Invariants / Non-goals）はユーザ承認が必須。事実の追記（Done への達成追記・Open Questions の追加）は agent が ticket close 時に行ってよい。
- `technical-reference.md` は「現在の実装がどうなっているか」の常設文書（`templates/technical-reference.md`）。ticket close 時に、その ticket の差分に因果がある範囲だけを agent が追記・上書きする。他 ticket 由来の記述は消さない（削除候補は note に記録し、棚卸し ticket で別モデル検証つきで刈る）。
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
- 並列で複数 ticket を進める場合は、worktree 分離 (`claude --worktree <slug>` or `EnterWorktree({name: "<slug>"})`) を使うと PM (Director) と worker が独立に動ける。詳細は `.claude/skills/tmux-director/SKILL.md` 「複数 window による並行チケット実行」参照。

### Coding agent 向け

- Agent は Ticket の **Why / Acceptance Criteria / Architectural Invariants check / 確定判断 / out-of-scope / Implementation Notes** を主な入力として使う。
- 判断に迷ったら Product Brief の **Constraints / Architectural Invariants** を参照する。
- Ticket に書かれていない仕様判断が必要な場合の対応は `.claude/skills/pdh-coding/SKILL.md` 「Open Questions protocol (batch escalate)」を参照する (デフォルト値で進め、ASSUMPTION commit + note 記録、PM に batch escalate)。
- Ticket の Dependencies に未完了のブロッカーがある場合は、着手せずに報告する。
- `PDH-AGENTS.md` は PDH 汎用 agent ルール、`CLAUDE.md` は repo で共有する project 固有ルール、`CLAUDE.local.md` は gitignore された環境固有メモとする。端末・sandbox・個人アカウント・一時 URL・ローカル認証状態などは `CLAUDE.local.md` に書き、secret の値そのものは書かない。

### Stage labels

Stage label は checklist と引き継ぎ用の安定キーであり、重い工程番号ではない。

| Label | 意味 |
|---|---|
| `PDH-open` | ticket を作成・開始・復元し、読む対象を確定する |
| `PDH-ticket-review` | agent が ticket の Why / AC / Design Decisions / Out-of-scope / blocker を確認し、実装前に提示できる形へ整える |
| `PDH-ticket-human-review` | 実装前に ticket review の修正点・全体概要・達成するもの・AC をユーザとすり合わせ、AC 承認を明示する |
| `PDH-implement` | AC を満たす実装・必要なテスト・作業ログを残す |
| `PDH-review` | risk に応じて独立レビューし、重要指摘を解消する |
| `PDH-verify` | AC、`scripts/test-all.sh`、docs impact、実動確認を照合する |
| `PDH-human-review` | coding agent がやったこと・達成したことがユーザの想定と合っているかをすり合わせ、差し戻しまたは close 承認を明示する |
| `PDH-close` | ユーザ承認、merge/push/deploy 状態、残課題を記録して閉じる |

`PDH-review-1` / `PDH-review-2` のような実行回数ラベルは top-level stage ではなく、`current-note.md` の `PDH-review` 配下に残す attempt log とする。

`PDH-ticket-review` と `PDH-ticket-human-review` は分ける。前者は agent が ticket contract を整える工程、後者は実装前にユーザが全体像・達成するもの・ticket review で修正した点・AC を見て、想定と合っているかをすり合わせる人間 gate。AC 承認は `PDH-ticket-human-review` で得る。承認なしに `PDH-implement` へ進まない。

Agent は `PDH-verify` までを自動で進め、そこで止まらず `PDH-human-review` として人間にレビューを依頼する。`PDH-human-review` の目的は、coding agent がやったこと・達成したことをユーザが見て、それがユーザの想定と合っているかをすり合わせること。UI / API surface がある場合、`PDH-verify` では `./scripts/dev-server.sh --seed` を使う。server 不要で seed だけ必要な場合は `scripts/seed-pdh-verify.sh` を使い、repo / ticket にこの seed hook が無ければ作り、seed 不要なら no-op として成功させる。UI / browser surface がある場合、`PDH-verify` の Surface Observer は seed 後に、shared shell / CSS / auth を含む実 dev-server の composed page で `agent-browser` 等を使って主要ユースケースを実行する。renderer 単体を代替証拠にせず、対象 commit SHA と操作結果または実行不能理由を記録する。レビュー依頼は note に書くだけでなく、会話上で「やったこと」「判断ポイント」「次の選択肢」を説明する。レビュー可能な UI / API がある場合、`PDH-human-review` では `./scripts/dev-server.sh` で開発サーバを起動し、ユーザ自身が触って判断できる確認手順を提示する。UI はブラウザ URL と操作箇所、API は `curl` と期待レスポンス、手作業が難しい認証・cookie・fixture は `tmp/` の一時スクリプトで補助する。認証が必要な surface では dev mode で dummy login を用意し、localhost 以外へ出す場合は Basic Auth や一時 token 等で保護し、レビュー依頼前に、認証方式、必要な cookie / token / helper / cookie jar、秘密値を会話に貼らない方針、ユーザが実行する具体手順、確認後のサーバ停止や一時ファイルの扱いを説明する。`agent-browser` のコマンド列だけを人間向け確認手順にしない。判断が必要な選択肢は一番上におすすめを置くが、初期選択・timeout/default・沈黙を回答や承認として扱わない。`PDH-human-review` の承認があるまで `PDH-close` に進まず、チケット全体を完了と表現しない。途中で疑問・判断不能・blocker・完了見込みが立たない状態になった場合は、`PDH-human-review` を待たずにその時点でユーザに確認する。

恒久テストと `ticket-local-test` は分ける。`scripts/test-all.sh` / CI / `test/` に残すのは、Product Brief、Architectural Invariants、継続的な product contract、または一般化された regression だけとする。特定 ticket の一時的な移行確認（例: `/a` から `/b` への変更で旧 `/a` が 404 になること、特定 fixture 名がカタログに出ないこと）は `PDH-verify` の `ticket-local-test` とする。実行可能なものは `ticket.sh start` / `restore` 出力の `tests_dir:` が示すパス（新レイアウトでは `tickets/<ticket-name>/tests/`、旧 flat 形式は `tests/tickets/<ticket-id>/` で後方互換）に置き、`./scripts/test-ticket-local.sh [ticket-id]` で呼ぶ。seed / `tmp/` helper / `agent-browser` / `curl` の実行証跡は note に残す。恒久化するか迷う場合は、その期待が ticket 名や一時 fixture なしで今後も product contract として説明できるかを基準にする。

`PDH-verify` / `PDH-human-review` で開発サーバが必要な場合は `./scripts/dev-server.sh` を使う。`--seed` は local 環境をリセットして PDH verify seed を投入し、`--port <port>` は固定 port、未指定なら空き port をランダム選択する。localhost 以外から見せる必要がある場合は共通オプション `--no-localhost` を使う。`--no-localhost` では外部 URL に port が出ないことが多いため、固定 port が必要な検証以外では `--port` を省略してよい。実装はアプリごとに異なり得る（例: プロジェクト既定の tunnel / 公開手段）。agent は app/script に実装された方法を使う。ticket の再現可能な product 検証条件が不足する場合だけ script / seed hook を更新し、sandbox・端末パス・local login 等の環境固有制約は local 設定か一時コマンドで扱う。Quick Tunnel は URL を知る人が到達できるため、露出内容を確認し、厳密な認可が必要なら named tunnel + Access 等の別設定を人間判断にする。

PDH の実行は stage ごとに subagent / worker へ委譲し、Director が結果を検品して統合する。worker の PASS は入力であって承認ではない。Director は各 stage の完了前に、正典・ticket・diff・実コマンド出力・note の証跡を照合し、矛盾や未確認があれば差し戻す。subagent を起動できない環境では、単独で完了扱いにせずユーザに確認する。


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

### Appetite
<!-- （任意）どこまで投資する価値があるか。時間・複雑さの上限感を 1-3 行。
     coding agent は YAGNI 判断の較正に使う。書けなければセクションごと省略。 -->

### Constraints
<!-- すべての判断を規定する前提条件・技術的制約。
     開発体制、技術スタック、データの形式、既存ワークフローとの関係など。
     coding agent はここを見て技術選定・設計判断の境界を知る。
     実装時に落とし穴になりうる既知の地雷（rabbit holes）もここ。 -->

### Architectural Invariants
<!-- 根本不変則。Ticket / 実装の全てがこれと矛盾しないこと。
     例: - Hub stateless: API はリクエストごとに完結、サーバ側で state を持たない
         - Process immutable: publish 後は変更不可、tag で参照を切り替える
     ticket は実装前にこの Invariants との整合性を 1 行宣言する責務がある。
     変更には破壊的影響があるためユーザ承認が必須。 -->

### Done
<!-- うまくいったと言える状態。自分が判断できる言葉で。
     計測しないメトリクスは書かない。
     フォーマットは自由。散文でも箇条書きでもよい。
     達成した項目は消さず、日付または commit / ticket 名を添えて「達成済み」と追記する。 -->

### Non-goals
<!-- やりたくなるが、意図的にやらないこと。
     議論にすらならないことは書かない。 -->

### Open Questions
<!-- まだ決まっていないこと。本文中の [NEEDS CLARIFICATION: 問い] マーカーの索引もここ。
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
