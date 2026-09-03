---
name: pdh-update
description: "PDH アップデート: 上流 PDH リポジトリの最新版を取り込み、プロジェクトのスキル・テンプレートを更新する。「pdh-update」とだけ言われた時のみ起動する。他のキーワードでは起動しない。"
---

# PDH Update — 上流 PDH の取り込み

利用可能な subagent / delegation 機構で更新作業用 worker を起動し、その worker 内で以下を実行する（メインコンテキストでは実行しない）。worker を起動できない場合は単独続行せず、制限を報告してユーザに確認する。

1. https://raw.githubusercontent.com/masuidrive/pdh/refs/heads/main/INSTALL.md を読む（README.md しか無い古い記述を見た場合も INSTALL.md を読む）
2. INSTALL.md の「既存プロジェクトのアップデート」の手順に従い、このプロジェクトの PDH を最新版にアップデートする。配置表へ追加されたskillと、directory copy配下に追加された`scripts/checks/*.check`も取り込み、Codex用symlink一覧を現行skill一式へ揃える。**skillと`pdh-*`のagent定義は毎回まるごと上書きする**（差分マージしない）。あわせて`scripts/checks/required-pdh-files.check`の`required_paths`を、いま配置した skill / agent 定義の一式へ揃える（導入先が使わないと決めて外した行は復活させない）
3. **INSTALL.md の「既知の移行手順」を必ず読み、該当する項目をすべて適用する。**
4. 更新手順には `bash ./ticket.sh selfupdate`（ticket.sh 本体を upstream 最新版へ更新）が含まれる。
5. **「既知の移行手順」の確認コマンドを、適用後にもう一度ぜんぶ実行する**（INSTALL.md 手順 7.5）。「要追加」「要改名」が残っていたら直してから次へ進む。
6. 完了報告には、どの項目を適用したか（または該当なしと判断したか）に加えて、**手順 5 の再実行の出力をそのまま貼る。**

Based on https://github.com/masuidrive/pdh/blob/XXXXXXX/skills/pdh-update/SKILL.md
