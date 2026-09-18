# coding-robot — Issue に 🤖 と書くと動く bot 一式

このディレクトリ配下の `.github/` と `.devcontainer/` が **PDH が配布する coding-robot の実体**である。`INSTALL.md` の配置表がこれを導入先の repo へ配る。

**直すのはここである。**別の repo を探しに行かない。

## 出どころ

もとは [masuidrive/github-bots](https://github.com/masuidrive/github-bots) の `coding-robot/` から vendoring していた（最後の取り込みは commit `e1c5eb3685a5197273dc4dba1e3ac118c9f222b1`）。**2026-09-17 に github-bots の廃止が決まり、PDH がそのまま所有者になった**（ユーザ判断）。

⚠ **昇格でいちばん変わったのは «直す場所» である。**vendoring の間は「ここを書き換えず上流へ出す」が規約で、PDH 側の変更は *移植性パッチ* として記録し、再同期のたびに再適用する必要があった。**その運用はもう無い。**

## 何を持っているか

```
.github/workflows/coding-robot.yml            # 🤖 トリガー・devcontainer 実行
.github/workflows/coding-robot-finalize.yml   # merge された PR の Issue を閉じる
.github/coding-robot/run-action.sh            # prompt 組み立て・agent 実行・進捗コメント
.github/coding-robot/system.md  system-claude.md  system-codex.md
.github/coding-robot/_issue.md  _pr.md
.github/coding-robot/engines/_claude.sh  _codex.sh   # ← engine で割れるのはここだけ
.github/coding-robot/trigger-source.sh        # event 別の本文取得・PR の出自検査
.devcontainer/Dockerfile  docker-compose.yml  devcontainer.json
```

⚠ **`_pdh.md` はここに置かない。**PDH mode の定義は `github-bot/_pdh.md`（親ディレクトリ）が持ち、INSTALL がそれを `.github/coding-robot/_pdh.md` として配る。github-bots にも同名ファイルがあったが、旧 stage 名を使う古い版なので取り込んでいない。`scripts/check-github-bot.sh` が「ここに `_pdh.md` が無いこと」を検査する。

同じ理由で、PDH 側が持ち続けるものが 3 つある — `_github-issue.md`（issue が会話面であることの定義）・`pdh-hooks.sh`（run の終わりに progress・ラベル・承認導線・待ち行を保証する hook）・`pdh-gh-pull/`（端末から issue を読む skill）。

## 設計上の決め事（消さないこと）

- **`.devcontainer/devcontainer.json` の `workspaceFolder` は `/workspaces/project` 固定である。**repo 名（`${localWorkspaceFolderBasename}`）にすると、compose 側の `/workspaces/${LOCAL_WORKSPACE_FOLDER_BASENAME:-project}` が env 未設定で `project` へ落ちたときに食い違い、`devcontainer exec` が «no such file or directory» で落ちる。**実測**: smoke（`pdh-ghbot-smoke`）の 1 回目がこの mismatch で失敗し、固定にした 2 回目が成功した。
- **`run-action.sh` は最終レポートの投稿直前に `$SCRIPT_DIR/pdh-hooks.sh final` を通す。**hook が無い環境では何もしない。`scripts/check-github-bot.sh` がこの呼び出し行を守る。
- **branch への push は `ATTACHMENTS_TOKEN`（classic PAT）で行う。**`GITHUB_TOKEN` で押すと、その SHA の `pull_request` run が `action_required`（承認待ち）になり、人が «Approve and run» を押すまで走らない。run の最後の push がこれだと、**PR は «緑にできない» 状態で人に渡る。**
