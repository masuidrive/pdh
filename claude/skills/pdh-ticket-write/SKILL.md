---
name: pdh-ticket-write
description: PM 専用。PDH-ticket-write で ticket を書くときと、PDH-ticket-review で AC を直すときに読む。
---

# PDH Ticket Write

PDH-ticket-write は、要望を受け取り、承認者が ticket だけを読んで «終わると誰が何をできるようになるか» と «何を約束するか» を決められる ticket を作る。
ticket を書く人は全部を読み、PDH-ticket-review で AC を直す人は「添付・リンクされた資料」と「AC の書き方」を読む。

## 入力

- 要望の原文（会話・issue・報告）と、それに添付・リンクされた資料がある
- `product-brief.md`（どの問題を解くか、Architectural-Invariants）がある
- ticket はまだ無いか、base branch の checkout に ticket・note・`progress.md` があって note の Status が `PDH-ticket-write` である。後者は、書く途中で作業が中断したとき（commit 前のこともある）と、PDH-open の «例外» でこの PDH-stage へ進んだときに当たる

## 処理

`bash scripts/docs-toc.sh --stage PDH-ticket-write` を実行し、出力の読む場面と見出しから ticket に関係する文書・節だけを開く。

### ticket を作る

ticket がまだ無いときだけ、`./ticket.sh help` を読み、`./ticket.sh new <slug>` を実行する。slug は英語のケバブケースで内容を短く表す。ticket が既にあるときに `new` を実行すると、同じ要望の ticket が別の名前でもう 1 つできる。

`new` の出力（ticket が既にあるときは `./ticket.sh list` の `ticket_path:`）で、ticket・note・`progress.md` のパスを確かめる。note と progress の記録形式は `[SKILLS_PATH]/pdh-pm/_records.md`「ticket / note / progress の役割分担」に従う。

ticket の節は `.ticket-config.yaml` の `default_content`、note の節は `note_content` に従う。生成された節と記入ガイドを読み、そこに無い節を前提にしない。

### 旧書式を移す

この規則の目的: 次の PM が、旧書式に残る依頼・判断待ち・承認済みの約束を失わずに現行の手順を始められること。

既存の ticket 名と 3 ファイルのパスを保ち、`new` は実行しない。`./ticket.sh list` で start 済みかを確かめ、start 済みなら `pdh-resume` で確定したその ticket の worktree で移行だけを行う。次の順で移す。

1. `.ticket-config.yaml` の `default_content` と `note_content` の節へ既存の内容を移す。progress は書き換えず、移した内容と旧 Status を追記する
2. 旧 Checklist の依頼・判断待ちは済み・未了・skip と理由を保って移す。旧 PDH-stage の行も消さず、現行の行への対応と、対応しない行の扱いを progress に残す。対応しない未了の工程行は理由付き `[-]` にし、ユーザの依頼と判断待ちは未了のまま残す
3. 承認済みの AC と Out-of-scope は文を変えずに写し、承認の記録も保つ。未承認の仮置き AC と Out-of-scope は、この skill の完成条件に従って書く。承認が読み取れないものは未承認として扱い、通常の実装前の承認を受ける
4. まだ start していない ticket は、Status を `PDH-ticket-write` にし、その stage の `--enter` で現行の行を写す。start 済みの ticket は Status を戻さず、現在の PDH-stage の Checklist と済んだ印を保つ。現在の PDH-stage の行が一つも無い場合だけ、その stage の `--enter` で写す。一部だけ欠けている場合は足りない行を手で足す。旧記録と現行の行の対応を照合した結果を progress に残す

移行の照合は下の出力の Checklist 行で数える。start 済みなら「旧書式からの移行では依頼・判断待ち・承認済みの約束を照合した」の行だけを note の Checklist へ手で足し、移行の結果を判定する。内容の対応と承認の有無は文章の意味によるため、PM が判断する。

### 添付・リンクされた資料

**要望・報告に添付・リンクされた資料（画像・mockup・ファイル・文書・URL の先）があれば、ticket の本文を書く前に開く。**文章は方向を書くが、資料は中身を決めていることが多い。ticket には次を書く。

- 資料があることと所在（投稿の URL・ファイル ID・リンク先）
- 資料が決めていること（画像なら文言・色・画面の移り方・並び順、文書やリンク先なら決まっている値・手順・制約）を、箇条書きで文字に起こしたもの。資料は git に入らず、リンク先は変わったり消えたりするので、ticket だけを読む人が資料を開かなくても分かるようにする
- 資料と違う判断をするなら、違えた理由。黙って変えない

### 要望の原文を残す

この規則の目的: 承認者と実装する人が、言い換えを通さずに依頼者の言葉を読めること。言い換えは目的をずらす（Slack の要望で、依頼者が «そうではない» «最低限やりたいのは…» と言い直した例がある）。

