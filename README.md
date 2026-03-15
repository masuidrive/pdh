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

#### 2. PDH ドキュメントを配置する

```bash
mkdir -p docs

# このリポジトリから PDH ドキュメントをダウンロード
curl -sL https://raw.githubusercontent.com/masuidrive/pdh/main/docs/product-delivery-hierarchy.md \
  -o docs/product-delivery-hierarchy.md
```

#### 3. Claude Code スキルを配置する

`/pdh-dev` コマンドで PDH ワークフローを実行できるようになる。

```bash
mkdir -p .claude/skills/pdh-dev

curl -sL https://raw.githubusercontent.com/masuidrive/pdh/main/skills/pdh-dev/SKILL.md \
  -o .claude/skills/pdh-dev/SKILL.md
```

#### 4. CLAUDE.md を配置する

プロジェクトルールを定義する。テンプレートをダウンロードし、プロジェクトに合わせてカスタマイズする。

```bash
curl -sL https://raw.githubusercontent.com/masuidrive/pdh/main/templates/CLAUDE.md -o CLAUDE.md
```

カスタマイズのポイント:
- `## ディレクトリ構造` をプロジェクトの実際の構造に書き換える
- テストコマンド（`uv run pytest`, `npm test` 等）をプロジェクトに合わせる
- 開発サーバーの起動方法を追記する

#### 5. ticket.sh の設定をカスタマイズする

`.ticket-config.yaml` の `default_content` を PDH の Ticket テンプレートに合わせる。

```bash
curl -sL https://raw.githubusercontent.com/masuidrive/pdh/main/templates/.ticket-config.yaml \
  -o .ticket-config.yaml
```

設定項目:
- `default_branch`: メインブランチ名（default: `main`）
- `branch_prefix`: feature ブランチのプレフィックス（default: `features/`）
- `auto_push`: close 時に自動 push するか
- `default_content`: Ticket テンプレート（Why / What / Acceptance Criteria）
- `note_content`: 作業メモテンプレート（C1〜C4 セクション）

#### 6. Product Brief を書く

`product-brief.md` をプロジェクトルートに作成する。テンプレート:

```bash
curl -sL https://raw.githubusercontent.com/masuidrive/pdh/main/templates/product-brief.md \
  -o product-brief.md
```

最低限必要なセクション:
- **Background**: いまなぜこれを作るのか
- **Who**: 誰がどんな場面で使うか
- **Problem**: 何が困っているか
- **Solution**: どう解くか
- **Constraints**: 前提条件・技術的制約
- **Done**: うまくいったと言える状態
- **Non-goals**: やらないこと
- **Open Questions**: まだ決まっていないこと

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
  .claude/
    skills/
      pdh-dev/SKILL.md      ← PDH ワークフロースキル
```

## このリポジトリの構成

```
pdh/
  README.md                          ← このファイル
  docs/
    product-delivery-hierarchy.md    ← PDH 本体ドキュメント
  skills/
    pdh-dev/SKILL.md                 ← Claude Code 用 PDH スキル
  templates/
    product-brief.md                 ← Product Brief テンプレート
    CLAUDE.md                        ← CLAUDE.md テンプレート
    .ticket-config.yaml              ← ticket.sh 設定テンプレート
```

## 関連ツール

- [ticket.sh](https://github.com/masuidrive/ticket.sh) — Git ベースのチケット管理
- [Claude Code](https://claude.ai/claude-code) — Anthropic の CLI ツール

## License

MIT
