# プロジェクト概要

@product-brief.md を参照すること
@PDH-AGENTS.md

## ディレクトリ構造

<!-- プロジェクトに合わせて書き換えること -->

```
product-brief.md            # プロダクト概要・方針【変更にはユーザーの明示的な承認が必要】
docs/
  product-delivery-hierarchy.md  # Ticket 運用ルール
tickets/                    # Ticket（実行作業。ticket.sh が管理）
  done/                     # 完了した Ticket
```

# 基本方針

<!-- 以下はサンプル。このプロジェクトの価値判断・運用規約に合わせて書き換え・追加・削除すること。 -->
<!-- PDH 共通のルールではないので、合わないものは消してよい。 -->

- **時間がかかっても技術的正しさを優先する。** 後方互換のための余計なコードやハックは入れない。短期的な楽より長期的な正しさを取る
- **⚠ 文末が「？？」（?2回）の質問には、質問にだけ答えること。** 作業の実行・ファイル変更・コマンド実行など一切進めない。回答のみ
- **⚠ 指定されたコマンド（playwright 等）がインストール不足・設定ミスで起動しない場合は、直ちに作業を中止してユーザに確認すること。** 回避策を勝手に試みない
- **main ブランチでソースコードを書き換える作業を頼まれたら、まずチケット化するか確認すること**

# 実装品質ルール

