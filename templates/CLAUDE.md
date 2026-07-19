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

- **時間がかかっても技術的正しさを優先する。** 後方互換のための余計なコードやハックは入れない
- **難しい問題でも、将来のためになるなら正しいほうを選ぶ。** 時間はたくさんある。短期的な楽より長期的な正しさを取る
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

- **「正常に動作しています」とユーザに報告する前に、必ずテストを実行して全件パスを確認すること。テスト未実行で完了報告しない**
- **テストは全件パスが必須。コマンド未インストール・依存不足・環境エラーも「テスト失敗」とみなす**
- テスト実行前に環境を整えること。「コマンドが見つからない」で終わらせない
- テストが 1 件でも失敗・スキップ不明・実行不能の場合、実装完了とみなさないこと
- **実装後は必ず実環境で動作確認すること。ビルド成功だけで完了としない。自動テストと stub / mock / フィクスチャで通っただけでは「動作確認」ではない**
- **完了判定に使う「動作確認」は実データ + 終端操作で行う（合成での pass 禁止）。**
  - **「stub」は外部 API の mock だけを指さない — 自分が手で組み立てて系に流し込む入力すべて**（合成ログ entry・手で set した context / DB 行・本番の上流が本来生成するデータを迂回する fixture 等）が stub。stub は早期フィードバック用で完了判定には使わない。コードが「与えた入力どおりの出力」を返したことの確認は循環論法であり、完了判定ではない
  - **consume 側機能（他所が生成するログ / イベント / payload / DB 行を読む機能）は、検証前に「実上流が実際に何を出すか」を実データで観測する**（本番ログを query する等）。上流が consumer の必要フィールドを出していなければ、その機能は未完成（不具合）であって pass ではない
  - **「描画 / 生成された」で完了としない。** リンク・通知・画面遷移・外部副作用が目的の場合、**終端のユーザ操作を実際に行って着地まで**確認する（リンクは実際にクリック・通知は実イベントで受信）。「実機 = 実トランスポート」を「実データ」と取り違えない（例: 実 Slack に合成ログを流すのは実データ確認ではない）
  - **外部 provider / API は可能な限り実 API を end-to-end で叩く。** 実環境を使えない場合（credential 未保有・外部サービスダウン等）はその旨を明示し、deferred 扱いの承認を得る。自発的に「stub で十分」と判断しない

<!-- プロジェクトに合わせてテストコマンドを記述すること -->

### 全スイート一括実行

`scripts/test-all.sh` で全テストスイートを一括実行できる。`--parallel` で並列実行可。

- **段階的実行を推奨**: まず高速なテスト（例: `pytest -x -q`）で早期フィードバックを得る → 修正があれば対応 → 全スイートは `scripts/test-all.sh` で一括実行
- **E2E 実環境テスト（必須）**: ビルド成功・テストパスだけで完了としない。サーバー起動 → UI 変更はブラウザ確認、API 変更は curl でレスポンス検証

### テスト設計ルール

- **テストは「アプリがこう動くべき」（desired state）を記述する**。現在の仕様における正しい振る舞いを定義するもの
- チケット固有の一時確認は `PDH-AGENTS.md` の `ticket-local-test` ルールに従う

# PDH (Ticket) 運用

- **`product-brief.md` が全判断の基準。** チケット作成・実装・レビューのすべてはこのドキュメントを正として行う
- PDH 汎用ルールは `PDH-AGENTS.md`、フローの詳細・ステップ定義・レビュー構造は `/pdh-dev` SKILL.md が正。`CLAUDE.md` では project 固有の差分だけを書く。
- **Acceptance Criteria の変更（追加・削除・修正）は必ずユーザの承認を得ること**

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

### Codex worker の起動方法（main = Claude Code のとき）

このセクションは **main（PM）が Claude Code で、codex を worker として spawn する場合** の手順。main が codex の場合は自身の exec 機構を使うため該当しない（engine 中立な spawn 契約は pdh-dev `_execution-team.md`「spawn 機構」が正）。

**⚠ Codex plugin（`codex:codex-rescue` 等）など他の起動方法があっても、必ず以下の方法を使うこと。**

Agent を経由せず、Bash ツールで直接実行する。`run_in_background` で非同期実行し、`-o` で最終結果のみをファイルに出力、`< /dev/null` で stdin を即 EOF にし、`2>` で stderr を別ファイルに捕捉する。

```
Bash(
  command: "d=$(mktemp -d /tmp/codex-XXXXXX) && echo \"output: $d\" && codex exec --dangerously-bypass-approvals-and-sandbox -o $d/result.txt '<指示>' < /dev/null 2> $d/stderr.log",
  run_in_background: true,
  timeout: 7200000
)
```

Bash の出力先ファイル冒頭に `output: /tmp/codex-XXXXXX` とディレクトリパスが表示される。

- **最終結果**: `Read(file_path: "/tmp/codex-XXXXXX/result.txt")` — 通常 ~2 KB
- **途中ログ（デバッグ用）**: `Read(file_path: "/tmp/codex-XXXXXX/stderr.log")` — codex の進捗・exec 呼び出し等の詳細はすべて stderr に出る

prompt が短く shell quoting のリスクが低い場合は上記の inline 形式 (`codex exec '<指示>'`) を使う。長文、複数段落、特殊文字、日本語を多く含む prompt は file + stdin 経由で渡す (shell quoting failure 回避)。

```
Bash(
  command: "d=$(mktemp -d /tmp/codex-XXXXXX) && p=$d/prompt.txt && cat > $p << 'EOF'\n<指示>\nEOF\n echo \"output: $d\" && codex exec --dangerously-bypass-approvals-and-sandbox -o $d/result.txt < $p 2> $d/stderr.log",
  run_in_background: true,
  timeout: 7200000
)
```

**注意:**
- timeout は 120分（7200000ms）に設定すること
- **worktree 中の ticket に対して実行する場合は必ず `cd <worktree> && codex exec ...` の形にする**（custom statusLine がある環境で cwd が毎回リセットされる既知バグ [anthropics/claude-code#31471](https://github.com/anthropics/claude-code/issues/31471) を回避するため）
- **コンテキスト汚染対策**: 完了通知は `<task-notification>` として軽量メッセージで届く（出力本体は含まない）。result.txt だけ Read すれば ~2 KB で済む。stderr.log は失敗時のみ `tail -50` 程度で部分読みし、`cat` で全部流し込まない

# Based on https://github.com/masuidrive/pdh/blob/XXXXXXX/templates/CLAUDE.md
