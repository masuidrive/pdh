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
| `tmp/pdh/skills/pdh-reviewing/SKILL.md` | `.claude/skills/pdh-reviewing/SKILL.md` | レビュー標準スキル（reviewer worker が review 開始前に読む） |
| `tmp/pdh/skills/pdh-check-writing/SKILL.md` | `.claude/skills/pdh-check-writing/SKILL.md` | 宣言型 `.check` 執筆スキル |
| `tmp/pdh/skills/tmux-director/SKILL.md` | `.claude/skills/tmux-director/SKILL.md` | tmux Director スキル |
| `tmp/pdh/skills/pdh-update/SKILL.md` | `.claude/skills/pdh-update/SKILL.md` | PDH アップデートスキル |
| `tmp/pdh/skills/pdh-decision-board/` | `.claude/skills/pdh-decision-board/` | 判断ボードスキル — 実装前 gate と close 前 gate の両方。`SKILL.md` が入口で、共通規則 `base.md` / gate 差分 `ticket-gate.md` `close-gate.md` / renderer 分冊 / `kit/`（CSS・JS・見本）/ `tools/`（組み立てと静的検査。bash と awk だけで動く）を**ディレクトリごと**コピーする |
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
| `tmp/pdh/templates/agents/claude/` | `.claude/agents/` | PDH worker の agent 定義（Claude Code 用。read-only 役の書き込み境界を `tools` で機構化する。**ディレクトリごと**コピーする） |
| `tmp/pdh/templates/agents/codex/` | `.codex/agents/` | PDH worker の agent 定義（Codex CLI 用。read-only 役を `sandbox_mode` で機構化する。Codex CLI を使わないなら省略してよい） |
| `tmp/pdh/templates/product-brief.md` | `product-brief.md` | Product Brief テンプレート |
| `tmp/pdh/templates/technical-reference.md` | `technical-reference.md` | Technical Reference テンプレート（現在の実装の How。運用は `docs/product-delivery-hierarchy.md` 参照） |
| `tmp/pdh/scripts/hookbus.js` | `scripts/hookbus.js` | tmux worker hook event bus (実行権限 `chmod +x` 要) — README「tmux Director」参照 |

コピー時に、各ファイル末尾の `Based on` 行の `XXXXXXX` を `tmp/pdh` の HEAD commit ID（7 桁）に置換する。

##### Codex CLI を使う場合: skill を symlink する

Codex CLI はプロジェクト直下の `.agents/skills/` を skill として自動で読み込む（`.codex/skills/` も同様）。**skill の実体は `.claude/skills/` に置き、`.agents/skills/` からは symlink を張る**。コピーではなく symlink にすることで、実体が 1 つだけになり両者が食い違わない。

```bash
mkdir -p .agents/skills
for s in pdh-dev pdh-coding pdh-reviewing pdh-check-writing pdh-update tmux-director pdh-decision-board; do
  ln -snf "../../.claude/skills/$s" ".agents/skills/$s"
done
```

symlink を張れないファイルシステム（Windows の一部構成など）では、`.claude/skills/` をディレクトリごとコピーしてもよい。その場合は PDH 更新のたびにコピーし直すこと。

`PDH-AGENTS.md` は PDH 汎用 agent ルール、`CLAUDE.md` は project 固有ルールとして commit する。`.claude/skills/` は skill の実体、`.agents/skills/` はそこへの symlink とし、実体を 1 つに保つ。端末・sandbox・個人アカウント・一時 URL・ローカル認証状態などの環境固有メモは `CLAUDE.local.md` に書き、`.gitignore` に入れて commit しない。必要なら `CLAUDE.local.md.example` をコピーして作る。secret の値そのものは `CLAUDE.local.md` にも書かず、取得方法や保管場所だけを書く。

```bash
grep -qxF 'CLAUDE.local.md' .gitignore || printf '\nCLAUDE.local.md\n' >> .gitignore
```

> **⚠ Grok Build を使う場合、`CLAUDE.local.md` は読まれない。** Grok は instruction file の探索で `.gitignore` を尊重するため、gitignore した時点で discovery から外れる（skill の探索は `.gitignore` を無視するので影響しない）。grok 0.2.93 の `grok inspect` で確認済み。Grok で環境固有メモを効かせたい場合は `.grok/rules/*.md` に置くなど、別の手段を検討すること。Claude Code / Codex CLI はこの制約を受けない。

