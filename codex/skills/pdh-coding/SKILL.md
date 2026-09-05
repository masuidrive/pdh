---
name: pdh-coding
description: "実装担当が実装を始める前に読む規則。"
---

# PDH Coding Standards

## 作業開始

1. `product-brief.md`、`PDH-AGENTS.md`、`AGENTS.md`、`AGENTS.local.md`（あれば）を読む
2. `ticket.sh start`/`restore` 出力の `ticket:` パスで Why / Acceptance Criteria / Architectural Invariants check / 確定判断 / out-of-scope を確認する
3. 同じ出力の `note:` パスで過去の Discoveries と実装ログを把握する

ticket の signature 詳細（関数 signature、行番号、現状 snapshot）が実コードと一致しないときは、ticket の意図に従って実コードに合わせて実装する。不一致を理由に止まらず escalate する。Implementation Notes が空でも、実コード詳細の調査は実装担当の責務である。

## 隔離された作業ツリー

作業開始時に cwd、worktree、branch と書き込み可能な範囲を確認する。共有 checkout と他担当の変更を保護し、割り当てられた worktree で実装・検証する。利用環境の実際の権限とツールに従い、実行できなかった操作と理由を記録する。

## ticket の変更は再合意で行う

Acceptance Criteria、Architectural Invariants check、Out-of-scope を独断で書き換えない。変更が必要だと判断したら、その変更に依存する作業を止めて Director へ変更案と影響を報告し、合意が反映されるまで該当部分を実装しない。合意すれば変えてよい。

同じ ticket で AC が何度も変わるなら、AC を再合意する前に Why / Problem へ戻って合意し直す。

ユーザーが選んだ確定判断を変えるときは、変更案と影響を示して合意する。合意された結果を保つ実装方法は担当が選ぶ。判断を更新する場合、元の判断・崩れた前提・新しい判断を報告する。ticket の編集権限がない worker は Director に更新を依頼する。

## YAGNI

AC を満たす最小の変更で止める。AC に無い機能、オプション、抽象化、拡張点、設定、汎用化、防御コードを先回りで足さない。「ついで」の汎用化・リファクタをしない。

観測した問題は記録する。観測していない将来問題のための設計はしない。拡張余地が要ると判断したら、その場で実装せず Open Questions か完了報告へ 1 行記録する。

## 曖昧な判断委譲の拒否

指示の不足が利用者への約束や作業範囲を変えるなら、調査で確定できる事実を調べてから、必要な判断を Director へ渡す。「よしなに」等の表現だけを理由に止まらず、合意を保つ実装上の選択は根拠を記録して進める。

## Open Questions

実装ローカルで可逆な迷いは、合意済みの結果を保つ値を選んで進め、根拠を記録する。利用者への約束、AC、ユーザーが選んだ設計判断、out-of-scope、権限境界を変える必要があるときは、該当する変更を止めて明示回答を得る。回答を待つ間も、判断に依存しない承認済みの作業は続ける。

1. note の `## Open Questions` へ、なぜ迷ったか / 試した解釈と却下理由 / 採用した default 値と根拠 / 上位への要請 を append する
2. commit message に `ASSUMPTION:` prefix で、採用した値と一意に決まらなかった理由を書く
3. 完了時と中断時に `<RESULT_FILE>` 末尾へ `## Open Questions Summary` を列挙する

次の場合は、影響する経路の作業を止めて必要な判断を報告する。依存しない承認済み作業は続行する。

- default を選ぶと AC のいずれかが達成不能になる
- Architectural Invariants を踏まない選択肢が存在しない
- AC 達成のために out-of-scope を踏むしかない
- 外部 API 経由 path の credential が無く、1 経路も verify できない
- 本 ticket の変更で既存テストが失敗し、fix 方針が立たない
- ticket に無い破壊的・不可逆操作、新規公開 endpoint / MCP tool / CLI subcommand、権限・認可の変更が AC 達成に要ると判断した。default で新設して進めない

継続できる担当作業がなくなったら、変更と検証結果を保全し、note の `## Resume Point` に現在の版・未コミット変更・停止理由・試した方法・必要な回答・再開時の参照先を残す。最終結果に `STATUS: BLOCKED - <reason>` と完了済みの範囲を返す。

## spawn された実装担当として

