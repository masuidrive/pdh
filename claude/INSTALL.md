# PDH セットアップガイド

Claude Code 用配布セット。Codex 単独導入は [codex/INSTALL.md](../codex/INSTALL.md)、概要は [README](../README.md) を読む。

## 前提

Python 3.11 以降と PyYAML（文書・生成の検査と Codex の worker 起動が使う）を用意する。

## 新規導入

### 方法 1: coding agent に任せる

project の root で「https://github.com/masuidrive/pdh の claude/INSTALL.md を読んで、この project に PDH を導入して」と依頼する。

### 方法 2: 手動でセットアップ

<!-- pdh-shell: prepare -->
```bash
git clone https://github.com/masuidrive/pdh.git tmp/pdh
curl -sL https://raw.githubusercontent.com/masuidrive/ticket.sh/main/ticket.sh -o ticket.sh
chmod +x ticket.sh
```

### ファイルを配置する

配置先が既にある project は、下の更新手順に従う。表のディレクトリは中の全ファイルをコピーする。自前の skill・agent・check は消さない。

| コピー元 | コピー先 | 用途 | 更新の仕方 |
|---|---|---|---|
| `tmp/pdh/docs/PDH-AGENTS.md` | `PDH-AGENTS.md` | PDH の共通契約・用語 | 上書き |
| `tmp/pdh/docs/pdh-glossary.md` | `docs/pdh-glossary.md` | PDH の共通契約・用語 | 上書き |
| `tmp/pdh/claude/skills/pdh-change/` | `.claude/skills/pdh-change/` | pdh-change skill（分冊・kit・tools を含む） | 上書き |
| `tmp/pdh/claude/skills/pdh-check-writing/` | `.claude/skills/pdh-check-writing/` | pdh-check-writing skill（分冊・kit・tools を含む） | 上書き |
| `tmp/pdh/claude/skills/pdh-close/` | `.claude/skills/pdh-close/` | pdh-close skill（分冊・kit・tools を含む） | 上書き |
| `tmp/pdh/claude/skills/pdh-decision-board/` | `.claude/skills/pdh-decision-board/` | pdh-decision-board skill（分冊・kit・tools を含む） | 上書き |
| `tmp/pdh/claude/skills/pdh-implement/` | `.claude/skills/pdh-implement/` | pdh-implement skill（分冊・kit・tools を含む） | 上書き |
| `tmp/pdh/claude/skills/pdh-open/` | `.claude/skills/pdh-open/` | pdh-open skill（分冊・kit・tools を含む） | 上書き |
| `tmp/pdh/claude/skills/pdh-pm/` | `.claude/skills/pdh-pm/` | pdh-pm skill（分冊・kit・tools を含む） | 上書き |
| `tmp/pdh/claude/skills/pdh-resume/` | `.claude/skills/pdh-resume/` | pdh-resume skill（分冊・kit・tools を含む） | 上書き |
| `tmp/pdh/claude/skills/pdh-review/` | `.claude/skills/pdh-review/` | pdh-review skill（分冊・kit・tools を含む） | 上書き |
| `tmp/pdh/claude/skills/pdh-ticket-review/` | `.claude/skills/pdh-ticket-review/` | pdh-ticket-review skill（分冊・kit・tools を含む） | 上書き |
| `tmp/pdh/claude/skills/pdh-ticket-write/` | `.claude/skills/pdh-ticket-write/` | pdh-ticket-write skill（分冊・kit・tools を含む） | 上書き |
| `tmp/pdh/claude/skills/pdh-update/` | `.claude/skills/pdh-update/` | pdh-update skill（分冊・kit・tools を含む） | 上書き |
| `tmp/pdh/claude/skills/pdh-verify/` | `.claude/skills/pdh-verify/` | pdh-verify skill（分冊・kit・tools を含む） | 上書き |
| `tmp/pdh/claude/templates/.ticket-config.yaml` | `.ticket-config.yaml` | project の設定・入口テンプレート | 差分マージ |
| `tmp/pdh/claude/templates/AGENTS.md` | `AGENTS.md` | project の設定・入口テンプレート | 差分マージ |
| `tmp/pdh/claude/templates/CLAUDE.local.md.example` | `CLAUDE.local.md.example` | project の設定・入口テンプレート | 初回だけ |
| `tmp/pdh/claude/templates/CLAUDE.md` | `CLAUDE.md` | project の設定・入口テンプレート | 差分マージ |
| `tmp/pdh/claude/templates/agents/claude/pdh-ac-reader.md` | `.claude/agents/pdh-ac-reader.md` | PDH worker の役割定義 | 上書き |
| `tmp/pdh/claude/templates/agents/claude/pdh-ac-verifier.md` | `.claude/agents/pdh-ac-verifier.md` | PDH worker の役割定義 | 上書き |
| `tmp/pdh/claude/templates/agents/claude/pdh-coding-engineer.md` | `.claude/agents/pdh-coding-engineer.md` | PDH worker の役割定義 | 上書き |
| `tmp/pdh/claude/templates/agents/claude/pdh-qa.md` | `.claude/agents/pdh-qa.md` | PDH worker の役割定義 | 上書き |
| `tmp/pdh/claude/templates/agents/claude/pdh-reviewer-lens1.md` | `.claude/agents/pdh-reviewer-lens1.md` | PDH worker の役割定義 | 上書き |
| `tmp/pdh/claude/templates/agents/claude/pdh-reviewer.md` | `.claude/agents/pdh-reviewer.md` | PDH worker の役割定義 | 上書き |
| `tmp/pdh/claude/templates/agents/claude/pdh-surface-observer.md` | `.claude/agents/pdh-surface-observer.md` | PDH worker の役割定義 | 上書き |
| `tmp/pdh/claude/templates/agents/codex/pdh-ac-reader.toml` | `.codex/agents/pdh-ac-reader.toml` | PDH worker の役割定義 | 上書き |
| `tmp/pdh/claude/templates/agents/codex/pdh-ac-verifier.toml` | `.codex/agents/pdh-ac-verifier.toml` | PDH worker の役割定義 | 上書き |
| `tmp/pdh/claude/templates/agents/codex/pdh-coding-engineer.toml` | `.codex/agents/pdh-coding-engineer.toml` | PDH worker の役割定義 | 上書き |
| `tmp/pdh/claude/templates/agents/codex/pdh-qa.toml` | `.codex/agents/pdh-qa.toml` | PDH worker の役割定義 | 上書き |
| `tmp/pdh/claude/templates/agents/codex/pdh-reviewer-lens1.toml` | `.codex/agents/pdh-reviewer-lens1.toml` | PDH worker の役割定義 | 上書き |
| `tmp/pdh/claude/templates/agents/codex/pdh-reviewer.toml` | `.codex/agents/pdh-reviewer.toml` | PDH worker の役割定義 | 上書き |
| `tmp/pdh/claude/templates/agents/codex/pdh-surface-observer.toml` | `.codex/agents/pdh-surface-observer.toml` | PDH worker の役割定義 | 上書き |
| `tmp/pdh/claude/templates/check-pdh-ticket.sh` | `scripts/check-pdh-ticket.sh` | 共有 script | 上書き |
| `tmp/pdh/claude/templates/check-ticket-template-drift.sh` | `scripts/check-ticket-template-drift.sh` | 共有 script | 上書き |
| `tmp/pdh/claude/templates/checks/README.md` | `scripts/checks/README.md` | fast-check の定義・見本（project の独自 check は保持） | 上書き |
| `tmp/pdh/claude/templates/checks/bin/pdh-stage-skill-sections.sh` | `scripts/checks/bin/pdh-stage-skill-sections.sh` | fast-check の定義・見本（project の独自 check は保持） | 上書き |
| `tmp/pdh/claude/templates/checks/docs-metadata.check` | `scripts/checks/docs-metadata.check.example` | fast-check の定義・見本（project の独自 check は保持） | 上書き |
| `tmp/pdh/claude/templates/checks/docs-references.check` | `scripts/checks/docs-references.check.example` | fast-check の定義・見本（project の独自 check は保持） | 上書き |
| `tmp/pdh/claude/templates/checks/example-max-source-lines.check` | `scripts/checks/example-max-source-lines.check` | fast-check の定義・見本（project の独自 check は保持） | 差分マージ |
| `tmp/pdh/claude/templates/checks/example-max-test-lines.check` | `scripts/checks/example-max-test-lines.check` | fast-check の定義・見本（project の独自 check は保持） | 差分マージ |
| `tmp/pdh/claude/templates/checks/example-no-merge-conflict-markers.check` | `scripts/checks/example-no-merge-conflict-markers.check` | fast-check の定義・見本（project の独自 check は保持） | 差分マージ |
| `tmp/pdh/claude/templates/checks/example-no-node-p-capture.check` | `scripts/checks/example-no-node-p-capture.check` | fast-check の定義・見本（project の独自 check は保持） | 差分マージ |
| `tmp/pdh/claude/templates/checks/pdh-stage-skill-sections.check` | `scripts/checks/pdh-stage-skill-sections.check` | fast-check の定義・見本（project の独自 check は保持） | 上書き |
| `tmp/pdh/claude/templates/checks/required-pdh-files.check` | `scripts/checks/required-pdh-files.check` | fast-check の定義・見本（project の独自 check は保持） | 差分マージ |
| `tmp/pdh/claude/templates/dev-server.sh` | `scripts/dev-server.sh` | project の設定・入口テンプレート | 差分マージ |
| `tmp/pdh/claude/templates/docs-policy.py` | `scripts/docs-policy.py` | 共有 script | 上書き |
| `tmp/pdh/claude/templates/docs-toc.sh` | `scripts/docs-toc.sh` | 共有 script | 上書き |
| `tmp/pdh/claude/templates/fast-checks.sh` | `scripts/fast-checks.sh` | 共有 script | 上書き |
| `tmp/pdh/claude/templates/gen-agents-md.sh` | `scripts/gen-agents-md.sh` | 共有 script | 上書き |
| `tmp/pdh/claude/templates/gen-codex-agents.sh` | `scripts/gen-codex-agents.sh` | 共有 script | 上書き |
| `tmp/pdh/claude/templates/hooks.json` | `.codex/hooks.json` | SessionStart の hook を既存設定へ統合 | 差分マージ |
| `tmp/pdh/claude/templates/pdh-lock.sh` | `scripts/pdh-lock.sh` | 共有 script | 上書き |
| `tmp/pdh/claude/templates/pdh-related-docs.sh` | `scripts/pdh-related-docs.sh` | 共有 script | 上書き |
| `tmp/pdh/claude/templates/pdh-review-eval/` | `docs/pdh-review-eval/` | project の評価データと実測結果の書き方。空の case 一覧 | 初回だけ |
| `tmp/pdh/claude/templates/pdh-review-eval.sh` | `scripts/pdh-review-eval.sh` | 共有 script | 上書き |
| `tmp/pdh/claude/templates/pdh-review-range.sh` | `scripts/pdh-review-range.sh` | 共有 script | 上書き |
| `tmp/pdh/claude/templates/pdh-review-tally.sh` | `scripts/pdh-review-tally.sh` | 共有 script | 上書き |
| `tmp/pdh/claude/templates/pdh-session-hook.sh` | `scripts/pdh-session-hook.sh` | 共有 script | 上書き |
| `tmp/pdh/claude/templates/pdh-stage-checklist.sh` | `scripts/pdh-stage-checklist.sh` | 共有 script | 上書き |
| `tmp/pdh/claude/templates/pdh-verify-lib.sh` | `scripts/pdh-verify-lib.sh` | 共有 script | 上書き |
| `tmp/pdh/claude/templates/product-brief.md` | `product-brief.md` | project の設定・入口テンプレート | 初回だけ |
| `tmp/pdh/claude/templates/seed-pdh-verify.sh` | `scripts/seed-pdh-verify.sh` | project の設定・入口テンプレート | 差分マージ |
| `tmp/pdh/claude/templates/settings.json` | `.claude/settings.json` | SessionStart の hook を既存設定へ統合 | 差分マージ |
| `tmp/pdh/claude/templates/spawn-worker.sh` | `scripts/spawn-worker.sh` | 共有 script | 上書き |
| `tmp/pdh/claude/templates/test-all.sh` | `scripts/test-all.sh` | project の設定・入口テンプレート | 差分マージ |
| `tmp/pdh/claude/templates/test-ticket-local.sh` | `scripts/test-ticket-local.sh` | 共有 script | 上書き |
| `tmp/pdh/claude/templates/checks/required-pdh-source-files.check` | `scripts/checks/required-pdh-source-files.check` | PDH の共有 script と PM の分冊の存在 | 差分マージ |

