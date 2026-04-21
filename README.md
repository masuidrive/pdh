![PDH flow](pdh-header.png)

# PDH — Product Delivery Hierarchy

Product Brief / Epic / Ticket の 3 層で、**なぜ作るか**・**何を作るか**・**いま何をやるか** を構造化する仕組み。

人間と coding agent（Claude Code 等）の両方が読み、同じ文脈の中でプロダクトの方向性から日々の実装作業までを追跡する。

## 特徴

- **3 層構造**: Product Brief（why）→ Epic（what）→ Ticket（how）
- **Coding agent 対応**: Agent が読んで判断・実装できるように設計
- **Git ベース**: すべて Markdown ファイル。特別なツールは不要
- **ticket.sh 連携**: [ticket.sh](https://github.com/masuidrive/ticket.sh) でチケットのライフサイクルを管理

## 前提条件

| 必須/任意 | ツール | バージョン目安 | 用途 |
|---|---|---|---|
| 必須 | `git` | 2.x+ | バージョン管理、リポジトリ clone |
| 必須 | `curl` | any | ticket.sh ダウンロード |
| 必須 | `bash` | 4.x+ | スクリプト実行 |
| 必須 | [`claude`](https://claude.ai/claude-code) (Claude Code CLI) | 2.x+ | Agent skills 実行・コーディング |
| 任意 | `node` | **18+** (推奨 20+ / 24+) | `scripts/hookbus.js` の実行 (tmux Director 使用時のみ)。ESM / top-level await / `import.meta` / `node:` prefix を使うため 18 未満は不可 |
| 任意 | `tmux` | 3.x+ | Director で複数 worker 監視する場合 |
| 任意 | [Codex CLI](https://github.com/openai/codex) | any | Codex モード使用時 |

macOS は `sed -i` の引数が GNU と違うため、本 README のコマンド例では macOS/Linux 両対応の書き方を示す。

## セットアップ

Claude Code にこのリポジトリの内容を読ませて、自分のプロジェクトに PDH を導入できる。

### 読み方ガイド

- **新規プロジェクトで PDH を導入**: 方法 1 (自動) または 方法 2 の §0〜§2.5〜§4〜§9 を順に実行 (§3 はスキップ)
- **既に PDH 導入済で最新版に更新**: §3 のみ実行 (他はスキップ)
- **tmux Director の hookbus 機能を使いたい**: 新規・更新を終えた後で §tmux Director を参照

### 方法 1: Claude Code に設定させる

プロジェクトのルートで Claude Code を起動し、以下のように指示する:

```
https://github.com/masuidrive/pdh の README を読んで、このプロジェクトに PDH を導入して。
```

Claude Code が以下を自動で行う:
1. ticket.sh のダウンロードと初期化
2. PDH ドキュメントの配置
3. スキル・CLAUDE.md・ticket-config の設定
4. Product Brief の雛形作成

### 方法 2: 手動でセットアップ

#### 0. PDH リポジトリを clone する

```bash
git clone https://github.com/masuidrive/pdh.git tmp/pdh
```

以降のステップでは `tmp/pdh/` のファイルをコピー元として使う。

#### 1. ticket.sh を導入する

```bash
# プロジェクトのルートで
git init  # 既存リポジトリなら不要

# ticket.sh をダウンロード・初期化
curl -sL https://raw.githubusercontent.com/masuidrive/ticket.sh/main/ticket.sh -o ticket.sh
chmod +x ticket.sh
bash ticket.sh init

# epics ディレクトリを作成
mkdir -p epics epics/done
```

#### 2. ファイルを配置する

以下のファイルを `tmp/pdh/` からプロジェクトにコピーする。
**すでにファイルが存在する場合はコピーせず、ステップ 3 のアップデート手順に従う。**

| コピー元 | コピー先 | 用途 |
|---|---|---|
| `tmp/pdh/docs/product-delivery-hierarchy.md` | `docs/product-delivery-hierarchy.md` | PDH 運用ルール・テンプレート |
| `tmp/pdh/skills/pdh-dev/SKILL.md` | `.claude/skills/pdh-dev/SKILL.md` | PDH ワークフロースキル |
| `tmp/pdh/skills/pdh-coding/SKILL.md` | `.claude/skills/pdh-coding/SKILL.md` | コーディング標準スキル |
| `tmp/pdh/skills/epic-creator/SKILL.md` | `.claude/skills/epic-creator/SKILL.md` | Epic 作成スキル |
| `tmp/pdh/skills/tmux-director/SKILL.md` | `.claude/skills/tmux-director/SKILL.md` | tmux Director スキル |
| `tmp/pdh/skills/pdh-update/SKILL.md` | `.claude/skills/pdh-update/SKILL.md` | PDH アップデートスキル |
| `tmp/pdh/templates/CLAUDE.md` | `CLAUDE.md` | Agent 向けルール |
| `tmp/pdh/templates/AGENTS.md` | `AGENTS.md` | Codex CLI 向け設定（CLAUDE.md への thin pointer） |
| `tmp/pdh/templates/.ticket-config.yaml` | `.ticket-config.yaml` | ticket.sh 設定 |
| `tmp/pdh/templates/test-all.sh` | `scripts/test-all.sh` | テスト一括実行スクリプト |
| `tmp/pdh/templates/product-brief.md` | `product-brief.md` | Product Brief テンプレート |
| `tmp/pdh/scripts/hookbus.js` | `scripts/hookbus.js` | tmux worker hook event bus (実行権限 `chmod +x` 要) — 下記 §tmux Director hookbus 参照 |

コピー時に、各ファイル末尾の `Based on` 行の `XXXXXXX` を `tmp/pdh` の HEAD commit ID（7 桁）に置換する。

対象ファイル (5 つ):
- `CLAUDE.md`
- `product-brief.md`
- `.ticket-config.yaml`
- `.claude/skills/epic-creator/SKILL.md`
- `.claude/skills/tmux-director/SKILL.md`

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
  .ticket-config.yaml \
  .claude/skills/epic-creator/SKILL.md \
  .claude/skills/tmux-director/SKILL.md
```

`scripts/hookbus.js` と `pdh-dev` / `pdh-coding` / `pdh-update` の SKILL.md には `Based on` footer がないので sed 対象外。

#### 2.5. .claude/settings.json を設定する

##### 2.5.a. PDH core のみ (tmux Director を使わない / 単一 Claude Code セッション)

Agent Teams を使うために、`.claude/settings.json` に以下を配置する。`scripts/hookbus.js` も不要:

```json
{
  "teammateMode": "in-process",
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

##### 2.5.b. tmux Director の hookbus event stream も使う

上記に加えて `hooks` ブロックを追加:

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

#### 3. 既存ファイルのアップデート

1. PDH リポジトリを clone する（なければ）:
   ```bash
   git clone https://github.com/masuidrive/pdh.git tmp/pdh
   ```
2. `based on` の URL から旧 commit ID を特定する
3. **新規ファイルの検出**: `tmp/pdh` で旧 commit ID 以降に追加されたファイルを確認する:
   ```bash
   cd tmp/pdh && git diff --name-status <旧commit-id> HEAD -- skills/ templates/ scripts/
   ```
   `A`（追加）のファイルがあれば、ステップ 2（ファイル配置）のマッピング表に従って配置する。**`.ticket-config.yaml` / `product-brief.md` / `CLAUDE.md` / 各 SKILL.md に `Based on` footer が入るものはステップ 2 の sed 対象にも追加する**
4. **新規ファイルの付随設定 (重要)**: 新規ファイルには単独配置だけでは機能しないものがある。下表に該当する追加があれば、対応する章を見て `.claude/settings.json` / `vitest.config.ts` / `scripts/test-all.sh` 等を更新する:

   | 新規追加された file | 参照すべき章 | 追加が必要な設定 |
   |---|---|---|
   | `scripts/hookbus.js` | §2.5.b + §6.5 + §tmux Director | `.claude/settings.json` に 5 hook ブロック、`vitest.config.ts` に scripts project (includeSource)、`package.json` に `test:scripts`、`scripts/test-all.sh` に `run "test:scripts"` 行 |
   | 新規 `skills/<名前>/SKILL.md` (将来追加されたもの) | 追加された skill の README / ヘッダコメント | skill 固有の settings.json / env / script があれば個別対応 |
   | 新規 `templates/` | §2 / §その他 | テンプレートによる。README 本体を再読し該当章を確認 |

   不明な新規 file があれば、**そのファイル自体の冒頭コメント** と **README の該当 section** を両方読んで必要な設定を判断する。

5. **既存ファイルの差分マージ**: `Based on` 行があるファイルごとに差分を取得・反映する:
   ```bash
   cd tmp/pdh && git diff <旧commit-id> HEAD -- <テンプレートファイルパス>
   ```
   - **スキル（SKILL.md）**: 常にテンプレートで上書きする（プロジェクト固有のカスタマイズはスキルに入れない）
   - **CLAUDE.md**: `Based on` 行の commit ID 間の差分を取り、プロジェクト固有の設定（テストコマンド、ディレクトリ構造、チーム構成テーブル等）を保持しつつテンプレートの変更を反映する
   - **README-level の設定 (settings.json / vitest.config.ts / scripts/test-all.sh)**: プロジェクト固有のカスタマイズが入っているので上書きしない。代わりに README §2.5 / §6 / §6.5 / §tmux Director で推奨される項目が含まれているかをレビューし、抜けていたら追加する
6. **削除されたファイルの撤去**: 旧 commit から HEAD で `D` (削除) になったファイルがあれば、プロジェクト側から除去する。該当する設定 (settings.json / vitest.config.ts / scripts/test-all.sh) も必要なら撤去。上の表の逆手順
7. `Based on` 行の commit ID を最新に更新する
8. 変更点をまとめてユーザに報告する (新規追加 file、削除 file、付随設定追加、削除 file と付随設定撤去 を明示)
9. AskUserQuestion で「既存の Epic や Ticket を新しいフォーマット・ルールに合わせて書き直すか？」を確認する。OK なら `epics/` と `tickets/` のファイルを新テンプレートに従って更新し、commit 前に変更点をユーザに伝えて確認を取る
10. 後片付け: `rm -rf tmp/pdh`

#### 4. CLAUDE.md をカスタマイズする

- `## ディレクトリ構造` をプロジェクトの実際の構造に書き換える
- テストコマンド（`uv run pytest`, `npm test` 等）をプロジェクトに合わせる
- 開発サーバーの起動方法を追記する

#### 5. .ticket-config.yaml をカスタマイズする

設定項目:
- `default_branch`: メインブランチ名（default: `main`）
- `branch_prefix`: feature ブランチのプレフィックス（default: `feature/`）
- `auto_push`: close 時に自動 push するか
- `default_content`: Ticket テンプレート（Why / What / Acceptance Criteria + 任意: Implementation Notes / Dependencies）
- `note_content`: 作業メモテンプレート（PD-2〜PD-7 等のセクション）

#### 6. scripts/test-all.sh を作成する

`tmp/pdh/templates/test-all.sh` をコピーし、プロジェクトのテストスイートに合わせてカスタマイズする。
テンプレート内のコメントアウトされた `run` 行を参考に、プロジェクトの各テストスイートを追加する。

```bash
cp tmp/pdh/templates/test-all.sh scripts/test-all.sh
chmod +x scripts/test-all.sh
# scripts/test-all.sh を編集し、プロジェクトのテストコマンドを追加
```

このスクリプトは PD-C-6（実装完了時）と PD-C-9（完了検証）で実行される。
`--parallel` フラグで並列実行が可能。

#### 6.5. (hookbus 使用時のみ) vitest in-source testing を有効化

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

hookbus を使わない、または CLI 動作だけで十分なプロジェクトでは 6.5 節はスキップしてよい。

#### 7. Product Brief を書く

- **ファイルがない場合**: `tmp/pdh/templates/product-brief.md` をコピーし、`based on` 行の commit ID を置換する。内容を埋めるようユーザに促す
- **ファイルがある場合**: テンプレートと見比べて、新しいセクションが増えていたら追記するようユーザに促す

PDH の全判断は Product Brief を基準にするため、Background / Who / Problem / Solution / Constraints / Done のセクションが十分に記述されている必要がある。

#### 7.5. 動作確認

配置が正しいかざっと確認:

```bash
# ファイル存在チェック
test -f product-brief.md && echo "OK product-brief"
test -f CLAUDE.md && echo "OK CLAUDE.md"
test -f .ticket-config.yaml && echo "OK ticket-config"
test -f ticket.sh && echo "OK ticket.sh"
test -f .claude/settings.json && echo "OK settings.json"
ls .claude/skills/{pdh-dev,pdh-coding,epic-creator,tmux-director,pdh-update}/SKILL.md

# Based on の commit ID が XXXXXXX から置換されたか
grep -l XXXXXXX CLAUDE.md product-brief.md .ticket-config.yaml .claude/skills/*/SKILL.md 2>&1
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

#### 8. 後片付け

```bash
rm -rf tmp/pdh
```

## ワークフロー

```
Product Brief を書く
    ↓
Epic を作成 → レビュー → 確定
    ↓
Epic から Ticket を切り出す
    ↓
Ticket ごとに:
    調査 → 計画 → レビュー → 実装 → 品質検証 → 完了
    ↓
全 Ticket 完了 → Epic クローズ判定
```

詳細は `docs/product-delivery-hierarchy.md` と `skills/pdh-dev/SKILL.md` を参照。

## Codex モード

Claude のトークン消費を抑えるためのオプションモード。実装・テスト実行・レビューの一部を [Codex CLI](https://github.com/openai/codex) に切り替える。

- **通常モード**: 全役割を Claude（Opus / Sonnet）で実行
- **Codex モード**: Coding Engineer・QA Engineer・レビュアーの一部が Codex に切り替わる

使い方: セッション内で「codex モード」と言うだけ。デフォルト無効。未決定のまま dispatch が必要になった場合は一度だけ確認される。各役割のモデル割り当ては `templates/CLAUDE.md` のチーム構成テーブルを参照。

## tmux Director

tmux 上で複数の Claude Code セッションを走らせている場合に、別 window の Claude Code を監督・指示するためのスキル。

- **Director（監督）** として振る舞い、自分ではコードを書かず、別 window の Claude Code に指示を出して作業を監視する
- PDH ワークフロー（PD-1〜PD-8）の遵守を監視し、逸脱（テスト未実行、E2E 省略、AC 未達等）を検知して是正指示を出す

Claude Code で `tmux-director` と入力すると起動する。

### 監視パス (2 系統)

1. **hookbus event stream (推奨、ms 単位で反応)** — `scripts/hookbus.js` と `.claude/settings.json` の hooks を配線しておくと、worker がアイドル / permission 待ちになった瞬間に `/tmp/claude-events-<socket_hash>/log.ndjson` に NDJSON が 1 行 append される。Director は Claude Code の **`Monitor` ツール** (deferred tool、stdout 1 行 = 1 通知として会話に push する組み込み streaming 機能) で `scripts/hookbus.js pull --include <w1-key> --include <w2-key> ... --follow` を bg 消費し、対象 worker の event だけを通知として受け取る。無関係な pane は allow-list にないので自然に弾かれる。ポーリング不要
2. **tmux capture-pane Monitor Agent (fallback、15 秒間隔)** — hookbus 未配線のプロジェクト用。Sonnet Agent を bg spawn して 15 秒ごとに画面 capture + 状態判定

### hookbus 起動手順

**前提**: §2 で `scripts/hookbus.js` 配置済、§2.5.b で `.claude/settings.json` に hooks 配置済。

**重要な仕様**: `.claude/settings.json` は **各 Claude Code セッション起動時に読まれて固まる**。mid-session で settings.json を編集しても、走っているセッションには反映されない。hooks を追加・変更した場合は **全 Claude セッション一旦終了 → 再起動** が必要。

手順:

1. 全 tmux window で走っている Claude Code セッションを終了 (`/exit` or Ctrl-C)
2. Director window / Worker window とも通常どおり `claude` で起動
3. Director セッション内で監視対象 worker の key を allow-list で指定して Monitor 起動:
   ```
   Monitor({
     command: "scripts/hookbus.js pull --include <w1-key> --include <w2-key> --include <w3-key> --follow",
     description: "tmux worker events",
     persistent: true
   })
   ```
   worker の key は `<socket_hash>:<pane_id>` (例: `a3f2e1:%10`)。pane_id は `tmux list-panes -a -F '#{pane_id}'` で取れる。socket_hash は Director の `scripts/hookbus.js whoami` の `:` 前部分と同じ。`--include` 省略時は全 event が流れる (無関係な pane 含む) ので、監視対象は明示推奨。cursor identity は default で `whoami` の key。worker が Stop / Notification した瞬間、NDJSON 1 行が会話に通知として push される。

**動作確認** (Director 側で):
```bash
# 別 worker window で何かターンを終わらせてから:
cat /tmp/claude-events-*/log.ndjson | tail -3    # 3 行以上あれば動いてる
scripts/hookbus.js whoami                         # 自分の key が出る
```

### 元に戻す

- `.claude/settings.json` から `hooks` ブロックを外す → 全セッション再起動 → log 書込停止
- `/tmp/claude-events-*` の cleanup は `scripts/hookbus.js cleanup --older-than 7` (default) または `rm -rf /tmp/claude-events-*`

詳細は `scripts/hookbus.js` ヘッダコメント (サブコマンド / ログ配置) と `.claude/skills/tmux-director/SKILL.md` の TD-0 節を参照。

## ファイル構成

導入後のプロジェクト構造:

```
project-root/
  product-brief.md          ← プロダクトの why（1 つだけ）
  CLAUDE.md                 ← Agent 向けルール
  ticket.sh                 ← チケット管理ツール
  .ticket-config.yaml       ← ticket.sh 設定
  docs/
    product-delivery-hierarchy.md  ← PDH 運用ルール・テンプレート
  epics/
    YYMMDD-hhmmss-slug.md   ← Epic ファイル
    done/                   ← 完了した Epic
  tickets/
    YYMMDD-hhmmss-slug.md   ← Ticket ファイル（ticket.sh が管理）
    done/                   ← 完了した Ticket
  AGENTS.md                 ← Codex CLI 向け設定（CLAUDE.md への thin pointer）
  scripts/
    test-all.sh             ← テスト一括実行
    hookbus.js              ← (任意) tmux Director hookbus event bus
  .claude/
    settings.json           ← Agent Teams 設定 + (任意) hookbus 用 hooks
    skills/
      pdh-dev/SKILL.md      ← PDH ワークフロースキル
      pdh-coding/SKILL.md   ← コーディング標準スキル
      epic-creator/SKILL.md  ← Epic 作成スキル
      tmux-director/SKILL.md ← tmux Director スキル
      pdh-update/SKILL.md    ← PDH アップデートスキル
```

## このリポジトリの構成

```
pdh/
  README.md                          ← このファイル
  docs/
    product-delivery-hierarchy.md    ← PDH 本体ドキュメント
  skills/
    pdh-dev/SKILL.md                 ← PDH ワークフロースキル
    pdh-coding/SKILL.md              ← コーディング標準スキル
    epic-creator/SKILL.md            ← Epic 作成スキル
    tmux-director/SKILL.md           ← tmux Director スキル
    pdh-update/SKILL.md              ← PDH アップデートスキル
  templates/
    product-brief.md                 ← Product Brief テンプレート
    CLAUDE.md                        ← CLAUDE.md テンプレート
    AGENTS.md                        ← AGENTS.md テンプレート（Codex CLI 向け thin pointer）
    test-all.sh                      ← テスト一括実行テンプレート
    .ticket-config.yaml              ← ticket.sh 設定テンプレート
  scripts/
    hookbus.js                       ← tmux Director hookbus (CLI + library + in-source vitest、1 ファイル完結)
```

## 関連ツール

- [ticket.sh](https://github.com/masuidrive/ticket.sh) — Git ベースのチケット管理
- [Claude Code](https://claude.ai/claude-code) — Anthropic の CLI ツール

## License

Apache License 2.0
