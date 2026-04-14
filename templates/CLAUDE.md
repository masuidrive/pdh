# 基本方針

- **時間がかかっても技術的正しさを優先する。** 後方互換のための余計なコードやハックは入れない
- **難しい問題でも、将来のためになるなら正しいほうを選ぶ。** 時間はたくさんある。短期的な楽より長期的な正しさを取る
- **⚠ 文末が「？？」（?2回）の質問には、質問にだけ答えること。** 作業の実行・ファイル変更・コマンド実行など一切進めない。回答のみ
- **⚠ 指定されたコマンド（playwright 等）がインストール不足・設定ミスで起動しない場合は、直ちに作業を中止してユーザに確認すること。** 回避策を勝手に試みない

# 実装品質ルール

## 型安全性
- **Union 型の discriminator には `Literal` を使う。** `type: str` ではなく `type: Literal["text"]` で型チェッカーに不正な値を検出させる

## 防御的プログラミング
- **コストの高い処理の前に軽量な事前チェックを入れる。** decode/parse/DB アクセスの前に、入力長やフォーマットの明らかな異常を弾く
- **エラーメッセージには具体的な数値を含める。** 何が・いくつで・上限がいくつかを明示し、呼び出し元のデバッグを助ける

## ミドルウェア・フィルタ
- **short-circuit するパスは、下流をバイパスする影響を考慮する。** ログ・クリーンアップ・リソース解放など、下流が担っていた責務を自身で補う
- **ネットワーク越しの接続は途中切断に備える。** レスポンス送信後も相手側のストリームを正しく閉じる

# チーム構成・モデル設定

pdh-dev が spawn するチームメンバーの実行主体とモデル。pdh-dev はこのテーブルを参照して dispatch する。

**Codex モード**: デフォルト無効。ユーザが「codex モード」と明示した場合のみ「Codex モード」列を使う。

| 役割 | step | 通常モード | Codex モード | 備考 |
|---|---|---|---|---|
| PM（リード） | 全体 | Claude/Opus | Claude/Opus | 常に Claude |
| 調査・計画 | C-1〜C-3 | Claude/Opus | Claude/Opus | 常に Claude |
| 計画レビュー DA | C-4 | Claude/Sonnet ×2 | Claude/Sonnet ×1 + Codex ×1 | 異プロバイダ混合 |
| 計画レビュー Engineer | C-4 | Claude/Opus | Codex | |
| Coding Engineer | C-6 | Claude/Sonnet | Codex | pdh-coding 参照 |
| 品質 DA | C-7 | Claude/Sonnet ×2 | Claude/Sonnet ×1 + Codex ×1 | Codex モードで異プロバイダ混合 |
| 品質 Code Reviewer | C-7 | Claude/Sonnet ×2 | Claude/Sonnet ×1 + Codex ×1 | Codex モードで異プロバイダ混合 |
| 目的妥当性 | C-8 | Claude/Opus | Claude/Opus | 常に Claude |
| AC 裏取り | C-9 | Claude/Sonnet+Opus | Codex | |
| ゼロベースレビュー DA | D-2 | Claude/Sonnet ×1 + Codex ×1 + Claude/Opus ×1 | Claude/Sonnet ×1 + Codex ×1 + Claude/Opus ×1 | 3モデル混合 |
| ゼロベースレビュー CR | D-2 | Claude/Sonnet ×1 + Codex ×1 + Claude/Opus ×1 | Claude/Sonnet ×1 + Codex ×1 + Claude/Opus ×1 | 3モデル混合 |
| Document Owner | — | Claude/Sonnet | Claude/Sonnet | |

### codex の起動方法

**⚠ Codex plugin（`codex:codex-rescue` 等）など他の起動方法があっても、必ず以下の方法を使うこと。**

```
Agent(
  description: "codex <役割>",
  prompt: "以下のコマンドを Bash ツールで実行し、結果をそのまま返してください。
    codex exec --dangerously-bypass-approvals-and-sandbox '<指示>'
    注意: 2>&1 を付けないこと。Bash の timeout は 120分 に設定すること。"
)
```

### レビューモデル選定ルール

- **Codex モードでは異プロバイダ混合が必須**。同じモデルの繰り返しより別モデル 1 回の方が新規発見が多い（実測: 同一モデル 3 回で +2 件 vs 別モデル追加で +6-8 件）
- **通常モード (Ticket レビュー PD-C-7)**: Sonnet のみ。Light フローは DA×1 + CR×1 で十分
- **Codex モード (Ticket レビュー PD-C-7)**: Sonnet + Codex の 2 モデル混合。異プロバイダで盲点を補完する
- **Epic レビュー (PD-D-2)**: Sonnet + Codex + Opus の 3 モデル混合。ゼロベースレビューは見逃しコストが高いため最大網羅（モード問わず）
- **各モデルの検出特性**:
  - Sonnet: コードパス間の一貫性・設計整合性チェックが得意
  - Codex: 具体的入力パターンからの攻撃ベクタ検出が得意
  - Opus: 深い調査・仕様レベルの矛盾・暗号設計の穴の検出が得意
