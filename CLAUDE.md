# プロジェクト概要

@product-brief.md を参照すること

このリポジトリは **PDH の配布元** であり、PDH を適用される側でもある。

- PDH 汎用 agent ルールは **`templates/PDH-AGENTS.md`** を読む。配布先プロジェクトのように root へコピーしない（この repo が原本であり、コピーすると原本が 2 つになる）
- Claude Code skill の実体は **`skills/`**。配布先の `.claude/skills/` に相当する
- Codex CLI は `.agents/skills/` から skill を読む。配布先ではそこを `.claude/skills/` への symlink にする（wrapper ファイルは廃止済み。実体を 1 つに保つため）

**設計意図の探し方:** `git blame <file>` でコミットを特定 → コミットメッセージの ticket 名 → `product-brief.md`

## ディレクトリ構造

```
product-brief.md                     # プロダクト概要・方針【変更にはユーザーの明示的な承認が必要】
CLAUDE.md                            # このファイル（PDH repo 固有ルール）
README.md                            # PDH の説明（何を解決するか・ワークフロー）
INSTALL.md                           # 導入・更新手順。配布物の配置表はここにある
docs/
  product-delivery-hierarchy.md      # PDH 運用ルール（配布物）
skills/                              # Claude Code skill の実体（配布物）
  pdh-dev/  pdh-coding/  pdh-reviewing/  pdh-check-writing/  pdh-update/  tmux-director/
  pdh-decision-board/
templates/                           # 配布テンプレート
  PDH-AGENTS.md                      # PDH 汎用 agent ルール（この repo でもこれを読む）
  CLAUDE.md                          # 配布先 project 固有ルールの雛形
  AGENTS.md                          # 他 agent platform 向け thin pointer
  agents/claude/  agents/codex/      # PDH worker の agent 定義（配布先 .claude/agents/ と .codex/agents/）
  checks/  *.sh                      # 配布 script 群
evals/                               # 判断ボード skill を直すときの資料（eval シナリオ + examples.md）。配布物ではない
scripts/
  hookbus.js                         # tmux worker hook event bus（配布物）
  test-all.sh                        # この repo 自身の検査（配布物ではない）
  fast-checks.sh                     # 宣言的 grep 不変条件ランナー（配布物ではない）
  check-distribution.sh              # 配布セットの一貫性検査（配布物ではない）
  check-links.py                     # Markdown リンク / アンカー検査（配布物ではない）
  check-board-render.sh              # 判断ボード kit の描画検査（配布物ではない。kit を変えたときだけ回す）
  board-check/                       # 同上（check.js と反証 fixture）
  bsd-shim/                          # BSD (macOS) のコマンドを Linux 上で模す（配布物ではない）
  checks/*.check                     # この repo 用 fast-check レジストリ
```

`scripts/` 直下のうち `hookbus.js` だけが配布物。他は PDH repo 自身の検査であり、配布先へコピーしない（`templates/` 側に配布用の同名テンプレートがある）。配布しないので `AI-4`（配布物の実行依存は標準的な Unix 環境に入っているものだけ）の対象外であり、`check-links.py` のように適した言語を使ってよい。

# 基本方針

- **時間がかかっても技術的正しさを優先する。** 後方互換のための余計なコードやハックは入れない
- **⚠ 文末が「？？」（?2回）の質問には、質問にだけ答えること。** 作業の実行・ファイル変更・コマンド実行など一切進めない。回答のみ
- **この repo は ticket 運用をしない**（`product-brief.md` の決定事項）。main へ直接 commit してよい。配布物の変更は `./scripts/test-all.sh` が通ることで担保する

# この repo 固有の実装ルール

このリポジトリに製品コードはない。成果物は **配布されるテキスト** である。したがって品質ルールもテキストに対して適用する。

## 配布物の一貫性

- **配布ファイルを追加・改名・削除したら、`INSTALL.md` の配置表（「ファイルを配置する」のコピー元/コピー先テーブル）と README のディレクトリ構造図を同じ commit で更新する。** 配布物の一覧は `INSTALL.md` にある
- **配布ファイル末尾の `Based on https://github.com/masuidrive/pdh/blob/XXXXXXX/<path>` 行を壊さない。** `XXXXXXX` はプレースホルダのまま commit する（導入時に HEAD commit へ置換される）。path 部分は **この repo 内でのソースパス**と一致させる（URL が pdh repo への permalink なので、配布先の `.claude/...` ではない）。`scripts/check-distribution.sh` の `BASED_ON_FILES` へ登録して初めて検査される
- **`pdh-update` skill の更新手順が、追加した配布物をカバーしているか確認する**
- **上書きされないテンプレート（`.ticket-config.yaml` / `CLAUDE.md` / `test-all.sh` 等、project カスタマイズを保持するファイル）に項目を追加・変更したら、`INSTALL.md`「既知の移行手順」に冪等な確認コマンド付きで追記する。** これらは pdh-update の diff マージ任せで、既存プロジェクトに確実には届かない。skill（常に上書き）だけが diff 伝播を信用してよい

