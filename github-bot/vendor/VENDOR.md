# vendor/ — github-bots coding-robot の取り込み元

このディレクトリは **engine 中立の bot machinery** を [masuidrive/github-bots](https://github.com/masuidrive/github-bots) の `coding-robot/` から vendoring したもの。**PDH が書き換えるのはここではなく親ディレクトリの `_pdh.md`（PDH mode を定義する）である。**

## 取り込み元

- repo: `masuidrive/github-bots`
- path: `coding-robot/`
- commit: **`e1c5eb3685a5197273dc4dba1e3ac118c9f222b1`**

## 取り込んだファイル

```
.github/workflows/coding-robot.yml            # 🤖 トリガー・devcontainer 実行
.github/workflows/coding-robot-finalize.yml
.github/coding-robot/run-action.sh            # prompt 組み立て・agent 実行・進捗コメント
.github/coding-robot/system.md  system-claude.md  system-codex.md
.github/coding-robot/_issue.md  _pr.md
.github/coding-robot/engines/_claude.sh  _codex.sh   # ← engine で割れるのはここだけ
.devcontainer/Dockerfile  docker-compose.yml  devcontainer.json
```

## 取り込まなかったもの

- **`.github/coding-robot/_pdh.md`** — github-bots の版は古い（旧 stage 名 `PD-C-*`・存在しない `_principles.md` を読ませる・cloud の gate 停止が無い）。**PDH が現行版を `github-bot/_pdh.md` に持ち、INSTALL でそれを配置する。** vendor 側の `_pdh.md` は取り込まない。
- 開発補助（`scripts/dev/*`・`setup.md`・`README.md`・`UPDATE.md`）— 配布に不要。

## PDH 側の移植性パッチ（upstream から意図的に 1 行ずらしている）

- **`.devcontainer/devcontainer.json`**: `workspaceFolder` を `/workspaces/${localWorkspaceFolderBasename}`（repo 名依存）から **`/workspaces/project`**（固定）へ変更。upstream は compose 側が `/workspaces/${LOCAL_WORKSPACE_FOLDER_BASENAME:-project}` で、その env が未設定だと `project` にフォールバックし、devcontainer.json の chdir 先（repo 名）と食い違って `devcontainer exec` が «no such file or directory» で落ちる（任意 repo に落とすと踏む）。固定パスで両者を一致させた。**実測**: smoke（`pdh-ghbot-smoke`）の 1 回目がこの mismatch で失敗、この修正で 2 回目が成功。
- **再同期時は再適用する。** github-bots が devcontainer/compose の workspace 解決を直したら、このパッチは不要になるので突き合わせる。upstream へ報告する価値がある。

## 再同期（github-bots が machinery を更新したとき）

```bash
GB=<github-bots の checkout>/coding-robot
# machinery だけ上書き（_pdh.md は PDH 側で保守するので除く）
rsync -a --exclude '_pdh.md' \
  "$GB/.github/" "$GB/.devcontainer/" github-bot/vendor/…  # パスは上の一覧に合わせる
```
再同期したら commit id を上の «commit» に更新し、`github-bot/_pdh.md` が現行 PDH（stage 名・分冊構成・gate 停止）と食い違っていないか確認する。
