---
name: pdh-update
description: "PDH アップデート: 上流 PDH リポジトリの最新版を取り込み、プロジェクトのスキル・テンプレートを更新する。「pdh-update」とだけ言われた時のみ起動する。他のキーワードでは起動しない。"
---

# PDH Update — 上流 PDH の取り込み

利用可能な subagent / delegation 機構で更新作業用 worker を起動し、その worker 内で以下を実行すること（メインコンテキストでは実行しない）。Claude Code では Agent ツール、Codex では subagent / agent thread 等の現在の環境で使える機構に読み替える。worker を起動できない場合は単独続行せず、制限を報告してユーザに確認する。

1. https://raw.githubusercontent.com/masuidrive/pdh/refs/heads/main/INSTALL.md を読む（手順が README.md から INSTALL.md へ移動した。README.md しか無い古い記述を見た場合も INSTALL.md を読むこと）
2. INSTALL.md の「既存ファイルのアップデート」セクションの手順に従い、このプロジェクトの PDH を最新版にアップデートする
3. **INSTALL.md の「既知の移行手順」(§3.1) を必ず読み、該当する項目をすべて適用する。** ファイルの追加/削除の差分だけでは正しく移行できない変更（削除に見えて実は置き換えであるもの、旧 README の手順漏れに起因する欠落など）がここに列挙されている。差分に現れないため、読まないと見落とす
4. 更新手順には `bash ./ticket.sh selfupdate`（ticket.sh 本体を upstream 最新版へ更新）が含まれる。
5. 完了報告には、§3.1 のどの項目を適用したか（または該当なしと判断したか）を含める。
