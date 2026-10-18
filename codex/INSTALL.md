# PDH セットアップガイド

PDH を Codex プロジェクトへ導入する手順と、導入済みプロジェクトを更新する手順。[PDH の概要](../README.md)。

worker 定義は共有の上書き対象である。役ごとの engine・model・reasoning effort は `AGENTS.md` とそこから指す project の PM 規則で指定する。未指定の model は親から引き継ぐ。

## 前提

Python 3.11 以降と PyYAML（文書・生成の検査と Codex の worker 起動が使う）を用意する。

## 新規導入

### Codex に任せる

対象プロジェクトのルートで Codex を起動し、次のように指示する。

```text
https://github.com/masuidrive/pdh の codex/INSTALL.md を読んで、このプロジェクトに PDH を導入して。
```

Codex は既存ファイルを上書きせず、下の手動手順と同じ配置・初期化・検査を行う。

### 手動で導入する

#### 1. 配布元と ticket.sh を用意する

<!-- pdh-shell: prepare -->
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
```

#### 2. ファイルを配置する

この節は PDH 未導入の project が対象である。開始前からコピー先が存在した場合は上書きせず、[既存プロジェクトのアップデート](#既存プロジェクトのアップデート)に従う。

| コピー元 | コピー先 | 用途 | 更新の仕方 |
|---|---|---|---|
| `tmp/pdh/docs/PDH-AGENTS.md` | `PDH-AGENTS.md` | PDH の共通契約・用語 | 上書き |
| `tmp/pdh/docs/pdh-glossary.md` | `docs/pdh-glossary.md` | PDH の共通契約・用語 | 上書き |
| `tmp/pdh/codex/skills/pdh-change/` | `.agents/skills/pdh-change/` | pdh-change skill（分冊・kit・tools を含む） | 上書き |
| `tmp/pdh/codex/skills/pdh-check-writing/` | `.agents/skills/pdh-check-writing/` | pdh-check-writing skill（分冊・kit・tools を含む） | 上書き |
| `tmp/pdh/codex/skills/pdh-close/` | `.agents/skills/pdh-close/` | pdh-close skill（分冊・kit・tools を含む） | 上書き |
| `tmp/pdh/codex/skills/pdh-decision-board/` | `.agents/skills/pdh-decision-board/` | pdh-decision-board skill（分冊・kit・tools を含む） | 上書き |
| `tmp/pdh/codex/skills/pdh-implement/` | `.agents/skills/pdh-implement/` | pdh-implement skill（分冊・kit・tools を含む） | 上書き |
| `tmp/pdh/codex/skills/pdh-open/` | `.agents/skills/pdh-open/` | pdh-open skill（分冊・kit・tools を含む） | 上書き |
| `tmp/pdh/codex/skills/pdh-pm/` | `.agents/skills/pdh-pm/` | pdh-pm skill（分冊・kit・tools を含む） | 上書き |
| `tmp/pdh/codex/skills/pdh-resume/` | `.agents/skills/pdh-resume/` | pdh-resume skill（分冊・kit・tools を含む） | 上書き |
| `tmp/pdh/codex/skills/pdh-review/` | `.agents/skills/pdh-review/` | pdh-review skill（分冊・kit・tools を含む） | 上書き |
| `tmp/pdh/codex/skills/pdh-ticket-review/` | `.agents/skills/pdh-ticket-review/` | pdh-ticket-review skill（分冊・kit・tools を含む） | 上書き |
| `tmp/pdh/codex/skills/pdh-ticket-write/` | `.agents/skills/pdh-ticket-write/` | pdh-ticket-write skill（分冊・kit・tools を含む） | 上書き |
| `tmp/pdh/codex/skills/pdh-update/` | `.agents/skills/pdh-update/` | pdh-update skill（分冊・kit・tools を含む） | 上書き |
| `tmp/pdh/codex/skills/pdh-verify/` | `.agents/skills/pdh-verify/` | pdh-verify skill（分冊・kit・tools を含む） | 上書き |
| `tmp/pdh/codex/templates/.ticket-config.yaml` | `.ticket-config.yaml` | project の設定・入口テンプレート | 差分マージ |
| `tmp/pdh/codex/templates/AGENTS.local.md.example` | `AGENTS.local.md.example` | project の設定・入口テンプレート | 初回だけ |
| `tmp/pdh/codex/templates/AGENTS.md` | `AGENTS.md` | project の設定・入口テンプレート | 差分マージ |
| `tmp/pdh/codex/templates/agents/codex/pdh-ac-reader.toml` | `.codex/agents/pdh-ac-reader.toml` | PDH worker の役割定義 | 上書き |
| `tmp/pdh/codex/templates/agents/codex/pdh-ac-verifier.toml` | `.codex/agents/pdh-ac-verifier.toml` | PDH worker の役割定義 | 上書き |
| `tmp/pdh/codex/templates/agents/codex/pdh-coding-engineer.toml` | `.codex/agents/pdh-coding-engineer.toml` | PDH worker の役割定義 | 上書き |
| `tmp/pdh/codex/templates/agents/codex/pdh-qa.toml` | `.codex/agents/pdh-qa.toml` | PDH worker の役割定義 | 上書き |
| `tmp/pdh/codex/templates/agents/codex/pdh-reviewer-lens1.toml` | `.codex/agents/pdh-reviewer-lens1.toml` | PDH worker の役割定義 | 上書き |
| `tmp/pdh/codex/templates/agents/codex/pdh-reviewer.toml` | `.codex/agents/pdh-reviewer.toml` | PDH worker の役割定義 | 上書き |
| `tmp/pdh/codex/templates/agents/codex/pdh-surface-observer.toml` | `.codex/agents/pdh-surface-observer.toml` | PDH worker の役割定義 | 上書き |
| `tmp/pdh/codex/templates/check-pdh-ticket.sh` | `scripts/check-pdh-ticket.sh` | 共有 script | 上書き |
| `tmp/pdh/codex/templates/check-ticket-template-drift.sh` | `scripts/check-ticket-template-drift.sh` | 共有 script | 上書き |
| `tmp/pdh/codex/templates/checks/README.md` | `scripts/checks/README.md` | fast-check の定義・見本（project の独自 check は保持） | 上書き |
| `tmp/pdh/codex/templates/checks/bin/pdh-stage-skill-sections.sh` | `scripts/checks/bin/pdh-stage-skill-sections.sh` | fast-check の定義・見本（project の独自 check は保持） | 上書き |
| `tmp/pdh/codex/templates/checks/docs-metadata.check` | `scripts/checks/docs-metadata.check.example` | fast-check の定義・見本（project の独自 check は保持） | 上書き |
| `tmp/pdh/codex/templates/checks/docs-references.check` | `scripts/checks/docs-references.check.example` | fast-check の定義・見本（project の独自 check は保持） | 上書き |
| `tmp/pdh/codex/templates/checks/example-max-source-lines.check` | `scripts/checks/example-max-source-lines.check` | fast-check の定義・見本（project の独自 check は保持） | 差分マージ |
| `tmp/pdh/codex/templates/checks/example-max-test-lines.check` | `scripts/checks/example-max-test-lines.check` | fast-check の定義・見本（project の独自 check は保持） | 差分マージ |
| `tmp/pdh/codex/templates/checks/example-no-merge-conflict-markers.check` | `scripts/checks/example-no-merge-conflict-markers.check` | fast-check の定義・見本（project の独自 check は保持） | 差分マージ |
| `tmp/pdh/codex/templates/checks/example-no-node-p-capture.check` | `scripts/checks/example-no-node-p-capture.check` | fast-check の定義・見本（project の独自 check は保持） | 差分マージ |
| `tmp/pdh/codex/templates/checks/pdh-stage-skill-sections.check` | `scripts/checks/pdh-stage-skill-sections.check` | fast-check の定義・見本（project の独自 check は保持） | 上書き |
| `tmp/pdh/codex/templates/checks/required-pdh-files.check` | `scripts/checks/required-pdh-files.check` | fast-check の定義・見本（project の独自 check は保持） | 差分マージ |
| `tmp/pdh/codex/templates/dev-server.sh` | `scripts/dev-server.sh` | project の設定・入口テンプレート | 差分マージ |
| `tmp/pdh/codex/templates/docs-policy.py` | `scripts/docs-policy.py` | 共有 script | 上書き |
| `tmp/pdh/codex/templates/docs-toc.sh` | `scripts/docs-toc.sh` | 共有 script | 上書き |
| `tmp/pdh/codex/templates/fast-checks.sh` | `scripts/fast-checks.sh` | 共有 script | 上書き |
| `tmp/pdh/codex/templates/hooks.json` | `.codex/hooks.json` | SessionStart の hook を既存設定へ統合 | 差分マージ |
| `tmp/pdh/codex/templates/pdh-lock.sh` | `scripts/pdh-lock.sh` | 共有 script | 上書き |
| `tmp/pdh/codex/templates/pdh-related-docs.sh` | `scripts/pdh-related-docs.sh` | 共有 script | 上書き |
| `tmp/pdh/codex/templates/pdh-review-eval/` | `docs/pdh-review-eval/` | project の評価データと実測結果の書き方。空の case 一覧 | 初回だけ |
| `tmp/pdh/codex/templates/pdh-review-eval.sh` | `scripts/pdh-review-eval.sh` | 共有 script | 上書き |
| `tmp/pdh/codex/templates/pdh-review-range.sh` | `scripts/pdh-review-range.sh` | 共有 script | 上書き |
| `tmp/pdh/codex/templates/pdh-review-tally.sh` | `scripts/pdh-review-tally.sh` | 共有 script | 上書き |
| `tmp/pdh/codex/templates/pdh-session-hook.sh` | `scripts/pdh-session-hook.sh` | 共有 script | 上書き |
| `tmp/pdh/codex/templates/pdh-stage-checklist.sh` | `scripts/pdh-stage-checklist.sh` | 共有 script | 上書き |
| `tmp/pdh/codex/templates/pdh-verify-lib.sh` | `scripts/pdh-verify-lib.sh` | 共有 script | 上書き |
| `tmp/pdh/codex/templates/product-brief.md` | `product-brief.md` | project の設定・入口テンプレート | 初回だけ |
| `tmp/pdh/codex/templates/seed-pdh-verify.sh` | `scripts/seed-pdh-verify.sh` | project の設定・入口テンプレート | 差分マージ |
| `tmp/pdh/codex/templates/spawn-worker.sh` | `scripts/spawn-worker.sh` | 共有 script | 上書き |
| `tmp/pdh/codex/templates/test-all.sh` | `scripts/test-all.sh` | project の設定・入口テンプレート | 差分マージ |
| `tmp/pdh/codex/templates/test-ticket-local.sh` | `scripts/test-ticket-local.sh` | 共有 script | 上書き |
| `tmp/pdh/codex/templates/checks/required-pdh-source-files.check` | `scripts/checks/required-pdh-source-files.check` | PDH の共有 script と PM の分冊の存在 | 差分マージ |


<!-- pdh-shell: install -->
```bash
while IFS="$(printf '\t')" read -r source destination; do
  destination=${destination%/}
  mkdir -p "$(dirname "$destination")"
  if [ -d "tmp/pdh/$source" ]; then
    rm -rf "$destination"
    mkdir -p "$destination"
    cp -RL "tmp/pdh/$source/." "$destination/"
  else
    cp -p "tmp/pdh/$source" "$destination"
  fi
