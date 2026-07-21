# PDH セットアップガイド

PDH を自分のプロジェクトへ導入する手順と、導入済みプロジェクトを最新版へ更新する手順。

PDH そのものの説明（何を解決するか・ワークフロー・ファイル構成）は [README.md](README.md) を参照。前提条件（必要なツール）も README 側にある。

- **新規に導入する**: [新規導入](#新規導入) — [方法 1](#方法-1-coding-agent-に任せる)（coding agent に任せる）または [方法 2](#方法-2-手動でセットアップ)（手順 1〜13 を順に実行）
- **導入済みを更新する**: [既存プロジェクトのアップデート](#既存プロジェクトのアップデート) — [手順](#手順) と [既知の移行手順](#既知の移行手順)
- **tmux Director の hookbus を使う**: 上記のあと README の「tmux Director」へ

節番号は改訂で変わりうるので、他ファイルから参照するときは番号ではなく**見出し名**を使うこと。

coding agent にこのリポジトリを読ませれば、導入は自動でも行える（方法 1）。

## 新規導入

### 方法 1: coding agent に任せる

プロジェクトのルートで Claude Code を起動し、以下のように指示する:

```
https://github.com/masuidrive/pdh の INSTALL.md を読んで、このプロジェクトに PDH を導入して。
```

Claude Code が以下を自動で行う:
1. ticket.sh のダウンロードと初期化
2. PDH ドキュメントの配置
3. スキル・CLAUDE.md・ticket-config の設定
4. Product Brief の雛形作成

### 方法 2: 手動でセットアップ

#### 1. PDH リポジトリを clone する

```bash
git clone https://github.com/masuidrive/pdh.git tmp/pdh
```

以降のステップでは `tmp/pdh/` のファイルをコピー元として使う。

#### 2. ticket.sh を導入する

```bash
# プロジェクトのルートで
git init  # 既存リポジトリなら不要

# ticket.sh をダウンロード・初期化
curl -sL https://raw.githubusercontent.com/masuidrive/ticket.sh/main/ticket.sh -o ticket.sh
chmod +x ticket.sh
bash ticket.sh init
```

#### 3. ファイルを配置する

以下のファイルを `tmp/pdh/` からプロジェクトにコピーする。
**すでにファイルが存在する場合はコピーせず、「既存プロジェクトのアップデート」に従う。**

| コピー元 | コピー先 | 用途 |
|---|---|---|
| `tmp/pdh/docs/product-delivery-hierarchy.md` | `docs/product-delivery-hierarchy.md` | PDH 運用ルール・テンプレート |
| `tmp/pdh/skills/pdh-dev/` | `.claude/skills/pdh-dev/` | PDH stage flow ワークフロースキル（`SKILL.md` と、そこから参照される `_*.md` を**ディレクトリごと**コピーする） |
| `tmp/pdh/skills/pdh-coding/SKILL.md` | `.claude/skills/pdh-coding/SKILL.md` | コーディング標準スキル |
| `tmp/pdh/skills/pdh-check-writing/SKILL.md` | `.claude/skills/pdh-check-writing/SKILL.md` | 宣言型 `.check` 執筆スキル |
| `tmp/pdh/skills/tmux-director/SKILL.md` | `.claude/skills/tmux-director/SKILL.md` | tmux Director スキル |
| `tmp/pdh/skills/pdh-update/SKILL.md` | `.claude/skills/pdh-update/SKILL.md` | PDH アップデートスキル |
| `tmp/pdh/templates/CLAUDE.md` | `CLAUDE.md` | Agent 向けルール |
| `tmp/pdh/templates/PDH-AGENTS.md` | `PDH-AGENTS.md` | PDH 汎用 agent ルール |
| `tmp/pdh/templates/CLAUDE.local.md.example` | `CLAUDE.local.md.example` | 環境固有 agent メモのサンプル（実体は commit しない） |
| `tmp/pdh/templates/AGENTS.md` | `AGENTS.md` | Codex CLI 向け設定（CLAUDE.md / PDH-AGENTS.md への thin pointer） |
| `tmp/pdh/templates/.ticket-config.yaml` | `.ticket-config.yaml` | ticket.sh 設定 |
| `tmp/pdh/templates/test-all.sh` | `scripts/test-all.sh` | テスト一括実行スクリプト |
| `tmp/pdh/templates/fast-checks.sh` | `scripts/fast-checks.sh` | 決定論的 fast-check ランナー（宣言形式の grep 不変条件。test-all の最初の軽量ステージ） |
| `tmp/pdh/templates/checks/` | `scripts/checks/` | fast-check レジストリ（README、汎用pattern例、source 1500行/test 2500行の例。プロジェクトに合わせて調整/削除） |
| `tmp/pdh/templates/dev-server.sh` | `scripts/dev-server.sh` | PDH verify / human-review 用の開発サーバ入口 |
| `tmp/pdh/templates/seed-pdh-verify.sh` | `scripts/seed-pdh-verify.sh` | PDH verify / human-review 用のローカル seed hook |
| `tmp/pdh/templates/test-ticket-local.sh` | `scripts/test-ticket-local.sh` | `ticket-local-test` 実行スクリプト（CI には含めない） |
| `tmp/pdh/templates/product-brief.md` | `product-brief.md` | Product Brief テンプレート |
| `tmp/pdh/templates/technical-reference.md` | `technical-reference.md` | Technical Reference テンプレート（現在の実装の How。運用は `docs/product-delivery-hierarchy.md` 参照） |
| `tmp/pdh/scripts/hookbus.js` | `scripts/hookbus.js` | tmux worker hook event bus (実行権限 `chmod +x` 要) — README「tmux Director」参照 |

コピー時に、各ファイル末尾の `Based on` 行の `XXXXXXX` を `tmp/pdh` の HEAD commit ID（7 桁）に置換する。

##### Codex CLI を使う場合: skill を symlink する

Codex CLI はプロジェクト直下の `.agents/skills/` を skill として自動で読み込む（`.codex/skills/` も同様）。**skill の実体は `.claude/skills/` に置き、`.agents/skills/` からは symlink を張る**。コピーではなく symlink にすることで、実体が 1 つだけになり両者が食い違わない。

```bash
mkdir -p .agents/skills
for s in pdh-dev pdh-coding pdh-check-writing pdh-update tmux-director; do
  ln -snf "../../.claude/skills/$s" ".agents/skills/$s"
done
```

symlink を張れないファイルシステム（Windows の一部構成など）では、`.claude/skills/` をディレクトリごとコピーしてもよい。その場合は PDH 更新のたびにコピーし直すこと。

`PDH-AGENTS.md` は PDH 汎用 agent ルール、`CLAUDE.md` は project 固有ルールとして commit する。`.claude/skills/` は skill の実体、`.agents/skills/` はそこへの symlink とし、実体を 1 つに保つ。端末・sandbox・個人アカウント・一時 URL・ローカル認証状態などの環境固有メモは `CLAUDE.local.md` に書き、`.gitignore` に入れて commit しない。必要なら `CLAUDE.local.md.example` をコピーして作る。secret の値そのものは `CLAUDE.local.md` にも書かず、取得方法や保管場所だけを書く。

```bash
grep -qxF 'CLAUDE.local.md' .gitignore || printf '\nCLAUDE.local.md\n' >> .gitignore
```

> **⚠ Grok Build を使う場合、`CLAUDE.local.md` は読まれない。** Grok は instruction file の探索で `.gitignore` を尊重するため、gitignore した時点で discovery から外れる（skill の探索は `.gitignore` を無視するので影響しない）。grok 0.2.93 の `grok inspect` で確認済み。Grok で環境固有メモを効かせたい場合は `.grok/rules/*.md` に置くなど、別の手段を検討すること。Claude Code / Codex CLI はこの制約を受けない。

対象ファイル (9 つ):
- `CLAUDE.md`
- `product-brief.md`
- `technical-reference.md`
- `.ticket-config.yaml`
- `docs/product-delivery-hierarchy.md`
- `.claude/skills/pdh-check-writing/SKILL.md`
- `.claude/skills/tmux-director/SKILL.md`
- `scripts/checks/example-max-source-lines.check`
- `scripts/checks/example-max-test-lines.check`

macOS / Linux 両対応のワンライナー:

```bash
COMMIT_ID=$(cd tmp/pdh && git rev-parse --short=7 HEAD)

# macOS (BSD sed) と Linux (GNU sed) の両対応: バックアップ拡張子として空ファイルを作らない書き方
sed_inplace() {
  if sed --version >/dev/null 2>&1; then
    # GNU sed (Linux)
    sed -i "s/XXXXXXX/$COMMIT_ID/g" "$@"
  else
    # BSD sed (macOS)
    sed -i '' "s/XXXXXXX/$COMMIT_ID/g" "$@"
  fi
}

sed_inplace \
  CLAUDE.md \
  product-brief.md \
  technical-reference.md \
  .ticket-config.yaml \
  docs/product-delivery-hierarchy.md \
  .claude/skills/pdh-check-writing/SKILL.md \
  .claude/skills/tmux-director/SKILL.md \
  scripts/checks/example-max-source-lines.check \
  scripts/checks/example-max-test-lines.check
```

`scripts/hookbus.js` と `pdh-dev` / `pdh-coding` / `pdh-update` の SKILL.md には `Based on` footer がないので sed 対象外。

#### 4. .claude/settings.json を設定する

##### 4.a. PDH core のみ (tmux Director を使わない / 単一 Claude Code セッション)

Agent Teams を使うために、`.claude/settings.json` に以下を配置する。`scripts/hookbus.js` も不要:

```json
{
  "teammateMode": "in-process",
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

- **`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` は必須。** Agent Teams は experimental で既定は無効。この変数が無いと session 開始時に team が作られず、teammate の spawn も提案も行われない（[公式ドキュメント](https://code.claude.com/docs/en/agent-teams)）
- **`teammateMode` は Claude Code 自身の teammate 表示方法**（`in-process` / `auto` / `tmux` / `iterm2`）であり、PDH の tmux Director とは別物。**Claude Code v2.1.179 以降は `in-process` が既定**なので上記の指定は冗長だが、既定値の変更に左右されないよう明示している。split pane で teammate を見たい場合は `auto` にしてよい

##### 4.b. tmux Director の hookbus event stream も使う

上記に加えて `hooks` ブロックを追加:

（PDH の tmux Director は「別 window で動く独立した Claude Code セッションを監督する」スキルで、Claude Code の `teammateMode: "tmux"`（1 セッションの teammate を split pane に置く機能）とは別物。ここで `in-process` のままなのはそのため。）

```json
{
  "teammateMode": "in-process",
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  },
  "hooks": {
    "SessionStart":      [{"hooks":[{"type":"command","command":"\"$CLAUDE_PROJECT_DIR/scripts/hookbus.js\" event","timeout":5}]}],
    "Stop":              [{"hooks":[{"type":"command","command":"\"$CLAUDE_PROJECT_DIR/scripts/hookbus.js\" event","timeout":5}]}],
    "SubagentStop":      [{"hooks":[{"type":"command","command":"\"$CLAUDE_PROJECT_DIR/scripts/hookbus.js\" event","timeout":5}]}],
    "Notification":      [{"matcher":"idle_prompt|permission_prompt",
                            "hooks":[{"type":"command","command":"\"$CLAUDE_PROJECT_DIR/scripts/hookbus.js\" event","timeout":5}]}],
    "UserPromptSubmit":  [{"hooks":[{"type":"command","command":"\"$CLAUDE_PROJECT_DIR/scripts/hookbus.js\" event","timeout":5}]}]
  }
}
```

意味:
- 5 つの hook は `scripts/hookbus.js` を呼んで `/tmp/claude-events-<socket_hash>/log.ndjson` にイベントを NDJSON で記録する
- `UserPromptSubmit` は Director が `tmux send-keys` で送った Enter が worker に届いたかを確認するために使う
- `$CLAUDE_PROJECT_DIR` は Claude Code が hook 実行時に project root を渡す公式 env var。**相対パス `scripts/hookbus.js` にすると worker が別ディレクトリに cd した直後に Stop hook が発火した場合に `not found` エラーになる** ため絶対化必須。パスにスペースが含まれる将来ケースに備えてダブルクォートで囲む

設定後、Claude Code を再起動すると有効になる。

#### 5. CLAUDE.md をカスタマイズする

`PDH-AGENTS.md` は PDH 汎用ルールなので project 固有の内容を入れない。project 固有の内容は `CLAUDE.md` にだけ書く。

- `## ディレクトリ構造` をプロジェクトの実際の構造に書き換える
- テストコマンド（`uv run pytest`, `npm test` 等）をプロジェクトに合わせる
- `scripts/dev-server.sh` / `scripts/seed-pdh-verify.sh` をプロジェクトの開発サーバー・ローカル fixture に合わせて編集する

#### 6. .ticket-config.yaml をカスタマイズする

設定項目:
- `default_branch`: メインブランチ名（default: `main`）
- `branch_prefix`: feature ブランチのプレフィックス（default: `features/`）
- `auto_push`: close 時に自動 push するか
- `default_content`: Ticket テンプレート（Why / What+AC / Architectural Invariants check / 確定判断 / Out-of-scope + 任意: Implementation Notes / Dependencies）
- `note_content`: 作業メモテンプレート（PDH-ticket-review / PDH-implement / PDH-review + Findings 表 / PDH-verify / Technical reference 更新 / PDH-human-review / Discoveries / Open Questions / Resume Point）

#### 7. scripts/test-all.sh を作成する

`tmp/pdh/templates/test-all.sh` をコピーし、プロジェクトのテストスイートに合わせてカスタマイズする。
テンプレート内のコメントアウトされた `run` 行を参考に、プロジェクトの各テストスイートを追加する。

```bash
cp tmp/pdh/templates/test-all.sh scripts/test-all.sh
chmod +x scripts/test-all.sh
# scripts/test-all.sh を編集し、プロジェクトのテストコマンドを追加
```

このスクリプトは `PDH-implement`（実装完了時）と `PDH-verify`（完了検証）で実行される。
`--parallel` フラグで並列実行が可能。

#### 8. scripts/dev-server.sh / scripts/seed-pdh-verify.sh を作成する

`tmp/pdh/templates/dev-server.sh` と `tmp/pdh/templates/seed-pdh-verify.sh` をコピーし、プロジェクトの実装に合わせて編集する。

```bash
cp tmp/pdh/templates/dev-server.sh scripts/dev-server.sh
cp tmp/pdh/templates/seed-pdh-verify.sh scripts/seed-pdh-verify.sh
chmod +x scripts/dev-server.sh scripts/seed-pdh-verify.sh
```

`PDH-verify` / `PDH-human-review` で UI / API surface を確認する場合、agent は `./scripts/dev-server.sh --seed` を使う。`--seed` は local 環境をリセットして `scripts/seed-pdh-verify.sh` を実行し、`--port <port>` は固定 port、未指定なら空き port をランダム選択する。localhost 以外から確認する必要がある場合は共通オプション `--no-localhost` を使う。

このテンプレートは安全のため実サーバを起動せず失敗する。各プロジェクトで npm / pnpm / wrangler / docker compose 等の実際の起動方法、dummy login、確認 URL、必要な認証情報の出力を実装する。seed 不要のプロジェクトでも `seed-pdh-verify.sh` は no-op として成功させる。

#### 9. scripts/test-ticket-local.sh を作成する

`tmp/pdh/templates/test-ticket-local.sh` をコピーする。これは特定 ticket の一時的な確認を
`tickets/<ticket-id>/tests/test-ticket-local.sh`（旧 flat 形式 `tests/tickets/<ticket-id>/` も後方互換）から実行する wrapper で、`scripts/test-all.sh` / CI には含めない。

```bash
cp tmp/pdh/templates/test-ticket-local.sh scripts/test-ticket-local.sh
chmod +x scripts/test-ticket-local.sh
```

使い方:

```bash
./scripts/test-ticket-local.sh                    # current-ticket.md から ticket id を推定
./scripts/test-ticket-local.sh <ticket-id>        # 明示指定
```

`ticket-local-test` は `PDH-verify` の証跡として `current-note.md` に実行コマンドと結果を残す。
恒久テストへ昇格するか迷う場合は「ticket 名や一時 fixture なしで今後も product contract として説明できるか」を基準にする。

#### 10. (hookbus 使用時のみ) vitest in-source testing を有効化

`scripts/hookbus.js` は **vitest in-source testing** (`import.meta.vitest`) でライブラリコード + CLI + テストを 1 ファイルに同居させている。テストを走らせたい場合:

1. `vitest` を devDependency に追加 (`npm i -D vitest` または既存プロジェクトなら既に入っている)
2. `vitest.config.ts` (or `.js`) の `test.projects[]` に hookbus 用 project を追加:
   ```ts
   import { defineConfig, defineProject } from 'vitest/config';
   export default defineConfig({
     test: {
       projects: [
         // ... 既存 projects ...
         defineProject({
           test: {
             name: 'scripts',
             root: './scripts',
             include: [],
             includeSource: ['hookbus.js'],  // ← in-source tests を拾う
             pool: 'forks',
             poolOptions: { forks: { singleFork: true } },
           },
         }),
       ],
     },
   });
   ```
3. `package.json` の `scripts` に追加:
   ```json
   "test:scripts": "vitest run --project scripts"
   ```
4. 実行: `npm run test:scripts` (14 テスト走る想定)

`scripts/test-all.sh` を使っているなら `run "test:scripts" npm run test:scripts` を `sequential` / `parallel` 両ブロックに追加。

hookbus を使わない、または CLI 動作だけで十分なプロジェクトではこの節はスキップしてよい。

#### 11. Product Brief を書く

- **ファイルがない場合**: `tmp/pdh/templates/product-brief.md` をコピーし、`based on` 行の commit ID を置換する。内容を埋めるようユーザに促す
- **ファイルがある場合**: テンプレートと見比べて、新しいセクションが増えていたら追記するようユーザに促す

PDH の全判断は Product Brief を基準にするため、Background / Who / Problem / Solution / Constraints / Architectural Invariants / Done のセクションが十分に記述されている必要がある。

#### 12. 動作確認

配置が正しいかざっと確認:

```bash
# ファイル存在チェック
test -f product-brief.md && echo "OK product-brief"
test -f technical-reference.md && echo "OK technical-reference"
test -f CLAUDE.md && echo "OK CLAUDE.md"
test -f .ticket-config.yaml && echo "OK ticket-config"
test -f ticket.sh && echo "OK ticket.sh"
test -f .claude/settings.json && echo "OK settings.json"
ls .claude/skills/{pdh-dev,pdh-coding,pdh-check-writing,tmux-director,pdh-update}/SKILL.md

# Based on の commit ID が XXXXXXX から置換されたか
grep -l XXXXXXX CLAUDE.md product-brief.md technical-reference.md .ticket-config.yaml .claude/skills/*/SKILL.md scripts/checks/*.check 2>&1
# → 何も出なければ OK (全ファイルで置換済み)

# ticket.sh が動くか
./ticket.sh list
```

hookbus を使う場合の追加確認:

```bash
test -x scripts/hookbus.js && echo "OK hookbus.js executable"
node scripts/hookbus.js whoami   # <socket_hash>:<pane_id> or local-<pid> が 1 行出る
jq '.hooks.Stop' .claude/settings.json   # hook 配線された JSON が出る
```

Claude Code を起動して、以下が認識されれば skill 側も OK:

```
/pdh-dev
```

で skill が読み込まれれば成功。

#### 13. 後片付け

```bash
rm -rf tmp/pdh
```

## 既存プロジェクトのアップデート

導入済みプロジェクトを最新の PDH へ更新する手順。`pdh-update` skill もこの節を辿る。

### 手順

1. PDH リポジトリを clone する（なければ）:
   ```bash
   git clone https://github.com/masuidrive/pdh.git tmp/pdh
   ```
2. `based on` の URL から旧 commit ID を特定する
3. **新規ファイルの検出**: `tmp/pdh` で旧 commit ID 以降に追加されたファイルを確認する:
   ```bash
   cd tmp/pdh && git diff --name-status <旧commit-id> HEAD -- skills/ templates/ scripts/
   ```
   `A`（追加）のファイルがあれば、「ファイルを配置する」の配置表に従って配置する。**`.ticket-config.yaml` / `product-brief.md` / `technical-reference.md` / `CLAUDE.md` / 各 SKILL.md に `Based on` footer が入るものは、同節の sed 対象にも追加する**
4. **新規ファイルの付随設定 (重要)**: 新規ファイルには単独配置だけでは機能しないものがある。下表に該当する追加があれば、対応する章を見て `.claude/settings.json` / `vitest.config.ts` / `scripts/test-all.sh` 等を更新する:

   | 新規追加された file | 参照すべき章 | 追加が必要な設定 |
   |---|---|---|
   | `scripts/hookbus.js` | 「.claude/settings.json を設定する」の hookbus 版 + 「vitest in-source testing を有効化」+ README「tmux Director」 | `.claude/settings.json` に 5 hook ブロック、`vitest.config.ts` に scripts project (includeSource)、`package.json` に `test:scripts`、`scripts/test-all.sh` に `run "test:scripts"` 行 |
   | `skills/pdh-check-writing/SKILL.md` | 「ファイルを配置する」+「Codex CLI を使う場合: skill を symlink する」 | `.claude/skills/`へ配置し、`.agents/skills/`へsymlinkを追加。追加された`templates/checks/*.check`もdirectory copyへ反映 |
   | 新規 `skills/<名前>/SKILL.md` (将来追加されたもの) | 追加された skill の README / ヘッダコメント | skill 固有の settings.json / env / script があれば個別対応 |
   | 新規 `templates/` | 「ファイルを配置する」ほか | テンプレートによる。本ガイドを再読し該当章を確認 |

   不明な新規 file があれば、**そのファイル自体の冒頭コメント** と **本ガイドの該当 section** を両方読んで必要な設定を判断する。

5. **既存ファイルの差分マージ**: `Based on` 行があるファイルごとに差分を取得・反映する:
   ```bash
   cd tmp/pdh && git diff <旧commit-id> HEAD -- <テンプレートファイルパス>
   ```
   - **スキル（SKILL.md）**: 常にテンプレートで上書きする（プロジェクト固有のカスタマイズはスキルに入れない）
   - **CLAUDE.md**: `Based on` 行の commit ID 間の差分を取り、プロジェクト固有の設定（テストコマンド、ディレクトリ構造、チーム構成テーブル等）を保持しつつテンプレートの変更を反映する
   - **本ガイドが指定する設定 (settings.json / vitest.config.ts / scripts/test-all.sh)**: プロジェクト固有のカスタマイズが入っているので上書きしない。代わりに本ガイドの「.claude/settings.json を設定する」「scripts/test-all.sh を作成する」「vitest in-source testing を有効化」と README「tmux Director」で推奨される項目が含まれているかをレビューし、抜けていたら追加する
6. **削除されたファイルの撤去**: 旧 commit から HEAD で `D` (削除) になったファイルがあれば、プロジェクト側から除去する。該当する設定 (settings.json / vitest.config.ts / scripts/test-all.sh) も必要なら撤去。上の表の逆手順。**過去の major refactor で `epics/` ディレクトリ / `epic-creator` skill / Light Full flow / PD-A / PD-B / PD-D / PD-C-2/3/4/5/8 phase は廃止された**。旧バージョンから upgrade する場合は project 側からこれらの参照を撤去する

   **⚠ 削除が「置き換え」である場合がある。** 下の[既知の移行手順](#既知の移行手順)に該当する項目があれば、単に消すのではなくそちらに従う。

6.5. **[既知の移行手順](#既知の移行手順)**: 下の節を読み、自分のプロジェクトが該当する項目をすべて適用する
7. **ticket.sh のアップデート**: `bash ./ticket.sh selfupdate` を実行して ticket.sh 本体を最新化する（PDH スキル・テンプレートは ticket.sh の挙動を前提にするため、PDH 更新と同時に行う）。実行後 `./ticket.sh list` で動作確認する
8. `Based on` 行の commit ID を最新に更新する
9. 変更点をまとめてユーザに報告する (新規追加 file、削除 file、付随設定追加、削除 file と付随設定撤去、ticket.sh の更新有無 を明示)
10. AskUserQuestion で「既存の Ticket を新しいフォーマット・ルールに合わせて書き直すか？」を確認する。OK なら `tickets/` のファイルを新テンプレートに従って更新し、commit 前に変更点をユーザに伝えて確認を取る
11. 後片付け: `rm -rf tmp/pdh`

### 既知の移行手順

#### 導入・更新手順が README.md → INSTALL.md へ移動（2026-07 以降）

以前は導入・更新手順が README.md にあり、`pdh-update` skill もそこを読んでいた。現在は本ファイル（INSTALL.md）が正で、README.md は概要とリンクだけを持つ。

**プロジェクトに配布済みの `pdh-update` skill は古い URL を読み続ける。** skill を更新しないと、次回以降も README.md を取得して手順を見失う。

```bash
# pdh-update skill を最新版に差し替える（他の skill と同じ手順）
cp tmp/pdh/skills/pdh-update/SKILL.md .claude/skills/pdh-update/SKILL.md
grep -n 'INSTALL.md' .claude/skills/pdh-update/SKILL.md   # ヒットすれば更新済み
```

README.md 側にも INSTALL.md へのリンクを残してあるので、古い skill でも「README を読む → INSTALL.md へ辿る」で到達はできる。ただし遠回りになるため、この移行は早めに適用すること。

`git diff` の追加/削除だけでは正しく移行できない変更を、ここに追記していく。アップデート時は上から順に、自分のプロジェクトが該当するか確認する。該当しなければ読み飛ばしてよい（すでに適用済みなら何度実行しても無害な形で書く）。

#### Codex 用 skill wrapper → symlink（2026-07 以降）

以前は `.agents/skills/<name>/SKILL.md` に「`.claude/skills/` を読め」と書いた wrapper ファイルを置いていた。現在は **`.agents/skills/<name>` を `.claude/skills/<name>` への symlink** にする。

**wrapper を消すだけだと Codex から skill が一切見えなくなる。** 必ず symlink を張り直すこと:

```bash
# 旧 wrapper があれば撤去し、symlink に置き換える（冪等）
for s in pdh-dev pdh-coding pdh-check-writing pdh-update tmux-director; do
  [ -e ".agents/skills/$s" ] && [ ! -L ".agents/skills/$s" ] && rm -rf ".agents/skills/$s"
  [ -d ".claude/skills/$s" ] && ln -snf "../../.claude/skills/$s" ".agents/skills/$s"
done
ls -l .agents/skills/   # すべて -> ../../.claude/skills/... になっていることを確認
```

#### `pdh-dev` の分冊ファイル欠落（2026-07 以前に導入した場合）

`pdh-dev` は `SKILL.md` と、そこから参照される `_*.md`（`_flow.md` / `_review.md` / `_execution-team.md` 等）で構成される。**2026-07 以前の手順は `SKILL.md` だけをコピーするよう書いていた**ため、手動導入したプロジェクトでは分冊が欠落している可能性がある。これは新規ファイルの追加ではないので `git diff` では検出できない。

```bash
# 欠落を確認し、ディレクトリごと同期する
ls .claude/skills/pdh-dev/
cp -R tmp/pdh/skills/pdh-dev/. .claude/skills/pdh-dev/
```

#### `scripts/test-all.sh` の bash 3.2 クラッシュ修正（2026-07 以降）

`scripts/test-all.sh` はプロジェクト固有のカスタマイズが入るため通常は上書きしないが、**空配列展開が macOS の bash 3.2 で `unbound variable` になるバグ**があった。該当する場合は Summary 部分だけを差し替える:

```bash
grep -q 'PASSED\[@\]} > 0' scripts/test-all.sh && echo "修正済み" || echo "要修正"
```

「要修正」なら、`tmp/pdh/templates/test-all.sh` の Summary ブロック（`(( ${#PASSED[@]} > 0 ))` / `(( ${#FAILED[@]} > 0 ))` の要素数ガード）を該当箇所に反映する。suite 定義（`run "..."` 行）は自分のものを残すこと。

修正後、**suite が 1 つも定義されていない状態と、失敗する suite がある状態の両方で実行して確認する**（このバグは空配列でだけ出る）。
