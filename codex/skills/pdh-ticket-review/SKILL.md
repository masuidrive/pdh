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
2. ticket の Architectural-Invariants-check を、`product-brief.md` の Architectural Invariants と 1 つずつ突き合わせる

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

### AC の場面の頻度を測る

この規則の目的: 承認者が、現実に起きる頻度と失敗のコストを知って AC の範囲を決められること。«必ず〜» «すべての〜» のように絶対の形で AC を書く前に、端の場面の頻度を測る手段・担当・コマンドを `Required-Probes` に書いて実行する。既存のログ・データで測れるなら実測し、期間・母数・件数を残す。実測できなければ推定と根拠・未確認の範囲を明記する。頻度と 1 回のコストが Failure Tolerance の目安に収まる場面は、AC の範囲から外すか、«止めて知らせる» 動作にして AC の承認で決める。

### AC が達成できるかを確かめる

- 実行する前に担当を分ける。PM は読み取り・検索・使い捨てコマンドによる事実の測定を行い、test runner・E2E・doc 再生成は調査用の worker に委譲する。Required-Probes の各行には担当とコマンドを書く。実行結果は同じ行の証拠として progress へ残す
- 達成できると確かめていない AC は、確かめる手段を note の `## Required-Probes` に書き、この PDH-stage の中で実行する。実行した command と output を progress に書いてから、note の行を `[x]` にする（`[SKILLS_PATH]/pdh-pm/_records.md`）
- 実装しないと分からない AC は、«測って記録する＋この値を下回ったら止めて報告する» の形に書き直す

### 初期状態と、AC の組の順番を確かめる

note の先頭行の `<!-- pdh-note-format: 2 -->`（書式の印）を置く雛形で作った note は、書式の印が欠けていたら先頭行へ戻す。書式の印を置かない古い雛形で作った ticket には以下の節を足さず、同じ記録と表を progress に書く。

この規則の目的: 承認者が、いちばん悪い初期状態と経路をまたぐ操作でも AC の約束が成り立つと確かめられること。未初期化の設定や空の保存先など、いちばん悪い初期状態を Required-Probes に測る行として置く。実行した command と結果を progress に残し、行を `[x]` にして、note の `## 承認前の記録` に `いちばん悪い初期状態: 測った` と `いちばん悪い初期状態の記録: <結果の所在>` と書く。当たる場面が無ければ Required-Probes の行を理由つき skip にし、同じ記録の節に `いちばん悪い初期状態: 当たらない` と `いちばん悪い初期状態の記録: <理由>` と書く。

AC が 2 件以上なら、同じデータや状態を別の経路で触る AC 同士の組と、AC と既存の経路（CLI・画面・定期処理など）の組ごとに、note の `## AC の組の順番` へ次の表を書く。各順番で、回数の上限や同じ結果になる約束を照合し、`## 承認前の記録` に `AC の組の順番: 表` と書く。当たる組が無ければ、同じ記録の節に `AC の組の順番: 当たる組なし` と `AC の組の順番の理由: <理由>` と書く。

| AC の組 | 経路と順番 | 順番ごとの約束 |
|---|---|---|
| <AC の番号> | <CLI → 画面 → CLI など> | <各順番で約束が成り立つ根拠> |

PDH-ticket-human-review へ Status を進めたら、承認者に渡す前に `pdh-pm`「承認の PDH-stage」の処理 2 で `bash scripts/check-pdh-ticket.sh` を回す。機械は決まった欄の決まった語だけを数え、記録の所在・非該当の理由・順番の表の中身は下の判断の Checklist で PM が確かめる。

### 別件として残された finding を拾う

この規則の目的: 別の ticket で見つかって起票・集約された finding を、同じ箇所を変えるこの ticket が見落とさないこと。次の 2 つを探し、取り込むかを決める。取り込むなら AC か Out-of-scope に書いて承認者に渡す。

- この ticket を指す `起票:` の行 — `git grep -n '起票:.*→ <この ticket 名>' -- <tickets_dir>`（done を含む）
- `pickup-timing: when-touching` の ticket のうち、この ticket が変える箇所に触るもの — `git grep -lE '^[[:space:]]*(-[[:space:]]+)?pickup-timing:[^<]*when-touching' -- <tickets_dir>` で出た ticket の anchor を、この ticket の影響範囲と突き合わせる