新規導入では次を実行する。更新時は下の更新手順を使う。

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
done < tmp/pdh/claude/lock-map.tsv
for name in .ticket-config.yaml AGENTS.md product-brief.md CLAUDE.md CLAUDE.local.md.example; do
  [ -e "$name" ] || cp "tmp/pdh/claude/templates/$name" "$name"
done
for name in dev-server.sh seed-pdh-verify.sh test-all.sh; do
  [ -e "scripts/$name" ] || cp "tmp/pdh/claude/templates/$name" "scripts/$name"
done
for name in example-max-source-lines example-max-test-lines example-no-merge-conflict-markers example-no-node-p-capture required-pdh-files required-pdh-source-files; do
  [ -e "scripts/checks/$name.check" ] || cp "tmp/pdh/claude/templates/checks/$name.check" "scripts/checks/$name.check"
done
python3 - <<'MERGE_HOOKS'
import json
from pathlib import Path

for source, destination in [('tmp/pdh/claude/templates/hooks.json', '.codex/hooks.json'), ('tmp/pdh/claude/templates/settings.json', '.claude/settings.json')]:
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
[ -e docs/pdh-review-eval ] || cp -R tmp/pdh/claude/templates/pdh-review-eval docs/pdh-review-eval
chmod +x scripts/*.sh
bash ticket.sh init
```

既存の差分マージ・初回だけのファイルは保持する。template と比較して必要な項目を差分マージしてから検査する。上の JSON マージは既存の権限・hook と設定値を残し、PDH の SessionStart hook だけを重複なく追加する。

設定の JSON は既存設定へマージする。`settings.json` は PM の session 開始・再開・compact で stage と未了行を context へ戻す。worker には `PDH_ROLE=<役割>` を渡す。Codex の hook を使う場合は `.codex/hooks.json` の信頼設定も確認し、実際の session で表示を確かめる。

#### Codex CLI を使う場合: skill を symlink する

Claude 併用では `.claude/skills/` に実体を 1 つ置く。

<!-- pdh-shell: symlinks -->
```bash
mkdir -p .agents/skills
for source in tmp/pdh/claude/skills/pdh-*; do
  skill=${source##*/}
  ln -snf "../../.claude/skills/$skill" ".agents/skills/$skill"
