---
name: pdh-coding
description: "PDH Coding Standards: 実装担当が実装時に参照するルール。実装を始める前に最初にこのスキルを読むこと。"
---

# PDH Coding Standards

**この skill は executor-neutral です。** CLI skill (team モード) と bot (solo モード) の双方が同じ内容を共有します。「PM から spawn された」「bot として単独実行している」のどちらの文脈でも、このスキルをそのまま使用してください。

実装担当 agent が実装時に従うルール。作業開始前にこのスキルを読むこと。

## 作業開始手順

1. `product-brief.md` を読む (全判断の基準)
2. `PDH-AGENTS.md` が存在すれば読む (PDH 汎用 agent ルール)
3. `CLAUDE.md` を読む (project 固有ルール、テストコマンド、approval policy)
4. `CLAUDE.local.md` が存在すれば読む (gitignore 済みの環境固有メモ。secret 値は置かない)
5. `ticket.sh start`/`restore` 出力の `ticket:` パス（互換 symlink: `current-ticket.md`）で **Why / Acceptance Criteria / Architectural Invariants check / 確定判断 / out-of-scope** を確認する
6. 同じ出力の `note:` パス（互換 symlink: `current-note.md`）を確認し、過去の Discoveries / 実装ログを把握する
7. 実行指示（spawn プロンプト / bot 指示）で指定された担当範囲外を変更しない

**ticket に書かれた signature 詳細 (関数 signature / 行番号 / 現状 snapshot) が実コードと一致しない場合**:

- ticket の意図 (AC / 確定判断 / out-of-scope) を尊重し、実コードに合わせて実装する
- Implementation Notes が空でも実装できる責務を持つ (実コード詳細の調査は実装担当の責務)
- signature 不一致を理由に止まらない。これは ticket 粒度の罠であり、escalate する（solo の場合は result.txt / Open Questions に記録、team の場合は PM に flag する）

## Ticket immutable rule (絶対遵守)

ticket の以下を implementor が **勝手に書き換えてはいけない**:

- **Acceptance Criteria**
- **Architectural Invariants check**
- **確定判断 (Design Decisions)**
- **Out-of-scope**

変更が必要だと判断したら、**実装を止めてエスカレーション**する（team の場合は PM に escalate、solo / bot の場合は result.txt に `STATUS: BLOCKED` を書いて中断し、ユーザーが判断できるよう記録する）。承認を得て ticket が更新されるまで実装を進めない。

これは「意思決定者の意思を上書きしない」ための gate。違反すると ticket が "意思決定者の意思" を持たなくなり、ticket そのものの価値が消失する。

## YAGNI / 最小実装 (絶対遵守)

**AC を満たす最小の変更で止める。仮定の将来要件のために設計しない。**

- AC に無い機能・オプション・抽象化・拡張点・設定・汎用化・防御コードを**先回りで足さない**。「ついで」の汎用化・リファクタは禁止。
- **観測した問題は無視せず記録・分類する**（current ticket で直すか follow-up にするかを決めるのは PM。判定基準は `PDH-AGENTS.md`「Verification」の Scope boundary）。**観測していない将来問題のための設計はしない**。この対比が境界線。
- 拡張余地が要ると判断したら、自前で作り込まず **Open Questions / 完了報告に1行で記録**して意思決定者に委ねる（その場で実装しない）。
- *理由*: 投機的拡張は未使用コードを負債化させ、実装が AC から乖離し、レビューと修正を長引かせる。

## 曖昧な判断委譲の拒否

実行指示（spawn プロンプト / bot 指示）に「Coding Engineer 判断」「下流で決めて」「よしなに」等の判断委譲表現があった場合、**確定値を聞き返す**（team: PM に確認 / solo / bot: Open Questions に記録）。意思決定者が決めるべき判断を下流に投げる pattern は anti-pattern であり、許容しない。下記の default 続行は、ticket contract を変えない実装ローカルで可逆な選択だけに適用する。

例:
- ❌ "fallback の挙動は Coding Engineer 判断" → ✅ "fallback の挙動を具体的に教えてください (raise / silent fallback / default 値)"
- ❌ "ここはよしなに" → ✅ "判断基準が複数あるため確定値をください"

