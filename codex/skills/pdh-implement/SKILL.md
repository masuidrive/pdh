---
name: pdh-implement
description: "PM 専用。PDH-implement で読む。承認された AC を満たすコード・テスト・実装の記録を Coding Engineer に作らせ、出力を確かめる。Coding Engineer の手順は .codex/agents/pdh-coding-engineer.toml の本文にある。"
---

# PDH-implement

PDH-implement は、承認された ticket を受け取り、AC を満たすコードとテストと実装の記録を作って、reviewer と QA が確かめるだけで済む状態にする。
PM がこのファイルを読む。Coding Engineer の手順は `.codex/agents/pdh-coding-engineer.toml` の本文にある（起動の仕方は `[SKILLS_PATH]/pdh-pm/_execution-team.md`）。

## 入力

- ticket が worktree で開かれていて、note の Status は `PDH-implement`
- AC が承認されていて、承認の答えが progress にある
- PDH-human-review から差し戻されたときは、差し戻しの理由が progress にある
- 作業が中断して再開したときは、途中までの commit がある

## 処理

`bash scripts/docs-toc.sh --stage PDH-implement` を実行し、出力の読む場面と見出しから ticket に関係する文書・節だけを開く。

- 実装は Coding Engineer 1 人に任せる
- 整合性の検査の後に QA を起動して完了を確かめる（QA の手順は `.codex/agents/pdh-qa.toml`）。失敗は Coding Engineer へ戻す
- Coding Engineer が `.codex/agents/pdh-coding-engineer.toml`「実装中に AC より Why に合う作り方が見つかったら、AC の書き換えを提案する」の提案を出したら、そのままユーザに持ち込んで再合意を取る（`.codex/agents/pdh-coding-engineer.toml`「ticket の変更は再合意で行う」）。承認されてもされなくても、結果を progress に 1 行残し、close の報告でその発見を挙げる
- 同じ ticket で AC が何度も変わるなら、AC を再合意する前に Why を合意し直す
- Coding Engineer の結果の `## Open-Questions Summary` と、`[TICKET_DIR]/note.md` の `## Open-Questions` の未了の行を読み、1 行ずつ処置を決める。PM が決められるものは決めて `[x]` にし、決めた内容を同じ行に書く。承認者が決めるもの（ユーザが選んだ確定判断や利用者に見える振る舞いを変えるもの）は、影響する経路を再開する前に変更案と影響を示して合意し、ticket と progress に答えを反映して `[x]` にする。合意した結果を保つ未指定の実装方法は Coding Engineer が選ぶ。PM が見ないまま残ると、既定の値で決めたことを承認者が知らずに close を承認する
- 実装や review の作業を巻き戻すと決めたら、巻き戻す前に `.codex/agents/pdh-coding-engineer.toml`「finding を直すときは、壊していないことを反例で固定する」の最後の段落の手順を済ませる

この PDH-stage の最後に、下の「出力」を確かめる。

## 出力

AC を満たすコードとテストが commit されていて、Coding Engineer の完了報告の要点（確かめた結果・回せなかったもの・AC の書き換え案の有無）が progress にある。

`- [ ] PDH-implement:` で始まる行は、この PDH-stage のチェックリストである。この PDH-stage に入るとき、`bash scripts/pdh-stage-checklist.sh PDH-implement --enter [TICKET_DIR]/note.md` が note の `## Checklist` へ写す。確かめたら `[x]` にし、当てはまらない行は `- [-] ... - skip: <理由>` にする。

チェックリストの行の括弧にある「…」の節は、`.codex/agents/pdh-coding-engineer.toml` の節である。

### 機械で確かめるもの

- [ ] PDH-implement: `scripts/test-all.sh` の結果（実行する場所は `AGENTS.md` が決める。CI なら run の URL）が progress にある

  フルスイートを PR の CI に委ね、draft の間は走らない運用（`AGENTS.md` か bot の手順書が決める）では、この行の «結果» を 2 つで満たす — 手元で回した scoped test の実出力と、委ねた先（workflow 名・対象の SHA・merge を止める必須のチェックの名前）。⚠ **まだ走っていない run を成功と書かない。**PDH-review と PDH-verify も同じ形を受け取る

### 判断で確かめるもの

- [ ] PDH-implement: 変えるファイルの `git log` と、書き換える行の `git blame` を見て、関わる commit を読んだ（「変えるファイルの最近の変更を読む」）
- [ ] PDH-implement: 書く前に、確かめていない仮定を列挙し、測れるものは測った（「書く前に、依存している仮定を測る」）
- [ ] PDH-implement: AC 全件と合意済みの画像を、できたものと 1 項目ずつ突き合わせ、合わない項目は直したか違えた理由を書いた
- [ ] PDH-implement: 外部 provider・API を経由する path を実 API で 1 経路以上確かめ、status と body の抜粋を progress に貼った（credential が無いなら、無いと書いた）
- [ ] PDH-implement: 変えた identifier・field・API path・enum 値の旧名を grep し、出力を完了報告に貼った
- [ ] PDH-implement: 変更が正しく入ったかの確認は `[TICKET_DIR]/tests/` の ticket-local-test に置き、`scripts/test-all.sh` と CI に足したのは ticket の名前を出さずに書ける製品の約束だけである
- [ ] PDH-implement: 追加・変更した application-test を `.codex/agents/pdh-qa.toml`「追加された application-test の検査」に従って検査した
- [ ] PDH-implement: «AC より Why に合う作り方»（AC の書き換え案）を提案したか、無かったと完了報告に書いた
- [ ] PDH-implement: 作業中に気づいたバグを、別の commit で直したか PM へ渡し、完了報告に挙げた（無ければ無いと書いた）
- [ ] PDH-implement: note の `Open-Questions` の未了の行を、PM が 1 行ずつ処置した（この skill の「処理」）
- [ ] PDH-implement: PM が、完了報告の主張を diff と progress の実出力で確かめた
- [ ] PDH-implement: PM が、完了報告の要点（確かめた結果・回せなかったもの・AC の書き換え案の有無）を progress へ写した。完了報告の `<RESULT_FILE>` は git 管理外の `<TMP_DIR>` にあり、session や run が終わると消える

## 例外

- Coding Engineer が作業を止めて返した（止める条件は `.codex/agents/pdh-coding-engineer.toml`「例外」）: 結果の `STATUS: BLOCKED - <reason>` と、該当した条件・試した方法と却下理由・止めた経路・続けた作業を、PM が progress.md の最後へ追記する。影響する経路は合意まで止め、依存しない承認済みの作業は続ける（`pdh-pm`「中断するときと再開するとき」）
