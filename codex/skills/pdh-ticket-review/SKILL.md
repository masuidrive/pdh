---
name: pdh-ticket-review
description: "PM 専用。PDH-ticket-review で読む。worktree で開かれた ticket の AC と作り方の判断を、実際のコード・データ・資料で確かめ、PDH-ticket-human-review で承認者が AC だけを読んで承認できる形にする。AC だけを読む worker の手順は .codex/agents/pdh-ac-reader.toml の本文にある。"
---

# PDH-ticket-review

PDH-ticket-review は、worktree で開かれた ticket を受け取り、AC と作り方の判断を実際のコード・データ・資料で確かめて、承認者が AC だけを読んで承認できる ticket と、確かめた結果の記録を作る。
PM がこのファイルを読む。AC だけを読む worker の手順は `.codex/agents/pdh-ac-reader.toml` の本文にある。

## 入力

- ticket が worktree で開かれている。ticket・note・progress のパスと、作業する worktree のパスが分かっている
- note の Status は `PDH-ticket-review`
- PDH-ticket-human-review から差し戻されたときは、差し戻した理由が progress にある

## 処理

PDH-ticket-human-review から差し戻されたときは、progress にある差し戻しの理由に関わるところから確かめる。

### Product Brief と矛盾しないかを確かめる

1. Why が `product-brief.md` のどの目的とジャーニーにつながるかを、ticket の `Key-User-Journeys:` の行と突き合わせる
2. ticket の Architectural-Invariants-check を、`product-brief.md` の Architectural-Invariants と 1 つずつ突き合わせる

矛盾があれば「例外」へ。

### 関係する文書を読む

`bash scripts/docs-toc.sh --stage PDH-ticket-review` を実行し、出力の読む場面と見出しから ticket に関係する文書・節だけを開く。 AC・作り方の判断に効く内容は ticket へ反映する。文書の frontmatter 検査を採用している場合、読んだ節と採否は `[TICKET_DIR]/related-docs.md` に残し、照合を終えた節は次のコマンドで記録する。`<base>` は close の文書検査と同じ基点にする。

```sh
python3 scripts/docs-policy.py record docs/example.md#scope --base <base> --note [TICKET_DIR]/note.md --resolution unchanged --reason '今回の変更でも契約が変わらない理由'
```

記録は YAML の fenced block に `id`・`document`・`document-hash`・`inputs-hash`・`trigger`・`resolution`・`reason` を持つ。`resolution` は updated / unchanged / retired / not-applicable。unchanged と not-applicable には理由が要る。文書と stale-when の path に当たる内容を後から変えると照合は未了に戻る。使う前の外部照会（check と expect）や方針・計画の変更（event）は、その条件に依存する担当が照合する。

### 調べれば分かることを、調べて決める

次を、実際のコード・データ・資料で確かめて決める。決めた値は ticket に書き、«未確認» のまま残さない。

- `Open-Questions` 全件。残してよいのは、承認者にしか決められないものと、実装しないと分からないものだけ
- ticket の中の «未確認» «要確認» «見込み» «はず» «思われる» «かもしれない»（grep で探す）
- «変更なし» «不変の見込み» と書いた contract・data model の行
- 影響範囲。挙げた範囲を grep で確かめ、挙げなかった範囲が無関係であることも確かめる
- 断定しているフィールド名・関数名・呼び出し元の数・件数
- 合意に使われた資料（画像・ファイル・URL の先）。`[SKILLS_PATH]/pdh-ticket-write/SKILL.md`「添付・リンクされた資料」の 3 点が ticket に書かれているか
- `Dependencies` が終わっているか
- AC の中の次の書き方。調べて値を決めてから書き直す
  - 測っていない数値目標
  - 可否を条件にした分岐
  - 文面の無い «◯◯が入る»
  - 対象を列挙していない件数

### AC が達成できるかを確かめる