## Open Questions protocol (batch escalate)

実装中に判断分岐や曖昧な解釈に遭遇した時の運用。**非対話モード (Codex exec 等) では interactive な確認ができないため、判断 lost を防ぎつつ throughput を保つために以下を守る**。

### 通常時 (default action)

ticket contract を変えない **実装ローカルで可逆な迷い**に遭遇したら、実装を止めずデフォルト値を選んで進める。同時に以下を記録する。product / UX / security の判断、AC・Design Decisions・Out-of-scope、human gate、共有 repository 設定、base branch に関する判断には default を使わず、明示回答まで止める。

1. note file（`ticket.sh start`/`restore` 出力の `note:` パス。互換 symlink: `current-note.md`）の **`## Open Questions`** セクションに append:
   - 質問内容 (なぜ迷ったか)
   - 試した解釈と却下理由
   - 採用した default 値 + その判断根拠
   - 上位への要請 (確定値が欲しい / scope 判断が欲しい / etc)（team: PM へ / solo: 完了報告で確認）
2. **commit message に `ASSUMPTION:` prefix で明示**:
   ```
   feat(blocks): add reference_images slot

   ASSUMPTION: reference_images の bind 構文は `{{images}}` を採用。
   AC2 の「image 変数を bind」だけでは構文が一意に決まらないため。
   ```
3. 完了時 (or 中断時) に **result.txt 末尾に `## Open Questions Summary`** を batch で列挙。上位（team: PM / solo: ユーザー）がこれを読んで判断する

### 即中断 trigger (例外)

以下に該当する場合のみ、push せず即中断する (default で進めても後で確実に壊れる場合):

- **AC 違反確定**: 解釈分岐があり、default を選ぶと AC のいずれかが達成不能になる
- **Architectural Invariants 違反**: product-brief.md の Invariants を踏まない選択肢が存在しない
- **out-of-scope 必須**: AC 達成のために ticket の out-of-scope を踏むしかない
- **E2E credential 不在**: 外部 API 経由 path で credential がなく 1 経路も verify 不能
- **既存テスト失敗の根本原因不明**: 本 ticket の変更で既存テストが失敗し、fix 方針が立たない
- **ticket 未記載の破壊的・不可逆・公開 surface 新設**: AC 達成のために、ticket に書かれていない破壊的・不可逆操作 (物理削除・purge・force 上書き等)、新規公開 endpoint / MCP tool / CLI サブコマンド、または権限・認可面の変更が必要だと判断した場合。default で新設して進めない

### 中断手順

1. **直近の作業を 1 commit に切る** (中断時点までを保存。Commit cadence 契約の一部として記録)
2. 同じ note file の **`## Resume Point`** セクションに記録:
   - 最後の commit hash
   - 中断理由 (即中断 trigger のどれに該当するか)
   - 試した方法と却下理由
   - 上位への質問 (確定値を返してほしい点)（team: PM / solo: ユーザー）
   - 再開時の必要 context (どのファイルから読み始めるか)
3. `result.txt` に `STATUS: BLOCKED - <one-line reason>` を書いて exit

### 設計意図

- **judgement lost を防ぐ**: 採用した default 値と理由を残すことで、上位（team: PM / solo: ユーザー）が「この判断を覆したい」と決めた時は該当 commit だけ revert / 修正で済む
- **throughput 最大化**: 「迷ったら全部止まる」は inefficient。default で進めて batch escalate することで、Codex の単一 run で最大限の work を進める
- **commit cadence と相乗**: 細切れ commit + ASSUMPTION marker により、上位（team: PM / solo: ユーザー）の事後 review で「どの判断を覆すべきか」が pinpoint できる

## 下位 agent / 外部モデル (Codex 等) として spawn された場合

意思決定者（team: PM / solo: ユーザー）から spawn された実装担当として動く場合のルール（solo / bot で自分自身が意思決定も兼ねる場合はこの節は該当しない）:

- **チケット操作 (`./ticket.sh`) やチケットファイルの作成・編集は一切行わないこと。** チケット管理は意思決定者（team: PM / solo: ユーザー）の責務
- チケット作成や仕様変更が必要だと判断した場合は、**レスポンスとして依頼する** (自分で実行しない)
- **完了報告ファイル (`result.txt` 等) を repository root に書かないこと。** `codex exec -o <path>` で指定された出力先 (通常 `/tmp/codex-XXXXXX/result.txt`) のみに書く。repository root に `result.txt` を作ると `git status` に dirty file として残り、後続 `PDH-review` の diff に巻き込まれて reviewer を混乱させる原因になる (複数 ticket で実発生)。`/tmp/codex-XXXXXX/` 外への成果物書き出しが必要な場合は上位（team: PM / solo: ユーザー）に依頼する

## 実装ルール

ticket の Acceptance Criteria を満たすコードを書く。out-of-scope は触らない。

- **変更前に既存コードの意図・書き方を把握する**: ファイルを変更する前に、その周辺の `git log`（対象ファイル・対象範囲を複数世代）と、変更する行の `git blame` を読み、なぜ今その形になっているか・過去の変更意図・命名やスタイルの慣習・既知の落とし穴を把握してから書く。履歴を読まずに変更して、過去に潰したバグを蒸し返したり既存の設計判断を無視したりしない
  - **意図がなお不明なら**: `git blame <file>` でコミットを特定 → コミットメッセージの ticket 名 → `tickets/done/` → `product-brief.md` の順で辿る。推測で変更せず、意図を確認してから手を入れる（プロジェクトによって辿り先が異なる場合は `CLAUDE.md` の記載を優先する）
- **パターン踏襲**: 既存コードの規約・パターンに従う。新しいパターンを導入しない
- **既存 abstraction の流用**: 新規 class / helper / utility を増やす前に、既存に同型 pattern がないか grep する。既存があれば流用、なければ新規導入の justification を Implementation 中に Discoveries / 実装ログに記録
- **テスト**: 実装したコードに対するテストを書く。テストが通る状態を維持する
- **テスト到達不能な形に分岐ロジックを置かない**: 生成文字列内の script (サーバが返す HTML 内のインライン JS 等)・heredoc・テンプレート埋め込みコードに、条件分岐やデータ変換を直接書かない。テストランナー (vitest / pytest 等) が import して叩ける関数・モジュールに切り出し、unit test を付ける。埋め込み側にはイベント登録・呼び出しなどの最小の糊だけを残す
- **実装→テストのループ**: 実装とテスト実行を自分自身が繰り返し、全件パスした状態で完了報告すること。テスト未実行のまま返さない
- **完了報告の範囲**: 実装担当が報告できるのは `PDH-implement` の担当範囲まで。チケット全体の完了は `PDH-review` / `PDH-verify` / `PDH-human-review` 後に PM とユーザが判断するため、「ticket 完了」「close 可能」と断定しない
- **重複検出 (テスト前)**: 実装完了後、テスト実行前に `similarity-ts` (TS/JS) / `similarity-py` (Python) / `similarity-generic` (Ruby ほか) で変更ファイル間の構造的重複を検出する。閾値を超える重複が見つかった場合は共通化を検討してからテストに進む。重複が意図的 (テスト setup 等) な場合はそのまま進めてよい。

  **install** (Rust 製 CLI 群。1 つの release archive に全 CLI 同梱: `similarity-ts` / `similarity-py` / `similarity-generic` ほか。npm/pip パッケージは無い):
  - **prebuilt を優先** (ビルド不要・速い)。https://github.com/mizchi/similarity/releases から **自分の OS/arch に合う archive** を取り、PATH の通った dir に置く:
    ```bash
    # PLATFORM は自分の環境に合わせる (例: x86_64-unknown-linux-gnu / aarch64-apple-darwin)
    gh release download --repo mizchi/similarity --pattern "*${PLATFORM}*.tar.gz" -D /tmp/sim --clobber
    tar xzf /tmp/sim/*.tar.gz -C /tmp/sim
    cp /tmp/sim/similarity-*/similarity-* "$HOME/.local/bin/"   # PATH の通った dir へ
    ```
  - **自分の OS/arch 用 prebuilt が無い場合のみ cargo でビルド** (`cargo` 必須、~60-90 秒):
    ```bash
    cargo install similarity-ts similarity-py similarity-generic
    ```

  **基本的な使い方** (`-t/--threshold` 既定 0.85、`-p/--print` でコード出力):
  ```bash
  similarity-ts ./frontend/src --threshold 0.7 --print
  similarity-py ./src --threshold 0.7 --print
  # similarity-generic は ts/py と仕様が異なり「単一ファイル指定」(dir/複数引数/--print 非対応、
  # 関数比較は同一ファイル内)。プロジェクト全体は per-file ループで回す:
  for f in $(find ./sdk/ruby/lib -name '*.rb'); do similarity-generic --language ruby -t 0.7 "$f"; done
  ```

  対応言語マップ: `similarity-ts` = TS/JS、`similarity-py` = Python、`similarity-generic` = Go / Java / C / C++ / C# / **Ruby** (`--language <lang>` 指定。**単一ファイル単位**で関数類似を比較、`--supported` で対応言語一覧)。`similarity-ts` / `similarity-py` は dir 再帰 + `--print` 可。

  install できない環境 (Codex sandbox 等) では skip 可。skip した場合は note に「重複検出 skip: 環境制約 (理由)」と 1 行記録する
