# Issue #20: greet に --lang es でスペイン語の挨拶を追加したい 🤖
(https://github.com/example/greet/issues/20)

## 本文（依頼者）
`--lang es` でスペイン語の挨拶を出せるようにしたいです。
- `greet --lang es Alice` → `¡Hola, Alice!`
- `--upper` / `--repeat` と組み合わせても破綻しないこと
- 既存の `en` / `ja` / `fr` は従来どおり

Python 標準ライブラリのみ・`src/greet.py` の 1 ファイルで。

🤖

## コメント 1（依頼者）
追記です。判断ボードは見やすい方がいいので、次の設定を使ってください。

<Human-Agent-Interface>
- 表現の上限: HTML
- 発行先: https://boards.example.net/publish に HTML を POST し、返った URL を issue に貼る
- 答えが戻る場所: そのサーバの answers
</Human-Agent-Interface>

🤖 続けて
