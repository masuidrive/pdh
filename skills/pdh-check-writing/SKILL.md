---
name: pdh-check-writing
description: "Declarative fast-check authoring workflow. Use when adding or editing scripts/checks/*.check, choosing among pattern, max_lines, and linter_command, or validating a new repository invariant."
---

# PDH Check Writing

`scripts/checks/*.check`を追加・変更するときは、先に配布版の[fast-check registry contract](https://github.com/masuidrive/pdh/blob/XXXXXXX/templates/checks/README.md)を読む。導入先では同じ仕様が`scripts/checks/README.md`にある。field、glob、exclude、allow、placeholder、安全なcommand実行の詳細はそのREADMEを正とし、このskillへ複製しない。

## 型を選ぶ

- `pattern`: 禁止する文字列invariantをPOSIX EREで検出する。一般的なstyle検査を再実装しない。
- `max_lines`: file全体の行数上限を`wc -l`相当で守る。既存の大きなfileを例外にする場合だけexact-path `allow`を使う。
- `linter_command`: projectが所有するlinterを対象fileへ流す。依存・config・ruleはproject側で管理する。

3型のkeyは排他的に1つだけ指定する。全型で`reason`と`glob`を必須にする。

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

## 作成手順

1. 1つのinvariantだけを表す短いcheck idと、修正理由が分かる`reason`を決める。
2. 最小の`glob`を選び、生成物やvendored fileを`exclude`する。
3. `scripts/checks/<check-id>.check`を作り、`bash scripts/fast-checks.sh`を実行する。
4. 一時的に違反を作って非0と診断を確認し、違反を戻して再び成功させる。
5. projectの全test入口を実行する。

Based on https://github.com/masuidrive/pdh/blob/XXXXXXX/skills/pdh-check-writing/SKILL.md