done < tmp/pdh/codex/lock-map.tsv
for name in .ticket-config.yaml AGENTS.md product-brief.md AGENTS.local.md.example; do
  [ -e "$name" ] || cp "tmp/pdh/codex/templates/$name" "$name"
done
for name in dev-server.sh seed-pdh-verify.sh test-all.sh; do
  [ -e "scripts/$name" ] || cp "tmp/pdh/codex/templates/$name" "scripts/$name"
done
for name in example-max-source-lines example-max-test-lines example-no-merge-conflict-markers example-no-node-p-capture required-pdh-files required-pdh-source-files; do
  [ -e "scripts/checks/$name.check" ] || cp "tmp/pdh/codex/templates/checks/$name.check" "scripts/checks/$name.check"
done
python3 - <<'MERGE_HOOKS'
import json
from pathlib import Path

for source, destination in [('tmp/pdh/codex/templates/hooks.json', '.codex/hooks.json')]:
    path = Path(destination)
    existing = json.loads(path.read_text()) if path.exists() else {}
    required = json.loads(Path(source).read_text())
    events = existing.setdefault('hooks', {})
    for event, groups in required['hooks'].items():
        entries = events.setdefault(event, [])
        for group in groups:
            match = next((item for item in entries if item.get('matcher') == group.get('matcher')), None)
            if match is None:
                entries.append(group)
                continue
            hooks = match.setdefault('hooks', [])
            for hook in group['hooks']:
                if not any(item.get('type') == hook['type'] and item.get('command') == hook['command'] for item in hooks):
                    hooks.append(hook)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(existing, ensure_ascii=False, indent=2) + '\n')
