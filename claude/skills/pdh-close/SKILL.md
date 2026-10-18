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
2. `./ticket.sh close` を実行する

close の承認は PDH-human-review で得ている。ここで承認を取り直さない。承認者に見せる完了報告（decision-board）の作り方は、PDH-human-review の材料として skill `pdh-decision-board` の `close-gate.md` にある。

## 出力

### 機械で確かめるもの

`./ticket.sh close` が成功する（note の Checklist に未了が残っていると拒否される）。

### 判断で確かめるもの（誰が判断し、どこに残すか）

- [ ] PDH-close: PM: PDH-human-review で承認された内容と、merge・push・deploy の状態が progress に残っている

## 例外

- **ticket を中止する**: 中止の理由を ticket と progress へ記録してから、`./ticket.sh cancel` を実行する。cancel した ticket は `tickets/done/` に残す。判断の履歴なので削除しない
- **`./ticket.sh close` が拒否された**（note の Checklist に未了が残っている）: 未了の行を片付けるか、`- [-] ... - skip: <理由>` にしてから close し直す
