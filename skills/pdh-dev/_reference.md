# PDH Dev — リファレンス

## 用語

- **step** = `PD-C-*` の単位 (PD-A / PD-B / PD-D は持たない)
- **review loop** = PD-C-7 で修正 → テスト → 再レビューを繰り返すこと
- **gate** = 次の step に進むための完了条件
- **AC** = Acceptance Criteria。観察可能な振る舞い
- **Architectural Invariants** = `product-brief.md` に明記された不変則

## ステップ遷移の宣言

step を移動するたびに宣言する（実行モデル依存の宣言手段は `_execution-*.md` に従う）:

```text
[PD-C-1] -> [PD-C-6] — AC 承認、実装開始
[PD-C-7] -> [PD-C-7(2回目)] — Critical 修正後の再レビュー
[PD-C-7(2回目)] -> [PD-C-9] — 全 reviewer PASS
```

差し戻しも明示的に宣言する。省略や暗黙の遷移は禁止。

## 進捗報告フォーマット

```text
Current Step:
Step Status: 未着手 / 進行中 / 完了
Gate Remaining:
Evidence:
Next Step:
```

`Gate Remaining` が空でない限り、その step は完了ではない。

## step 完了ルール

各 step 完了時にコミット。コミットメッセージは `[step 名] 概要` の形式 (例: `[PD-C-6] Implementation`)。セッション中断時の作業損失を防ぎ、step ごとの進捗を git 履歴で追跡する。

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
| **Status** (冒頭) | 常時 | 現在 step + タイムスタンプ (例: `## Status: PD-C-6 — 2026-05-27T03:45:00Z`) |
| **PD-C-6. 実装ログ** | PD-C-6 中・完了時 | commit hash 一覧、実装中に発見した設計判断 / scope 拡張 / 縮小の判断 |
| **PD-C-7. 品質検証結果** | PD-C-7 完了時 | reviewer 別ステータステーブル + 指摘と対応結果 |
| **PD-C-9. プロセスチェックリスト** | PD-C-9 完了時 | プロセス要件のチェック (レビュー通過、テスト全件パス、実動確認等) |
| **Discoveries** | 随時 | 実装中に発見した想定外の事実 |

必須ルール:
- Status 行を冒頭に維持
- タイムスタンプ必須
- 空セクションを残さない (スキップ理由を 1 行書く)
- gate 未達のまま次 step 名へ Status を更新してはならない
- セッション終了時、作業途中の場合は現在の状態と次にやるべきことを `current-note.md` に記録

## 責務境界（artifact 観点）

| レイヤー | 意思決定者が決める / 書く | 実装担当領域 |
|---|---|---|
| Product Brief | ユーザの意思 (ユーザ承認のもと編集) | — |
| Ticket | Why / AC (観察可能な振る舞い) / Architectural Invariants check / 確定判断 / out-of-scope / Implementation Notes (任意) | 実コード詳細 |
| Subagent / 実行指示 | 目的 / 背景 / AC / 担当範囲 / 確定判断 | how-to / 実装手順 / コマンド指定 |

書かない側に踏み込むと下流の自由度を奪い、review loop 肥大化 / 実装手戻り / drift の原因。

## 成果物セルフチェック（内容品質チェック）

ticket / 実行指示 提出前に確認する（誰が確認するか = 主体は `_execution-*.md` に従う。team では PM が担当）:

- `product-brief.md` の Architectural Invariants と矛盾していないか
- 実装詳細 (signature / 行番号 / 内部実装フロー / 現状 snapshot / コード snippet) が混入していないか
- AC は「観察可能な振る舞い」のみか (テスト方法 / 実装状態を書いていないか)
- 実行指示は「判断」のみで「how-to」を書いていないか
- AC / 実装 / チケット化候補に**投機的拡張・将来要件向け設計**が混入していないか（YAGNI、→ `_principles.md`）

1 つでも混入していれば抽象化する。