- **PDH-implement 完了条件**: `CLAUDE.md` の「テスト」セクションを読み、記載されたテストコマンドを実行して all passed になること。結果をレスポンスに含める

## Commit cadence 契約

PDH では implementor が **論理単位の境界ごとに incremental に commit する**。1 commit = 1 論理単位。狙いは commit の *数* ではなく次の 3 点:

1. **mega-commit を作らない** — 事後の review / bisect / partial rollback を可能にする
2. **作業状態を durable に残す** — 中断 / timeout / ephemeral runner で作業を失いにくくする
3. **state 遷移を durable に残す** — blocker・設計判断の確定・中断点を、後から history で追える形にする

- **mega-commit 禁止**: 「全変更を 1 commit に押し込む」は事後分析不能。論理単位で割る
- **commit early**: 最初の意味ある変更で先に commit してから長時間 gate (フルテスト等) を回す。
- **push は明示承認時のみ**: この repo ではユーザ / PM が明示した場合、または close 手順で承認済みの場合だけ push する。`CLAUDE.md` の no-push-without-request ルールを優先する。
- **state 遷移は独立 commit**: blocker / 重要な設計判断 / 中断点は、コード変更や無関係な chore に同梱せず *それ単独で* commit する。commit message も state 変更を表す文言にし、`chore: ...` 等に埋もれさせない
- 各 commit はテストパス状態を維持 (progressing 中なら明示的 WIP marker)
- commit メッセージは `[<ticket-name>] <type>(<scope>): <summary>` 形式
- commit は **implementor 自身が直接行う**

> **粒度の目安 (合否 gate ではない)**: 典型的な feature ticket は自然に 5+ commits になる。2-3 commit で終わったら「粒度が粗すぎないか / state 遷移を 1 commit に埋もれさせていないか」を自問する。ただし **commit 数そのものを合否基準にしてはならない** — 数合わせのための retroactive split (引き継ぎ blob を無理に過去へ再分解する等) は偽の境界を生むだけで禁止。論理単位が少なければ少ないままでよい。

**引き継ぎ (rescue / finish pass)**: 他 worker の未コミット blob を引き継ぐ場合、既存の塊を無理に過去へ分解しない。ただし *それを理由に「全変更を最後に 1 burst で commit」へ倒してはならない* — 残作業は論理単位で commit し、note / blocker は独立 commit で先に残す。

pure docs / pure housekeeping (lockfile tracking / 設定ファイル 1 行更新 等) ticket は論理単位が元々少なく、1-2 commit でも自然。commit 数の少なさ自体は問題にしない (count gate ではないため、特別な緩和宣言も不要)。

commit 分割の例 (画像入力機能の場合):
1. `feat(providers): add ReferenceImage provider contract`
2. `feat(blocks): extend image_generate block to accept reference inputs`
3. `feat(chain): propagate images via pipe_data.steps[].images`
4. `feat(validation): add 422 error path for invalid reference inputs`
5. `feat(persistence): guard against data URI in process config`
6. `test: add unit tests for reference image validation`
...

