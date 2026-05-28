---
name: pdh-coding
description: "PDH Coding Standards: Coding Engineer が実装時に参照するルール。spawn された Agent は最初にこのスキルを読むこと。"
---

# PDH Coding Standards

Coding Engineer が実装時に従うルール。PM (Director) から spawn されたら、作業開始前にこのスキルを読むこと。

## 作業開始手順

1. `product-brief.md` を読む (全判断の基準)
2. `current-ticket.md` で **Why / Acceptance Criteria / Architectural Invariants check / 確定判断 / out-of-scope** を確認する
3. `current-note.md` を確認し、過去の Discoveries / 実装ログを把握する
4. spawn プロンプトで指定された担当範囲外を変更しない

**設計意図の探し方:** 既存コードの意図が不明な場合は `git blame <file>` でコミットを特定 → コミットメッセージの ticket 名 → `tickets/done/` → `product-brief.md` の順で辿る。推測で変更せず、意図を確認してから手を入れること

**ticket に書かれた signature 詳細 (関数 signature / 行番号 / 現状 snapshot) が実コードと一致しない場合**:

- ticket の意図 (AC / 確定判断 / out-of-scope) を尊重し、実コードに合わせて実装する
- Implementation Notes が空でも実装できる責務を持つ (実コード詳細の調査は Coding Engineer の責務)
- signature 不一致を理由に止まらない。これは ticket 粒度の罠であり、PM に flag する

## Ticket immutable rule (絶対遵守)

ticket の以下を implementor が **勝手に書き換えてはいけない**:

- **Acceptance Criteria**
- **Architectural Invariants check**
- **確定判断 (Design Decisions)**
- **Out-of-scope**

変更が必要だと判断したら、**実装を止めて PM に escalate** する。PM が user 承認を得て ticket を更新するまで実装を進めない。

これは「PM の意思を上書きしない」ための gate。違反すると ticket が "PM の意思" を持たなくなり、ticket そのものの価値が消失する。

## PM の "punt" 拒否

spawn prompt に「Coding Engineer 判断」「下流で決めて」「よしなに」等の判断委譲表現があった場合、**確定値を PM に聞き返す**。PM が決めるべき判断を下流に投げてくる pattern は anti-pattern であり、許容しない。

例:
- ❌ "fallback の挙動は Coding Engineer 判断" → ✅ "fallback の挙動を具体的に教えてください (raise / silent fallback / default 値)"
- ❌ "ここはよしなに" → ✅ "判断基準が複数あるため確定値をください"

## Open Questions protocol (batch escalate)

実装中に判断分岐や曖昧な解釈に遭遇した時の運用。**非対話モード (Codex exec 等) では interactive な確認ができないため、判断 lost を防ぎつつ throughput を保つために以下を守る**。

### 通常時 (default action)

迷い点に遭遇したら、**実装を止めず、デフォルト値を選んで進める**。同時に以下を記録:

1. `current-note.md` の **`## Open Questions`** セクションに append:
   - 質問内容 (なぜ迷ったか)
   - 試した解釈と却下理由
   - 採用した default 値 + その判断根拠
   - PM への要請 (確定値が欲しい / scope 判断が欲しい / etc)
2. **commit message に `ASSUMPTION:` prefix で明示**:
   ```
   feat(blocks): add reference_images slot

   ASSUMPTION: reference_images の bind 構文は `{{images}}` を採用。
   AC2 の「image 変数を bind」だけでは構文が一意に決まらないため。
   ```
3. 完了時 (or 中断時) に **result.txt 末尾に `## Open Questions Summary`** を batch で列挙。PM がこれを読んで判断する

### 即中断 trigger (例外)

以下に該当する場合のみ、push せず即中断する (default で進めても後で確実に壊れる場合):

- **AC 違反確定**: 解釈分岐があり、default を選ぶと AC のいずれかが達成不能になる
- **Architectural Invariants 違反**: product-brief.md の Invariants を踏まない選択肢が存在しない
- **out-of-scope 必須**: AC 達成のために ticket の out-of-scope を踏むしかない
- **E2E credential 不在**: 外部 API 経由 path で credential がなく 1 経路も verify 不能
- **既存テスト失敗の根本原因不明**: 本 ticket の変更で既存テストが失敗し、fix 方針が立たない

### 中断手順

1. **直近の作業を 1 commit に切る** (中断時点までを保存。commit cadence 5+ の一部として記録)
2. `current-note.md` の **`## Resume Point`** セクションに記録:
   - 最後の commit hash
   - 中断理由 (即中断 trigger のどれに該当するか)
   - 試した方法と却下理由
   - PM への質問 (確定値を返してほしい点)
   - 再開時の必要 context (どのファイルから読み始めるか)
3. `result.txt` に `STATUS: BLOCKED - <one-line reason>` を書いて exit

