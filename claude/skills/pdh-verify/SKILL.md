---
name: pdh-verify
description: "PM 専用。PDH-verify で読む。出荷する commit で AC と consumer surface が実際に動くことを、QA Engineer・AC 裏取り・Surface Observer に証拠で確かめさせ、close 前 review を回す。各 worker の手順は .claude/agents/ の pdh-qa.md・pdh-ac-verifier.md・pdh-surface-observer.md の本文にある。"
---

# PDH-verify

この規則の目的: 出荷する commit で AC と consumer surface が実際に動くことを、実装者とは別の worker が証拠で確かめてから出荷すること。
PM がこのファイルを読む。QA Engineer・AC 裏取り・Surface Observer の手順は、それぞれ `.claude/agents/pdh-qa.md`・`.claude/agents/pdh-ac-verifier.md`・`.claude/agents/pdh-surface-observer.md` の本文にある。

## 入力

- ticket が worktree で開かれていて、note の Status は `PDH-verify`
- PDH-review の «出力» を通っている

## 処理

`bash scripts/docs-toc.sh --stage PDH-verify` を実行し、出力の読む場面と見出しから ticket に関係する文書・節だけを開く。

文書の frontmatter 検査を採用している場合、文書と関連する入力の最終内容を照合し、`[TICKET_DIR]/related-docs.md` の記録を `python3 scripts/docs-policy.py record` で更新する。記録の形式は `pdh-ticket-review`「関係する文書を読む」に従う。

PM は次の順に回す。test 結果・AC の判定・consumer surface の観察は、どれも正確な commit SHA に結び付いている。

1. AC 裏取りの worker を 1 人起動し、各 AC の実質的な達成を検証させる（手順は `.claude/agents/pdh-ac-verifier.md`）。`NOT VERIFIED` は証拠を補うのが既定である。権限・環境の制約で補えないと AC 裏取りの worker が理由と足りない証拠を示した AC だけは、下の「未確認の出口」で承認者へ渡す
2. ticket の各 AC と note の Checklist を、1 項目ずつ確認して check する。未確認の AC を達成済みの `[x]` にしない
3. 最終 HEAD で `scripts/test-all.sh` を再実行し、結果を progress へ残す。実行する場所（手元か CI か）は `CLAUDE.md` が決める。手元なら実出力を貼り（貼り方は `.claude/agents/pdh-qa.md`「結果の貼り方」）、CI なら run の URL と結果を書く。最終 SHA のフルスイートを PR の CI に委ね、verify の時点ではまだ走らない運用（`CLAUDE.md` か bot の手順書が決める）では、委ねた先の workflow 名・対象の SHA・merge を止める必須のチェックの名前を書く。⚠ **まだ走っていない run を成功と書かない**
4. 利用者から観察できる変更（画面・HTTP API・CLI・SDK）があるなら、`./scripts/dev-server.sh --seed` を実行してから Surface Observer を起動し、利用者の視点で観察させる（手順は `.claude/agents/pdh-surface-observer.md`）。変更した層で決めない — backend だけの変更でも HTTP API が変われば観察する。利用者から観察できる変更が無いときだけ、progress に 1 行残して skip する
5. AC を check した ticket file を含めて commit する
6. close 前 review: 最後に review した SHA の後に入った ticket 自身の commit を review する。**この規則の目的: close へ進む ticket 自身の commit を、すべて review が読んでいること**
   - reviewer への指示文は `bash scripts/pdh-review-range.sh <ticket dir> --from last-review --prompt` の出力にする。区間は base の取り込みで入った変更を含まない。diff の基点を指定する形（`--base` など）で代用しない
   - 指示文には review 対象の commit SHA を明記し、reviewer はその SHA を読む。`[SKILLS_PATH]/pdh-pm/_execution-team.md`「review 専用 worktree」で起動前後の HEAD と作業ツリーを照合する
   - exit 3 は区間が空なので、review を回さない。exit 2（起点の行が無い・起点が履歴に無い）は ticket の差分全体を review する
   - 回した HEAD を progress へ `close-gate-sha:` の行で追記する（区間が空なら SHA の後に `区間が空` と書く）。`tickets/` だけの commit は区間に入らない
   - review の実行中に ref が動いたら、`pdh-review`「例外」の ref に commit が積まれた場合の比較と判定に従う。記録だけの差分かを確かめずに結果を採用しない
   - この後に ticket 自身の変更を commit したら、その修正差分に対してもう一度回す。`scripts/check-pdh-ticket.sh` が、`close-gate-sha:` の後に残った ticket 自身の変更と、`PDH-close` なのに行が無いことを落とす