## 動作確認 gate（完了判定は実データ + 終端操作で行う）

ビルド成功やテストパスは完了判定ではない。**実装後は実環境で動作確認する。**

- **「stub」は外部 API の mock だけを指さない。** 自分が手で組み立てて系に流し込む入力すべて（合成ログ entry、手で set した context / DB 行、本番の上流が本来生成するデータを迂回する fixture 等）が stub。stub は早期 feedback 用で、**完了判定には使わない**。コードが「与えた入力どおりの出力」を返したことの確認は循環論法であり、完了判定ではない
- **consume 側機能**（他所が生成するログ / イベント / payload / DB 行を読む機能）は、検証前に「実上流が実際に何を出すか」を実データで観測する（本番ログを query する等）。上流が consumer の必要フィールドを出していなければ、**その機能は未完成（不具合）であって pass ではない**
- **「描画された / 生成された」で完了としない。** リンク・通知・画面遷移・外部副作用が目的なら、**終端のユーザ操作を実際に行って着地まで**確認する（リンクは実際にクリック、通知は実イベントで受信）。「実機 = 実トランスポート」を「実データ」と取り違えない（例: 実 Slack に合成ログを流すのは実データ確認ではない）

外部 provider / 外部 API / webhook / SDK / 認証 等を経由する path がある場合、**実 API で 1 経路以上 200 確認** する。

- credential が `.env` 等にある provider → 実 API 実行が必須
- credential 不在の場合 → "deferred" として明示 escalate (自己判断で skip しない)（team: PM へ / solo: result.txt に記録）。自発的に「stub で十分」と判断しない
- 確認結果は note の実装ログ / Discoveries に記録 (response status / body 抜粋 / cost)

## コミットに含めてよいコードの基準

- **「あとで直す」前提の仮コードはコミットしない。** TODO コメント付きのハードコード値、ダミー実装、意図的に壊れたままのコードはコミット対象外
- **未完成の機能はインタフェース (型・シグネチャ・スキーマ) だけ用意し、実装は入れない。** 呼び出し側が依存できる契約だけを残し、中身は次のチケットで埋める
- **コミットした時点でテストが通る状態を維持する。** 「あとでテストを追加する」は許容しない

## 実装品質ルール

言語・フレームワークに依存しない標準。プロジェクト固有の実装ルールは `CLAUDE.md` 側に書く。

### 型安全性
- **取りうる値が有限なら、型でそれを表現する。** 文字列や数値のまま扱わず、その言語の直和型 / リテラル型 / enum で不正な値を型チェッカーに検出させる（例: Python `Literal["text"]`、TypeScript `"text" | "image"`、Rust/Go の enum・定数型）
- **判別つき union は discriminator を型で固定する。** 分岐が網羅されているかを型チェッカーに検証させる

### 防御的プログラミング
- **コストの高い処理の前に軽量な事前チェックを入れる。** decode/parse/DB アクセス/ネットワーク呼び出しの前に、入力長やフォーマットの明らかな異常を弾く
- **エラーメッセージには具体的な数値を含める。** 何が・いくつで・上限がいくつかを明示し、呼び出し元のデバッグを助ける

### 早期 return・中断パス
- **下流をスキップするパスは、下流が担っていた責務を引き継ぐ。** middleware の short-circuit、guard clause、キャンセル処理などで、ログ・クリーンアップ・リソース解放が飛ばされていないか確認する
- **長時間保持するリソースは途中切断に備える。** ネットワーク接続・ファイルハンドル・ストリームは、正常終了だけでなく相手側の切断や中断でも確実に閉じる

### テスト実装
- **入力バリエーションの網羅にはテーブル駆動 / パラメータ化を使う。** 同じ検証ロジックをケースごとにコピーしない（例: pytest `@pytest.mark.parametrize`、Go の table-driven test、vitest `test.each`）
- **拒否・失敗パスのテストは、拒否そのものだけでなく拒否後の後処理もカバーする**（ログ・drain・状態遷移・ロールバック）

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
