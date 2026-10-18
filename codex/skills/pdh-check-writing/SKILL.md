---
name: pdh-check-writing
description: "Declarative fast-check authoring workflow. Use when adding or editing scripts/checks/*.check, choosing among pattern, max_lines, linter_command, and required_paths, or validating a new repository invariant."
---

# PDH Check Writing

`scripts/checks/*.check`を追加・変更するときは、先に PDH-repo の[fast-check registry contract](https://github.com/masuidrive/pdh/blob/main/codex/templates/checks/README.md)を読む。導入先では同じ仕様が`scripts/checks/README.md`にある。field、glob、exclude、allow、placeholder、安全なcommand実行の詳細はそのREADMEに従い、このskillへ複製しない。

## 型を選ぶ

- `pattern`: 禁止する文字列invariantをPOSIX EREで検出する。一般的なstyle検査を再実装しない。
- `max_lines`: file全体の行数上限を守る。既存の大きなfileを例外にする場合だけexact-path `allow`を使う。
- `linter_command`: projectが所有するlinterを対象fileへ流す。
- `required_paths`: 消えては困るfileをexact pathで名指しする。

4型のkeyは排他的に1つだけ指定する。全型で`reason`を必須にし、`required_paths`以外では`glob`も必須にする。

## 最小例

```ini
reason=forbidden API must not be called
pattern=forbidden_api[[:space:]]*\(
glob=src/**
```

```ini
reason=source file exceeds the agreed size ceiling
max_lines=1500
glob=**/*.ts,**/*.py,**/*.rb
```

```ini
reason=project linter rejected selected files
linter_command=project-lint -- {{filenames}}
glob=src/**
```

```ini
reason=必須fileが消えている（PDH-repoからの上書きcopyで失われた可能性がある）
required_paths=config/settings.yaml
```

## 足す前に判断すること

この節の目的: fast-check が、ほかの仕組みで数えられる規則や、本来の違反でない行に当たる規則で増えないこと。1 本ごとに `scripts/test-all.sh` の所要時間と、改名のたびに直す場所が増える。誤検出が溜まった検査は、人も agent も無視するようになる。

- **一般化できるなら fast-check にしない**。型・恒久テスト・既存の linter の規則で決定論的に落とせるなら、そちらに置く。fast-check が受け持つのは、それらで書けない文字列の形だけ
- **当たってほしくない箇所を先に数える**。pattern を書いたら、repo 全体に `grep -rnE` で当て、当たる行をすべて読む。本来の違反でない行が 1 つでもあれば、pattern を狭めるか `linter_command` に切り替える。`checks-allow:` で逃がす前提で足さない
- **行をまたぐ構造は pattern で近似しない**。「どの関数の引数か」「対になる行があるか」が意味を決めるなら、構文木を読む script を `linter_command` で呼ぶ
- **足す理由を `.check` の先頭のコメントに書く**。後で消す人が、何を守っていたかと、消す条件（README「Removing a check」）に当たるかを読めるようにする

## 作成手順

1. 1つのinvariantだけを表す短いcheck idと、修正理由が分かる`reason`を決める。
2. 最小の`glob`を選び、生成物やvendored fileを`exclude`する。
3. fileの中身を守るcheckなら、そのfileが消える経路（PDH-repoの版によるdirectory上書き、merge事故、伝播しなかったrename）を確認する。経路があるなら`required_paths` checkを併置する。
4. `scripts/checks/<check-id>.check`を作り、`bash scripts/fast-checks.sh`を実行する。
5. 一時的に違反を作って非0と診断を確認し、違反を戻して再び成功させる。`required_paths`なら対象fileを一時的に退避して落ちることを確かめる。
6. projectの全テストを実行するコマンド（`scripts/test-all.sh`など）を実行する。

## 増やしすぎない

- fast-check は追記専用ではない。消す条件は README「Removing a check」にある（守る対象が消えた・恒久テストや型に一般化した・例外が本来の違反より多く当たる）。足す変更で既存の検査がこの条件に当たったら、同じ変更で消す
- project が fast-checks 全体の所要時間に上限を置くなら、`CLAUDE.md` に書く。超えたら、消す候補を上の条件で探す