### 設計意図

- **judgement lost を防ぐ**: 採用した default 値と理由を残すことで、PM が「この判断を覆したい」と決めた時は該当 commit だけ revert / 修正で済む
- **throughput 最大化**: 「迷ったら全部止まる」は inefficient。default で進めて batch escalate することで、Codex の単一 run で最大限の work を進める
- **commit cadence 5+ と相乗**: 細切れ commit + ASSUMPTION marker により、PM の事後 review で「どの判断を覆すべきか」が pinpoint できる

**ticket に書かれた signature 詳細 (関数 signature / 行番号 / 現状 snapshot) が実コードと一致しない場合**:

- ticket の意図 (設計判断 / What / AC) を尊重し、実コードに合わせて実装する
- Implementation Notes が空でも実装できる責務を持つ (実コード詳細の調査は Coding Engineer の責務)
- signature 不一致を理由に止まらない (これは ticket 粒度の罠であり、PM に flag する)

## Codex / 外部モデルで実行される場合

- **チケット操作 (`./ticket.sh`) やチケットファイルの作成・編集は一切行わないこと。** チケット管理は PM の責務
- チケット作成や仕様変更が必要だと判断した場合は、**レスポンスとして PM に依頼する** (自分で実行しない)
- **完了報告ファイル (`result.txt` 等) を repository root に書かないこと。** `codex exec -o <path>` で指定された出力先 (通常 `/tmp/codex-XXXXXX/result.txt`) のみに書く。repository root に `result.txt` を作ると `git status` に dirty file として残り、後続 PD-C-7 review の diff に巻き込まれて reviewer を混乱させる原因になる (複数 ticket で実発生)。`/tmp/codex-XXXXXX/` 外への成果物書き出しが必要な場合は PM に依頼する

## 実装ルール

ticket の Acceptance Criteria を満たすコードを書く。out-of-scope は触らない。

- **パターン踏襲**: 既存コードの規約・パターンに従う。新しいパターンを導入しない
- **既存 abstraction の流用**: 新規 class / helper / utility を増やす前に、既存に同型 pattern がないか grep する。既存があれば流用、なければ新規導入の justification を Implementation 中に Discoveries / 実装ログに記録
- **テスト**: 実装したコードに対するテストを書く。テストが通る状態を維持する
- **実装→テストのループ**: 実装とテスト実行を Coding Engineer 自身が繰り返し、全件パスした状態で PM に返すこと。テスト未実行のまま返さない
- **重複検出 (テスト前)**: 実装完了後、テスト実行前に `similarity-ts` (TS/JS) / `similarity-py` (Python) / `similarity-generic` (Ruby ほか) で変更ファイル間の構造的重複を検出する。閾値を超える重複が見つかった場合は共通化を検討してからテストに進む。重複が意図的 (テスト setup 等) な場合はそのまま進めてよい。

  **install** (Rust 製 CLI、npm/pip パッケージは存在しない):
  - `cargo install similarity-ts similarity-py similarity-generic` (`cargo` が必要、通常 ~60-90 秒)
  - `cargo` がない環境では https://github.com/mizchi/similarity/releases から prebuilt binary を取得

  **基本的な使い方**:
  ```bash
  similarity-ts ./frontend/src --threshold 0.7 --print
  similarity-py ./src --threshold 0.7 --print
  similarity-generic ./sdk/ruby/lib --threshold 0.7 --print
  ```

  対応言語マップ: `similarity-ts` = TS/JS、`similarity-py` = Python、`similarity-generic` = Go / Java / C / C++ / C# / Ruby (multi-language CLI、必要なら `--lang ruby` 等の指定が要るかは実行時に `--help` で確認)。

  install できない環境 (Codex sandbox 等) では skip 可。skip した場合は note に「重複検出 skip: 環境制約 (理由)」と 1 行記録する
- **PD-C-6 完了条件**: `CLAUDE.md` の「テスト」セクションを読み、記載されたテストコマンドを実行して all passed になること。結果をレスポンスに含める

## Commit cadence 5+ 契約

Direct flow では implementor が **incremental に 5+ commits に分けて切る**。1 commit = 1 論理単位。

- 「全変更を 1 commit に押し込む」は禁止 (事後分析 / bisect / partial rollback 不能)
- 各 commit はテストパス状態を維持 (progressing 中なら明示的 WIP marker)
- commit メッセージは `[<ticket-name>] <type>(<scope>): <summary>` 形式
- commit は PM ではなく **implementor 自身が直接行う**

