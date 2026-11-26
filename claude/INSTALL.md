# PDHの導入と既存プロジェクトのアップデート

Claude Code と Codex は同じスキルと検収コマンドを使う。新規導入と `pdh-update` は[共通の導入手順](../INSTALL.md)に従う。

従来の `pdh-update` からこのファイルを開いた場合も、共通手順の適用と確認までを1回行って更新を終える。今回から `ticket.sh` は検収コマンドを含むPDH同梱版を使う。旧版に書かれている個別コピー・selfupdate・lockの再生成は旧stage方式専用である。

移行前のチケットや旧方式のcoding-botを保守する際は[旧stage配布の配置表](INSTALL-stage.md)を参照する。