対象ファイル (14 個):
- `CLAUDE.md`
- `product-brief.md`
- `technical-reference.md`
- `.ticket-config.yaml`
- `docs/product-delivery-hierarchy.md`
- `.claude/skills/pdh-reviewing/SKILL.md`
- `.claude/skills/pdh-check-writing/SKILL.md`
- `.claude/skills/pdh-coding/SKILL.md`
- `.claude/skills/pdh-dev/SKILL.md`
- `.claude/skills/pdh-update/SKILL.md`
- `.claude/skills/pdh-decision-board/SKILL.md`
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
  .claude/skills/pdh-reviewing/SKILL.md \
  .claude/skills/pdh-check-writing/SKILL.md \
  .claude/skills/pdh-decision-board/SKILL.md \
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
- `worktree_copy_files`: `ticket.sh start --worktree` 時に main repo からコピーする gitignored ファイルのリスト（template default: `.env`）。worktree で動くために必要なファイルに合わせて編集する
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
ls .claude/skills/{pdh-dev,pdh-coding,pdh-reviewing,pdh-check-writing,tmux-director,pdh-update}/SKILL.md

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
   - **`Based on` 行を持たない配布物 (`scripts/fast-checks.sh` / `scripts/checks/README.md` / `scripts/hookbus.js`)**: この手順では拾えない。該当する変更は[既知の移行手順](#既知の移行手順)で個別に扱う
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

#### PDH worker の agent 定義が新設された（2026-08-30 以降）

worker（Coding Engineer / reviewer / QA / AC 裏取り / Surface Observer / AC 読み手）の agent 定義が `agents/claude/`（`.md`）と `agents/codex/`（`.toml`）として配布に加わった。engine の agent 定義機構に配置すると PM は定義名で worker を spawn でき、read-only 役の書き込み境界が Claude Code では `tools`、Codex では `sandbox_mode` で機構的に強制される。定義が無くても従来の subprocess spawn はそのまま動く。

適用済みかの確認（冪等）:

```bash
test -f .claude/agents/pdh-reviewer.md && echo "claude: 適用済み" || echo "claude: 要適用"
test -f .codex/agents/pdh-reviewer.toml && echo "codex: 適用済み" || echo "codex: 要適用（Codex CLI を使わないなら不要）"
```

「要適用」なら「ファイルを配置する」の配置表に従いコピーする:

```bash
mkdir -p .claude/agents
cp tmp/pdh/templates/agents/claude/*.md .claude/agents/
# Codex CLI を使う場合のみ
mkdir -p .codex/agents
cp tmp/pdh/templates/agents/codex/*.toml .codex/agents/
```

#### reviewer 向け skill `pdh-reviewing` が新設された（2026-08-30 以降）

reviewer worker が review 時に従う規則（網羅探索チェックリスト、レンズごとの確認内容、修正確認、報告形式）が、`pdh-dev` の `_review.md` / `_subagent-context.md` から新設の `pdh-reviewing` skill へ移った。`pdh-dev` 側には Director（PM）側の運用だけが残り、reviewer の spawn prompt は `pdh-reviewing` を読ませる形になっている。**`pdh-dev` だけ更新して `pdh-reviewing` を配置しないと、spawn prompt が存在しない skill を指す。**

適用済みかの確認（冪等）:

```bash
test -f .claude/skills/pdh-reviewing/SKILL.md && echo "適用済み" || echo "要適用"
```

「要適用」なら:

```bash
mkdir -p .claude/skills/pdh-reviewing .agents/skills
cp tmp/pdh/skills/pdh-reviewing/SKILL.md .claude/skills/pdh-reviewing/SKILL.md
cp -R tmp/pdh/skills/pdh-dev/. .claude/skills/pdh-dev/
ln -snf ../../.claude/skills/pdh-reviewing .agents/skills/pdh-reviewing
```

配置後、「ファイルを配置する」の sed 置換（`Based on` 行）を `.claude/skills/pdh-reviewing/SKILL.md` にも適用する。

#### 判断ボード 3 skill が `pdh-decision-board` 1 つに統合された（2026-08-30 以降）

`pdh-decision-board-base` / `pdh-ticket-decision-board` / `pdh-close-decision-board` は `pdh-decision-board` 1 つになった。入口は `SKILL.md`（gate の選び方と、手順ごとに読む分冊を持つ router）で、旧 base の `SKILL.md` は `base.md`、実装前 gate の差分は `ticket-gate.md`、close 前 gate の差分は `close-gate.md` になり、`ship-risk.md`・renderer 分冊・`kit/`・`tools/` もすべて `pdh-decision-board/` 直下にある。

**⚠ 旧 3 ディレクトリは必ず削除する。**残すと skill の実体が 2 系統になり（`AI-2`: skill の実体は 1 つだけ置く、に違反）、どちらが正か agent には判定できない。`.agents/skills/` の古い symlink 3 本も削除する。

適用済みかの確認（冪等）:

```bash
test -d .claude/skills/pdh-decision-board && ! test -e .claude/skills/pdh-decision-board-base && echo "適用済み" || echo "要適用"
```

「要適用」なら:

```bash
rm -rf .claude/skills/pdh-decision-board-base .claude/skills/pdh-ticket-decision-board .claude/skills/pdh-close-decision-board .claude/skills/pdh-decision-board
rm -f .agents/skills/pdh-decision-board-base .agents/skills/pdh-ticket-decision-board .agents/skills/pdh-close-decision-board
cp -r tmp/pdh/skills/pdh-decision-board/ .claude/skills/pdh-decision-board/
mkdir -p .agents/skills
ln -snf ../../.claude/skills/pdh-decision-board .agents/skills/pdh-decision-board
```

これより下の節にある判断ボード関連の移行手順（3 分冊化・2 ファイル化・evals の分離）は、この統合で置き換えられている。未適用でもこの節だけを適用すればよい（旧 commit の `tmp/pdh` にしか無いパスをコピーする手順は、現在の `tmp/pdh` では実行できない）。

#### 文章 skill 3 本が削除された（2026-08-26 以降）

`common-writing` / `japanese-tech-writing` / `cognitive-rhythm-writing` を削除した。**判断ボードと ticket に効いていたのは «承認者に復元作業をさせない» 3 項だけで、それは `pdh-decision-board-base/final-check.md` の「文」の層にある。**残りは書籍・記事の原稿向けの規範で、板の読み手にプラスにならないまま 39.6 KB が配布されていた。

```bash
rm -rf .claude/skills/common-writing .claude/skills/japanese-tech-writing .claude/skills/cognitive-rhythm-writing
rm -f .agents/skills/common-writing .agents/skills/japanese-tech-writing .agents/skills/cognitive-rhythm-writing
```

#### 判断ボードの evals / 検査 script が配布物から外れた（2026-08-26 以降）

`pdh-decision-board-base/` から次が消えた。**どれも配布先では使わないもので、残しても害だけがある。**

- `evals/` — 判断ボード skill 自身の評価シナリオ。skill の規則を変えるとき（＝ PDH repo 側）にしか回さない
- `examples.md` — 規則の由来になった日付つきの事故と実測値。**特定時点の制約を実行者に持たせるとゴールから遠ざかる**ので、skill を直すときの資料として PDH repo 側に置く。規則ファイルからも日付つきの出典を落とし、規則を現在形だけで書くようにした
- `tools/check.js` と `tools/fixtures/broken-{a,d,h,i}.html`、`kit/check-contrast.py` — Node / Playwright / Python を要求していた。描画の検査は PDH repo 側へ移っており（配布先は kit を変えないので要らない）、palette の検査は `kit/check-contrast.sh`（awk）が引き継いだ

古い配置が残っていると、Playwright の導入を促す README や、回されない eval がプロジェクトに居座る。ディレクトリごと消してからコピーし直す。

```bash
rm -rf .claude/skills/pdh-decision-board-base
cp -r tmp/pdh/skills/pdh-decision-board-base/ .claude/skills/pdh-decision-board-base/
```

#### pdh-close-decision-board が 2 ファイルになった（2026-08-26 以降）

close 前 gate の skill は `SKILL.md` に加えて `ship-risk.md`（保存されている形・外部契約を変える ticket だけが読む分冊）を持つ。`SKILL.md` だけをコピーしていたプロジェクトは、ディレクトリごとコピーし直す。同時に、判断ボードの reviewer への問いが 7 問（問 2 が「推奨はゴールに届くか」）になり、判断カードに「ゴールへの効き」の欄が増えた。

```bash
cp -r tmp/pdh/skills/pdh-decision-board-base/ .claude/skills/pdh-decision-board-base/
cp -r tmp/pdh/skills/pdh-ticket-decision-board/ .claude/skills/pdh-ticket-decision-board/
cp -r tmp/pdh/skills/pdh-close-decision-board/ .claude/skills/pdh-close-decision-board/
```

#### pdh-ticket-decision-board の 3 分冊化 + close 前 gate の追加（2026-08-20 以降）

**判断ボード skill は 3 つの構成になった。**gate と媒体に依存しない共通規則・renderer 分冊・kit（CSS/JS/検査 script）は新設の `pdh-decision-board-base` が持ち、`pdh-ticket-decision-board`（実装前 gate）と新設の `pdh-close-decision-board`（close 前 gate）は base への差分だけを持つ。

**⚠ 単なるファイル追加ではない。**旧 `pdh-ticket-decision-board/` に入っていた `render-html-common.md` / `create-doc.md` / `create-slides.md` / `examples.md` は base 側へ移動して内容も更新されているため、**旧配置のまま残すと 2 系統の規則が食い違う。**

移行手順:

```bash
rm -rf .claude/skills/pdh-ticket-decision-board
cp -r tmp/pdh/skills/pdh-decision-board-base/ .claude/skills/pdh-decision-board-base/
cp -r tmp/pdh/skills/pdh-ticket-decision-board/ .claude/skills/pdh-ticket-decision-board/
cp -r tmp/pdh/skills/pdh-close-decision-board/ .claude/skills/pdh-close-decision-board/
for s in pdh-decision-board-base pdh-ticket-decision-board pdh-close-decision-board; do
  ln -snf "../../.claude/skills/$s" ".agents/skills/$s"
done
```

kit の CSS（tokens.css の palette）を変えたときは `bash .claude/skills/pdh-decision-board-base/kit/check-contrast.sh` が exit 0 になることを確認する。


#### decision-board → pdh-ticket-decision-board へ置き換え（2026-08-15 以降）

**`decision-board` skill は撤去され、`pdh-ticket-decision-board` に置き換わった。**
単なる rename ではなく、扱う範囲と作り方の両方が変わっている。

| | 旧 `decision-board` | 新 `pdh-ticket-decision-board` |
|---|---|---|
| 扱う gate | 実装前・close 前の両方 | **実装前（`PDH-ticket-human-review`）だけ** |
| 媒体 | HTML 1 枚に固定 | Markdown / 端末に出す文章 / PR コメント / HTML 文書 / HTML 2 軸デッキ から選ぶ |
| 作り方 | `db-*` タグを `build-board.sh` に渡す | 規則に従って組む（生成スクリプトは持たない） |
| 検査 | 発行前の 2 段 | Completed Staff Work の 1 問 + 形・文・判断の 3 層 + 別 engine の reviewer に 7 問 |

移行手順:

```bash
rm -rf .claude/skills/decision-board .agents/skills/decision-board
cp -r tmp/pdh/skills/pdh-ticket-decision-board/ .claude/skills/pdh-ticket-decision-board/
ln -snf ../../.claude/skills/pdh-ticket-decision-board .agents/skills/pdh-ticket-decision-board
```

⚠ **`build-board.sh` / `board-kit.tpl` / `board-runtime.js` / `mermaid-render.min.js` は
配布されなくなった。**これらで作った過去の `board.html` はそのまま読めるが、**再 build する
手段は無い。**必要なら旧ファイルを自プロジェクトへ退避してから更新すること。

⚠ **close 前 gate（`PDH-human-review`）の board を作る手順は、現在どの skill も持たない。**
`PDH-AGENTS.md`「Human Gate Materials」が求める材料は変わらないので、そこを直接読んで用意する。
`pdh-ticket-decision-board` を読み替えて使ってもよいが、**主線の構成と AC の扱いは実装前 gate
向けなので、そのままでは合わない。**

#### 導入・更新手順が README.md → INSTALL.md へ移動（2026-07 以降）

以前は導入・更新手順が README.md にあり、`pdh-update` skill もそこを読んでいた。現在は本ファイル（INSTALL.md）にあり、README.md は概要とリンクだけを持つ。

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
for s in pdh-dev pdh-coding pdh-check-writing pdh-update tmux-director pdh-decision-board-base pdh-ticket-decision-board pdh-close-decision-board; do
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

#### `.ticket-config.yaml` に checkbox gate と `Required Probes` を追加（2026-08-30 以降）

未了の checkbox が残っている間 `close` を拒否する gate を有効にし、note に `## Required Probes` の節と、その節の存在を close の必須条件にする宣言を足した。**どちらも `--force` では抜けられない。**当てはまらない項目は `- [-] ... - skip: <理由>` と書いて理由をファイルに残す（理由なしの `- [-]` は未了扱い）。未了の一覧は `./ticket.sh check`、特定の節だけの要求は `./ticket.sh check --require "<見出し名>"`。

⚠ **`Required Probes` の節が無いと、AC を確かめる工程が «節ごと存在しない» まま実装へ進める**（実際にそれで未確認の仮定に基づく修正が本番へ出た）。`require_checklist` は未了の checkbox を数えるので、**節ごと無い ticket は 0 件 = 全部片付いた、と読んで通してしまう。**塞ぐのは `require_checklist_groups` の側なので、**両方入っていることを確認する。**

`.ticket-config.yaml` は project カスタマイズが濃く diff マージで取りこぼされやすいので、直接確認する:

```bash
grep -q '^require_checklist:' .ticket-config.yaml && echo "gate: 適用済み" || echo "gate: 要追加"
grep -q '^require_checklist_groups:' .ticket-config.yaml && echo "必須グループ: 適用済み" || echo "必須グループ: 要追加"
grep -q '## Required Probes' .ticket-config.yaml && echo "節: 適用済み" || echo "節: 要追加"
grep -q '## Checklist' .ticket-config.yaml && echo "Checklist 節: 適用済み" || echo "Checklist 節: 要改名"
grep -q '確かめていない仮定' .ticket-config.yaml && echo "項目: 適用済み" || echo "項目: 要追加"
```

「要追加」のものを `tmp/pdh/templates/.ticket-config.yaml` からコピーする。

- `gate` — `# Automatically delete remote feature branch` ブロックの直後にある `require_checklist: true`（コメント含む）
- `必須グループ` — その直後の `require_checklist_groups:`（コメント含む）。**ticket.sh 20260830 以降が必要**なので、手順 7 の `selfupdate` を先に済ませる（古い ticket.sh ではキーが黙って無視され、守られていないのに守られたつもりになる）
- `節` — `note_content` の `## Required Probes` 節（`## PDH-ticket-review. Ticket contract check` の直後）
- `Checklist 節` — `## PDH-verify. プロセスチェックリスト` を **`## Checklist` へ改名し、`## Status:` の直後へ移す**。⚠ **見出しが「verify のときに見るもの」に読めると、他 stage の項目が終盤まで放置される。**stage ごとに節を割らないこと（割ると「その stage の分だけ」を見て、他が残っているのに気づかない）
- `項目` — `## Checklist` の `PDH-implement:` 行 2 つと `PDH-review:` 行 2 つ

**既存の進行中 ticket がある状態でこれらを入れると、その ticket の close が止まる。**止まったら未了を埋めるか、当てはまらない項目に `- [-] ... - skip: <理由>` を書く。**節そのものが無い ticket では、`## Required Probes` を手で足してから測る**（テンプレートを変えても、既にある note には反映されない）。⚠ **`Checklist` を必須グループに宣言すると、`## PDH-verify. プロセスチェックリスト` のままの進行中 note は close が止まる。**その note の見出しも `## Checklist` へ改名する。

#### `.ticket-config.yaml` に `worktree_copy_files` を追加（2026-07 以降）

worktree には gitignored ファイル（`.env` 等）が入らない。`worktree_copy_files` に列挙すると `ticket.sh start --worktree` が作成・再開時に main repo からコピーする（ticket.sh 本体の対応は手順 7 の selfupdate で入る。古い ticket.sh でもキーが無視されるだけで無害）。`.ticket-config.yaml` は project カスタマイズが濃く diff マージで取りこぼされやすいので、キーの有無を直接確認する:

```bash
grep -q '^worktree_copy_files:' .ticket-config.yaml && echo "適用済み" || echo "要追加"
```

「要追加」なら `tmp/pdh/templates/.ticket-config.yaml` の `# Worktree settings` ブロック（コメント含む）を `.ticket-config.yaml` にコピーし、worktree での実行に必要な gitignored ファイルに合わせてリストを編集する。

#### fast-check に `required_paths` 型を追加（2026-08 以降）

`scripts/fast-checks.sh` と `scripts/checks/README.md` には `Based on` footer がないため、「既存ファイルの差分マージ」の対象から漏れる。ランナー本体とレジストリ契約はプロジェクト固有のカスタマイズを持たない（カスタマイズは `scripts/checks/*.check` 側にある）ので、常に最新版で上書きしてよい。

`required_paths` は「この exact path のファイルが存在すること」を宣言する 4 番目の型。`pattern` / `max_lines` / `linter_command` は「禁止されたものが存在しない」ことしか主張しないので、glob が 0 件になる — つまり守っていたファイルごと消える — と静かに通る。上流の directory 上書きや merge 事故で消える経路のあるファイルには、中身を守る check と併せてこれを置く。

```bash
grep -q 'required_paths' scripts/fast-checks.sh && echo "適用済み" || echo "要更新"
```

「要更新」なら上書きし、既存の check が通ることを確認する:

```bash
cp tmp/pdh/templates/fast-checks.sh scripts/fast-checks.sh
cp tmp/pdh/templates/checks/README.md scripts/checks/README.md
bash scripts/fast-checks.sh
```