## どこに書くかの判断（CLAUDE.md / PDH-AGENTS.md / skill）

判断の 3 問は `templates/PDH-AGENTS.md`「Where A Rule Belongs」に従う。この repo 固有の適用例だけをここに置く。

例: 「変更前に `git log` / `git blame` で意図を把握する」は、共通・コード変更時のみ・実装担当なので `pdh-coding` に従う。配布テンプレートの `CLAUDE.md` に同じことを書くと、コピー先で二重管理になる。

**同じルールが「テンプレートでは重複、実プロジェクトでは固有情報」になることがある。** 配布先ごとに参照先が変わる場合（辿るディレクトリ構成が違う等）は、`CLAUDE.md` にその差分だけを書いてよい。

## 規則に、実行時に要らない背景と仕組みを書かない

skill・`PDH-AGENTS.md`・`CLAUDE.md` に置くのは**現在形の規則だけ**である。読み手は「いま何をするか」を決めるために読む。次は書かない。

| 書かないもの | 置き場所 |
|---|---|
| **なぜその実装になったか** — 退けた別案、踏んだ失敗、既定値の由来 | 実装の隣（CSS / JS / script のコメント） |
| **仕組みの説明** — kit や script が保証している挙動の解説 | 保証の**一覧**を 1 行ずつ置くだけにする |
| **日付つきの事故と実測** — 「2026-08-15 に踏んだ」「ユーザ指摘」 | `evals/examples.md` |
| **経緯そのもの** | git |

⚠ **確かめる手順は、実行できる相手がいるときだけ書く。**skill の中からブラウザは開けないので、「発行前にブラウザで測れ」は書かない。実行できないなら、保証する側（kit・script）へ寄せるか、`PDH-AGENTS.md`「Browser And Surface Checks」に従って «回せない» とユーザへ渡す。

⚠ **«別のファイルへ移す» は解決ではない。**移した先が次の堆積場所になる。要らないものは消す。要るかどうかは 1 問で決まる — **読み手がそれを読んで、いま下す判断が変わるか。**

## 重複の禁止

- **同じルールを 2 箇所に書かない**（`product-brief.md` の `AI-1`）。PDH 汎用は `templates/PDH-AGENTS.md`、project 固有の書き方例は `templates/CLAUDE.md`、導入・更新手順は `INSTALL.md`、運用ルールは `docs/product-delivery-hierarchy.md`
- **配布テンプレートに「このテンプレートの使い方」を書かない**（`AI-3`）。コピー先で読み手のいない説明文になる
- 文言を移動したら、移動元に残骸がないか `rg '<特徴的な一文>'` で sweep する

## engine 中立性

- **フローの記述に特定 engine を前提としない**（`AI-5`）。engine 固有の起動手順を書く場合は、セクション見出しかリード文で前提を明示して閉じ込める
- **具体的なモデル名は「上書き例」としてのみ書く。** 役割プロファイル（`strong-judge` 等）に従う
- Claude Code 側に何かを追加したら、**Codex 側に対応が要るか必ず確認する**（`templates/AGENTS.md` の用語対応表、`INSTALL.md`「ファイルを配置する」の symlink 手順に skill 名を足すか）

# テスト・検証

## 自動検査

`./scripts/test-all.sh` を実行する。中身は 5 つ:

- `scripts/fast-checks.sh` — `scripts/checks/*.check` の宣言的不変条件（`Based on` 行の commit id 置換禁止、配布物からの `templates/` 参照禁止、merge-conflict marker、判断基準ファイル `product-brief.md` / `CLAUDE.md` の存在）
- `scripts/check-distribution.sh` — grep で書けない検査（`Based on` 行の存在とパス一致、`INSTALL.md` 配置表 ↔ 実ファイルの双方向一致、**配布物間の重複行検出**）
- `scripts/check-links.py` — Markdown のリンク検査（リンク先ファイルの存在、**アンカーが実在する見出しを指すか**）。見出しの改名でリンクが静かに切れるのを防ぐ
- **配布 kit の `selftest.sh` を 2 回** — 素の環境と、`scripts/bsd-shim/` を PATH に載せた BSD 相当。この repo も CI も GNU なので、**GNU でしか動かない書き方は素の実行では通ってしまう。**実際に `build.sh` が `base64 "$file"`（BSD が受け付けない位置引数）のまま配布され、macOS で画像を埋め込めなかった
- 配布 `*.sh` の構文検査

**配布物を追加・改名・削除したら `./scripts/test-all.sh` が通ることを確認する。** README への追記漏れはここで落ちる。

