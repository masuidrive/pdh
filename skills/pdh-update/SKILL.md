---
name: pdh-update
description: "PDH アップデート: 上流 PDH リポジトリの最新版を取り込み、プロジェクトのスキル・テンプレートを更新する。「pdh-update」とだけ言われた時のみ起動する。他のキーワードでは起動しない。"
---

# PDH Update — 上流 PDH の取り込み

Agent ツールでサブエージェントを起動し、そのサブエージェント内で以下を実行すること（メインコンテキストでは実行しない）:

1. https://raw.githubusercontent.com/masuidrive/pdh/refs/heads/main/README.md を読む
2. README の「既存ファイルのアップデート」セクションの手順に従い、このプロジェクトの PDH を最新版にアップデートする