### 未確認の出口

この規則の目的: 承認者が、権限・環境の制約で補えなかった証拠を把握し、未確認の AC を残して閉じるかを決められること。

PM は、AC 裏取りの worker が書いた権限・環境の制約の理由と足りない証拠を progress に残す。その AC は close の板（`pdh-decision-board/close-gate.md`「AC ごとの達成」）へ «未確認（理由・足りない証拠）» として出し、VERIFIED には数えない。

板の待ち行は、`pdh-pm`「承認の PDH-stage」の手順どおり note の Checklist に置く。`check-pdh-ticket.sh` の一般の待ち行検査が数える。PR の merge を close の承認とする運用では、`- [-] close の回答待ち 発行先: <板の URL か絶対 path> - skip: close の承認は PR の merge で受ける` とする。この待ち行は回答済みを意味しない。

github-bot の `pr-merge` で未確認の AC があるときは、merge の前に «未確認のまま閉じるか» を別の質問として出し、明示の回答を受ける。その回答を受けてから処理 5 に従って AC の処置と承認 hash を更新し、done への移動と PR の merge による close の承認へ進む。

承認者が未確認のまま閉じることを明示で承認したら、`pdh-pm`「承認の PDH-stage」の処理 5 に従い、AC の処置と承認 hash を更新する。承認を VERIFIED に読み替えない。差し戻しなら証拠の補完へ戻る。

この PDH-stage の最後に、下の「出力」を確かめる。

## 出力

### 機械で確かめるもの


- [ ] PDH-verify: 最終 HEAD の `scripts/test-all.sh` の結果（実行する場所は `CLAUDE.md` が決める。CI なら run の URL）が progress にある。PR の CI に委ねる運用（`CLAUDE.md`・bot の手順書が決める）では、委ねた先（workflow 名）・対象の SHA・merge を止める必須のチェックの名前が progress にある。未実行を成功と書かない
- [ ] PDH-verify: worktree で `bash scripts/check-pdh-ticket.sh` が通る（引数は取らず、その branch の ticket を確かめる）

### 判断で確かめるもの（誰が判断し、どこに残すか）

- [ ] PDH-verify: close 前 reviewer の専用 worktree の HEAD と作業ツリーを起動前後に照合し、結果が progress にある（区間が空なら skip 理由がある）

- [ ] PDH-verify: QA Engineer: retry-pass があれば、件数と test 名が progress にある
- [ ] PDH-verify: AC 裏取り: 全 AC を判定し、`NOT VERIFIED` は 0 件、または権限・環境の制約で補えず未確認として板に出した AC だけである。理由と足りない証拠を worker が報告し、結果を progress に残した。VERIFIED の AC だけを `[x]` にし、未確認を達成件数へ数えない
- [ ] PDH-verify: Surface Observer: 利用者の視点での観察結果が、テストした commit SHA と一緒にある。利用者から観察できる変更が無ければ «該当なし» の 1 行を progress に残す
- [ ] PDH-verify: PM: close 前 review を回し、回した HEAD を progress に `close-gate-sha:` の行で追記した

## 例外

- 手順の途中で ticket 自身の変更を commit した: その変更が影響しうる証拠を取り直させる
- Surface Observer が認証方法を報告したら、PDH-human-review の前にユーザへ説明する
- Surface Observer がブラウザ検証をできないと報告したら、`curl` での代用を検証済みとせず、ユーザに確認する