**`scripts/check-board-render.sh` は `test-all.sh` に入れない。**Node と Playwright を要る検査で、無い環境では必ず落ちるため。**判断ボードの `kit/`（`board.css` / `board.js` / `deck.css` / `deck.js` / `page.js`）を変えたときだけ回す。**`skill` の中からブラウザは開けないが、**kit を作る側は PDH repo の作業なので使ってよい**（配布しないので `AI-4` の対象外。`check-links.py` と同じ扱い）。同梱 build と環境の Chromium が食い違う場合は `CHROMIUM_EXECUTABLE=/path/to/chrome` を渡す。

新しい不変条件を追加するときは、まず `.check`（1 パターンの grep で書けるか）を検討し、書けない場合だけ `check-distribution.sh` に足す。**追加した検査は、わざと違反を作って実際に落ちることを確認する。** 落ちない検査は無いのと同じ。

### 自由文は、行数や件数で機械的に評価できない

規則・ticket・判断ボードのような自由文に対して「AC が全件あるか」「指摘を全件出したか」を測るには、書式を固定するしかない。**固定していない書式を数えた検査は、当たる形の成果物にだけ当たり、外れた形では沈黙して通る。**

⚠ **検査を足す前に、その対象を «測らない» と決めている記述を探す。**

```bash
rg '検査に入れない|測らない|数えない|数や有無|入力であって|input, not approval|never acceptable evidence' skills/ templates/ docs/ CLAUDE.md
```

`tools/check-static.sh` は「節・カード・AC・判断・見出しの数や有無は検査に入れない（板の形は案件ごとに違うため）」、`PDH-AGENTS.md` は「worker の PASS は入力であって承認ではない」と、**理由付きで既に決めている。**当たったら、**その判断を覆す理由を先に書く。**書けなければ作らない。

| 測れる | 測れない |
|---|---|
| タグの均衡、class の定義、参照の宛先 | AC が全件あるか |
| ファイルの存在、`Based on` 行、配置表との一致 | 指摘を全件出したか |
| 同一行の重複（食い違う前だけ） | 網羅性・妥当性・読みやすさ |

内容が要件を満たしているかを見たいなら、`evals/` のように人か別 agent が読む形にする（決定論ではないので `test-all.sh` には入らない）。

## 自動化できない確認

- **script を変更したら実際に実行する。** `bash -n` の構文チェックだけで完了としない
- **配布テンプレートを変更したら、実プロジェクトへの導入経路で確認する。** 最低でも、変更したファイルを実際にコピーして agent に読ませ、指示が破綻していないことを確認する
- **`INSTALL.md` の手順を変更したら、その手順どおりにコマンドを実行して確認する**
- **「ドキュメントを直した」だけで「正常に動作しています」と報告しない**
- **判断ボード skill の散文規則（`skills/pdh-*decision-board*/` の `SKILL.md` と分冊）を変えたら、`evals/` の該当シナリオを回してから commit する。** どの eval がどの失敗形を見ているかは `evals/README.md` にある。回した結果は該当 eval の `実行記録` へ追記する — **旧版との比較があって初めて、その規則が振る舞いを変えたと言える**（`evals/eval-5` に 旧 4/7 → 新 7/7 の例がある）。回せなかったなら、回していないことを commit メッセージに書く

## 頻出の漏れ

| # | カテゴリ | よくある漏れ | 対策 |
|---|---|---|---|
| 1 | 配置表 未同期 | 配布物を追加したが `INSTALL.md` の配置表に載せ忘れ | `./scripts/test-all.sh`（check-distribution が検出） |
| 2 | 文言の二重化 | 同じルールを 2 箇所に書く | `./scripts/test-all.sh`（重複行検出）。意図的な重複は allowlist に理由付きで登録。⚠ **拾えるのは «同一の行» だけ = まだ食い違っていない重複である。**書き直して食い違った後は検出できないので、**移動したら移動元を `rg` で sweep する**（上「重複の禁止」）。別々の言語で別々に書かれた重複は機械では見つからない |
| 3 | Codex 側の取り残し | skill を増減したのに `INSTALL.md` の symlink 手順や `templates/AGENTS.md` が古いまま | `INSTALL.md` の symlink ループと `templates/AGENTS.md` を確認 |
| 4 | リンク切れ | 見出しを改名して他ファイルからのアンカーリンクが無効になる | `./scripts/test-all.sh`（check-links が検出） |
| 5 | `Based on` 行 | 置換対象ファイルの行が無い / path が誤り / commit id が固定されている | `./scripts/test-all.sh`（fast-checks + check-distribution が検出） |

# PDH (Ticket) 運用

- **`product-brief.md` が全判断の基準**
- PDH 汎用ルールは `templates/PDH-AGENTS.md`、フローの詳細は `skills/pdh-dev/SKILL.md` にある。ここには PDH repo 固有の差分だけを書く
- **Acceptance Criteria の変更（追加・削除・修正）は必ずユーザの承認を得ること**

## 影響範囲の明示（必須）

チケット作成・実装計画・検証計画では、影響するレイヤーを必ず列挙する。

`docs` · `skills` · `templates` · `scripts` · `README` · `INSTALL` · `product-brief.md`