done
```

Claude 併用で `AGENTS.md` を生成する共有 script は `.codex/config.toml` の上限を読む。初回は次で設定を作り、既存の設定がある場合はその値を保持する。

<!-- pdh-shell: config -->
```bash
mkdir -p .codex
if [ ! -f .codex/config.toml ]; then
  printf 'project_doc_max_bytes = 131072\n' > .codex/config.toml
fi
```

#### project 固有の設定

- `CLAUDE.md` に project の規則・テスト環境・PM の規則を置くファイル・worker の割り当て・受け渡し経路を書く。`PDH-AGENTS.md` と共有 skill は書き換えない
- `.ticket-config.yaml` の branch、push、worktree の設定を project に合わせる。`worktree_mode: true` が既定。`post_start_command` は project に必要なら設定する
- `scripts/test-all.sh` に製品の全スイートを登録する。`check-pdh-ticket.sh` も 1 段に残す。`dev-server.sh` と `seed-pdh-verify.sh` は実環境へ合わせる
- `product-brief.md` の全節を人と埋める。まだ決めていないものは未決と書く。既存の Product Brief の本文は更新で上書きしない
- 個人の環境は gitignore した `CLAUDE.local.md` へ置き、secret の値は書かない。Grok Build は gitignore した context を読まないため、必要ならその engine の規則の入口へ置く

#### 版を記録して検査する

差分マージのファイルにある `Based on` の `XXXXXXX` だけを取り込んだ commit に置換する。上書きするファイルの版は `.pdh-lock` に記録する。

<!-- pdh-shell: verify -->
```bash
bash scripts/pdh-lock.sh write --upstream tmp/pdh --map tmp/pdh/claude/lock-map.tsv
bash scripts/pdh-lock.sh check
bash scripts/fast-checks.sh
bash scripts/check-ticket-template-drift.sh --upstream-file tmp/pdh/claude/templates/.ticket-config.yaml
bash scripts/test-all.sh
./ticket.sh list
```

`pdh-pm` と `pdh-resume` が認識されることを session で確かめる。配置と移行の検査が終わるまで `tmp/pdh` は残す。完了後に消してよい。

## 既存プロジェクトのアップデート

### 手順

1. 作業ツリーを commit し、現在の skill・agent・設定・script・`.pdh-lock` を backup する。`tmp/pdh` を fetch / fast-forward して最新の main にする（なければ clone）
2. `.pdh-lock` の upstream SHA と差分マージ対象の `Based on` から旧版を特定する。上流の旧版・最新版・導入先の 3 点を比較し、導入先だけの変更を失わない形で反映する
3. 配置表の「上書き」は名前を列挙した PDH ファイルだけを毎回置き換える。ディレクトリを置き換える前に backup を残す。「差分マージ」は project の値と独自の節を保持する。「初回だけ」は欠けたときだけ作る
4. `.ticket-config.yaml` は `default_content` と `note_content` を現行 template と一致させる。独自の節がある場合は差分マージして相違を報告する。固有設定（tickets_dir、default_branch、branch_prefix、repository、auto_push、delete_remote_on_close、worktree_copy_files、post_start_command、各 success_message）は戻す。トップレベルの `require_checklist`・`require_checklist_groups`・`pre_close_command`・`ticket_files`・`append_only_files` も個別に確認する
5. `required-pdh-files.check` を配置した skill・agent の一覧に合わせ、symlink も更新する。project が使わないと明示して外した項目は復活させない。新設された script と hook の配線を忘れない
6. [既知の移行手順](#既知の移行手順)の全項目を確認する。未完の ticket だけを移行し、`tickets/done/` は歴史記録として保持する。AC と Out-of-scope の内容は一括変更しない。着手時の ticket review と人の承認で直す
7. `bash ./ticket.sh selfupdate` し、`./ticket.sh list` で確かめる。coding-bot 導入済みなら [github-bot/INSTALL.md](../github-bot/INSTALL.md) の更新・改名・secret の手順も適用する。共有プロトコルは上書きし、workflow・devcontainer の project の設定は差分を読んで保持する
8. 「版を記録して検査する」のコマンドを回す。`pdh-lock.sh write` は全件一致しなければ既存 lock を保って止まる。差分マージしていない変更があればそのファイルの `Based on` を進めない
9. 移行確認コマンドを再実行し、要適用が残れば直す。同じ手順の 2 回目に差分が出ないことを確認する。backup の場所・反映した項目・相違・各検査の終了コードと実出力を報告する

### backup と上書き対象の更新コマンド

手順 1 の配布元更新・backup は次で行う。手順 3 の上書きは lock-map に列挙した対象だけを置き換える。差分マージ・初回だけのファイルは表の方針に従う。

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
for path in AGENTS.md AGENTS.local.md product-brief.md .ticket-config.yaml .pdh-lock PDH-AGENTS.md scripts docs CLAUDE.md CLAUDE.local.md; do
  [ ! -e "$path" ] || cp -Rp "$path" "$PDH_BACKUP/"
done
[ ! -d .agents/skills ] || cp -Rp .agents/skills "$PDH_BACKUP/agents-skills"
[ ! -d .codex/agents ] || cp -Rp .codex/agents "$PDH_BACKUP/codex-agents"
[ ! -d .claude/skills ] || cp -Rp .claude/skills "$PDH_BACKUP/claude-skills"
[ ! -d .claude/agents ] || cp -Rp .claude/agents "$PDH_BACKUP/claude-agents"
printf 'backup: %s\n' "$PDH_BACKUP"
```

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
done < tmp/pdh/claude/lock-map.tsv
```

### 既知の移行手順

#### Python 3.11 以降と PyYAML を用意する

既存の導入先は Python 3.11 以降と PyYAML を用意する。確かめ方:

<!-- pdh-shell: runtime-check -->
```bash
python3 -c 'import sys,yaml,tomllib; assert sys.version_info>=(3,11)'
```

#### 入口とテスト template の旧参照を直す

`CLAUDE.md` の構造図は共有契約を `PDH-AGENTS.md`、用語を `docs/pdh-glossary.md` とする。`scripts/test-all.sh` の skill 参照を `pdh-verify` に直し、DB 接続変数の例は project が使う名前へ合わせる（template は `DATABASE_URL`）。`.ticket-config.yaml` の標準構造の参照は `pdh-ticket-write` に直す。project の本文と実際のテストコマンドは保持する。

確認（冪等）:

```bash
for path in CLAUDE.md scripts/test-all.sh .ticket-config.yaml; do
  status=0
  grep -nE 'product-delivery-hierarchy\.md|pdh-dev' "$path" || status=$?
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
  rm -rf ".claude/skills/$skill"
  rm -f ".agents/skills/$skill"
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
pdh_migration_status=0
pdh_check() {
  local item=$1
  shift
  if "$@"; then
    printf '済: %s\n' "$item"
  else
    printf '要適用: %s\n' "$item"
    pdh_migration_status=1
  fi
}
pdh_absent() {
  local status=0
  grep -n "$@" || status=$?
  [ "$status" -eq 1 ]
}
pdh_no_path() {
  [ ! -e "$1" ] && [ ! -L "$1" ]
}
pdh_check ".pdh-lock の更新" bash scripts/pdh-lock.sh write --upstream tmp/pdh --map tmp/pdh/claude/lock-map.tsv
pdh_check ".pdh-lock の照合" bash scripts/pdh-lock.sh check
pdh_check ".claude/skills/pdh-resume/SKILL.md" test -f ".claude/skills/pdh-resume/SKILL.md"
pdh_check ".claude/skills/pdh-pm/_open-ticket.md" test -f ".claude/skills/pdh-pm/_open-ticket.md"
pdh_check ".ticket-config.yaml worktree_mode: true" grep -q "^worktree_mode: true" .ticket-config.yaml
pdh_check ".ticket-config.yaml pre_close_command:" grep -q "^pre_close_command:" .ticket-config.yaml
pdh_check ".ticket-config.yaml Key-User-Journeys:" grep -q "Key-User-Journeys:" .ticket-config.yaml
pdh_check ".ticket-config.yaml Reproduction-or-measurement:" grep -q "Reproduction-or-measurement:" .ticket-config.yaml
pdh_check ".ticket-config.yaml Why-not-fix-now:" grep -q "Why-not-fix-now:" .ticket-config.yaml
pdh_check ".ticket-config.yaml AC-approved:" grep -q "AC-approved:" .ticket-config.yaml
pdh_check ".ticket-config.yaml Resume Point の撤去" pdh_absent "Resume Point" .ticket-config.yaml
for skill in pdh-dev pdh-coding pdh-reviewing pdh-verifying pdh-rule-write; do
  pdh_check "旧 skill .claude/skills/$skill の削除" pdh_no_path ".claude/skills/$skill"
done
for path in .claude/settings.json scripts/test-all.sh package.json vitest.config.*; do
  [ -f "$path" ] || continue
  pdh_check "$path の hookbus 呼び出し撤去" pdh_absent hookbus "$path"
done
pdh_check ".ticket-config.yaml の template 本文" bash scripts/check-ticket-template-drift.sh --upstream-file tmp/pdh/claude/templates/.ticket-config.yaml
exit "$pdh_migration_status"
```

上の確認を更新後に再実行する。同じ移行を 2 回行っても差分は出ない。review 集計は `pdh-review-tally.sh`、評価は `pdh-review-eval.sh --help` と `docs/pdh-review-eval/README.md` を読む。評価データは project が集め、実 engine での計測は CI に入れない。
