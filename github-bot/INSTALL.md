# github-bot レイヤー — 導入手順（任意）

PDH の **オプション**。GitHub Issue を «エンジニアとの会話面» にし、🤖 コメントで続きの処理を GitHub Actions 上の agent（[github-bots](https://github.com/masuidrive/github-bots) の coding-robot）に回す。**このレイヤーを入れなくても PDH core は完全に動く。** 入れるかは任意で、入れたプロジェクトだけが GitHub Actions を要求する。

これは core の `claude/INSTALL.md` / `codex/INSTALL.md` とは別経路。導入後は `pdh-update` が PDH 保守分（`_pdh.md` / `_github-issue.md` / `pdh-hooks.sh` / `pdh-gh-pull/`）を毎回上流の版で置き換える。machinery（`github-bot/.github/` と `github-bot/.devcontainer/`）も PDH が所有しているので、同じ更新で置き換わる。

## 前提

- PDH core が導入済み（`.claude/skills/pdh-dev/` か `.codex/skills/pdh-dev/` がある）。無ければ先に core を入れる。
- `gh` CLI が使えて、対象が GitHub repo であること。**このレイヤーでは `gh` を必須にする。**
- ticket.sh が 20260914.144516 以降であること（`new --branch` / `ticket_files` / `append_only_files`、ticket 自身の branch 上での `start`。`bash ./ticket.sh selfupdate`）。
- project root に `product-brief.md` と `tickets/` がある（bot はこれで PDH mode を判定する）。

## 1. ファイルを配置する

| コピー元（この repo） | コピー先（あなたの project） | 役割 |
|---|---|---|
| `github-bot/.github/` | `.github/` | workflow 2 本・coding-robot 一式（machinery） |
| `github-bot/.devcontainer/` | `.devcontainer/` | Actions が使う devcontainer。**既存の devcontainer があればマージ**（上書き前に diff を確認） |
| `github-bot/_pdh.md` | `.github/coding-robot/_pdh.md` | **PDH mode を定義する**（machinery 側には `_pdh.md` を置かない） |
| `github-bot/_github-issue.md` | `.github/coding-robot/_github-issue.md` | gate→issue プロトコル（cloud / local 共通） |
| `github-bot/pdh-hooks.sh` | `.github/coding-robot/pdh-hooks.sh` | runner hook。progress.md の作成・stage ラベル・承認導線・待ち行・導入検査を、agent の申告に依らず run の終わりに保証する（`run-action.sh` が呼ぶ） |
| `github-bot/pdh-gh-pull/` | `.claude/skills/pdh-gh-pull/`（Codex は `.codex/skills/pdh-gh-pull/`） | 「issue 読みに行く」skill。core skill と同じ流儀で symlink する場合はそれに合わせる |
| `github-bot/.ticket-config.snippet.yaml` の中身 | `.ticket-config.yaml` の末尾へ追記 | `github_bot:` 設定 |

`.gitignore` に `current-ticket.md` / `current-note.md`（作業ビュー symlink）が無ければ足す。

⚠ **`scripts/checks/required-pdh-files.check` に、このレイヤーの分を足す。**core の配布物にはこのレイヤーが入っていないので、**`pdh-gh-pull` が消えても誰も検出しない。**`required_paths=` へ次の 2 つを加える（Codex CLI を使わないなら symlink の行は省く）。

```
.claude/skills/pdh-gh-pull/SKILL.md
.agents/skills/pdh-gh-pull
```

## 1.5 既存の devcontainer とマージするとき

**守るのは «run が始まってから «道具が無い» と分かる状態にしないこと» である。**

配置表の `github-bot/.devcontainer/` は、**この bot が動くだけの最小構成**である（engine の CLI と `git` / `gh`）。⚠ **既に devcontainer を持っている repo では、上書きではなくマージになる** — そちらには repo の開発環境が入っているからである。マージしたあと、**次のものが container の中に在ることを確かめる。**

| 要るもの | 使う場所 | 無いとどうなるか |
|---|---|---|
| `claude` または `codex` | engine（`CODING_ROBOT_ENGINE` で選ぶ） | run が起動直後に失敗する |
| `gh` | `run-action.sh` と `pdh-hooks.sh`（コメント・ラベル・PR・CI） | 同上 |
| `jq` | `run-action.sh`（トリガーの解析・API 応答） | 同上 |
| `git` | branch・merge・push・差分 | 同上 |
| `python3` | 最終レポートのリンク書き換え | ⚠ **黙って飛ばす。**`command -v python3` で分岐しているのでエラーは出ず、**レポートのファイル名がただの文字列になる**だけ |
| **repo のテスト道具** | bot は scoped test を自分で回す | ⚠ **実装はできるのにテストが回らない run** になる。上流の既定 image は Node/TypeScript だけなので、Python・DB・ブラウザが要る repo は自分で足す |
| ブラウザ（任意） | スクリーンショット・実 surface 検証 | 撮れない。⚠ **これは «skill の掟» ではなく «container に入っているか» で決まる**（`_github-issue.md`）。headless Chromium / Playwright を足せば cloud bot が自分で画面を確かめられる |

⚠ **`workspaceFolder` は `/workspaces/project` のままにする。**`${localWorkspaceFolderBasename}`（repo 名）へ変えると、compose 側の `/workspaces/${LOCAL_WORKSPACE_FOLDER_BASENAME:-project}` が env 未設定で `project` へ落ちたときに食い違い、**`devcontainer exec` が «no such file or directory» で落ちる**（実測）。理由は `github-bot/ROBOT.md`。

確かめ方 — **導入直後に 1 回、container の中で見る。**

```bash
devcontainer exec --workspace-folder . bash -lc \
  'for c in git gh jq python3 claude codex; do printf "%-8s %s\n" "$c" "$(command -v $c || echo MISSING)"; done'
```

⚠ **engine は選んだほうだけ在ればよい**（`claude` か `codex`）。それ以外が `MISSING` なら、足してから 🤖 を打つ。

## 2. リポジトリ変数・secret を設定する

engine を選び、その認証を入れる。**基本はサブスク（購読ログイン）で運用する** — Claude は `CLAUDE_CODE_OAUTH_TOKEN`、Codex は `CODEX_AUTH_JSON`。**API key 課金（`OPENAI_API_KEY`）は既定で使わない**（使うのは明示的に選んだときだけ）。

```bash
# engine を選ぶ（claude か codex。未設定だと workflow は fail-fast する）
gh variable set CODING_ROBOT_ENGINE --body 'claude'     # or 'codex'

# 1 run の上限（秒）。既定 5400（90 分）。⚠ 実装 → review → verify → PR まで通す run は
# 70 分を超えることがあり、既定だと途中で殺される。長めに取るなら設定する
gh variable set CODING_ROBOT_TIMEOUT --body '10800'
```

engine 別の認証 secret:

- **claude**: `CLAUDE_CODE_OAUTH_TOKEN`（購読ログイン）
  ```bash
  gh secret set CLAUDE_CODE_OAUTH_TOKEN
  ```
- **codex**: `CODEX_AUTH_JSON`（ChatGPT プラン = 購読ログイン。**既定**）
  ```bash
  codex login && jq -c . ~/.codex/auth.json | gh secret set CODEX_AUTH_JSON
  ```
  ⚠ 同じアカウントの `auth.json` を手元の `codex` でも使うと、片方が refresh した時点でもう片方の refresh token が失効する（Actions 側が `refresh token was already used` で落ちる。smoke 実測）。落ちたら上のコマンドで secret を入れ直す。
  `OPENAI_API_KEY`（API 課金）という別路も machinery は受け付けるが、**この運用では使わない**。サブスク運用では `OPENAI_API_KEY` secret は設定しない（workflow が空で渡すのは無害）。

project 固有の env が要るテストがあるなら、まとめて 1 つの secret に:
```bash
gh secret set ENV_JSON --body '{"SOME_API_KEY":"...","BASE_URL":"..."}'
```

### Actions に PR 作成を許可する

close 承認後に bot が PR を作る（`_github-issue.md`「PR は `Refs`」）。既定の repo 設定では GitHub Actions は PR を作れず、`gh pr create` が `GitHub Actions is not permitted to create or approve pull requests` で落ちる（smoke 実測）。Settings → Actions → General → Workflow permissions の「Allow GitHub Actions to create and approve pull requests」を有効にする:

```bash
gh api -X PUT repos/<owner/repo>/actions/permissions/workflow -f default_workflow_permissions=write -F can_approve_pull_request_reviews=true
gh api repos/<owner/repo>/actions/permissions/workflow   # can_approve_pull_request_reviews が true なら適用済み
```

組織ポリシーで固定されている場合は管理者に依頼する。無効のままでも bot は blocker として停止し、人間が PR を作る手順を issue に書く。

ラベル（次節）と合わせて、導入検査を 1 回実行して「要追加」が無いことを確かめる（bot も run の終わりに同じ検査を行い、要追加があれば最終レポートに出す）:

```bash
bash .github/coding-robot/pdh-hooks.sh setup <owner/repo>
```

## 3. stage ラベルを作る

bot は stage 遷移で issue に PDH stage ラベルを付ける（status を Issues 一覧で見るため。Projects は使わない）。8 段のラベルを作っておく（gate の 2 つは amber で目立たせる）:

```bash
R=<owner/repo>
for s in open ticket-review implement review verify close; do
  gh label create "PDH-$s" --repo "$R" --color c5def5 --force
done
for s in ticket-human-review human-review; do          # gate は amber
  gh label create "PDH-$s" --repo "$R" --color fbca04 --force
done
```

未作成でも致命的ではない（bot はラベル更新を skip して本作業を続ける）が、gate 待ちの可視化には作っておく。

## 4. 使い方

- Issue / PR のコメントに **🤖**（または `:robot:`）を含めると Actions が発火し、coding-robot が PDH フローで動く。
- **human gate（`PDH-ticket-human-review` / `PDH-human-review`）では bot は自己承認せず、要点を issue にコメントして停止する。** 承認は **「🤖 承認」など 🤖 を含むコメント**で再開（⚠ Actions は reaction では起動しないので 👍 だけでは動かない。👍 は任意の印）。変更希望は 🤖 付きで返信。
- close 承認後は既定で bot が `ticket.sh close` で squash merge して issue を閉じる（PR は作らない）。PR を通したい repo は `.ticket-config.yaml` の `github_bot.close: pr`（snippet のコメント参照）。
- 端末で issue のコメントを拾いたいときは「issue 読んで」等と言えば `pdh-gh-pull` skill が取り込む。

## 5. 更新（再同期）

**coding-robot 一式は PDH が所有している**（`github-bot/ROBOT.md`）。machinery も PDH 保守分（`_pdh.md` / `_github-issue.md` / `pdh-hooks.sh` / `pdh-gh-pull`）も、`pdh-update` がこの repo の版を再配置する（手動なら「1. ファイルを配置する」の行をコピーし直す）。⚠ **外部 repo との再同期はもう無い** — 2026-09-17 に github-bots からの取り込みをやめ、`github-bot/` 配下が直す場所になった。

## 任意: 人のクリックを 1 回にする（`ATTACHMENTS_TOKEN`）

`github_bot.close: pr-merge` を使うとき、**この secret があるかどうかで人の手数が変わる。**

| | 人が押す回数 |
|---|---|
| `ATTACHMENTS_TOKEN` あり | **1**（Merge だけ） |
| 無し | **2**（Approve and run → Merge） |

⚠ **理由**: `GITHUB_TOKEN` が作った PR / 押した push では、`pull_request` と `synchronize` の
workflow が **`action_required`（承認待ち）**になり、**人が «Approve and run» を押すまで走らない。**
人の PAT で作れば作者・push 主が人になるので、**CI は自動で走る。**

```bash
gh secret set ATTACHMENTS_TOKEN --repo <owner>/<repo>
```

⚠ **この token は Issue の添付ファイル取得にも使われる**（`GITHUB_TOKEN` では取れない既知制約）。
⚠ **repo scope の classic PAT を admin が発行すると、default branch の保護を bypass できる資格が
agent の環境に入ることになる。**読み取りだけで足りるなら、**権限を絞った token を使うこと。**

## 必要なラベル

stage ラベル 8 段（`PDH-open` … `PDH-close`）に加えて、**`awaiting-reply`** を作る。

```bash
gh label create awaiting-reply --color d93f0b \
  --description "bot が人の答えを待って止まっている（stage ラベルと同時に付く）"
```

⚠ **stage ラベルは «どこにいるか» しか言わない。**gate でない場所で止まったとき（非収束・blocker・
質問・認証失敗）に «自分の番か» を一覧から見分けるのがこのラベルである。無い repo では hook が
skip し、最終レポートの「導入検査で要追加」に出る。

## 既に CI がある repo — 同じ commit を 2 回走らせていないか確かめる

**守るのは «bot が回す CI が、既存 CI と二重にならないこと» である。**

bot は自分でフルスイートを回さない。⚠ **回すのは repo の既存 CI で、bot はその緑を待つだけである。**
そのため、**既存 CI の trigger 次第で同じ commit が 2 回走る。**

```yaml
on:
  pull_request:          # ← bot が作った PR で走る
  push:
    branches: [main, "agent/issue-*"]   # ← 同じ commit の push でも走る
```

この形だと、bot の push 1 回につき **`push` 側と `pull_request` 側の 2 本**が同じ内容を回す。⚠ **merge
ボタンを解除するのは `pull_request` 側だけ**なので、`push` 側は待ち時間と Actions の時間を増やすだけになる。

導入時に既存の workflow を開いて、**`agent/issue-*`（bot の branch）が push trigger に入っているか**を見る。
入っているなら、**PR がある間は重い step を飛ばす。**

```yaml
- name: Detect whether the full suite must run
  env:
    EVENT: ${{ github.event_name }}
    REF_NAME: ${{ github.ref_name }}
    GH_TOKEN: ${{ github.token }}      # permissions に pull-requests: read が要る
  run: |
    case "$EVENT:$REF_NAME" in
      push:agent/issue-*)
        if [ "$(gh pr list --head "$REF_NAME" --state open --json number --jq 'length')" -gt 0 ]; then
          echo "open PR exists → pull_request 側が回すので skip"
          echo "run=false" >> "$GITHUB_OUTPUT"; exit 0
        fi
        ;;
    esac
```

⚠ **push trigger をまるごと外さない。**PR ができる前（実装中）の push では `pull_request` 側が存在せず、
**赤に気づくのが PR 作成まで遅れる。**

⚠ **bot 側が CI を明示起動する経路もある**（`run-action.sh`。engine が終わったあとに machinery が
commit したとき）。⚠ **`ATTACHMENTS_TOKEN` があるときは起動しない** — PAT の push は `push` と
`pull_request` の run を普通に立てるので、そこで起動すると **3 本目**になる。

## default branch の保護（`pr-merge` を使う場合）

- **PR を経由すること**を必須にする（`required_pull_request_reviews` を置く。⚠ **まるごと消すと
  bot の直 push が復活する**）
- **承認レビューは 0 件でよい。**⚠ **1 件以上にすると、bot が作った PR を人が承認する形になり、
  クリックが 1 回増える**（作者は自分の PR を承認できないので、bot の self-merge は別途止まる）
- **CI の job を必須チェックにする**（これが merge ボタンを塞ぐ gate になる）
- `enforce_admins` は false のままにする（**人がローカルから `ticket.sh close` する経路を残すため**）