- `Why` の先頭に、依頼者の原文を `>` の引用でそのまま置く。最初の依頼だけでなく、後から届いた補足と答え（Slack のスレッドの返信・Issue のコメント）も、発言者と所在（permalink か URL）を添えて置く。要約しない
- 原文のうち «してほしいこと» を書いた文を 1 つずつ拾い、それぞれに対応する AC があるか、依頼者が了承した Out-of-scope があるかを確かめる。どちらも無い文は、AC に足すか、Out-of-scope の案として承認者に聞く。黙って落とさない
- 原文が形を指定していても «もっといい方法があればそれでもよい» と添えているなら、その形は AC ではなく作り方の候補として扱い、AC には依頼者が得たい結果を書く
- 原文の対象が 同じ機能を持つ別の入口（画面・API・SDK など）や同期の実行・非同期の job のどこまでに及ぶかを並べ、片方だけを対象にするなら、その理由を Out-of-scope に書いて承認者に聞く（`PDH-AGENTS.md`「PDH の構造」の «要望の本来の意図を読み取り…» の段落）

### Why を書く

`Why` には、`product-brief.md` のどの問題を解くかを書き、次の 2 行を埋める。

- `Reproduction-or-measurement:` 何を開いて・何を実行して・何が見えたか。バグなら再現手順と結果、要望なら原文の所在と、現状を 1 回確かめた結果
- `Why-not-fix-now:` 進行中の ticket から派生したなら、別の問題であり、かつそこで直すと高くつく理由（«高くつく» の意味は `PDH-AGENTS.md`「変更のコストの数え方」）。要望起点なら «該当なし（要望起点。進行中の ticket から派生していない）»

この ticket が良くする Product Brief の Key User Journeys（例: J3）を、`Key-User-Journeys:` の行に 1 つ以上書く。恩恵を受ける人と使い方は、`What` 冒頭の 1 文と AC が書くので、別の節は作らない。どのジャーニーにも当たらない ticket（内部の整理など）は «該当なし» と理由を書く。

### AC の書き方

`What / Acceptance Criteria` の冒頭に、次の形の 1 文を書く。

> この ticket が終わると、〈誰〉が、いままでできなかった〈何〉をできるようになる

各 AC は、この 1 文の分割としてだけ書く。ただし、今できることが変わらないことを確かめる AC には登場人物だけを求め、「いままでできなかった」を求めない。

AC には、承認者が観察できる振る舞いを書く。「〜できる」「〜が返る」「〜が表示される」の形にし、「適切に」「正しく」のような品質の形容詞は使わない。review 済み・テストが通る、のような工程の要件は note の `Checklist` に置く。

読める AC とは、承認者がその 1 行だけを読んで「満たされた場面」を頭の中で再生できる AC をいう。登場人物、その人がする操作、その人が見る結果が分かるように書く。登場人物は `What` 冒頭の 1 文から補えてもよい（`.claude/agents/pdh-ac-reader.md`「判定」）。

AC ごとに「承認者がこれを自分で確かめるとしたら、何をするか」に答える。答えが書けないなら、実装の言葉で決めた中身を `Design-Decisions` へ移し、AC には場面を残す。約束の中身は減らさない。

読み手は上級エンジニアである。平易な言葉への言い換えを求めるものではない。技術的な内容は避けず、承認者が decision-board や ticket の外を見なくても約束が分かるように書く。約束の本体が承認者の言葉で書かれていれば、実装上の識別子を括弧で添えてよい。

### 作り方の判断と対象外を書く

- `Architectural-Invariants-check` には、`product-brief.md` の `Architectural-Invariants` と矛盾しないことを 1 行で宣言する
- `Design-Decisions` には、作り方の判断と理由を書く。変更の影響範囲（区切り方は `CLAUDE.md` が決める。例: backend・frontend・SDK・docs）もここに挙げる
- `Out-of-scope` には、この ticket でやらないことを書く

ticket には signature・行番号・内部の処理の流れ・code snippet などの実装の詳細を書かない。書くと、実装で確かめていない作り方が承認の対象になり、PDH-implement が作り方を選べなくなる。`Implementation Notes` は、ユーザが明示した関数名・module 名を書くときだけ使う。

`Dependencies` は、先に完了している必要がある ticket があるときだけ書く。ticket の実行順はこの節で表し、ファイル名では表さない。

影響範囲は 1 つの ticket で全部扱う。分けると、片方だけが入った状態で close され、両側がそろうまで動かない。

AC と作り方の判断に、今回要らない拡張や将来の要件向けの設計を入れない。入れると、承認者が頼んでいない約束を承認することになり、増えた行と仕組みが負債として残る。

### 未決の事項を note に書く

未決の事項は、生成された note の `Open-Questions` に 1 件 1 行の `- [ ]` で書く（決まったら `[x]` にし、決まった内容を同じ行に書く）。確認が要る判断の扱いは `PDH-AGENTS.md`「確認が要るのは判断であって、調査ではない」と「止まる場面」に従う。