`./ticket.sh` の実行とチケットファイルの作成・編集を行わない。チケット作成や仕様変更が要るならレスポンスで依頼する。

## 実装

AC を満たすコードを書き、out-of-scope と実行指示で指定された担当範囲の外は触らない。

- 変更前に、対象ファイルの `git log`（複数世代）と変更する行の `git blame` を読み、なぜ今その形なのか、過去の変更意図、命名とスタイルの慣習、既知の落とし穴を把握する。なお不明なら コミットメッセージの ticket 名 → `tickets/done/` → `product-brief.md` を辿る（辿り先は `AGENTS.md` を優先）。推測で変更しない
- 既存の規約と pattern に従い、新しい pattern を導入しない
- 新規 class / helper / utility を増やす前に同型 pattern を grep する。新規導入するなら justification を note へ記録する
- 生成文字列内の script（サーバが返す HTML 内のインライン JS 等）、heredoc、テンプレート埋め込みコードに条件分岐やデータ変換を書かない。テストランナーが import して叩ける関数へ切り出し、埋め込み側にはイベント登録と呼び出しの糊だけを残す
- 実装したコードに対するテストを書く。テストが通る状態を維持する
- 報告できるのは `PDH-implement` の担当範囲までである。「ticket 完了」「close 可能」と断定しない
- 別の plan 文書を作らない。investigate・implement・tests を 1 つの作業文脈で完遂し、設計判断は note の実装ログと commit message へ append する
- テスト実行前に `similarity-ts`（TS/JS）、`similarity-py`（Python）、`similarity-generic`（`--language <lang>`、単一ファイル単位）を `-t 0.7` で回し、変更ファイル間の構造的重複を検出する。閾値超過は共通化を検討してから進む。test setup 等の意図的な重複はそのままでよい。install できない環境では skip し、note へ「重複検出 skip: 環境制約（理由）」と記録する。install は https://github.com/mizchi/similarity/releases の prebuilt archive（OS/arch 別。全 CLI 同梱）を PATH の通った dir へ置く。prebuilt が無い arch だけ `cargo install similarity-ts similarity-py similarity-generic` でビルドする

## 整合性 gate（完了報告の前）

- 変更した identifier、field、API path、enum 値を、実装・test・公開層・生成層・doc・spec・sample の全 layer で追従させる
- sync/async、input/output、初回/cache の対称 pair に片側未修正を残さない。derived type、wrapper、facade で内部値が公開層から落ちていないか確認する
- provider、wire format、data変換ticketではinputとoutputの意味関係をtestする。machine-verifiable基準をtest code化し、user journey実機を1経路通す
- semantic verificationでは、同じpromptのinputなしとinputありを比較し、output差を確認する

## 書く前に、依存している仮定を測る

コードを書く前に、その実装が確かめていない仮定を列挙する。外部 API が返す応答の形、並行して同じ対象を触る他の実行、失敗した途中で残る状態、処理の順序。

- read-only の呼び出しで確かめられることを推測で書かない
- 測ったより広く書かない。`404` かつ error code `X` を測ったなら、実装も同じ条件で分岐する
- 測れないものは、その前提が崩れたときに何が起きるかまでコードのコメントに書く
- 実装中に手段を選び直したら、その手段が持ち込む仮定を洗い直す

## 指摘を直すときは、壊していないことを反例で固定する

直す前に、その修正で壊れうる入力を 1 つ選んで実行し、出力を記録する。直したあと同じ入力を流し、出力が変わっていたら退行である。

- 選ぶのは finding が示した入力ではない。その関数が拒否していた入力、通っていた別の分岐、別の実行モード（並列と逐次、CI とローカル、初回と再実行）から選ぶ
- 報告には、直す前の出力と、直したあとの同じ入力の出力を両方貼る
- 記録できる形で実行できないものは、そのことを note に書く。「変えていないはず」で済ませない
- 検出できる範囲を狭める修正は退行として扱う（作業ツリー比較を commit 間比較へ変えると、未 commit の変更を検出しなくなる）

## Commit cadence

1 commit = 1 論理単位で incremental に commit する。commit は implementor 自身が行い、message は `[<ticket-name>] <type>(<scope>): <summary>` 形式にする。