<!-- このプロジェクトで実際に踏んだ実装上の失敗を、再発防止ルールとしてここに書く。 -->
<!-- 言語・フレームワークに依存しない汎用コーディング標準は pdh-coding skill が正なので、ここには書かない。 -->
<!-- grep 1 パターンで決定論的に検出できるものは、ルールではなく scripts/checks/*.check にする。 -->

# 開発環境

<!-- プロジェクトに合わせてサーバー起動・DB・テストコマンドを記述すること -->

## サーバー起動

<!-- 例: バックエンド起動コマンド、フロントエンドビルド手順、seed データ投入など -->

## テスト

- **完了報告前のテスト実行ルールは `PDH-AGENTS.md`「Reporting」が正**（未実行での完了報告禁止。コマンド未インストール・依存不足・環境エラーも「テスト失敗」とみなす）。ここには project 固有のテストコマンドと確認観点だけを書く
- **完了判定に使う「動作確認」の基準は pdh-coding skill「動作確認 gate」が正。** 実データ + 終端操作で確認し、stub での pass を完了としない

<!-- プロジェクトに合わせてテストコマンドを記述すること -->

### 全スイート一括実行

`scripts/test-all.sh` で全テストスイートを一括実行できる。`--parallel` で並列実行可。

- **段階的実行を推奨**: まず高速なテスト（例: `pytest -x -q`）で早期フィードバックを得る → 修正があれば対応 → 全スイートは `scripts/test-all.sh` で一括実行
- **E2E 実環境確認の証拠要件は `PDH-AGENTS.md`「Browser And Surface Checks」が正**（ビルド成功・テストパスだけで完了としない）

### テスト設計ルール

- **テストは「アプリがこう動くべき」（desired state）を記述する**。現在の仕様における正しい振る舞いを定義するもの
- チケット固有の一時確認は `PDH-AGENTS.md` の `ticket-local-test` ルールに従う

# PDH (Ticket) 運用

PDH 汎用ルールは `PDH-AGENTS.md`、フローの詳細・ステップ定義・レビュー構造は `/pdh-dev` SKILL.md が正。**`CLAUDE.md` には project 固有の差分だけを書く。**

## 影響範囲の明示（必須）

チケット作成・実装計画・テスト計画では、**影響するレイヤーを必ず列挙する**。

<!-- プロジェクトに合わせてレイヤー名を変更すること -->
<!-- 例: `backend` · `frontend` · `sdk` · `cli` · `e2e-test` · `docs` · `CLAUDE.md` -->

- **チケット作成時**: What / Scope に影響レイヤーを明記する
- **PDH-implement 実装時**: ファイル変更計画をレイヤーごとに整理する
- **テスト計画時**: 各レイヤーのテスト手順を個別に記載する
- **PDH-review 品質検証時**: 全レイヤーがカバーされているかチェックする

## 頻出レビュー指摘 (PDH-implement 自己チェック用)

過去のチケットレビューで繰り返し指摘されたカテゴリ。PDH-implement 中に該当がないか確認すること。

<!-- プロジェクトの実情に合わせて追加・削除すること -->

| # | カテゴリ | よくある漏れ | 対策 |
|---|---|---|---|
| 1 | テストファイル漏れ | import パス・mock 文字列がリネーム後も旧名のまま | `rg '旧名' tests/` で残骸を検出 |
| 2 | ドキュメント残骸 | rename/削除後に docs・README に旧名が残る | `rg '旧名' docs/ *.md` で sweep |
| 3 | DB migration | スキーマ変更時にマイグレーションファイルが未作成 | ORM 変更 → migration を計画に含める |

# チーム運用

## チーム構成・モデル設定

pdh-dev が spawn するチームメンバーの engine / モデル設定。

engine 割り当ての規則（worker 既定 = main と同一、main engine の選び方、cross-delegate の適用範囲、spawn 機構）は pdh-dev `_execution-team.md`「エンジン割り当て」「spawn 機構」が正。ここには **この project 固有の上書きだけ**を書く。

<!-- cross-delegate を使う場合の、この project での推奨モデル。モデル名は時間で古びるので最新に読み替えて更新すること -->

- main = claude → 実装 worker = `codex exec -m gpt-5.6-sol -c model_reasoning_effort="medium"`（機械的な実装は `medium`、統合・判断を含む難しい実装は `high`）
- main = codex → 実装 worker = `claude -p --model opus`

**下表は「役割ごとに engine / model を既定から変えたいとき」の上書き例（任意）**。指定したロールだけ上書きされ、他は既定（= main と同一 engine）のまま。PDH stage の定義と gate 条件は `PDH-AGENTS.md` と `/pdh-dev` を正とし、この表は project 固有の role / model override だけを書く。

**この表は消さないこと。** どの step にどの engine / model を割り当てるかは project 依存で、skill 側の既定値では決められない。判断材料の例:

- **タスクの難易度**: 機械的な変更は軽量・高速なモデル、設計判断や統合を含む変更は強いモデル、といった step ごとの使い分け
- **コスト / スループット**: 頻繁に回る step を安いモデルに寄せる
- **独立性**: cross-model review が要る step には、生成側と別のモデルを明示指定する

割り当てを変えたら、その理由も 1 行添えておくと後から検証できる。

| 役割 | step | 上書き例 | 備考 |
|---|---|---|---|
| PM（Director） | 全体 | （main） | 進行・dispatch・統合・判断・ユーザ報告。worker を spawn する側 |
| Ticket contract | ticket contract / AC gate | （main） | PM が担当。project 固有の invariant / dependency / approval 補足を書く |
| Coding Engineer | implementation | （main） | 実装 worker。project 固有の実装制約や required skill があれば書く |
| QA Engineer | tests / verification | （main） | test command、E2E、doc regeneration など project 固有の確認観点を書く |
| Devil's Advocate | review | （main） | セキュリティ、設計、AC 達成の実質判定など project 固有の重点観点を書く |
| 追加 reviewer（任意） | review | 例: codex を1人追加 | 独立視点を増やしたいとき、別 engine の reviewer を明示追加してよい（混在）|
| AC 裏取り | verification | （main） | project 固有の AC evidence や canonical docs 照合観点を書く |
| Surface Observer | surface check | （main） | UI / HTTP API / SDK / CLI など、この project の consumer surface を書く |

共通の worker / spawn / context ルールは `PDH-AGENTS.md` に置く。以下にはこの project / tool 固有の起動方法だけを書く。

### worker の起動方法

engine 別の起動コマンド、並行起動、main = Claude Code のときの codex worker spawn 手順（`run_in_background` / timeout / 出力先 / worktree 時の cwd 注意）は pdh-dev `_execution-team.md`「spawn 機構」が正。

<!-- この project 固有の起動制約（sandbox、認証、権限ポリシー、使ってはいけない起動経路など）があればここに書く -->

# Based on https://github.com/masuidrive/pdh/blob/XXXXXXX/templates/CLAUDE.md