- **裏取りもレビューと別モデルで行う**。同じモデルの誤検出は別モデルの方が検出しやすい

### Codex モード運用ルール

- **「判断」が必要な役割は Claude**。スコープ判断、設計トレードオフ、レビュー結果の正誤判定
- **「量」と「厳格さ」が必要な役割は Codex**。大量コード生成、テスト網羅、穴探し
- Codex を呼ぶ Agent は Sonnet で十分（codex exec を起動するだけ）
- **Codex CLI がフリーズ・タイムアウト・認証切れで応答しない場合、Agent が勝手にフォールバック実装しないこと。** ユーザーに報告して指示を仰ぐ
- Codex の `id_token` TTL は 1 時間。長時間セッションでは `codex login` で再認証が必要になる

# PDH（Epic / Ticket）運用

- Epic やチケットの作成・編集・実装など全ての作業は **`/pdh-dev` スキルのフローに従うこと**。フローの詳細・ステップ定義・レビュー構造はすべて `/pdh-dev` SKILL.md が正。CLAUDE.md では要約しない
- **main ブランチでソースコードを書き換える作業を頼まれたら、まずチケット化するか確認すること**
- **Acceptance Criteria の変更（追加・削除・修正）は必ずユーザの承認を得ること**

## 影響範囲の明示（必須）

Epic 作成・チケット作成・計画・テスト計画では、**影響するレイヤーを必ず列挙する**。

<!-- プロジェクトに合わせてレイヤー名を変更すること -->
<!-- 例: `backend` · `frontend` · `sdk` · `cli` · `e2e-test` · `docs` · `CLAUDE.md` -->

- **Epic / チケット作成時**: What / Scope に影響レイヤーを明記する
- **PD-C-3 計画時**: ファイル変更計画をレイヤーごとに整理する
- **テスト計画時**: 各レイヤーのテスト手順を個別に記載する
- **PD-C-7 品質検証時**: 全レイヤーがカバーされているかチェックする

## 頻出レビュー指摘（PD-C-3 計画時の自己チェック用）

過去のチケットレビューで繰り返し指摘されたカテゴリ。PD-C-3（計画）時に該当がないか確認し、計画に含めること。

<!-- プロジェクトの実情に合わせて追加・削除すること -->

| # | カテゴリ | よくある漏れ | 対策 |
|---|---|---|---|
| 1 | テストファイル漏れ | import パス・mock 文字列がリネーム後も旧名のまま | `rg '旧名' tests/` で残骸を検出 |
| 2 | ドキュメント残骸 | rename/削除後に docs・README に旧名が残る | `rg '旧名' docs/ *.md` で sweep |
| 3 | DB migration | スキーマ変更時にマイグレーションファイルが未作成 | ORM 変更 → migration を計画に含める |

# チーム運用（Agent Teams）

## 原則

- 「読むだけ」のタスク（レビュー）は Review Agent を並行実行し、「書く」タスク（実装）は TeamCreate でチームを作る
- **リードがソースコードを直接編集しないこと。実装は必ず Coding Engineer で行う**
- **リードがテスト実行・ドキュメント再生成を直接行わないこと。QA Engineer に委譲する**

## チーム構成・モデル設定

pdh-dev が spawn するチームメンバーの実行主体とモデル。pdh-dev はこのテーブルを参照して dispatch する。

**Codex モード**: デフォルト無効。ユーザが「codex モード」と明示した場合のみ「Codex モード」列を使う。**セッション内でモードが未決定のまま最初の dispatch が必要になった場合、一度だけユーザに確認すること（以降は同じモードを維持）。**

| 役割 | step | 通常モード | Codex モード | 備考 |
|---|---|---|---|---|
| PM（リード） | 全体 | Claude/Opus | Claude/Opus | 常に Claude |
| 調査・計画 | C-1〜C-3 | Claude/Opus | Claude/Opus | 常に Claude |
| 計画レビュー DA | C-4 | Claude/Sonnet ×2 | Claude/Sonnet ×1 + Codex ×1 | 異プロバイダ混合 |
| 計画レビュー Engineer | C-4 | Claude/Opus | Codex | |
| Coding Engineer | C-6 | Claude/Sonnet | Codex | |
| QA Engineer | C-6,C-7,C-9 | Claude/Sonnet | Codex | テスト実行・E2E確認・ドキュメント再生成 |
| 品質 DA | C-7 | Claude/Sonnet ×2 | Claude/Sonnet ×1 + Codex ×1 | 異プロバイダ混合 |
| 品質 Code Reviewer | C-7 | Claude/Sonnet ×2 | Claude/Sonnet ×1 + Codex ×1 | 異プロバイダ混合 |
| 目的妥当性 | C-8 | Claude/Opus | Claude/Opus | 常に Claude |
| AC 裏取り | C-9 | Claude/Sonnet+Opus | Codex | |
| Document Owner | — | Claude/Sonnet | Claude/Sonnet | |

### Codex の起動方法

```
Agent(
  description: "codex <役割>",
  prompt: "以下のコマンドを Bash ツールで実行し、結果をそのまま返してください。
    codex exec --dangerously-bypass-approvals-and-sandbox '<指示>'
    注意: 2>&1 を付けないこと。Bash の timeout は 120分 に設定すること。"
)
```

