# PDH セットアップガイド

PDH を Codex プロジェクトへ導入する手順と、導入済みプロジェクトを更新する手順。

## 新規導入

### Codex に任せる

対象プロジェクトのルートで Codex を起動し、次のように指示する。

```text
https://github.com/masuidrive/pdh の INSTALL.md を読んで、このプロジェクトに PDH を導入して。
```

Codex は既存ファイルを上書きせず、下の手動手順と同じ配置・初期化・検査を行う。

### 手動で導入する

#### 1. 配布元と ticket.sh を用意する

```bash
git init  # 既存リポジトリなら不要
if [ -d tmp/pdh/.git ]; then
  git -C tmp/pdh fetch origin main
  git -C tmp/pdh checkout main
  git -C tmp/pdh merge --ff-only origin/main
else
  git clone https://github.com/masuidrive/pdh.git tmp/pdh
fi
curl -sL https://raw.githubusercontent.com/masuidrive/ticket.sh/main/ticket.sh -o ticket.sh
chmod +x ticket.sh
bash ticket.sh init
```

#### 2. ファイルを配置する

この節は PDH 未導入の project が対象である。開始前からコピー先が存在した場合は上書きせず、[既存プロジェクトのアップデート](#既存プロジェクトのアップデート)に従う。直前の `ticket.sh init` が新しく作った `.ticket-config.yaml` だけは、PDH template に置き換えてから project に合わせて編集する。

| コピー元 | コピー先 | 用途 |
|---|---|---|
| `tmp/pdh/docs/product-delivery-hierarchy.md` | `docs/product-delivery-hierarchy.md` | PDH 運用ルール |
| `tmp/pdh/docs/PDH-AGENTS.md` | `PDH-AGENTS.md` | PDH 共通 agent ルール |
| `tmp/pdh/skills/pdh-dev/` | `.agents/skills/pdh-dev/` | stage flow と worker 共通 context |
| `tmp/pdh/skills/pdh-coding/` | `.agents/skills/pdh-coding/` | 実装規則 |
| `tmp/pdh/skills/pdh-reviewing/` | `.agents/skills/pdh-reviewing/` | review 規則 |
| `tmp/pdh/skills/pdh-verifying/` | `.agents/skills/pdh-verifying/` | QA・AC 裏取り・surface 確認規則 |
| `tmp/pdh/skills/pdh-check-writing/` | `.agents/skills/pdh-check-writing/` | 宣言型 `.check` 執筆規則 |
| `tmp/pdh/skills/pdh-update/` | `.agents/skills/pdh-update/` | PDH 更新 skill |
| `tmp/pdh/skills/pdh-decision-board/` | `.agents/skills/pdh-decision-board/` | 実装前・close 前の判断ボード |
| `tmp/pdh/templates/AGENTS.md` | `AGENTS.md` | project 固有 Codex ルールの雛形 |
| `tmp/pdh/templates/AGENTS.local.md.example` | `AGENTS.local.md.example` | 環境固有 context のサンプル |
| `tmp/pdh/templates/agents/codex/` | `.codex/agents/` | PDH worker の custom agent 定義 |
| `tmp/pdh/templates/.ticket-config.yaml` | `.ticket-config.yaml` | ticket.sh 設定 |
| `tmp/pdh/templates/product-brief.md` | `product-brief.md` | Product Brief の雛形 |
| `tmp/pdh/templates/technical-reference.md` | `technical-reference.md` | 現在の実装の How の雛形 |
| `tmp/pdh/templates/test-all.sh` | `scripts/test-all.sh` | テスト一括実行 |
| `tmp/pdh/templates/fast-checks.sh` | `scripts/fast-checks.sh` | fast-check runner |
| `tmp/pdh/templates/checks/` | `scripts/checks/` | fast-check registry と見本 |
| `tmp/pdh/templates/dev-server.sh` | `scripts/dev-server.sh` | verify 用開発サーバー入口 |
| `tmp/pdh/templates/seed-pdh-verify.sh` | `scripts/seed-pdh-verify.sh` | verify 用 fixture seed hook |
| `tmp/pdh/templates/test-ticket-local.sh` | `scripts/test-ticket-local.sh` | ticket-local-test wrapper |

配置コマンド:

```bash
mkdir -p docs .agents/skills .codex/agents scripts
cp tmp/pdh/docs/product-delivery-hierarchy.md docs/product-delivery-hierarchy.md
cp tmp/pdh/docs/PDH-AGENTS.md PDH-AGENTS.md
for skill in pdh-dev pdh-coding pdh-reviewing pdh-verifying pdh-check-writing pdh-update pdh-decision-board; do
  cp -R "tmp/pdh/skills/$skill" ".agents/skills/$skill"
done
cp tmp/pdh/templates/AGENTS.md AGENTS.md
cp tmp/pdh/templates/AGENTS.local.md.example AGENTS.local.md.example
cp tmp/pdh/templates/agents/codex/*.toml .codex/agents/
cp tmp/pdh/templates/.ticket-config.yaml .ticket-config.yaml
cp tmp/pdh/templates/product-brief.md product-brief.md
cp tmp/pdh/templates/technical-reference.md technical-reference.md
cp tmp/pdh/templates/test-all.sh scripts/test-all.sh
cp tmp/pdh/templates/fast-checks.sh scripts/fast-checks.sh
cp -R tmp/pdh/templates/checks scripts/checks
cp tmp/pdh/templates/dev-server.sh scripts/dev-server.sh
cp tmp/pdh/templates/seed-pdh-verify.sh scripts/seed-pdh-verify.sh
cp tmp/pdh/templates/test-ticket-local.sh scripts/test-ticket-local.sh
chmod +x ticket.sh scripts/test-all.sh scripts/fast-checks.sh scripts/dev-server.sh scripts/seed-pdh-verify.sh scripts/test-ticket-local.sh
```

`.agents/skills/` は skill の実体である。`.claude/skills/` への symlink や wrapper は作らない。

#### 3. Based on の commit ID を埋める

対象ファイル（15 個）:

- `AGENTS.md`
- `PDH-AGENTS.md`
- `product-brief.md`
- `technical-reference.md`
- `.ticket-config.yaml`
- `docs/product-delivery-hierarchy.md`
- `.agents/skills/pdh-reviewing/SKILL.md`
- `.agents/skills/pdh-verifying/SKILL.md`
- `.agents/skills/pdh-check-writing/SKILL.md`
- `.agents/skills/pdh-coding/SKILL.md`
- `.agents/skills/pdh-dev/SKILL.md`
- `.agents/skills/pdh-update/SKILL.md`
- `.agents/skills/pdh-decision-board/SKILL.md`
- `scripts/checks/example-max-source-lines.check`
- `scripts/checks/example-max-test-lines.check`

```bash
COMMIT_ID=$(cd tmp/pdh && git rev-parse --short=7 HEAD)
sed_inplace() {
  if sed --version >/dev/null 2>&1; then
    sed -E -i "s#/blob/(XXXXXXX|[0-9a-f]{7})/#/blob/$COMMIT_ID/#g" "$@"
  else
    sed -E -i '' "s#/blob/(XXXXXXX|[0-9a-f]{7})/#/blob/$COMMIT_ID/#g" "$@"
  fi
}
sed_inplace \
  AGENTS.md PDH-AGENTS.md product-brief.md technical-reference.md .ticket-config.yaml \
  docs/product-delivery-hierarchy.md \
  .agents/skills/pdh-reviewing/SKILL.md \
  .agents/skills/pdh-verifying/SKILL.md \
  .agents/skills/pdh-check-writing/SKILL.md \
  .agents/skills/pdh-coding/SKILL.md \
  .agents/skills/pdh-dev/SKILL.md \
  .agents/skills/pdh-update/SKILL.md \
  .agents/skills/pdh-decision-board/SKILL.md \
  scripts/checks/example-max-source-lines.check \
  scripts/checks/example-max-test-lines.check
```

#### 4. project 固有ファイルを編集する

`PDH-AGENTS.md` と `.agents/skills/pdh-*` は PDH 共通配布物として扱い、project 固有の規則は `AGENTS.md` に書く。

- `AGENTS.md` のディレクトリ構造、テストコマンド、実装上の制約を埋める
- `.ticket-config.yaml` の branch と worktree 設定を project に合わせる
- `scripts/test-all.sh` に実際の全テストコマンドを登録する
- `scripts/dev-server.sh` と `scripts/seed-pdh-verify.sh` に実際の verify 環境を実装する
- `product-brief.md` と `technical-reference.md` を現在の product / implementation に合わせる

環境固有で commit できない指示には、gitignore した `AGENTS.local.md` を使える。secret の値は書かず、取得方法や保管場所だけを書く。必要なら `AGENTS.local.md.example` をコピーして作る。

```bash
grep -qxF 'AGENTS.local.md' .gitignore || printf '\nAGENTS.local.md\n' >> .gitignore
```

#### 5. 導入結果を検査する

```bash
test -f AGENTS.md
test -f PDH-AGENTS.md
for skill in pdh-dev pdh-coding pdh-reviewing pdh-verifying pdh-check-writing pdh-update pdh-decision-board; do
  test -f ".agents/skills/$skill/SKILL.md" || exit 1
  test ! -L ".agents/skills/$skill" || exit 1
done
for agent in pdh-ac-reader pdh-ac-verifier pdh-coding-engineer pdh-qa pdh-reviewer-lens1 pdh-reviewer pdh-surface-observer; do
  test -f ".codex/agents/$agent.toml" || exit 1
done
! grep -Rqs 'XXXXXXX' AGENTS.md PDH-AGENTS.md product-brief.md technical-reference.md .ticket-config.yaml docs/product-delivery-hierarchy.md .agents/skills scripts/checks
bash -n ticket.sh scripts/test-all.sh scripts/fast-checks.sh scripts/dev-server.sh scripts/seed-pdh-verify.sh scripts/test-ticket-local.sh
```

最後に `codex` を新しく起動し、`pdh-dev` と `pdh-update` が skill 一覧にあり、PDH worker が custom agent として選べることを確認する。

## 既存プロジェクトのアップデート

project 固有のファイルを保持し、上流管理の PDH skill と worker 定義だけを上書きする。

### 1. 更新前の状態を保存する

作業 tree に未保存変更があれば先に commit する。次に配布元を取得し、更新対象の backup を作る。

```bash
if [ -d tmp/pdh/.git ]; then
  git -C tmp/pdh fetch origin main
  git -C tmp/pdh checkout main
  git -C tmp/pdh merge --ff-only origin/main
else
  git clone https://github.com/masuidrive/pdh.git tmp/pdh
fi
PDH_BACKUP=$(mktemp -d tmp/pdh-backup.XXXXXX)
for path in AGENTS.md PDH-AGENTS.md product-brief.md technical-reference.md .ticket-config.yaml docs/product-delivery-hierarchy.md scripts/test-all.sh scripts/fast-checks.sh scripts/dev-server.sh scripts/seed-pdh-verify.sh scripts/test-ticket-local.sh; do
  [ ! -e "$path" ] || cp -Rp "$path" "$PDH_BACKUP/"
done
[ ! -d .agents/skills ] || cp -Rp .agents/skills "$PDH_BACKUP/agents-skills"
[ ! -d .codex/agents ] || cp -Rp .codex/agents "$PDH_BACKUP/codex-agents"
[ ! -d scripts/checks ] || cp -Rp scripts/checks "$PDH_BACKUP/scripts-checks"
printf 'backup: %s\n' "$PDH_BACKUP"
```

backup は `tmp/` 配下にあり、更新が正しいと確認するまで消さない。

### 2. 上流管理ファイルを更新する

```bash
mkdir -p docs .agents/skills .codex/agents
for skill in pdh-dev pdh-coding pdh-reviewing pdh-verifying pdh-check-writing pdh-update pdh-decision-board; do
  rm -rf ".agents/skills/$skill"
  cp -R "tmp/pdh/skills/$skill" ".agents/skills/$skill"
done
for agent in pdh-ac-reader pdh-ac-verifier pdh-coding-engineer pdh-qa pdh-reviewer-lens1 pdh-reviewer pdh-surface-observer; do
  cp "tmp/pdh/templates/agents/codex/$agent.toml" ".codex/agents/$agent.toml"
done
cp tmp/pdh/docs/PDH-AGENTS.md PDH-AGENTS.md
cp tmp/pdh/docs/product-delivery-hierarchy.md docs/product-delivery-hierarchy.md
```

上の `rm -rf` は名前を列挙した PDH skill だけを置き換える。`.agents/skills/` 全体や、`pdh-` で始まらない user skill / agent 定義は削除しない。

### 3. project 固有ファイルを差分マージする

次のファイルは上書きしない。`git diff --no-index` で template と比較し、必要な上流変更だけを既存ファイルへ反映する。

- `AGENTS.md`
- `product-brief.md`
- `technical-reference.md`
- `.ticket-config.yaml`
- `scripts/test-all.sh`
- `scripts/fast-checks.sh`
- `scripts/checks/`
- `scripts/dev-server.sh`
- `scripts/seed-pdh-verify.sh`
- `scripts/test-ticket-local.sh`

例:

```bash
git diff --no-index -- AGENTS.md tmp/pdh/templates/AGENTS.md || true
git diff --no-index -- .ticket-config.yaml tmp/pdh/templates/.ticket-config.yaml || true
git diff --no-index -- scripts/test-all.sh tmp/pdh/templates/test-all.sh || true
```

新しい `templates/checks/*.check` は追加し、既存の project 固有 `.check` は残す。`required-pdh-files.check` の `required_paths` は、実際に配置した PDH skill と Codex agent 定義の全件に合わせる。

### 4. commit ID と結果を検査する

[新規導入の commit ID 置換](#3-based-on-の-commit-id-を埋める)と[導入結果の検査](#5-導入結果を検査する)を実行する。続けて project の `scripts/test-all.sh` を実行し、`git diff` で user 固有設定が残っていることを確認する。

同じ更新手順をもう一度実行し、2 回目に PDH 配布物の差分が出ないことも確認する。

## Claude 併用版からの移行

旧版の `CLAUDE.md`、`.claude/skills/`、`.claude/agents/` に project 固有変更がある可能性があるため、先に backup とマージを行う。`.claude/` 全体を削除してはいけない。

### 1. legacy ファイルを退避する

```bash
PDH_LEGACY_BACKUP=$(mktemp -d tmp/pdh-claude-backup.XXXXXX)
[ ! -f CLAUDE.md ] || cp -p CLAUDE.md "$PDH_LEGACY_BACKUP/"
[ ! -f CLAUDE.local.md ] || cp -p CLAUDE.local.md "$PDH_LEGACY_BACKUP/"
[ ! -d .claude/skills ] || cp -Rp .claude/skills "$PDH_LEGACY_BACKUP/skills"
[ ! -d .claude/agents ] || cp -Rp .claude/agents "$PDH_LEGACY_BACKUP/agents"
printf 'legacy backup: %s\n' "$PDH_LEGACY_BACKUP"
```

### 2. project 固有ルールを AGENTS.md へ統合する

`AGENTS.md` がなければ `CLAUDE.md` を出発点としてコピーする。すでにある場合は上書きせず、旧 `CLAUDE.md` にある project 固有ルール、テストコマンド、モデル override を `AGENTS.md` へマージする。既存の thin pointer だけを残して旧ルールを失わないこと。

```bash
if [ ! -f AGENTS.md ]; then
  if [ -f CLAUDE.md ]; then cp -p CLAUDE.md AGENTS.md; else cp tmp/pdh/templates/AGENTS.md AGENTS.md; fi
fi
if [ -f CLAUDE.md ]; then git diff --no-index -- CLAUDE.md AGENTS.md || true; fi
git diff --no-index -- AGENTS.md tmp/pdh/templates/AGENTS.md || true
```

`AGENTS.md` 内の `.claude/skills/` を `.agents/skills/` に読み替える。最初の diff は自動判定に使わず、移すべき project 固有内容を見つける材料にする。旧ファイルは migration 後も backup として残る。

環境固有 context も同様に移す。`AGENTS.local.md` がなければ旧ファイルをコピーし、両方ある場合は既存 `AGENTS.local.md` を上書きせず差分をマージする。

```bash
if [ -f CLAUDE.local.md ] && [ ! -f AGENTS.local.md ]; then
  cp -p CLAUDE.local.md AGENTS.local.md
fi
if [ -f CLAUDE.local.md ]; then git diff --no-index -- CLAUDE.local.md AGENTS.local.md || true; fi
grep -qxF 'AGENTS.local.md' .gitignore || printf '\nAGENTS.local.md\n' >> .gitignore
```

末尾の `Based on` は `templates/AGENTS.md` を指す行へ更新する。旧 `templates/CLAUDE.md` を指す footer は残さない。

### 3. Codex ネイティブ配置へ更新する

[既存プロジェクトのアップデート](#既存プロジェクトのアップデート)を最後まで実行する。`.agents/skills/<name>` が旧 symlink の場合も、列挙した PDH skill だけが実ディレクトリへ置換される。

### 4. 旧 PDH 配布物だけを退役させる

新配置でテストが通り、backup が存在することを確認してから、旧 PDH skill と agent 定義を名前を指定して削除する。

```bash
for skill in pdh-dev pdh-coding pdh-reviewing pdh-verifying pdh-check-writing pdh-update pdh-decision-board tmux-director; do
  rm -rf ".claude/skills/$skill"
done
rm -rf .agents/skills/tmux-director
for agent in pdh-ac-reader pdh-ac-verifier pdh-coding-engineer pdh-qa pdh-reviewer-lens1 pdh-reviewer pdh-surface-observer; do
  rm -f ".claude/agents/$agent.md"
done
```

`.claude/settings.json`、`.claude/` 内の user ファイル、`pdh-` で始まらない agent / skill は触らない。`CLAUDE.md` と `CLAUDE.local.md` は backup として残してよい。Codex の現在形からは参照せず、不要と判断したときだけ後で削除する。

移行確認:

```bash
test -f AGENTS.md
test ! -L .agents/skills/pdh-dev
test -f .agents/skills/pdh-dev/SKILL.md
test -f .codex/agents/pdh-coding-engineer.toml
find .claude/skills .claude/agents -maxdepth 1 -name 'pdh-*' -print 2>/dev/null
```

最後の `find` が何か表示した場合は、backup と照合して PDH 配布物か user の同名カスタマイズかを判断する。自動では削除しない。

## pdh-update skill

導入後は Codex に「pdh-update」と指示すると、`.agents/skills/pdh-update/SKILL.md` がこの更新手順を実行する。更新結果には backup path、反映した migration、2 回目の冪等性確認、テスト結果を含める。
