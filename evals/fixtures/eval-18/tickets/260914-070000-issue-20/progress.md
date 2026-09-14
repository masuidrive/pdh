# Progress: 260914-070000-issue-20

## 2026-09-14T07:02:00Z [PDH-open] 初回要望
Issue #20 本文を依頼として記録。

## 2026-09-14T07:05:00Z [PDH-ticket-review] 現行動作の確認
```text
$ python3 src/greet.py --lang es Alice
usage: greet [-h] [--lang {en,ja,fr}] [--upper] [--repeat N] name
greet: error: argument --lang: invalid choice: 'es' (choose from 'en', 'ja', 'fr')
```
rc=2。
