---
name: pdh-close
description: "PM 専用。PDH-close と中止のときに PM が読む。"
---

# PDH-close

この規則の目的: ユーザが承認した内容だけが merge され、何を承認したかと merge 後の状態が progress に残ること。
PM がこの skill の全部を読む。ticket を中止するときは「例外」の節を読む。

## 入力

- note の Status は `PDH-close`
- PDH-human-review で得た close の承認が progress にある

## 処理

1. PDH-human-review で承認された内容と、close の時点の merge・push・deploy の状態を progress へ記録する
2. 下の「効果の記録」を progress に追記する
3. `./ticket.sh close` を実行する

close の承認は PDH-human-review で得ている。ここで承認を取り直さない。承認者に見せる完了報告（decision-board）の作り方は、PDH-human-review の材料として skill `pdh-decision-board` の `close-gate.md` にある。

### 効果の記録

この規則の目的: 承認者が、巡の数に加えて人の判断・答え待ち・退行・出荷後の欠陥で PDH の調整の効果を比べられること。PM が記録から読み、利用者に集計を頼まず、次の 1 行を書く。

`効果: 判断=<利用者に答えを求めた回数> 答え待ち=<答えを待って ticket が延びた日数> codex=<開始時と close 時の週の上限の使用割合か不明> claude=<同じく使用割合か不明> 退行=<この ticket の修正が持ち込んだいま直すの件数>`

判断は発行した設問を数え、答え待ちは回答を待っていた期間の重なりを除いて日数へ直す。使用割合はアカウント全体で並行作業を含むため概算の目安であり、ticket ごとの使用量とは扱わない。週の上限の期間をまたいだら `不明` とする。Codex は `~/.codex/sessions` の記録の `rate_limits` から開始時と close 時の週の値を読み、どちらかを取れなければ `不明` とする。Claude Code からは読めないので通常 `不明`。本文や資格情報は記録へ写さない。

PDH-ticket-write か PDH-open の `--enter` が note に `<!-- pdh-effect: 1 -->` を付けた ticket は、効果の行が無いと close の検査が落ちる。PDH-open を過ぎた ticket に印を後から付けず、done の記録は書き直さない。出荷後の欠陥は `bash scripts/pdh-review-tally.sh` の ticket ごとの集計で読む。

## 出力

### 機械で確かめるもの

`./ticket.sh close` が成功する（note の Checklist に未了が残っていると拒否される）。

### 判断で確かめるもの（誰が判断し、どこに残すか）

- [ ] PDH-close: PM: PDH-human-review で承認された内容と、merge・push・deploy の状態が progress に残っている

- [ ] PDH-close: 効果: の行が progress にあり、判断の回数・答え待ちの日数・使用割合の条件・退行を PM が記録と照合した

## 例外

- **ticket を中止する**: 中止の理由を ticket と progress へ記録してから、`./ticket.sh cancel` を実行する。cancel した ticket は `tickets/done/` に残す。判断の履歴なので削除しない
- **`./ticket.sh close` が拒否された**（note の Checklist に未了が残っている）: 未了の行を片付けるか、`- [-] ... - skip: <理由>` にしてから close し直す
