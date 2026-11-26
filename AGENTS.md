# PDH の管理範囲

製品の `pdh/` にこのファイルがある場合、このディレクトリは配布元の指定コミットのコピーです。製品固有のルール、テスト、チケットは製品側に置いてください。ここだけで編集すると次の更新で競合することがあります。恒久的な修正は [配布元](https://github.com/masuidrive/pdh) に反映し、製品のルートで `/pdh-update` を実行するか、エージェントに「pdh-update」と依頼してください。

## 配布元で開発するとき

- 製品の目的は [Product Brief](product-brief.md)、導入・移行は [INSTALL.md](INSTALL.md)、チケット操作は [USAGE.md](USAGE.md) を参照する。
- 実装とテストの指示は [実装者用プロンプト](skills/pdh/references/implementation.md) と [手法の選び方](skills/pdh/references/methods.md) にある。`scripts/` と `checks/` がチケットの検収を実行する。
- 配布元で `bash tools/test-all.sh` を実行する。導入・更新は使い捨ての製品リポジトリでも試し、製品固有の設定・試験が保たれ、二度目の更新予定が空になることを確かめる。
- [GitHub coding-bot](github-bot/INSTALL.md) を変更したら、導入済みプロジェクトの Issue 操作と人による承認も確認する。
