# PDH Dev — リファレンス

## 用語

- **stage label** = `PDH-open` / `PDH-ticket-review` / `PDH-ticket-human-review` / `PDH-implement` / `PDH-review` / `PDH-verify` / `PDH-human-review` / `PDH-close`。checklist と引き継ぎ用の安定キーであり、重い工程番号ではない
- **review attempt label** = `PDH-review-1` / `PDH-review-2` など。top-level stage ではなく、`PDH-review` 配下の実行ログ
- **gate** = 次の stage に進むための完了条件
- **AC** = Acceptance Criteria。観察可能な振る舞い
- **Architectural Invariants** = `product-brief.md` に明記された不変則

## stage 遷移の宣言

stage を移動するたびに短く宣言する（実行モデル依存の宣言手段は `_execution-*.md` に従う）:

```text
[PDH-open] -> [PDH-ticket-review] — ticket 確定
[PDH-ticket-review] -> [PDH-ticket-human-review] — ticket contract を人間に提示可能
[PDH-ticket-human-review] -> [PDH-implement] — AC 承認、実装開始
[PDH-review] -> [PDH-verify] — 重要指摘なし、または対応済み
[PDH-verify] -> [PDH-human-review] — 自動検証完了、人間レビュー依頼
[PDH-human-review] -> [PDH-close] — ユーザが明示承認
```

差し戻しも明示的に宣言する。省略や暗黙の遷移は禁止。

## 進捗報告フォーマット

```text
Current Stage:
Stage Status: 未着手 / 進行中 / 完了
Gate Remaining:
Evidence:
Next Stage:
```

`Gate Remaining` が空でない限り、その stage は完了ではない。

## stage 完了ルール

各 stage 完了時に必要ならコミットする。コミットメッセージは `[stage label] 概要` の形式 (例: `[PDH-implement] Implementation`)。セッション中断時の作業損失を防ぎ、進捗を git 履歴で追跡する。

## ticket と note の役割分担

| ファイル | 役割 | 残す情報 |
|---|---|---|
| **current-ticket.md** | 後世への記録。`ticket.sh close` 時のコミットメッセージの元 | Why / AC / Architectural Invariants check / 確定判断 / out-of-scope / Implementation Notes (任意) |
| **current-note.md** | 今の作業のノート。セッションをまたぐ引き継ぎ資料 | Status / 実装ログ / レビュー結果 / プロセスチェック / Discoveries |

## ticket 標準構造

```markdown
# Why
ユーザ価値・解きたい問題 (1〜3 行)

# What / Acceptance Criteria
- AC 1: 観察可能な振る舞い
- AC 2: ...

# Architectural Invariants check
product-brief.md の Invariants と矛盾しないことを 1 行宣言

# 確定判断 (Design Decisions)
- 既知の判断は明示
- 理由を 1 行添える

# Out-of-scope
- やらないこと (scope creep 防止)

# Implementation Notes (任意、自主 NG)
- ユーザの明示指示や会話で言及された事項のみ
- 関数名 / module 名レベルまで
```

1 ページ以内 (〜20 行) で書ける。

## AC に書いてよいもの / 書いてはいけないもの

- OK: 「`/api/services` が 200 を返し、レスポンスに description フィールドが含まれる」
- OK: 「画面幅 375px 以下でメニューがハンバーガーに切り替わる」
- NG: 「レビューで Critical/Major が解消済み」 → note のプロセスチェックリスト
- NG: 「テストが全件パスする」 → note のプロセスチェックリスト

## Implementation Notes は自主的に書かない

ユーザの明示指示、またはユーザが会話で言及した事項を残す場合 (認識齟齬の予防) のみ書く (関数名 / module 名レベルまで)。設計判断は `確定判断 (Design Decisions)` に書く。実装担当は Implementation Notes が空でも実装できる責務を持つ。

## note のセクション構成

| セクション | 記録タイミング | 内容 |
|---|---|---|
| **Status** (冒頭) | 常時 | 現在 stage + タイムスタンプ (例: `## Status: PDH-implement — 2026-05-27T03:45:00Z`) |
| **PDH-ticket-review. Ticket contract check** | 実装前 | Why / AC / Design Decisions / Out-of-scope / Dependencies / Invariants の確認。AC 承認は得ない |
| **PDH-ticket-human-review. Ticket human review** | 実装前 | ticket review の修正点、全体概要、達成するもの、AC、out-of-scope、判断ポイントの提示と AC 承認 |
| **PDH-implement. 実装ログ** | PDH-implement 中・完了時 | commit hash 一覧、実装中に発見した設計判断 / scope 拡張 / 縮小の判断 |
| **PDH-review. 品質検証結果** | PDH-review 完了時 | `PDH-review-1` / `PDH-review-2` など attempt ごとの reviewer 結果 + 指摘と対応結果 |
| **PDH-verify. プロセスチェックリスト** | PDH-verify 完了時 | プロセス要件のチェック (レビュー通過、テスト全件パス、実動確認等) |
| **PDH-human-review. 人間レビュー** | PDH-verify 完了後 | ユーザへのレビュー依頼、確認手順、承認または差し戻し結果 |
| **Discoveries** | 随時 | 実装中に発見した想定外の事実 |

必須ルール:
- Status 行を冒頭に維持
- タイムスタンプ必須
- 空セクションを残さない (スキップ理由を 1 行書く)
- gate 未達のまま次 stage 名へ Status を更新してはならない
- `PDH-human-review` の明示承認なしに `PDH-close` へ進まない。自動工程完了時は「PDH-human-review 待ち」と記録し、チケット全体を完了扱いにしない
- セッション終了時、作業途中の場合は現在の状態と次にやるべきことを `current-note.md` に記録
- **検証系チェック項目の証拠バインディング**: 「テスト全件パス」「`scripts/test-all.sh` 全スイート確認」「実 API 確認」「Surface 観察」等、検証完了を主張する項目は、対象 **commit SHA**、対応する**実コマンドと実出力 (合否サマリ)** を note に貼ってから `[x]` にする。後続 commit がその証拠へ影響し得る場合は無効として取り直す。証拠を貼れない項目を `[x]` にしてはならない ("記憶・要約で完了マーク" の禁止)。部分実行 (backend のみ等) で全スイート項目を `[x]` にするのも禁止

## 責務境界（artifact 観点）

| レイヤー | 意思決定者が決める / 書く | 実装担当領域 |
|---|---|---|
| Product Brief | ユーザの意思 (ユーザ承認のもと編集) | — |
| Ticket | Why / AC (観察可能な振る舞い) / Architectural Invariants check / 確定判断 / out-of-scope / Implementation Notes (任意) | 実コード詳細 |
| Subagent / 実行指示 | 目的 / 背景 / AC / 担当範囲 / 確定判断 | how-to / 実装手順 / コマンド指定 |

書かない側に踏み込むと下流の自由度を奪い、レビュー肥大化 / 実装手戻り / drift の原因。

## 成果物セルフチェック（内容品質チェック）

ticket / 実行指示 提出前に確認する（誰が確認するか = 主体は `_execution-*.md` に従う。team では PM が担当）:

- `product-brief.md` の Architectural Invariants と矛盾していないか
- 実装詳細 (signature / 行番号 / 内部実装フロー / 現状 snapshot / コード snippet) が混入していないか
- AC は「観察可能な振る舞い」のみか (テスト方法 / 実装状態を書いていないか)
- 実行指示は「判断」のみで「how-to」を書いていないか
- AC / 実装 / チケット化候補に**投機的拡張・将来要件向け設計**が混入していないか（YAGNI、→ `_principles.md`）

1 つでも混入していれば抽象化する。
