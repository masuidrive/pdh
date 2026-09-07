# github-bot レイヤー — 導入手順（任意）

PDH の **オプション**。GitHub Issue を «エンジニアとの会話面» にし、🤖 コメントで続きの処理を GitHub Actions 上の agent（[github-bots](https://github.com/masuidrive/github-bots) の coding-robot）に回す。**このレイヤーを入れなくても PDH core は完全に動く。** 入れるかは任意で、入れたプロジェクトだけが GitHub Actions を要求する。

これは core の `claude/INSTALL.md` / `codex/INSTALL.md` とは別経路。`pdh-update`（core 更新）はこのレイヤーに触らない。更新は本ファイルで行う。

## 前提

- PDH core が導入済み（`.claude/skills/pdh-dev/` か `.codex/skills/pdh-dev/` がある）。無ければ先に core を入れる。
- `gh` CLI が使えて、対象が GitHub repo であること。**このレイヤーでは `gh` を必須にする。**
- project root に `product-brief.md` と `tickets/` がある（bot はこれで PDH mode を判定する）。

## 1. ファイルを配置する

| コピー元（この repo） | コピー先（あなたの project） | 役割 |
|---|---|---|
| `github-bot/vendor/.github/` | `.github/` | workflow 2 本・coding-robot 一式（machinery） |
| `github-bot/vendor/.devcontainer/` | `.devcontainer/` | Actions が使う devcontainer。**既存の devcontainer があればマージ**（上書き前に diff を確認） |
| `github-bot/_pdh.md` | `.github/coding-robot/_pdh.md` | **PDH mode を定義する**（vendor の古い `_pdh.md` は使わない） |
| `github-bot/_github-issue.md` | `.github/coding-robot/_github-issue.md` | gate→issue プロトコル（cloud / local 共通） |
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
  `OPENAI_API_KEY`（API 課金）という別路も machinery は受け付けるが、**この運用では使わない**。サブスク運用では `OPENAI_API_KEY` secret は設定しない（vendored workflow が空で渡すのは無害）。

project 固有の env が要るテストがあるなら、まとめて 1 つの secret に:
```bash
gh secret set ENV_JSON --body '{"SOME_API_KEY":"...","BASE_URL":"..."}'
```

## 3. 使い方

- Issue / PR のコメントに **🤖**（または `:robot:`）を含めると Actions が発火し、coding-robot が PDH フローで動く。
- **human gate（`PDH-ticket-human-review` / `PDH-human-review`）では bot は自己承認せず、要点を issue にコメントして停止する。** 承認は **gate コメントへの 👍**、変更希望は返信。次の 🤖 で再開する。
- 端末で issue のコメントを拾いたいときは「issue 読んで」等と言えば `pdh-gh-pull` skill が取り込む。

## 4. 更新（再同期）

machinery（vendor/）が github-bots 側で更新されたら、`github-bot/vendor/VENDOR.md` の手順で再同期し、commit id を更新する。`_pdh.md` / `_github-issue.md` / `pdh-gh-pull` は PDH 側で保守するので、この repo の版を再配置する。
