# Technical Reference: <product name>

Based on https://github.com/masuidrive/pdh/blob/XXXXXXX/templates/technical-reference.md

このファイルは常に「現在の姿」だけを書く。過去の経緯・置き換えられた判断は削除する（履歴は git が持つ）。
残す基準は「将来の ticket の判断を今も拘束するか」。拘束しなくなった記述は消す。
通読させる文書ではなく、検索して引く文書として書く（番号付き見出し・検索可能なリテラル）。

## 更新ルール

- ticket close 時、その ticket の差分に因果がある範囲だけを追記・上書きする。
  実装として出荷済みの挙動は確定した事実としてその場で書く。承認待ちで先送りしない
  （承認が要るのは brief の意思の変更だけで、このファイルは事実の記録）。
  自分の変更が置き換えた記述は削除してよい。他 ticket 由来の記述は消さない
  （不要と思ったら削除候補として ticket note に記録し、棚卸し ticket に送る）。
- 肥大して検索ノイズが増えたら、専用 ticket で棚卸し→圧縮→別モデルによる保全検証を行う
  （削除判断を単独 agent に任せない）。

## Architecture overview

いまの構成を短く。何がどこにあるか（ファイルマップ）、主要コンポーネントと関係。

## Design decisions

いまも将来の実装を拘束する設計判断だけを「決定＋理由 1 行＋日付 / ticket 名」で書く。
brief の Architectural Invariants に昇格するほどではない中規模の判断の置き場。

## 実装の注意・地雷

実装粒度の具体的な罠（例:「この API は retry すると二重処理になる」）。
テストやガードで恒久対策したら該当行を消す。