0 件でも、実行したコマンドと «0 件» を progress に書く。

`AGENTS.md` が定める制約の文書（既定 `docs/known-limits.md`）の anchor と、この ticket が触るファイルを突き合わせ、当たる行だけ一緒に直すか残すかを決める。Failure Tolerance の目安を変えたときは全行を見直す。

### コストと利益を確かめる

承認者が «この利益に、このコストを払うか» を判断できるように、次の 5 行を note の `## PDH-ticket-review. Ticket contract check` に書く。コストの数え方は `PDH-AGENTS.md`「変更のコストの数え方」に従う。

- `Feasibility:` AC を技術的に達成できるか。確かめた方法（読んだコード・実行したコマンド）を添える
- `DB-changes:` 値は あり か なし の1語だけを書く。説明は `DB-changes の内容:` に書く。DB のスキーマの変更か既存データの変換が要るか。要るなら、AC がそれを求めるのか、作り方によっては避けられるのかを書く。要らなければ «なし»。`product-brief.md` の Solution・Constraints が挙げる対象（この ticket が扱わないものを含む）を後で足すとき、この DB の形を作り直すことになるかも書く（元の記録から作り直せる表は数えない）
- `API-changes:` 同じく値は あり か なし の1語だけを書く。説明は `API-changes の内容:` に書く。他者が使う契約（HTTP API・SDK・CLI・webhook・設定ファイルの形式）が変わるか。変わるなら、使っている側と、互換を保てるかを書く。変わらなければ «なし»。DB と同じく、Brief が挙げる対象を後で足すとき、この契約（識別子・URL を含む）を作り直すことになるかも書く。DB/API とも、作り直しの見込みは «なし» の場合も書く。後で作り直しになるなら あり と書く
- `Complexity:` 変更する部分、増える（減る）行のおおよその規模、既存の仕組みで足りるか新しい仕組みが要るか。後に残る負債として、コストに数える
- `Benefit:` 誰の何が良くなるか。Why と `Key-User-Journeys:` から書く

コードは、この 5 行に答えられるところまで読み、実行する。作り方は決めない — テーブル・列・関数の形を選ばず、ticket の Design-Decisions にも書き足さない。作り方を決めるのは PDH-implement で、ここで決めると、実装で確かめていない制約が実装の前に入る。

### 前提を疑う

書式の印を置かない古い雛形で作った note には «承認前の記録» の節を足さず、以下で求める同じ記録を progress に書く。

この規則の目的: 承認者が、戻しにくい判断の前提を別の engine が疑った結果で AC を承認できること。note の `DB-changes:` か `API-changes:` の値が «あり» のときは、承認を求める前に前提の見直しを必ず 1 回回す。回さない選択は無い。両方が «なし» のときも、新しい仕組み（状態の置き場所・受け口・定期処理）を作るなら回すことを勧める。その場合だけ回すかは PM が決め、回した結果か回さなかった理由を progress に残す。

1. 回すのは、経緯を持たない worker 1 人である。engine は PM と別にし、model と effort は `[SKILLS_PATH]/pdh-pm/_execution-team.md`「エンジン割り当て」の «前提の見直し» に従う。worker の手順は `.codex/agents/pdh-ticket-reviewer.toml` の «前提を疑う» にある
2. 渡すのは、依頼の原文・Why・AC の案・Required-Probes の結果・`product-brief.md` の全体・外の契約（API などの仕様）・いまの base のコードと文書だけである。ticket の `Design-Decisions` と、この ticket に出た review の finding は渡さない
3. 問いと、案ごとに書かせる項目は `[SKILLS_PATH]/pdh-review/SKILL.md`「収束」の S7 と同じものを prompt に書く
4. 出た案・選んだ案と外した理由を progress に書き、note の `## 承認前の記録` に `前提の見直し: 済み` と `前提の見直しの記録: <結果を書いた progress の path か worker の結果の絶対 path か URL>` と書く。選んだ案が ticket の `Design-Decisions` と違えば、ticket を直してから先へ進む
5. DB/API とも «なし» のため任意で回さなかったときだけ、その理由を progress に 1 行書き、`## 承認前の記録` に `前提の見直し: 不要` と書く。承認前の検査は上の「初期状態と、AC の組の順番を確かめる」と同じ手順で回す