### start の前に commit する

«出力» の内容の判断と、機械のコマンドのうち clean 検査以外を先に行い、結果を progress に書く。`./ticket.sh new` が作った 3 つのファイル（ticket・note・`progress.md`）を、`./ticket.sh start` の前に base branch で commit する。その後に機械のコマンド全体を回して clean を確かめる。成功したら PDH-open への遷移と一緒に結果を progress に書き、該当の Checklist 行を `[x]` にして commit する。最後に clean 検査だけを再実行してから `start` する。commit しないまま `start` すると、`progress.md` だけが worktree へ移らず、main の checkout に未追跡のまま残る。

## 出力

ticket・note・`progress.md` が base branch に commit されていて、ticket が次の条件を満たしている。

`- [ ] PDH-ticket-write:` で始まる行は、この PDH-stage のチェックリストである。この PDH-stage では `./ticket.sh new` の直後に、`bash scripts/pdh-stage-checklist.sh PDH-ticket-write --enter [TICKET_DIR]/note.md` が note の `## Checklist` へ写す。確かめたら `[x]` にし、当てはまらない行は `- [-] ... - skip: <理由>` にする。

### 機械で確かめるもの

`./ticket.sh list` に対象の ticket が出ることを確かめる。次の `ticket_dir` に、作成時の出力で確かめたディレクトリを指定して実行する。

```bash
ticket_dir='<ticket のディレクトリ>'
test -f "$ticket_dir/ticket.md" &&
test -f "$ticket_dir/note.md" &&
test -f "$ticket_dir/progress.md" &&
grep -qiE '^[[:space:]]*Key-User-Journeys:[[:space:]]*(J[0-9]+|該当なし)' "$ticket_dir/ticket.md" &&
grep -qiE '^[[:space:]]*Reproduction-or-measurement:[[:space:]]*[^[:space:]<]' "$ticket_dir/ticket.md" &&
grep -qiE '^[[:space:]]*Why-not-fix-now:[[:space:]]*[^[:space:]<]' "$ticket_dir/ticket.md" &&
test -z "$(git status --porcelain -- "$ticket_dir")"
```

- [ ] PDH-ticket-write: `pdh-ticket-write`「機械で確かめるもの」のコマンドが 0 で終わった

### 判断で確かめるもの（誰が判断し、どこに残すか）

次を判断し、結果と根拠を progress に残す。PDH-ticket-review は、この判断結果を前提に、書き換えた AC だけを確かめ直す。

- [ ] PDH-ticket-write: 旧書式からの移行では依頼・判断待ち・承認済みの約束を照合した。生成された必須の節が埋まり、添付・リンクされた資料があれば、この skill の「添付・リンクされた資料」の内容が ticket に残っている
- [ ] PDH-ticket-write: `Key-User-Journeys:` の番号が Why の内容と合っている。«該当なし» なら、その理由が書いてある（形だけは`pdh-ticket-write`「機械で確かめるもの」のコマンドが確かめる）
- [ ] PDH-ticket-write: `Architectural-Invariants-check` の宣言が `product-brief.md` と整合している
- [ ] PDH-ticket-write: 依頼者の原文（後から届いた補足と答えを含む）が `Why` に引用で残り、«してほしいこと» の文ごとに、対応する AC か Out-of-scope の案がある（「要望の原文を残す」）
- [ ] PDH-ticket-write: `What` 冒頭の 1 文と AC 全件が「AC の書き方」を満たしている
- [ ] PDH-ticket-write: 実装の詳細、今回要らない拡張、将来の要件向けの設計が入っていない
- [ ] PDH-ticket-write: 未決の事項が note の `Open-Questions` に `- [ ]` で残っている

満たさない項目があれば直す。

## 例外

- 要望が `product-brief.md` の Architectural-Invariants と矛盾する、または Product Brief の前提が崩れている → ticket を書き進めず、ユーザに確認する。Product Brief を先に直す（`PDH-AGENTS.md`「PDH の構造」）
- 決めないと AC が書けない判断が残る → note の `Open-Questions` に書いたうえで、ユーザに聞く。聞き方と再開は `pdh-pm`「中断するときと再開するとき」に従う
- 添付・リンクされた資料が開けない（権限が無い・リンクが切れている）→ 資料が決めていることを推測で埋めず、開けないことと AC・範囲への影響を note の `Open-Questions` に書き、直ちにユーザに聞く。実装前の承認まで質問を保留しない。答えに依存しない調査だけは続けてよい。聞き方と再開は `pdh-pm`「中断するときと再開するとき」に従う
- `./ticket.sh new` か`pdh-ticket-write`「機械で確かめるもの」のコマンドが失敗する → 原因を調べる。解決できなければユーザに聞く
