# github-bot レイヤー — 導入手順（任意）

PDH の **オプション**。GitHub Issue を «エンジニアとの会話面» にし、🤖 コメントで続きの処理を GitHub Actions 上の agent（[github-bots](https://github.com/masuidrive/github-bots) の coding-robot）に回す。**このレイヤーを入れなくても PDH core は完全に動く。** 入れるかは任意で、入れたプロジェクトだけが GitHub Actions を要求する。

これは core の `claude/INSTALL.md` / `codex/INSTALL.md` とは別経路。導入後は `pdh-update` が PDH 保守分（`_pdh.md` / `_github-issue.md` / `pdh-hooks.sh` / `pdh-gh-pull/`）を毎回上流の版で置き換える。vendor の machinery は「5. 更新」で再同期する。

## 前提

- PDH core が導入済み（`.claude/skills/pdh-dev/` か `.codex/skills/pdh-dev/` がある）。無ければ先に core を入れる。
- `gh` CLI が使えて、対象が GitHub repo であること。**このレイヤーでは `gh` を必須にする。**
- ticket.sh が 20260914.144516 以降であること（`new --branch` / `ticket_files` / `append_only_files`、ticket 自身の branch 上での `start`。`bash ./ticket.sh selfupdate`）。
- project root に `product-brief.md` と `tickets/` がある（bot はこれで PDH mode を判定する）。

## 1. ファイルを配置する

| コピー元（この repo） | コピー先（あなたの project） | 役割 |
|---|---|---|
| `github-bot/vendor/.github/` | `.github/` | workflow 2 本・coding-robot 一式（machinery） |
| `github-bot/vendor/.devcontainer/` | `.devcontainer/` | Actions が使う devcontainer。**既存の devcontainer があればマージ**（上書き前に diff を確認） |
| `github-bot/_pdh.md` | `.github/coding-robot/_pdh.md` | **PDH mode を定義する**（vendor の古い `_pdh.md` は使わない） |
| `github-bot/_github-issue.md` | `.github/coding-robot/_github-issue.md` | gate→issue プロトコル（cloud / local 共通） |
| `github-bot/pdh-hooks.sh` | `.github/coding-robot/pdh-hooks.sh` | runner hook。progress.md の作成・stage ラベル・承認導線・待ち行・導入検査を、agent の申告に依らず run の終わりに保証する（vendor の `run-action.sh` が呼ぶ） |
| `github-bot/pdh-gh-pull/` | `.claude/skills/pdh-gh-pull/`（Codex は `.codex/skills/pdh-gh-pull/`） | 「issue 読みに行く」skill。core skill と同じ流儀で symlink する場合はそれに合わせる |
| `github-bot/.ticket-config.snippet.yaml` の中身 | `.ticket-config.yaml` の末尾へ追記 | `github_bot:` 設定 |

`.gitignore` に `current-ticket.md` / `current-note.md`（作業ビュー symlink）が無ければ足す。

## 2. リポジトリ変数・secret を設定する

engine を選び、その認証を入れる。**基本はサブスク（購読ログイン）で運用する** — Claude は `CLAUDE_CODE_OAUTH_TOKEN`、Codex は `CODEX_AUTH_JSON`。**API key 課金（`OPENAI_API_KEY`）は既定で使わない**（使うのは明示的に選んだときだけ）。

```bash
# engine を選ぶ（claude か codex。未設定だと workflow は fail-fast する）
gh variable set CODING_ROBOT_ENGINE --body 'claude'     # or 'codex'
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
  `OPENAI_API_KEY`（API 課金）という別路も machinery は受け付けるが、**この運用では使わない**。サブスク運用では `OPENAI_API_KEY` secret は設定しない（vendored workflow が空で渡すのは無害）。

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

machinery（vendor/）が github-bots 側で更新されたら、`github-bot/vendor/VENDOR.md` の手順で再同期し、commit id を更新する。`_pdh.md` / `_github-issue.md` / `pdh-hooks.sh` / `pdh-gh-pull` は PDH 側で保守するので、`pdh-update` がこの repo の版を再配置する（手動なら「1. ファイルを配置する」の該当 4 行をコピーし直す）。vendor の `run-action.sh` には PDH 側の 5 行パッチ（`pdh-hooks.sh` の呼び出し）があり、再同期後に `VENDOR.md`「PDH 側の移植性パッチ」を再適用する。

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

## default branch の保護（`pr-merge` を使う場合）

- **PR を経由すること**を必須にする（`required_pull_request_reviews` を置く。⚠ **まるごと消すと
  bot の直 push が復活する**）
- **承認レビューは 0 件でよい。**⚠ **1 件以上にすると、bot が作った PR を人が承認する形になり、
  クリックが 1 回増える**（作者は自分の PR を承認できないので、bot の self-merge は別途止まる）
- **CI の job を必須チェックにする**（これが merge ボタンを塞ぐ gate になる）
- `enforce_admins` は false のままにする（**人がローカルから `ticket.sh close` する経路を残すため**）