例外: pure docs / pure housekeeping (lockfile tracking / 設定ファイル 1 行更新 等) ticket では、PM 判断で 3+ に緩和してよい。緩和する場合は **spawn prompt に「本 ticket は X のため cadence 3+ に緩和」を明示** し、`current-note.md` の実装ログ (`PD-C-6.` セクション) に緩和理由を記録する。`current-ticket.md` の Implementation Notes には書かない (ticket は後世への永続記録、cadence 緩和は本セッション限定の運用判断であり、後で同じ ticket を読む人にとってノイズになるため)。

commit 分割の例 (画像入力機能の場合):
1. `feat(providers): add ReferenceImage provider contract`
2. `feat(blocks): extend image_generate block to accept reference inputs`
3. `feat(chain): propagate images via pipe_data.steps[].images`
4. `feat(validation): add 422 error path for invalid reference inputs`
5. `feat(persistence): guard against data URI in process config`
6. `test: add unit tests for reference image validation`
...

## E2E real API gate

外部 provider / 外部 API / webhook / SDK / 認証 等を経由する path がある場合、**実 API で 1 経路以上 200 確認** する。

- credential が `.env` 等にある provider → 実 API 実行が必須
- credential 不在の場合 → "deferred" として PM に明示 escalate (自己判断で skip しない)
- stub / mock は早期 feedback には使うが、**完了判定には使わない**
- 確認結果は note の実装ログ / Discoveries に記録 (response status / body 抜粋 / cost)

## コミットに含めてよいコードの基準

- **「あとで直す」前提の仮コードはコミットしない。** TODO コメント付きのハードコード値、ダミー実装、意図的に壊れたままのコードはコミット対象外
- **未完成の機能はインタフェース (型・シグネチャ・スキーマ) だけ用意し、実装は入れない。** 呼び出し側が依存できる契約だけを残し、中身は次のチケットで埋める
- **コミットした時点でテストが通る状態を維持する。** 「あとでテストを追加する」は許容しない

## 実装品質ルール

### 型安全性
- **Union 型の discriminator には `Literal` を使う。** `type: str` ではなく `type: Literal["text"]` で型チェッカーに不正な値を検出させる

### 防御的プログラミング
- **コストの高い処理の前に軽量な事前チェックを入れる。** decode/parse/DB アクセスの前に、入力長やフォーマットの明らかな異常を弾く
- **エラーメッセージには具体的な数値を含める。** 何が・いくつで・上限がいくつかを明示し、呼び出し元のデバッグを助ける

### ミドルウェア・フィルタ
- **short-circuit するパスは、下流をバイパスする影響を考慮する。** ログ・クリーンアップ・リソース解放など、下流が担っていた責務を自身で補う
- **ネットワーク越しの接続は途中切断に備える。** レスポンス送信後も相手側のストリームを正しく閉じる

### テスト実装
- **allowlist/denylist のバリエーションには `@pytest.mark.parametrize` を使う。** 網羅性と保守性を両立させる
- **ミドルウェアやフィルタのテストでは、正常系だけでなく拒否後の後処理 (ログ・drain・状態遷移) もカバーする**

## DB スキーマ設計ルール

DB スキーマはコードより変更コストが高い。migration は事実上不可逆であり、一度入った負債は長期間残る。

- **既存スキーマを先に読む**。新しいテーブル・カラムを追加する前に、関連する既存テーブルの構造・制約・命名規則を確認し、整合させる
- **正規化を崩さない**。冗長カラムや非正規化は、明確なパフォーマンス根拠がある場合のみ。根拠は Implementation Notes に記録する
- **制約を DB レベルで入れる**。NOT NULL・UNIQUE・FK・CHECK はアプリ層ではなく DB 制約として定義する。アプリ層のバリデーションだけに頼らない
- **命名は既存に合わせる**。テーブル名・カラム名・インデックス名の規則を既存から読み取り、踏襲する
- **migration は可逆にする**。upgrade と downgrade の両方を書き、downgrade で孤立データが残らないようにする
- **既存データの扱いを考慮する**。カラム追加時のデフォルト値、NOT NULL 化時の backfill、リネーム時の旧データ移行を計画する

## テスト設計ルール

- **テストは「アプリがこう動くべき」 (desired state) を記述する**。現在の仕様における正しい振る舞いを定義するもの
- **変更の動作確認テストはコードに含めない**。変更が正しく適用されたかの検証 (例: API リネーム後に旧 URL が 404 を返す) は一時的な確認であり、テストスイートにコミットしない
- テスト項目の判断基準: 「このテストはアプリの望ましい状態を記述しているか？」→ Yes ならコミット対象、No (変更の副作用確認など) なら一時確認のみ

## コンテキスト管理

- コンパクション時に以下を必ず保持すること: 現在のチケット名、未解決の懸念事項、ユーザから得た判断・承認
- 関連のないタスク間では `/clear` でコンテキストをリセットする
- 調査が大規模になる場合はサブエージェントに委譲し、メインのコンテキストを実装に集中させる