MERGE_HOOKS
[ -e docs/pdh-review-eval ] || cp -R tmp/pdh/codex/templates/pdh-review-eval docs/pdh-review-eval
chmod +x scripts/*.sh
bash ticket.sh init
```

既存の差分マージ・初回だけのファイルは保持する。template と比較して必要な項目を差分マージしてから検査する。上の JSON マージは既存の権限・hook と設定値を残し、PDH の SessionStart hook だけを重複なく追加する。

`.agents/skills/` は skill の実体である。`.claude/skills/` への symlink や wrapper は作らない。

#### 3. Based on の commit ID を埋める

差分マージするファイルだけに `Based on` を残す。上書きで配る版は `.pdh-lock` が持つ。Product Brief は初回の由来だけを記録し、更新時に本文を上書きしない。

<!-- pdh-shell: ancestry -->
```bash
COMMIT_ID=$(git -C tmp/pdh rev-parse --short=7 HEAD)
python3 - "$COMMIT_ID" <<'SUBSTITUTE'
from pathlib import Path
import re,sys
for name in ('AGENTS.md', 'product-brief.md', '.ticket-config.yaml', 'scripts/checks/example-max-source-lines.check', 'scripts/checks/example-max-test-lines.check'):
    p=Path(name)
    if p.is_file():p.write_text(re.sub(r'/blob/(XXXXXXX|[0-9a-f]{7})/', '/blob/'+sys.argv[1]+'/', p.read_text()))
SUBSTITUTE
```

#### 4. project 固有ファイルを編集する

`PDH-AGENTS.md` と `.agents/skills/pdh-*` は PDH 共通配布物として扱い、project 固有の規則は `AGENTS.md` に書く。

- `AGENTS.md` のディレクトリ構造、テストコマンド、実装上の制約を埋める
- `.ticket-config.yaml` の branch と worktree 設定を project に合わせる
- `scripts/test-all.sh` に実際の全テストコマンドを登録する
- `scripts/dev-server.sh` と `scripts/seed-pdh-verify.sh` に実際の verify 環境を実装する

環境固有で commit できない指示には、gitignore した `AGENTS.local.md` を使える。secret の値は書かず、取得方法や保管場所だけを書く。必要なら `AGENTS.local.md.example` をコピーして作る。

```bash
grep -qxF 'AGENTS.local.md' .gitignore || printf '\nAGENTS.local.md\n' >> .gitignore
```

#### 5. 導入結果を検査する

<!-- pdh-shell: verify -->
```bash
bash scripts/pdh-lock.sh write --upstream tmp/pdh --map tmp/pdh/codex/lock-map.tsv
bash scripts/pdh-lock.sh check
bash scripts/fast-checks.sh
```


```bash
test -f AGENTS.md
test -f PDH-AGENTS.md
for skill in pdh-change pdh-check-writing pdh-close pdh-decision-board pdh-implement pdh-open pdh-pm pdh-resume pdh-review pdh-ticket-review pdh-ticket-write pdh-update pdh-verify; do
  test -f ".agents/skills/$skill/SKILL.md" || exit 1
  test ! -L ".agents/skills/$skill" || exit 1
done
for agent in pdh-ac-reader pdh-ac-verifier pdh-coding-engineer pdh-qa pdh-reviewer-lens1 pdh-reviewer pdh-surface-observer; do
  test -f ".codex/agents/$agent.toml" || exit 1
done
bash -n ticket.sh scripts/test-all.sh scripts/fast-checks.sh scripts/dev-server.sh scripts/seed-pdh-verify.sh scripts/test-ticket-local.sh scripts/check-pdh-ticket.sh scripts/pdh-review-range.sh scripts/check-ticket-template-drift.sh
```

最後に `codex` を新しく起動し、`pdh-pm` と `pdh-update` が skill 一覧にあり、PDH worker が custom agent として選べることを確認する。

## 既存プロジェクトのアップデート

project 固有のファイルを保持し、配置表で「上書き」とした PDH 配布物を更新する。

### 1. 更新前の状態を保存する

作業 tree に未保存変更があれば先に commit する。次に配布元を取得し、更新対象の backup を作る。

<!-- pdh-shell: refresh -->
```bash
if [ -d tmp/pdh/.git ]; then
  git -C tmp/pdh fetch origin main
  git -C tmp/pdh checkout main
  git -C tmp/pdh merge --ff-only origin/main
else
  git clone https://github.com/masuidrive/pdh.git tmp/pdh
fi
```

<!-- pdh-shell: backup -->
```bash
PDH_BACKUP=$(mktemp -d tmp/pdh-backup.XXXXXX)
for path in AGENTS.md AGENTS.local.md product-brief.md .ticket-config.yaml .pdh-lock PDH-AGENTS.md scripts docs; do
  [ ! -e "$path" ] || cp -Rp "$path" "$PDH_BACKUP/"
done
[ ! -d .agents/skills ] || cp -Rp .agents/skills "$PDH_BACKUP/agents-skills"
[ ! -d .codex/agents ] || cp -Rp .codex/agents "$PDH_BACKUP/codex-agents"
printf 'backup: %s\n' "$PDH_BACKUP"
```

backup は `tmp/` 配下にあり、更新が正しいと確認するまで消さない。

### 2. 上流管理ファイルを更新する

<!-- pdh-shell: update -->
```bash
while IFS="$(printf '\t')" read -r source destination; do
  destination=${destination%/}
  mkdir -p "$(dirname "$destination")"
  if [ -d "tmp/pdh/$source" ]; then
    rm -rf "$destination"
    mkdir -p "$destination"
    cp -RL "tmp/pdh/$source/." "$destination/"
  else
    cp -p "tmp/pdh/$source" "$destination"
  fi
done < tmp/pdh/codex/lock-map.tsv
```

上の `rm -rf` は lock-map に列挙した PDH skill だけを置き換える。`.agents/skills/` 全体や、`pdh-` で始まらない user skill / agent 定義は削除しない。

github-bot レイヤーを導入済み（`.github/` 内に `_pdh.md` がある。改名前の配置も含む）なら、先に [改名手順](../github-bot/INSTALL.md#既知の移行手順-coding-robot-を-coding-bot-に改名する2026-09-27-以降)と同文書の「導入先固有の secret」を確認し、該当する移行と確認コマンドの再実行を行う。その後、PDH 保守分（下の 4 つ）も同じく上流の版で置き換える。

⚠ **残りの machinery は «diff してから» 反映する** — `.github/coding-bot/system.md` `_issue.md` `_pr.md` `run-action.sh` `engines/`、`.github/workflows/coding-bot*.yml`、`.devcontainer/`。**丸ごと上書きしない。**導入先はここを意図して変えていることがある（repo 固有の規則を書いた節・action の SHA 固定・timeout・既存 devcontainer とのマージ結果）。⚠ **2026-09-17 に所有者が変わってから、この節は «触らない» ではなくなった** — それまでは外部 repo からの vendoring で「この手順では触らない」ものだったので、導入先の書き足しも自動的に守られていた。**いまは守られない。**

```bash
if [ -f .github/coding-bot/_pdh.md ]; then
  cp tmp/pdh/github-bot/_pdh.md .github/coding-bot/_pdh.md
  cp tmp/pdh/github-bot/_github-issue.md .github/coding-bot/_github-issue.md
  cp tmp/pdh/github-bot/pdh-hooks.sh .github/coding-bot/pdh-hooks.sh
  rm -rf .codex/skills/pdh-gh-pull && cp -R tmp/pdh/github-bot/pdh-gh-pull .codex/skills/pdh-gh-pull
fi
```

上のコマンドは配置表の「上書き」の script・文書・check も毎回コピーする。「差分マージ」は project の値を保ち、「初回だけ」は既存の本文を保持する。新規の設定ファイルは既存設定へマージする。



### 3. project 固有ファイルを差分マージする

次のファイルは上書きしない。`git diff --no-index` で template と比較し、必要な上流変更だけを既存ファイルへ反映する。

- `AGENTS.md`
- `.ticket-config.yaml`
- `scripts/test-all.sh`
- `scripts/checks/` の「差分マージ」の check（有効化した文書 check は project 管理）
- `scripts/dev-server.sh`
- `scripts/seed-pdh-verify.sh`

`product-brief.md` は「初回だけ」とし、既存の本文を保持する。

例:

```bash
git diff --no-index -- AGENTS.md tmp/pdh/codex/templates/AGENTS.md || true
git diff --no-index -- .ticket-config.yaml tmp/pdh/codex/templates/.ticket-config.yaml || true
git diff --no-index -- scripts/test-all.sh tmp/pdh/codex/templates/test-all.sh || true
```

`.ticket-config.yaml` の `default_content` / `note_content` は新しい template と照合し、設定キーは project の値を保持する。`scripts/checks/required-pdh-files.check` の一覧は実際に配置したファイルへ合わせる。

### 既知の移行手順

#### Python 3.11 以降と PyYAML を用意する

既存の導入先は Python 3.11 以降と PyYAML を用意する。確かめ方:

<!-- pdh-shell: runtime-check -->
```bash
python3 -c 'import sys,yaml,tomllib; assert sys.version_info>=(3,11)'
```

#### 入口とテスト template の旧参照を直す

`AGENTS.md` の構造図は共有契約を `PDH-AGENTS.md`、用語を `docs/pdh-glossary.md` とする。`scripts/test-all.sh` の skill 参照を `pdh-verify` に直し、DB 接続変数の例は project が使う名前へ合わせる（template は `DATABASE_URL`）。`.ticket-config.yaml` の標準構造の参照は `pdh-ticket-write` に直す。project の本文と実際のテストコマンドは保持する。

確認（冪等）:

```bash
for path in AGENTS.md scripts/test-all.sh .ticket-config.yaml; do
  status=0
  grep -nE 'product-delivery-hierarchy\.md|pdh-dev|LLMHUB_DATABASE_URL' "$path" || status=$?
  [ "$status" -eq 1 ] || exit 1
done
```

#### 文書の frontmatter 検査を採用する場合

既定では `docs-metadata.check.example` / `docs-references.check.example` を配る。registry は `*.check` だけを実行する。採用する場合は `pdh-change`「文書を書くとき」に従って既存の `docs/**/*.md` と `specs/*.md` に frontmatter・読む入口を整えてから、次を実行する。有効な check は project 管理とし、更新時に上書きしない。

<!-- pdh-shell: docs-opt-in -->
```bash
for name in docs-metadata docs-references; do
  test -f "scripts/checks/$name.check" || cp "scripts/checks/$name.check.example" "scripts/checks/$name.check"
done
bash scripts/fast-checks.sh
```

採用済みの確認（冪等）: `test -f scripts/checks/docs-metadata.check && test -f scripts/checks/docs-references.check`。close 前の文書レビューは、どちらかの有効な check がある場合に行う。旧版が `.check` として配置したものは、採用しない場合に限り backup してその 2 ファイルを削除する。

#### PDH の stage skill・worker 定義・lock への組み直し

旧 `pdh-dev` は `pdh-pm` と stage ごとの skill に、`pdh-rule-write` は `pdh-change` に、`pdh-coding` / `pdh-reviewing` / `pdh-verifying` は worker 定義に移った。`pdh-resume` と `pdh-pm/_open-ticket.md` も配る。配置表の全件を更新し、旧名だけを削除する。

```bash
for skill in pdh-dev pdh-coding pdh-reviewing pdh-verifying pdh-rule-write; do
  rm -rf ".agents/skills/$skill"
done
rm -rf .claude/skills/tmux-director .agents/skills/tmux-director
rm -f scripts/hookbus.js
```

`.claude/settings.json` の hookbus の呼び出しだけを外し、他の hook は保つ。`vitest.config.*` の hookbus project と `package.json` / `test-all.sh` の専用段も外す。SessionStart は配布した `pdh-session-hook.sh` の設定へ統合し、session を再起動する。

旧 `docs/product-delivery-hierarchy.md` の規則は `PDH-AGENTS.md` と stage skill へ集約した。project の追記を移してから旧配布文書を削除する。

`technical-reference.md` は配布しない。現行の事実をコードのコメント・テスト・仕様書へ、ソースから作れない外の事実・人の意図と方針を project の文書へ移してから廃止する。本文が残る間は退避し、内容を読まずに消さない。

`.ticket-config.yaml` のテンプレ本文を新しいものへ揃え、`worktree_mode: true`・`pre_close_command`・`require_checklist_groups: [Required-Probes, Checklist]` を確認する。Why の 3 ラベル、contract check の Feasibility / DB-changes / API-changes / Complexity / Benefit、AC と Out-of-scope の `AC-approved:`、Open-Questions の checkbox を取り込む。旧 Why ラベル・旧 Status 書式は受け付けない。

未完の note の旧 `## Status` の段に checkbox がある場合、各行を印・本文・skip 理由ごと `## Checklist` へ移し、Status を `## Status: PDH-<stage>` の 1 行へ直す。旧 Resume Point の必要な現在値は Checklist / Open-Questions へ、経緯は progress へ移してから節を消す。`pdh-resume` と `pdh-stage-checklist.sh --show` で現在の段を確認し、`bash scripts/pdh-stage-checklist.sh <stage> --enter <note>` でその段の行を写す。AC の内容を変える場合は人の再承認を得てから hash を書く。done の記録は移さない。

初回の `.pdh-lock` は、上書きの全件を配布元と一致させてから書く。上書き対象の `Based on` 行は消し、差分マージの footer は残す。

<!-- pdh-shell: migration-check -->
```bash
bash scripts/pdh-lock.sh write --upstream tmp/pdh --map tmp/pdh/codex/lock-map.tsv
bash scripts/pdh-lock.sh check
test -f .agents/skills/pdh-resume/SKILL.md
test -f .agents/skills/pdh-pm/_open-ticket.md
grep -q '^worktree_mode: true' .ticket-config.yaml
grep -q '^pre_close_command:' .ticket-config.yaml
grep -q 'Key-User-Journeys:' .ticket-config.yaml
grep -q 'Reproduction-or-measurement:' .ticket-config.yaml
grep -q 'Why-not-fix-now:' .ticket-config.yaml
grep -q 'AC-approved:' .ticket-config.yaml
! grep -q 'Resume Point' .ticket-config.yaml
for skill in pdh-dev pdh-coding pdh-reviewing pdh-verifying pdh-rule-write; do
  test ! -e ".agents/skills/$skill" || exit 1
done
for path in .claude/settings.json scripts/test-all.sh package.json vitest.config.*; do
  [ -f "$path" ] || continue
  status=0
  grep -n 'hookbus' "$path" || status=$?
  [ "$status" -eq 1 ] || exit 1
done
bash scripts/check-ticket-template-drift.sh --upstream-file tmp/pdh/codex/templates/.ticket-config.yaml
```

上の確認を更新後に再実行する。同じ移行を 2 回行っても差分は出ない。review 集計は `pdh-review-tally.sh`、評価は `pdh-review-eval.sh --help` と `docs/pdh-review-eval/README.md` を読む。評価データは project が集め、実 engine での計測は CI に入れない。

#### worker の混雑時の自動再開を導入する

`scripts/spawn-worker.sh` は現在は配置表の上書き対象である。旧導入先も共有版へ揃える。適用済みかの確認（冪等）:

```bash
grep -q PDH_CODEX_RESUME_MAX scripts/spawn-worker.sh 2>/dev/null && echo "worker 自動再開: 適用済み" || echo "worker 自動再開: 要適用"
```

「要適用」なら、既存ファイルを backup してから次を実行する。既に自動再開がある場合も、上流との差分を確認して今回の修正を反映する。旧版の project 固有変更は project 側の別 script へ移してから共有版へ揃える。

```bash
mkdir -p scripts
cp tmp/pdh/codex/templates/spawn-worker.sh scripts/spawn-worker.sh
chmod +x scripts/spawn-worker.sh
```

適用後に確認コマンドを再実行する。同じ版を再度コピーしても差分は出ない。

### 3.5 close 済みでない ticket

close 済みでない（todo / doing）ticket は、見出しの改名など AC の中身に触れない変更だけを一括で揃える。**AC の書き方が変わっても、AC は一括で書き直さない** — その ticket に着手するときの `PDH-ticket-review` で 1 件ずつ直し、`PDH-ticket-human-review` で承認を受ける（`PDH-AGENTS.md`「Stage Flow」）。`tickets/done/` は触らない。

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
  if [ -f CLAUDE.md ]; then cp -p CLAUDE.md AGENTS.md; else cp tmp/pdh/codex/templates/AGENTS.md AGENTS.md; fi
fi
if [ -f CLAUDE.md ]; then git diff --no-index -- CLAUDE.md AGENTS.md || true; fi
git diff --no-index -- AGENTS.md tmp/pdh/codex/templates/AGENTS.md || true
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

末尾の `Based on` は `codex/templates/AGENTS.md` を指す行へ更新する。旧 `templates/CLAUDE.md` を指す footer は残さない。

### 3. Codex ネイティブ配置へ更新する

[既存プロジェクトのアップデート](#既存プロジェクトのアップデート)を最後まで実行する。`.agents/skills/<name>` が旧 symlink の場合も、列挙した PDH skill だけが実ディレクトリへ置換される。

### 4. 旧 PDH 配布物だけを退役させる

新配置でテストが通り、backup が存在することを確認してから、旧 PDH skill と agent 定義を名前を指定して削除する。

```bash
for skill in pdh-dev pdh-coding pdh-reviewing pdh-verifying pdh-rule-write pdh-change pdh-check-writing pdh-close pdh-decision-board pdh-implement pdh-open pdh-pm pdh-resume pdh-review pdh-ticket-review pdh-ticket-write pdh-update pdh-verify; do
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
test ! -L .agents/skills/pdh-pm
test -f .agents/skills/pdh-pm/SKILL.md
test -f .codex/agents/pdh-coding-engineer.toml
find .claude/skills .claude/agents -maxdepth 1 -name 'pdh-*' -print 2>/dev/null
```

最後の `find` が何か表示した場合は、backup と照合して PDH 配布物か user の同名カスタマイズかを判断する。自動では削除しない。

## pdh-update skill

導入後は Codex に「pdh-update」と指示すると、`.agents/skills/pdh-update/SKILL.md` がこの更新手順を実行する。更新結果には backup path、反映した migration、2 回目の冪等性確認、テスト結果を含める。