- 実行する前に担当を分ける。PM は読み取り・検索・使い捨てコマンドによる事実の測定を行い、test runner・E2E・doc 再生成は調査用の worker に委譲する。Required-Probes の各行には担当とコマンドを書く。実行結果は同じ行の証拠として progress へ残す
- 達成できると確かめていない AC は、確かめる手段を note の `## Required-Probes` に書き、この PDH-stage の中で実行する。実行した command と output を progress に書いてから、note の行を `[x]` にする（`[SKILLS_PATH]/pdh-pm/_records.md`）
- 実装しないと分からない AC は、«測って記録する＋この値を下回ったら止めて報告する» の形に書き直す

### コストと利益を確かめる

承認者が «この利益に、このコストを払うか» を判断できるように、次の 5 行を note の `## PDH-ticket-review. Ticket contract check` に書く。コストの数え方は `PDH-AGENTS.md`「変更のコストの数え方」に従う。

- `Feasibility:` AC を技術的に達成できるか。確かめた方法（読んだコード・実行したコマンド）を添える
- `DB-changes:` DB のスキーマの変更か既存データの変換が要るか。要るなら、AC がそれを求めるのか、作り方によっては避けられるのかを書く。要らなければ «なし»
- `API-changes:` 他者が使う契約（HTTP API・SDK・CLI・webhook・設定ファイルの形式）が変わるか。変わるなら、使っている側と、互換を保てるかを書く。変わらなければ «なし»
- `Complexity:` 変更する部分、増える（減る）行のおおよその規模、既存の仕組みで足りるか新しい仕組みが要るか。後に残る負債として、コストに数える
- `Benefit:` 誰の何が良くなるか。Why と `Key-User-Journeys:` から書く

コードは、この 5 行に答えられるところまで読み、実行する。作り方は決めない — テーブル・列・関数の形を選ばず、ticket の Design-Decisions にも書き足さない。作り方を決めるのは PDH-implement で、ここで決めると、実装で確かめていない制約が実装の前に入る。

### AC が触る consumer surface を書く

AC が触る consumer surface（UI・HTTP API・SDK・CLI・設定・生成物・ログ・メトリクスなどの観測の出力）を、note の `## PDH-ticket-review. Ticket contract check` に列挙する。

### AC だけで伝わるかを確かめる

1. この PDH-stage で書き換えた AC が、`[SKILLS_PATH]/pdh-ticket-write/SKILL.md`「AC の書き方」を満たしているかを確かめ直す。書き換えていない AC は、PDH-ticket-write の «出力» で確かめてある
2. What 冒頭の 1 文と AC 全件だけを、AC だけを読む worker（agent 定義 `pdh-ac-reader`）に渡し、«終わると誰が何をできるようになるか» を答えさせる。この worker は repo を読む tool を持たない。CLI で起動するとき（`claude -p`・`codex exec`）は、`.codex/agents/pdh-ac-reader.toml` の本文から frontmatter を除いたものを、What 冒頭の 1 文・AC 全件と一緒に prompt に転記して渡す。Claude Code の in-process spawn で定義名 `pdh-ac-reader` を指定して起動するときは、本文が worker 自身の指示として読み込まれるので転記せず、What 冒頭の 1 文と AC 全件だけを渡す（転記すると本文が 2 重になる）
3. 答えが意図と合わない AC を書き直し、書き直した AC だけをもう一度渡す
4. worker の答えに合わせて AC を足さない。worker が復元できないのは AC の書き方の問題で、AC を足すと、ユーザが頼んでいない約束が増える

### 確かめた結果と、変えたことを書く

- note の `## PDH-ticket-review. Ticket contract check` に、確かめた結果を書く。Product Brief との突き合わせ、`Dependencies`、残した `Open-Questions` と残した理由、コストと利益の 5 行、consumer surface の一覧
- この PDH-stage で変えた AC・作り方の判断・Out-of-scope と、変えた理由を progress に書く。PDH-ticket-human-review で承認者に渡す材料の «ticket review 中に変えた内容と理由»（`[SKILLS_PATH]/pdh-decision-board/ticket-gate.md`）は、ここから作る

