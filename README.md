![PDH flow](pdh-header.png)

# PDH — Product Delivery Hierarchy

Product Brief / Epic / Ticket の 3 層で、**なぜ作るか**・**何を作るか**・**いま何をやるか** を構造化する仕組み。

人間と coding agent（Claude Code 等）の両方が読み、同じ文脈の中でプロダクトの方向性から日々の実装作業までを追跡する。

## 特徴

- **3 層構造**: Product Brief（why）→ Epic（what）→ Ticket（how）
- **Coding agent 対応**: Agent が読んで判断・実装できるように設計
- **Git ベース**: すべて Markdown ファイル。特別なツールは不要
- **ticket.sh 連携**: [ticket.sh](https://github.com/masuidrive/ticket.sh) でチケットのライフサイクルを管理

## セットアップ

Claude Code にこのリポジトリの内容を読ませて、自分のプロジェクトに PDH を導入できる。

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

コピー時に、各ファイル末尾の `based on` 行の `XXXXXXX` を `tmp/pdh` の HEAD commit ID（7 桁）に置換する。

```bash
COMMIT_ID=$(cd tmp/pdh && git rev-parse --short=7 HEAD)
# 例: sed -i '' "s/XXXXXXX/$COMMIT_ID/g" CLAUDE.md
```

#### 2.5. .claude/settings.json を設定する

Agent Teams + tmux Director の hookbus event stream (任意、§tmux Director 参照) を使うために、`.claude/settings.json` に以下を追加する:

```json
{
  "teammateMode": "in-process",
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1",
    "CLAUDE_EVENT_DISABLE": "1"
  },
  "hooks": {
    "SessionStart":  [{"hooks":[{"type":"command","command":"scripts/hookbus.js event","timeout":5}]}],
    "Stop":          [{"hooks":[{"type":"command","command":"scripts/hookbus.js event","timeout":5}]}],
    "SubagentStop":  [{"hooks":[{"type":"command","command":"scripts/hookbus.js event","timeout":5}]}],
    "Notification":  [{"matcher":"idle_prompt|permission_prompt",
                       "hooks":[{"type":"command","command":"scripts/hookbus.js event","timeout":5}]}]
  }
}
```

- `CLAUDE_EVENT_DISABLE=1` は default で event 書込を無効化する kill-switch。tmux Director を hookbus 消費モードに切り替える時に外す (§tmux Director)
- 4 つの hook は `scripts/hookbus.js` を呼んで `/tmp/claude-events-<socket_hash>/log.ndjson` にイベントを NDJSON で記録する
- 単一 Claude Code セッションしか使わないプロジェクトでは hookbus 関連の `hooks` ブロックと `CLAUDE_EVENT_DISABLE` は省略してよい (その場合 `scripts/hookbus.js` も不要)

設定後、Claude Code を再起動すると有効になる。

#### 3. 既存ファイルのアップデート

1. PDH リポジトリを clone する（なければ）:
   ```bash
   git clone https://github.com/masuidrive/pdh.git tmp/pdh
   ```
2. `based on` の URL から旧 commit ID を特定する
3. **新規ファイルの検出**: `tmp/pdh` で旧 commit ID 以降に追加されたファイルを確認する:
   ```bash
   cd tmp/pdh && git diff --name-status <旧commit-id> HEAD -- skills/ templates/
   ```
   `A`（追加）のファイルがあれば、ステップ 2（ファイル配置）のマッピング表に従って配置する
4. **既存ファイルの差分マージ**: `based on` 行があるファイルごとに差分を取得・反映する:
   ```bash
   cd tmp/pdh && git diff <旧commit-id> HEAD -- <テンプレートファイルパス>
   ```
   - **スキル（SKILL.md）**: 常にテンプレートで上書きする（プロジェクト固有のカスタマイズはスキルに入れない）
   - **CLAUDE.md**: `based on` 行の commit ID 間の差分を取り、プロジェクト固有の設定（テストコマンド、ディレクトリ構造、チーム構成テーブル等）を保持しつつテンプレートの変更を反映する
5. `based on` 行の commit ID を最新に更新する
6. 変更点をまとめてユーザに報告する
7. AskUserQuestion で「既存の Epic や Ticket を新しいフォーマット・ルールに合わせて書き直すか？」を確認する。OK なら `epics/` と `tickets/` のファイルを新テンプレートに従って更新し、commit 前に変更点をユーザに伝えて確認を取る
8. 後片付け: `rm -rf tmp/pdh`

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

#### 7. Product Brief を書く

- **ファイルがない場合**: `tmp/pdh/templates/product-brief.md` をコピーし、`based on` 行の commit ID を置換する。内容を埋めるようユーザに促す
- **ファイルがある場合**: テンプレートと見比べて、新しいセクションが増えていたら追記するようユーザに促す

PDH の全判断は Product Brief を基準にするため、Background / Who / Problem / Solution / Constraints / Done のセクションが十分に記述されている必要がある。

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

1. **hookbus event stream (推奨、ms 単位で反応)** — `scripts/hookbus.js` と `.claude/settings.json` の hooks を配線しておくと、worker がアイドル / permission 待ちになった瞬間に `/tmp/claude-events-<socket_hash>/log.ndjson` に NDJSON が 1 行 append される。Director は Claude Code の Monitor ツールで `scripts/hookbus.js pull --follow` を bg streaming 消費し、1 event = 1 通知として受け取る。ポーリング不要
2. **tmux capture-pane Monitor Agent (fallback、15 秒間隔)** — hookbus 未配線のプロジェクト用。Sonnet Agent を bg spawn して 15 秒ごとに画面 capture + 状態判定

hookbus を使うための配線:

1. `scripts/hookbus.js` をプロジェクトに配置 (§2 のファイル配置表、実行権限 `chmod +x` 要)
2. `.claude/settings.json` の `hooks` / `env.CLAUDE_EVENT_DISABLE=1` を設定 (§2.5)
3. Director セッション起動時に `CLAUDE_EVENT_ROLE=director claude` で起動 (自分の hook を除外、log 汚染防止)
4. Director セッション内で `.claude/settings.json` から `CLAUDE_EVENT_DISABLE` を外す (または env override で起動) → hook が log に書き始める
5. Director 内で `Monitor({command: "env -u CLAUDE_EVENT_DISABLE scripts/hookbus.js pull --exclude $(scripts/hookbus.js whoami) --follow", description: "tmux worker events", persistent: true})` を起動

詳細は `scripts/hookbus.js` ヘッダコメントと `.claude/skills/tmux-director/SKILL.md` の TD-0 節を参照。

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