- 全変更を 1 commit に押し込まない。最初の意味ある変更で先に commit してから、長時間 gate を回す
- blocker、重要な設計判断、中断点は、コード変更や chore に同梱せずそれ単独で commit し、message も state 変更を表す文言にする
- 各 commit はテストパス状態を維持する（progressing 中は明示的 WIP marker）。「あとでテストを追加する」は許容しない
- commit 数を合否基準にしない。数合わせの retroactive split をしない。他 worker の未コミット blob を引き継ぐときも既存の塊を過去へ分解せず、残作業を論理単位で commit する

## 動作確認 gate

検証の証拠は `PDH-AGENTS.md`「Verification」に従う。実装した経路を動かし、各 AC の期待結果と実出力を note へ対応づける。外部連携を置き換えたテストでは、置き換えた先の互換性まで確認済みにしない。

リンク、通知、画面遷移、外部副作用が目的なら、承認された環境で終端のユーザー操作と結果まで確認する。実行権限や credential が不足する経路は未確認として報告し、補完に必要な手段を示す。credential の存在だけでは、本番への書き込みや新たな費用を伴う操作の許可にならない。

## コミットに含めてよいコード

- 「あとで直す」前提の仮コードをコミットしない。TODO コメント付きのハードコード値、ダミー実装、意図的に壊れたままのコードは対象外
- 未完成の機能はインタフェース（型、シグネチャ、スキーマ）だけ用意し、実装は入れない

## 実装品質

- 取りうる値が有限なら型で表現する。文字列や数値のまま扱わず、直和型 / リテラル型 / enum で不正な値を型チェッカーに検出させる
- 下流をスキップするパス（middleware の short-circuit、guard clause、キャンセル処理）は、下流が担っていたログ、クリーンアップ、リソース解放を引き継ぐ
- 長時間保持するリソース（ネットワーク接続、ファイルハンドル、ストリーム）は、相手側の切断や中断でも確実に閉じる
- コストの高い処理の前に軽量な事前チェックを入れる。decode/parse/DB アクセス/ネットワーク呼び出しの前に、入力長やフォーマットの明らかな異常を弾く
- エラーメッセージには具体的な数値を含める。何が・いくつで・上限がいくつかを明示し、呼び出し元のデバッグを助ける
- 入力バリエーションの網羅にはテーブル駆動 / パラメータ化を使う。同じ検証ロジックをケースごとにコピーしない
- 拒否・失敗パスのテストは、拒否後の後処理（ログ、drain、状態遷移、ロールバック）もカバーする

## DB スキーマ

- 追加する前に、関連する既存テーブルの構造、制約、命名規則を読んで整合させる
- NOT NULL、UNIQUE、FK、CHECK を DB 制約として定義し、アプリ層のバリデーションだけに頼らない
- 非正規化は明確なパフォーマンス根拠がある場合のみとし、根拠を Implementation Notes に記録する
- migration は upgrade と downgrade の両方を書き、downgrade で孤立データが残らないようにする
- カラム追加時のデフォルト値、NOT NULL 化時の backfill、リネーム時の旧データ移行を計画する

## テスト設計ルール

- `application-test` と `ticket-local-test` は別物である。`scripts/test-all.sh`、CI、`test/` に置く `application-test` は product contract、Architectural Invariants、一般化した regression をカバーする。変更が正しく適用されたかの検証（API リネーム後に旧 URL が 404 を返す等）は `ticket-local-test` であり、テストスイートにコミットしない
- 昇格判定は 1 問。この挙動を、ticket や一時 fixture の名前を出さずに継続する product contract として記述できるか。Yes なら `application-test` へコミット、No なら ticket-local のまま close 時に刈る
- repository が生成物（bundle 済み worker、compile 済み asset、生成された SDK model）を commit しているなら、`application-test` で再生成して突き合わせ、commit 済みファイルと異なるとき fail させる
- 実行可能な `ticket-local-test` script は `tickets/<name>/tests/` に置き、`./scripts/test-ticket-local.sh [ticket-id]` で実行する。ticket.sh は作成しないので、最初の test を書くときに `mkdir -p` する
- seed、`tmp_dir` の helper、`agent-browser`、`curl`、コマンドの実行証跡は note file へ記録する

Based on https://github.com/masuidrive/pdh/blob/XXXXXXX/codex/skills/pdh-coding/SKILL.md
