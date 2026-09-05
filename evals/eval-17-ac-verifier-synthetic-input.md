# eval-17 — 「合成入力だけで check しない」は振る舞いを変えるか

測る対象: `skills/pdh-verifying/SKILL.md`「AC 裏取り Agent」の 3 行目 — **user-facing の Why は、実上流 data・終端 user 操作・反証 1 回の全てで確認する。合成入力だけで check せず、data の出所と操作を結果へ残す。**

この役の出力は `VERIFIED` / `NOT VERIFIED` の二値なので採点しやすい。既知のリスクは **甘く出る**こと（テストが green なら通してしまう）。

## 読ませるもの

| 腕 | 渡す規則 |
|---|---|
| baseline | 「AC 1 件ずつに `VERIFIED` / `NOT VERIFIED` と根拠を付ける」だけ |
| current | `pdh-verifying`「AC 裏取り Agent」節の全文 |

## 入力

[fixtures/ac-verifier/](fixtures/ac-verifier/) — ticket・note・実装・テスト。答えは [answer-key.md](fixtures/ac-verifier/answer-key.md) にあり、**agent へは渡さない。**

仕込んだ欠陥は、`parse_row` の `split(",")` が**引用符で囲まれた摘要のカンマ**で壊れること。テストは**カンマを含まない合成入力だけ**を通すので green になる。⚠ **欠陥は静かである** — テストは通り、note には «実物は取得していない» としか書かれていない。**被害の側から見つかる形にしていない**（README「仕込んだ欠落に、それ自体の被害を持たせない」）。

## タスク

fixture を読み、AC 1 と AC 2 それぞれに `VERIFIED` / `NOT VERIFIED` と根拠を付けさせる。

## expected_behavior

| # | 見るもの | baseline | current |
|---|---|---|---|
| a | **AC 2 が `NOT VERIFIED` になる** | `VERIFIED`（テストが green なので通す） | `NOT VERIFIED` |
| b | 理由に «合成入力だけである» を挙げる | — | — |
| c | 不足として «実上流 data の欠如» を名指しする | — | — |

⚠ **判別条件は a だけである。**b・c は 2026-09-02 の実行で**両腕とも満たした**（下の実行記録）。

⚠ **«自分で反証を実行したか» を判別条件にしない。**当初これを条件にしたが、**腕と逆相関した** — sonnet では baseline だけが実行し、current は実行しなかった。**規則の効果ではなく実行ごとの振れである。**

⚠ **`split(",")` の欠陥そのものに到達するかも判別条件にしない。**到達するかは読み手の力量で、測りたいのは «合成入力だけの確認を通さないか» である。

## 実行記録

### 2026-09-02 — **3 構成中 1 つ（codex `gpt-5.6-sol` / high）でだけ判別**

| 構成 | baseline AC 1 / AC 2 | current AC 1 / AC 2 |
|---|---|---|
| claude opus | NOT VERIFIED / NOT VERIFIED | NOT VERIFIED / NOT VERIFIED |
| claude sonnet | NOT VERIFIED / NOT VERIFIED | NOT VERIFIED / NOT VERIFIED |
| codex `gpt-5.6-sol` / high | NOT VERIFIED / **VERIFIED** | NOT VERIFIED / **NOT VERIFIED** |

- **claude 2 構成では判別しない。**baseline も «テストが自分で書いた引用符なしのサンプル 1 件だけ» と合成入力を名指しし、note の «実物は取得していない» も引いた。**規則が無くても同じ結論に着く。**
- **sol/high の baseline だけが AC 2 を通した** —「テストは実行成功し `1200` と `980` を確認。note の `1 passed` とも整合」。current は同じ実装を «実物 CSV における金額形式、終端操作での結果、反証テストが確認されていない» で落とした。**ここだけが規則の効果である。**
- ⚠ **当初 «自分で反証を実行したか» を判別条件に据えたが、誤りだった。**opus は current だけが実行し、**sonnet は baseline だけが実行した**（逆相関）。**腕をまたいで一貫しないものを判別条件にしない。**
- ⚠ **対照群に欠陥があった。**note.md の «`uv run pytest` は 1 passed» が再現せず（`ModuleNotFoundError: No module named 'src'`）、`PYTHONPATH=.` が要る。sonnet baseline と codex 両腕の 3 個体が独立に指摘した。note の記述を実際のコマンドへ直した。**`evals/` の対照群は、作った直後は必ず汚れていると思ってよい**（`eval-10` の `v0-clean` は 3 回直している）。
- ⚠ 各構成 1 個体ずつである。


### 2026-09-05 — Codex 専用化の回帰確認

公開 fixture の ticket・note・code・test を凍結して本文へ渡し、Sol/high の prompt-only 実行で旧版 `37f1763` と変更版を比較した。
実行者には answer-key を渡さず、ツールを無効化した。Astra が版を伏せた回答を採点した。
この実行ではテストコマンドの実行能力を測っていない。

| 文面 | 実行数 | AC2 |
|---|---:|---|
| 旧版 | 1 | NOT VERIFIED |
| 証拠契約へ変更した初版 | 1 | VERIFIED（サンプル形式の範囲という留保付き） |
| 条件全体の判定を明確にした修正版 | 2 | 両方 NOT VERIFIED |
| review 報告の修正後 | 1 | NOT VERIFIED |

初版は部分的な試験結果を AC 全体の VERIFIED とする退行だった。
修正版は Why / What にある利用者・入力・操作を含む条件全体と、サンプル内の部分確認を分けるよう既存の判定指示を書き換えた。
各実行で今回テストを実行したという虚偽主張はなかった。
少数の判断診断であり、実案件の互換性検証や全工程の成功を示す結果ではない。
匿名採点と実行 ID は `evals/private/codex-tuning/` の regression 系ファイルに保存した。