### AC が触る consumer surface を書く

AC が触る consumer surface（UI・HTTP API・SDK・CLI・設定・生成物・ログ・メトリクスなどの観測の出力）を、note の `## PDH-ticket-review. Ticket contract check` に列挙する。

### AC だけで伝わるかを確かめる

1. この PDH-stage で書き換えた AC が、`[SKILLS_PATH]/pdh-ticket-write/SKILL.md`「AC の書き方」を満たしているかを確かめ直す。書き換えていない AC は、PDH-ticket-write の «出力» で確かめてある
2. What 冒頭の 1 文と AC 全件だけを、AC だけを読む worker（agent 定義 `pdh-ac-reader`）に渡し、«終わると誰が何をできるようになるか» を答えさせる。この worker は repo を読む tool を持たない。CLI で起動するとき（`claude -p`・`codex exec`）は、`.codex/agents/pdh-ac-reader.toml` の本文から frontmatter を除いたものを、What 冒頭の 1 文・AC 全件と一緒に prompt に転記して渡す。Claude Code の in-process spawn で定義名 `pdh-ac-reader` を指定して起動するときは、本文が worker 自身の指示として読み込まれるので転記せず、What 冒頭の 1 文と AC 全件だけを渡す（転記すると本文が 2 重になる）
3. 答えが意図と合わない AC と、答え (3) の «結果ではなく手段を書いた AC» を、得たい結果を書く AC へ書き直し、書き直した AC だけをもう一度渡す
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

- [ ] PDH-ticket-review: 前提の見直しを回したなら、出た案と選んだ理由が progress にある。回さなかったなら、その理由を書いた
- [ ] PDH-ticket-review: PM が承認前の記録の所在と中身・非該当の理由・AC の組の順番の表を照合し、DB/API の変更時の前提の見直しの結果が progress にある。絶対の形の約束と実装で測る値が矛盾せず、端の場面・順番でも約束が成り立つ根拠が note と progress にある
- [ ] PDH-ticket-review: 絶対の形の AC は、Required-Probes に場面の頻度を測った結果と 1 回のコストがあり、Failure Tolerance と照合した範囲になっている
- [ ] PDH-ticket-review: 変更箇所と制約の anchor を照合し、該当行を直すか残すかが progress にある。目安の変更時は全行を見直した
- [ ] PDH-ticket-review: AC だけを読む worker が、全 AC に «復元できた» を返した。PM が結果を progress に残す
- [ ] PDH-ticket-review: 残っている `Open-Questions` が、承認者にしか決められないものと、実装しないと分からないものだけである。PM が判断し、残した理由を note の `## PDH-ticket-review. Ticket contract check` の節に書く
- [ ] PDH-ticket-review: Design-Decisions の各項を AC と 1 件ずつ突き合わせ、AC と食い違う項（ある条件で AC が求める振る舞いを壊す作り方）が無いか確かめた。あれば Open-Questions に残した
- [ ] PDH-ticket-review: コストと利益の 5 行が、作り方を決めずに書かれている（テーブル・列・関数の形を選んでいない）。PM が読んで判断する
- [ ] PDH-ticket-review: この ticket を指す `起票:` の行と、`pickup-timing: when-touching` の ticket のうち同じ箇所に触るものを探し、コマンド・件数（0 件を含む）・取り込むかの判断が progress にある

## 例外

- Why・AC が `product-brief.md` の目的や Architectural Invariants と矛盾する → AC を書き進めず、ユーザに聞く。Product Brief を先に直すかを決めてもらう（`PDH-AGENTS.md`「PDH の構造」）
- `Dependencies` が終わっていない → 待つか、scope を変えるかを、ユーザに聞く
- Required-Probes の実行に、課金 API・本番データ・外部への送信が要る → 実行する前にユーザに聞く（`PDH-AGENTS.md`「確認が要るのは判断であって、調査ではない」）
- 2 回書き直しても、worker が復元できない AC が残る → 残った AC と worker の答えを示して、ユーザに聞く
- ユーザへの聞き方は `pdh-pm`「中断するときと再開するとき」に従う。承認者にしか決められない `Open-Questions` は例外ではなく、PDH-ticket-human-review で聞く