### レビューモデル選定ルール

- **Codex モードでは異プロバイダ混合が必須**。同じモデルの繰り返しより別モデル 1 回の方が新規発見が多い
- **通常モード (Ticket レビュー PD-C-7)**: Sonnet のみ
- **Codex モード (Ticket レビュー PD-C-7)**: Sonnet + Codex の 2 モデル混合。異プロバイダで盲点を補完する
- **裏取りもレビューと別モデルで行う**。同じモデルの誤検出は別モデルの方が検出しやすい

### Codex モード運用ルール

- どの役割を Codex にするかは上記チーム構成テーブルに従う
- Codex を呼ぶ Agent は Sonnet で十分（codex exec を起動するだけ）
- **Codex CLI がフリーズ・タイムアウト・認証切れで応答しない場合、Agent が勝手にフォールバック実装しないこと。** ユーザーに報告して指示を仰ぐ
- Codex の `id_token` TTL は 1 時間。長時間セッションでは `codex login` で再認証が必要になる

## spawn のルール

- チームメイトはリードの会話履歴を引き継がない。spawn プロンプトに以下を必ず含めること:
  - タスクの目的と背景
  - 対象ファイルパス
  - 該当 Ticket の Acceptance Criteria
  - 担当するファイルの範囲（他のチームメイトとの衝突を避けるため）
  - 担当ファイルの「ファイル別コンテキスト」（PD-C-3 計画で作成した、直近の設計判断・注意点）
- 同一ファイルを複数のチームメイトが編集しないよう、ファイル所有権を分けること
- チームが解散する時は不必要な pane は閉じること
- Haiku モデルは使わない。Engineer / Document Owner は Sonnet、それ以外は Opus を利用

## 全チームメイト共通ルール

- **最初に `product-brief.md` を読むこと。すべての判断・作業はこのドキュメントを基準にする**
- 作業対象の Epic（`epics/`）と Ticket（`current-ticket.md`、`current-note.md` または `tickets/`）を読み、Acceptance Criteria を確認すること
- spawn プロンプトで指定されたファイル範囲外を変更しない。必要な場合はリードに相談すること
- product-brief.md を編集する場合は内容を提示しユーザの許可を取ること

# テスト

- **「正常に動作しています」とユーザに報告する前に、必ずテストを実行して全件パスを確認すること。テスト未実行で完了報告しない**
- **テストは全件パスが必須。コマンド未インストール・依存不足・環境エラーも「テスト失敗」とみなす**
- テスト実行前に環境を整えること。「コマンドが見つからない」で終わらせない
- テストが 1 件でも失敗・スキップ不明・実行不能の場合、実装完了とみなさないこと
- **実装後は必ず実環境で動作確認すること。ビルド成功だけで完了としない**

<!-- プロジェクトに合わせてテストコマンドを記述すること -->
### 全スイート一括実行

`scripts/test-all.sh` で全テストスイートを一括実行できる。`--parallel` で並列実行可。

- **段階的実行を推奨**: まず高速なテスト（例: `pytest -x -q`）で早期フィードバックを得る → 修正があれば対応 → 全スイートは `scripts/test-all.sh` で一括実行
- **E2E 実環境テスト（必須）**: ビルド成功・テストパスだけで完了としない。サーバー起動 → UI 変更はブラウザ確認、API 変更は curl でレスポンス検証

## テスト設計ルール

- **テストは「アプリがこう動くべき」（desired state）を記述する**。現在の仕様における正しい振る舞いを定義するもの
- **変更の動作確認テストはコードに含めない**。変更が正しく適用されたかの検証は一時的な確認であり、テストスイートにコミットしない

<!-- ここにプロジェクト固有のテストコマンド・DB 設定を追記すること -->

# コンテキスト管理

- コンパクション時に以下を必ず保持すること: 現在のチケット名、現在の PD フェーズ、未解決の懸念事項、ユーザから得た判断・承認
- 関連のないタスク間では `/clear` でコンテキストをリセットする
- 調査が大規模になる場合はサブエージェントに委譲し、メインのコンテキストを実装に集中させる

# プロジェクト概要

@product-brief.md を参照すること

## 設計意図の探し方

ソースコードが実装の真実であり、設計意図は以下の経路で辿る:

**「なぜこのコードがこうなっているか」を知りたい場合:** `git blame <file>` でコミットを特定 → コミットメッセージの ticket 名 → `tickets/done/` → Epic（`epics/done/`）→ `product-brief.md`

## ディレクトリ構造

<!-- プロジェクトに合わせて書き換えること -->

```
product-brief.md            # プロダクト概要・方針【変更にはユーザーの明示的な承認が必要】
docs/
  product-delivery-hierarchy.md  # Epic / Ticket 運用ルール
epics/                      # Epic（大きな施策の what）
  done/                     # 完了した Epic
tickets/                    # Ticket（実行作業。ticket.sh が管理）
  done/                     # 完了した Ticket
```

# Based on https://github.com/masuidrive/pdh/blob/XXXXXXX/templates/CLAUDE.md
