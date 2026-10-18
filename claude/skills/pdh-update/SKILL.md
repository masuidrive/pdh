---
name: pdh-update
description: "PDH アップデート: PDH-repoの最新版を取り込み、プロジェクトのスキル・テンプレートを更新する。「pdh-update」とだけ言われた時のみ起動する。他のキーワードでは起動しない。"
---

# PDH Update — PDH-repo の取り込み

利用可能な worker / delegation 機構で更新作業用 worker を起動し、その worker 内で以下を実行する（worker を起動した側の会話では実行しない）。worker を起動できない場合は単独続行せず、制限を報告してユーザに確認する。

1. https://raw.githubusercontent.com/masuidrive/pdh/refs/heads/main/claude/INSTALL.md を読む（README.md しか無い古い記述を見た場合も INSTALL.md を読む）
2. INSTALL.md の「既存プロジェクトのアップデート」の手順に従い、このプロジェクトの PDH を最新版にアップデートする。配置表へ追加されたskillと、directory copy配下に追加された`scripts/checks/*.check`も取り込み、Codex用symlink一覧を現行skill一式へ揃える。**skillと`pdh-*`のagent定義は毎回まるごと上書きする**（差分マージしない）。あわせて`scripts/checks/required-pdh-files.check`の`required_paths`を、いま配置した skill / agent 定義の一式へ揃える（導入先が使わないと決めて外した行は復活させない）
3. **INSTALL.md の「既知の移行手順」を必ず読み、該当する項目をすべて適用する。**
3.5. **coding-bot（`.github/coding-bot/` の手順書と script）を導入済みなら**（`.github/` 内に `_pdh.md` がある。改名前の配置も含む）、先に PDH-repo の [github-bot/INSTALL.md の改名手順](https://github.com/masuidrive/pdh/blob/main/github-bot/INSTALL.md#既知の移行手順-coding-robot-を-coding-bot-に改名する2026-09-27-以降)と同文書の「導入先固有の secret」を確認し、該当する移行と確認コマンドの再実行を行う。その後、同文書「更新」に従い `_pdh.md` / `_github-issue.md` / `pdh-hooks.sh` / `pdh-gh-pull/` を PDH-repo の版でまるごと置き換える。残りのファイル（`.github/coding-bot/`・`.github/workflows/coding-bot*.yml`・`.devcontainer/`）は同じ「更新」のとおり diff を確かめて反映し、丸ごと上書きしない。
4. 更新手順には `bash ./ticket.sh selfupdate`（ticket.sh 本体を配布元の repo の最新版へ更新）が含まれる。
5. **「既知の移行手順」の確認コマンドを、適用後にもう一度ぜんぶ実行する**（INSTALL.md 手順 7.5）。「要追加」「要改名」が残っていたら直してから次へ進む。
5.5. `bash scripts/check-ticket-template-drift.sh --upstream-file tmp/pdh/claude/templates/.ticket-config.yaml` で `.ticket-config.yaml` のテンプレ本文（`default_content` / `note_content`）と PDH-repo の版の差を数え、**出力を完了報告に貼る。**差があれば、その行が導入先の独自の節か、取り込み漏れかを分けて報告する
6. 完了報告には、どの項目を適用したか（または該当なしと判断したか）に加えて、**手順 5 の再実行の出力をそのまま貼る。**

6.5. 上書きしたファイルの版を記録する: `bash scripts/pdh-lock.sh write --upstream tmp/pdh --map tmp/pdh/claude/lock-map.tsv`。上書きしたファイルが PDH-repo の版と 1 つでも違えば、lock を書かずに止まる。その一覧を完了報告に貼る

`Based on` 行を持つのは、差分をマージするファイル（`CLAUDE.md`・`product-brief.md`・`.ticket-config.yaml` など）だけである。上書きするファイルの版は `.pdh-lock` が持つ。取り込んでいない PDH-repo の変更が残っているファイルは、`Based on` 行の commit ID を進めない。進めると «その版を取り込んだ» という誤った表示になる。版はファイルごとに違ってよい。
