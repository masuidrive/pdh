# プロジェクト概要

`product-brief.md` を参照すること。`AGENTS.local.md` があれば、その環境固有 context も読むこと。

このリポジトリは PDH の配布元であり、PDH を適用される側でもある。

- PDH 共通ルールは `docs/PDH-AGENTS.md` を読む。配布先のように root へコピーしない
- skill の実体は `skills/` に置く。配布先では `.agents/skills/` に実ディレクトリとしてコピーする
- worker 定義は `templates/agents/codex/` に置き、配布先の `.codex/agents/` へコピーする
- 設計意図は `git blame <file>` から commit と `product-brief.md` を辿る

## 基本方針

- 時間がかかっても技術的正しさを優先する
- 文末が「？？」（? 2 回）の質問には回答だけを返し、ファイル変更やコマンド実行を始めない
- この repo は ticket 運用をしない。配布物の変更は `./scripts/test-all.sh` が通ることで担保する

## 配布物の一貫性

- 配布ファイルを追加・改名・削除したら、`INSTALL.md` の配置表と `README.md` の構造図を同じ変更で更新する
- 配布物末尾の `Based on https://github.com/masuidrive/pdh/blob/XXXXXXX/<path>` は、`XXXXXXX` のまま保ち、path を配布元での実パスに一致させる
- `Based on` を持つファイルは `scripts/check-distribution.sh` の `BASED_ON_FILES` に登録する。skill の分冊と custom agent 定義には付けない
- skill または `pdh-*` agent 定義を増減したら、`templates/checks/required-pdh-files.check` と `scripts/checks/required-distribution-set.check` を同時に更新する
- `pdh-update` が配置表の全配布物と migration を扱うことを確認する
- `AGENTS.md`、`.ticket-config.yaml`、`scripts/test-all.sh` など project 固有変更を持つファイルの変更には、`INSTALL.md` へ冪等な移行手順を追加する

## 規則の置き場所

同じ規則を複数箇所に書かない。

- PDH 共通ルール: `docs/PDH-AGENTS.md`
- project 固有ルールの例: `templates/AGENTS.md`
- 導入・更新・migration: `INSTALL.md`
- 運用ルール: `docs/product-delivery-hierarchy.md`
- 実装時だけ読む規則: 対応する skill

skill を新設するのは人間の発話が入口になるものだけとする。worker がパスで読むだけの規則は `pdh-dev` の分冊に置く。

規則には現在の判断と行動だけを書く。経緯、退けた案、測定記録は git または `evals/` に置く。新しい規則を書く前に、既存の不要な指定を削り、既存の一文で表現できるなら書き換える。

## Codex 配布方針

- 配布先の instruction は root `AGENTS.md` を canonical とする
- skill は `.agents/skills/` に実体を置き、symlink や wrapper を作らない
- custom agent は `.codex/agents/*.toml` に置く
- 通常 worker は `gpt-5.6-sol` を使い、役割に応じて `medium` または `high` の reasoning effort を明示する
- 軽量モデルへ自動 downgrade しない。Astra は通常モデルで解けない問題や最高水準の判断への escalation に限る
- custom agent 定義の model は spawn 指定より優先されるため、Astra escalation は Sol 固定の `pdh-*` 定義を使わない

## 自動検査

配布物を変えたら `./scripts/test-all.sh` を実行する。この入口は次を検査する。

- `scripts/fast-checks.sh`: 宣言的な grep 不変条件
- `scripts/check-distribution.sh`: Based on、配置表、必須配布物、重複行
- `scripts/check-links.py`: Markdown link と anchor
- `scripts/test-codex-eval.py`: 計測記録の欠落・失敗・ツール使用を成功と混同しないこと
- 判断ボード kit の selftest を GNU / BSD 相当で各 1 回
- 配布 shell script の構文

script を変更した場合は構文検査だけでなく実際に実行する。配置手順を変更した場合は一時 project に手順どおりコピーし、新規導入、再実行、旧版からの migration を確認する。

新しい検査は、まず `scripts/checks/*.check` で表せるか検討する。追加した検査には故意に違反を作り、実際に失敗することを確認する。自由文の網羅性や妥当性を行数・件数で測らない。

判断ボードの `kit/` を変えたときだけ `scripts/check-board-render.sh` を実行する。散文規則を変えた場合は対応する eval を実行し、結果を記録する。

## PDH repo 固有の影響範囲

チケット作成・実装計画・検証計画では、影響する layer を列挙する。

`docs` · `skills` · `templates` · `scripts` · `README` · `INSTALL` · `product-brief.md`

Acceptance Criteria の変更は必ずユーザーの承認を得る。
