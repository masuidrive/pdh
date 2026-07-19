![PDH flow](pdh-header.png)

# PDH — Product Delivery Hierarchy

Product Brief / Ticket の 2 層で、**なぜ作るか**・**いま何をやるか** を構造化する仕組み。

人間と coding agent（Claude Code 等）の両方が読み、同じ文脈の中でプロダクトの方向性から日々の実装作業までを追跡する。

## 特徴

- **2 層構造**: Product Brief (why) → Ticket (what + how、1 ticket = 1 work unit)
- **Ticket-human-review + post-implementation review**: 実装前に ticket contract / AC を人間とすり合わせ、実装後に review / verify / human-review を通す
- **Coding agent 対応**: Agent が読んで判断・実装できるように設計
- **Git ベース**: すべて Markdown ファイル。特別なツールは不要
- **ticket.sh 連携**: [ticket.sh](https://github.com/masuidrive/ticket.sh) でチケットのライフサイクルを管理

> **note**: 旧設計は Product Brief / Epic / Ticket の 3 層 + Light/Full の 2 段階 flow だったが、1 user + AI 体制で Epic の同期 / coordination 価値より overhead cost の方が高いと実証され、Product Brief / Ticket の 2 層 + PDH stage flow (1 ticket per work) に統一された。Epic / PD-A / PD-B / PD-D / PD-C-2〜5 / PD-C-8 は廃止。詳細は `docs/product-delivery-hierarchy.md` 参照。

## 前提条件

| 必須/任意 | ツール | バージョン目安 | 用途 |
|---|---|---|---|
| 必須 | `git` | 2.x+ | バージョン管理、リポジトリ clone |
| 必須 | `curl` | any | ticket.sh ダウンロード |
| 必須 | `bash` | 4.x+ | スクリプト実行 |
| 必須（いずれか） | [`claude`](https://claude.ai/claude-code) (Claude Code CLI) | 2.x+ | coding agent 本体。skill は `.claude/skills/` から読む |
| 必須（いずれか） | [`codex`](https://github.com/openai/codex) (Codex CLI) | any | coding agent 本体。skill は `.agents/skills/`、指示は `AGENTS.md` から読む |
| 任意 | `node` | **18+** (推奨 20+ / 24+) | `scripts/hookbus.js` の実行 (tmux Director 使用時のみ)。ESM / top-level await / `import.meta` / `node:` prefix を使うため 18 未満は不可 |
| 任意 | `tmux` | 3.x+ | Director で複数 worker 監視する場合 |

**coding agent は claude / codex のどちらか一方があれば動く。** PDH のフローは engine 中立で、どちらを main（PM）にしても同じ stage flow を回せる。両方ある場合は実装 worker だけを逆 engine に委譲する構成も選べる（§main engine の選択 参照）。

## セットアップ・アップデート

導入手順と更新手順は **[INSTALL.md](INSTALL.md)** にある。

- **新規導入**: [INSTALL.md「新規導入」](INSTALL.md#新規導入) — coding agent に任せる方法と手動手順の両方
- **導入済みの更新**: [INSTALL.md「既存プロジェクトのアップデート」](INSTALL.md#既存プロジェクトのアップデート)。`pdh-update` skill を使う場合も内部でこの手順を辿る
- **バージョン間の移行**: [INSTALL.md「既知の移行手順」](INSTALL.md#既知の移行手順)。差分だけでは移行できない変更はここに集約している

最短の導入は、プロジェクトのルートで coding agent にこう指示する:

```
https://github.com/masuidrive/pdh の INSTALL.md を読んで、このプロジェクトに PDH を導入して。
```

## ワークフロー (PDH stage flow)

```
Product Brief を書く
    ↓
Ticket を作成 (Why / AC / Architectural Invariants check / 確定判断 / Out-of-scope を埋める)
    ↓
PDH-open: 対象 ticket / note / brief を読む
    ↓
PDH-ticket-review: agent が ticket contract を整える
    ↓
PDH-ticket-human-review: 実装前に全体概要・修正点・AC をユーザに提示し、AC 承認を得る (人間 gate)
    ↓
PDH-implement: 実装
    ↓
PDH-review: 実装後 review と修正ループ
    ↓
PDH-verify: AC 裏取り + Surface Observer + テスト全件 + `ticket-local-test`
    ↓
PDH-human-review: やったこと・達成したことをユーザが確認する (人間 gate)
    ↓
PDH-close: human-review 承認後に close
```

詳細は `docs/product-delivery-hierarchy.md` と `skills/pdh-dev/SKILL.md` を参照。

## main engine の選択

PDH のフローは engine 中立で、特定の engine を前提にしない。

**main engine** = PM（Director）を動かす coding agent。`claude` でも `codex` でもよい。**worker は既定で main と同じ engine**になる。

- **claude だけの環境**: `claude` で起動する。skill は `.claude/skills/` から読まれる
- **codex だけの環境**: `codex` で起動する。`AGENTS.md` が自動でコンテキストに載り、skill は `.agents/skills/`（`.claude/skills/` への symlink）から読まれる
- **両方ある環境**: どちらを main にしてもよい。加えて **cross-delegate**（実装 worker だけを main と逆の engine へ委譲）を選べる。セッションで最初に実装へ入る時に 1 回だけ確認され、その回答がセッション既定になる

役割ごとの engine / model を既定から変えたい場合は `CLAUDE.md` のチーム構成テーブルで上書きする。特定 engine をフローにハードコードしないこと（`product-brief.md` の `AI-5`）。ただし **cross-model review が必須の変更**（認証・認可・DB スキーマ・secret・データ削除・課金）では、生成したモデルとは別のモデルによる独立レビューを最低 1 つ入れる。これは engine の指定ではなく「生成者と検証者を分ける」という要件で、同一 engine 内の別モデルでも満たせる。

詳細は `skills/pdh-dev/_execution-team.md`「エンジン割り当て」「spawn 機構」を参照。

### 対応している coding agent

PDH が engine に要求するのは 2 つだけ。

1. session 開始時に `AGENTS.md` または `CLAUDE.md` を自動でコンテキストに載せること
2. `.claude/skills/` または `.agents/skills/` から skill を読むこと

| engine | 状況 |
|---|---|
| **Claude Code** | first-class。PDH の開発自体がここで回っている |
| **Codex CLI** | first-class。`AGENTS.md` の自動ロードと `.agents/skills/`（`.claude/skills/` への symlink）からの skill 探索を実測確認済み |
| Grok Build | 動く。`AGENTS.md` / `CLAUDE.md` を両方読み、`.claude/skills/` と `.agents/skills/` の両方を走査する。ただし **gitignore した `CLAUDE.local.md` は読まれない**（[INSTALL.md](INSTALL.md#新規導入) の注記を参照） |
| opencode ほか | 未検証だが、上の 2 条件を満たすなら動くはず |

2 の skill 機構が無い agent でも、`AGENTS.md` から `.claude/skills/pdh-dev/SKILL.md` を明示的に読ませれば動作する。skill 機構は遅延ロードの最適化であって、PDH の前提ではない。

## tmux Director

tmux 上で複数の Claude Code セッションを走らせている場合に、別 window の Claude Code を監督・指示するためのスキル。

- **Director (監督)** として振る舞い、自分ではコードを書かず、別 window の Claude Code に指示を出して作業を監視する
- PDH ワークフロー (`PDH-open` → `PDH-ticket-review` → `PDH-ticket-human-review` → `PDH-implement` → `PDH-review` → `PDH-verify` → `PDH-human-review` → `PDH-close`) の遵守を監視し、逸脱 (テスト未実行、E2E 省略、AC 未達、human gate スキップ等) を検知して是正指示を出す

Claude Code で `tmux-director` と入力すると起動する。

### 監視パス (2 系統)

1. **hookbus event stream (推奨、ms 単位で反応)** — `scripts/hookbus.js` と `.claude/settings.json` の hooks を配線しておくと、worker がアイドル / permission 待ちになった瞬間に `/tmp/claude-events-<socket_hash>/log.ndjson` に NDJSON が 1 行 append される。Director は Claude Code の **`Monitor` ツール** (deferred tool、stdout 1 行 = 1 通知として会話に push する組み込み streaming 機能) で `scripts/hookbus.js pull --include <w1-key> --include <w2-key> ... --follow` を bg 消費し、対象 worker の event だけを通知として受け取る。無関係な pane は allow-list にないので自然に弾かれる。ポーリング不要
2. **tmux capture-pane Monitor Agent (fallback、15 秒間隔)** — hookbus 未配線のプロジェクト用。Sonnet Agent を bg spawn して 15 秒ごとに画面 capture + 状態判定

### hookbus 起動手順

**前提**: INSTALL.md「ファイルを配置する」で `scripts/hookbus.js` 配置済、「.claude/settings.json を設定する」の hookbus 版で hooks 配置済。

**重要な仕様**: `.claude/settings.json` は **各 Claude Code セッション起動時に読まれて固まる**。mid-session で settings.json を編集しても、走っているセッションには反映されない。hooks を追加・変更した場合は **全 Claude セッション一旦終了 → 再起動** が必要。

手順:

1. 全 tmux window で走っている Claude Code セッションを終了 (`/exit` or Ctrl-C)
2. Director window / Worker window とも通常どおり `claude` で起動
3. Director セッション内で監視対象 worker の key を allow-list で指定し、**固有 `--cursor` id** で Monitor 起動:
   ```bash
   SOCK_HASH=$(scripts/hookbus.js whoami | cut -d: -f1)
   CURID="$SOCK_HASH:mon-$(tmux display-message -p '#{window_index}')"    # Director 自身の key と必ず別
   ROOT=/tmp/claude-events-$SOCK_HASH
   printf '%s\n' "$(stat -c%s "$ROOT/log.ndjson")" > "$ROOT/consumers/${CURID/:/%3A}.cursor"  # cursor を log 末尾へ直書き seed (__seed_no_match__ pull では seed されないため。backlog 再生回避)
   ```
   ```
   Monitor({
     command: "scripts/hookbus.js pull --cursor $CURID --include <w1-key> --include <w2-key> --include <w3-key> --follow",
     description: "tmux worker events",
     persistent: true
   })
   ```
   worker の key は `<socket_hash>:<pane_id>` (例: `a3f2e1:%10`)。pane_id は `tmux list-panes -a -F '#{pane_id}'` で取れる。socket_hash は Director の `scripts/hookbus.js whoami` の `:` 前部分と同じ。`--include` 省略時は全 event が流れる (無関係な pane 含む) ので、監視対象は明示推奨。worker が Stop / Notification した瞬間、NDJSON 1 行が会話に通知として push される。

   **⚠ `--cursor` を必ず明示する**: 省略時 cursor identity は `whoami`（= Director 自身の pane の key。`<hash>:<pane_id>` 形式で、pane_id は環境ごとに異なる）にフォールバックする。cursor は「読んだ byte offset」を identity ごとに 1 ファイルで持ち emit ごとに advance するため、**同一 identity の `pull` が複数あると (Monitor 2 つ / Director の手動 `pull`) 片方が cursor を進めて他方がイベントを取り逃す**。各 Monitor に固有 `--cursor`、新規 cursor は上記のように log 末尾へ seed (offset 0 からだと全 backlog を replay し通知洪水)、複数 worker は「1 Monitor + `--include` 複数」で監視する。

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
  product-brief.md          ← プロダクトの why + Architectural Invariants (1 つだけ)
  technical-reference.md    ← 現在の実装の How (1 つだけ。ticket close 時に agent が維持)
  CLAUDE.md                 ← project 固有 Agent ルール
  PDH-AGENTS.md             ← PDH 汎用 Agent ルール
  CLAUDE.local.md           ← gitignore 済みの環境固有 agent メモ（存在する場合のみ）
  CLAUDE.local.md.example   ← 環境固有 agent メモのサンプル
  ticket.sh                 ← チケット管理ツール
  .ticket-config.yaml       ← ticket.sh 設定
  docs/
    product-delivery-hierarchy.md  ← PDH 運用ルール・テンプレート
  tickets/
    YYMMDD-hhmmss-slug/     ← Ticket ディレクトリ (ticket.sh が管理: ticket.md / note.md / tests/ / tmp/)
    done/                   ← 完了した Ticket
  current-ticket/           ← 作業中 ticket への symlink (ticket.sh start/restore が作る。git 管理しない)
  AGENTS.md                 ← Codex CLI 向け設定 (CLAUDE.md / PDH-AGENTS.md への thin pointer)
  .agents/
    skills/                 ← Codex 用 skill wrappers（実体は .claude/skills）
  scripts/
    test-all.sh             ← テスト一括実行
    fast-checks.sh          ← 決定論的 fast-check ランナー（宣言形式の grep 不変条件）
    checks/                 ← fast-check レジストリ（*.check + README）
    dev-server.sh           ← PDH verify / human-review 用の開発サーバ入口
    seed-pdh-verify.sh      ← PDH verify / human-review 用のローカル seed hook
    test-ticket-local.sh    ← `ticket-local-test` 実行
    hookbus.js              ← (任意) tmux Director hookbus event bus
  tests/
    tickets/
      YYMMDD-hhmmss-slug/
        test-ticket-local.sh ← 旧 flat 形式の ticket-local-test（後方互換。新レイアウトでは tickets/<name>/tests/ に置く）
  .claude/
    settings.json           ← Agent Teams 設定 + (任意) hookbus 用 hooks
    skills/
      pdh-dev/              ← PDH stage flow ワークフロースキル (SKILL.md + _*.md)
      pdh-coding/SKILL.md   ← コーディング標準スキル
      tmux-director/SKILL.md ← tmux Director スキル
      pdh-update/SKILL.md    ← PDH アップデートスキル
```

## このリポジトリの構成

```
pdh/
  README.md                          ← このファイル（PDH の説明）
  INSTALL.md                         ← 導入・更新手順（配布物の配置表はここが正）
  docs/
    product-delivery-hierarchy.md    ← PDH 本体ドキュメント
  skills/
    pdh-dev/
      SKILL.md                       ← PDH stage flow ワークフロースキル（入口）
      _*.md                          ← SKILL.md から参照される分冊（flow / review / execution-team 等）
    pdh-coding/SKILL.md              ← コーディング標準スキル
    tmux-director/SKILL.md           ← tmux Director スキル
    pdh-update/SKILL.md              ← PDH アップデートスキル
  templates/
    product-brief.md                 ← Product Brief テンプレート
    technical-reference.md           ← Technical Reference テンプレート（現在の実装の How）
    CLAUDE.md                        ← project 固有 CLAUDE.md テンプレート
    PDH-AGENTS.md                    ← PDH 汎用 agent ルールテンプレート
    CLAUDE.local.md.example          ← 環境固有 agent メモのサンプル
    AGENTS.md                        ← AGENTS.md テンプレート (Codex CLI 向け thin pointer)
    test-all.sh                      ← テスト一括実行テンプレート
    fast-checks.sh                   ← 決定論的 fast-check ランナーテンプレート
    checks/                          ← fast-check レジストリテンプレート（README + サンプル）
    dev-server.sh                    ← PDH verify / human-review 用の開発サーバ入口テンプレート
    seed-pdh-verify.sh               ← PDH verify / human-review 用のローカル seed hook テンプレート
    test-ticket-local.sh             ← `ticket-local-test` 実行テンプレート
    .ticket-config.yaml              ← ticket.sh 設定テンプレート
  scripts/
    hookbus.js                       ← tmux Director hookbus (CLI + library + in-source vitest、1 ファイル完結)【配布物】
    test-all.sh                      ← この repo 自身の検査入口【配布物ではない】
    fast-checks.sh                   ← 同上（宣言的 grep 不変条件ランナー）
    check-distribution.sh            ← 同上（配布セットの一貫性検査）
    checks/                          ← 同上（この repo 用 fast-check レジストリ）
  product-brief.md                   ← PDH 自身の Product Brief
  CLAUDE.md                          ← PDH repo 固有の agent ルール
```

`scripts/` 直下で配布されるのは `hookbus.js` のみ。他は PDH repo 自身の検査で、配布先へはコピーしない（配布用テンプレートは `templates/` 側にある）。

## 関連ツール

- [ticket.sh](https://github.com/masuidrive/ticket.sh) — Git ベースのチケット管理
- [Claude Code](https://claude.ai/claude-code) — Anthropic の CLI ツール

## License

Apache License 2.0