## 出力

PDH-ticket-human-review に渡す ticket・note・progress が、次の状態になっている。

- AC は、調べれば分かることが決まっていて、AC だけを読む worker が全件を復元できる
- note の `## Required-Probes` が全部済んでいる
- note の `## PDH-ticket-review. Ticket contract check` に、確かめた結果、コストと利益の 5 行、consumer surface の一覧がある
- 残っている `Open-Questions` は、承認者にしか決められないものと、実装しないと分からないものだけである
- progress に、この PDH-stage で変えたことと理由がある

`- [ ] PDH-ticket-review:` で始まる行は、この PDH-stage のチェックリストである。この PDH-stage に入るとき、`bash scripts/pdh-stage-checklist.sh PDH-ticket-review --enter [TICKET_DIR]/note.md` が note の `## Checklist` へ写す。確かめたら `[x]` にし、当てはまらない行は `- [-] ... - skip: <理由>` にする。

### 機械で確かめるもの

worktree で、note のパスを入れて実行し、終了コードが 0 であることを確かめる。2 つ目からは、note の `## PDH-ticket-review. Ticket contract check` の節のコメントの外に、コストと利益の 5 行が値つきで書かれていることを確かめる。足りない行は `不足:` に続けて出る。

```bash
note='<note のパス>'
./ticket.sh check --require "Required-Probes" &&
sec=$(awk '/^## PDH-ticket-review\. Ticket contract check/{f=1;next} f&&/^## /{exit} f' "$note" |
  awk '/<!--/{c=1} !c{print} /-->/{c=0}') &&
missing=$(for k in Feasibility DB-changes API-changes Complexity Benefit; do
  printf '%s\n' "$sec" | grep -qiE "^[[:space:]]*(- )?$k:[[:space:]]*[^[:space:]]" || printf ' %s' "$k"
done) &&
{ test -z "$missing" || { echo "不足:$missing"; false; }; }
```

- [ ] PDH-ticket-review: `pdh-ticket-review`「機械で確かめるもの」のコマンドが 0 で終わった

### 判断で確かめるもの

- [ ] PDH-ticket-review: 文書の frontmatter 検査を採用している場合、関係する文書の内容を ticket に反映し、節ごとの採否・照合記録を `related-docs.md` に残した

- [ ] PDH-ticket-review: AC だけを読む worker が、全 AC に «復元できた» を返した。PM が結果を progress に残す
- [ ] PDH-ticket-review: 残っている `Open-Questions` が、承認者にしか決められないものと、実装しないと分からないものだけである。PM が判断し、残した理由を note の `## PDH-ticket-review. Ticket contract check` の節に書く
- [ ] PDH-ticket-review: Design-Decisions の各項を AC と 1 件ずつ突き合わせ、AC と食い違う項（ある条件で AC が求める振る舞いを壊す作り方）が無いか確かめた。あれば Open-Questions に残した
- [ ] PDH-ticket-review: コストと利益の 5 行が、作り方を決めずに書かれている（テーブル・列・関数の形を選んでいない）。PM が読んで判断する

## 例外

- Why・AC が `product-brief.md` の目的や Architectural-Invariants と矛盾する → AC を書き進めず、ユーザに聞く。Product Brief を先に直すかを決めてもらう（`PDH-AGENTS.md`「PDH の構造」）
- `Dependencies` が終わっていない → 待つか、scope を変えるかを、ユーザに聞く
- Required-Probes の実行に、課金 API・本番データ・外部への送信が要る → 実行する前にユーザに聞く（`PDH-AGENTS.md`「確認が要るのは判断であって、調査ではない」）
- 2 回書き直しても、worker が復元できない AC が残る → 残った AC と worker の答えを示して、ユーザに聞く
- ユーザへの聞き方は `pdh-pm`「中断するときと再開するとき」に従う。承認者にしか決められない `Open-Questions` は例外ではなく、PDH-ticket-human-review で聞く
