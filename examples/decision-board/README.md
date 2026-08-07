# decision-board の実例

`content.html` が書き手の書くもの（`db-*` コンポーネントの並び）、`board.html` がその build 結果。
架空の ticket を題材に、コンポーネントを一通り使っている。**配布物ではない**（skill の読者と
コンポーネント開発者のための参照実装）。

```bash
cd examples/decision-board
sh ../../skills/decision-board/build-board.sh content.html "通知メールが二重に届く — close 前の確認" > board.html
python3 -m http.server 8000   # http://localhost:8000/board.html で開く（file:// では保存とコピーが動かない）
```

図（mermaid）を使う board は第 3 引数に `mermaid` を付ける。bundle が 1.5 MB あるため、
図が無い board には付けない。

書き方の正は `skills/decision-board/SKILL.md`。
