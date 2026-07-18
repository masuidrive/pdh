---
name: pdh-update
description: "PDH アップデート: 上流 PDH リポジトリの最新版を取り込み、プロジェクトのスキル・テンプレートを更新する。「pdh-update」とだけ言われた時のみ起動する。他のキーワードでは起動しない。"
---

# PDH Update — 上流 PDH の取り込み

利用可能な subagent / delegation 機構で更新作業用 worker を起動し、その worker 内で以下を実行すること（メインコンテキストでは実行しない）。Claude Code では Agent ツール、Codex では subagent / agent thread 等の現在の環境で使える機構に読み替える。worker を起動できない場合は単独続行せず、制限を報告してユーザに確認する。

1. https://raw.githubusercontent.com/masuidrive/pdh/refs/heads/main/README.md を読む
2. README の「既存ファイルのアップデート」セクションの手順に従い、このプロジェクトの PDH を最新版にアップデートする
3. 更新手順には `bash ./ticket.sh selfupdate`（ticket.sh 本体を upstream 最新版へ更新）が含まれる。
