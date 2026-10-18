---
name: pdh-resume
description: "PM 専用。作業が中断している ticket を再開するときに読む。「続けて」「再開して」と頼まれたとき、bot の同じ issue の 2 回目以降の run に使う。PDH-stage ではなく、note の Status は変えない。"
---

# PDH resume

pdh-resume は、作業が中断している ticket を受け取り、作業する worktree を確定する。そのうえで、作業がどの PDH-stage のどこまで進んでいたかを記録から読み取り、その PDH-stage の途中から続ける。PDH-stage ではないので、note の Status は変えない（変えると、どの PDH-stage の途中だったかが消える）。

## 入力

- 作業が中断している ticket。note の Status には、中断したときの PDH-stage の名前が入っている

## 処理

### 再開する ticket を決める

最初に `bash scripts/pdh-stage-checklist.sh --show` を実行する。作業ディレクトリの branch から ticket・Status・未了の行・読む skill を表示する（状態は変えない）。ticket が出たら、下の 1. と食い違わない限りそれを使う。«未確定» と出たら、次の順で決める。先にある手がかりほど確かで、後の手がかりと食い違えば先のほうに従う
1. 依頼が名指しした ticket。端末ではユーザの依頼の文や `/pdh-pm` の引数。bot では issue 番号で、その issue の branch で `./ticket.sh restore` を実行し、解決した ticket（frontmatter の `branch:` がその branch を指す ticket。前の run が引き継いだ既存の名前の ticket を含む）を先に使う。`restore` が ticket を解決しないときだけ、ticket 名を issue の作成日時と番号から `.github/coding-bot/_pdh.md` の式で計算する
2. 作業ディレクトリが、ある ticket の worktree なら、その ticket（その worktree で session を起動したとき）
3. `./ticket.sh list` の ticket。始まっている ticket は `status: doing`、PDH-ticket-write の途中で作業が中断している ticket は `status: todo` で出る。複数あってどれか決まらなければ、ユーザに聞く

### まだ始まっていない ticket は開かない

`./ticket.sh list` でその ticket が `status: todo` なら、`start` しない。note は `list` が出す `ticket_path:` と同じディレクトリにある。その note の Status で、次に使う skill を決める。

- `PDH-ticket-write`: 作業が PDH-ticket-write の途中で中断している。skill `pdh-ticket-write` に従って続ける
- `PDH-open`: skill `pdh-open` に従って ticket を始める

### ticket を開く

`[SKILLS_PATH]/pdh-pm/_open-ticket.md` の手順で開く。Status が `PDH-open` なら、PDH-open の途中で作業が中断している ticket なので、skill `pdh-open` に従う。

旧い書式の ticket・note なら、`pdh-ticket-write`「旧書式を移す」の start 済みの手順で、その worktree 内の移行だけを行う。Status と済んだ Checklist の印を保ち、PDH-ticket-write へは戻さない。

### どこまで進んでいたかを読み取る

中断しても消えない記録を、次の順に読む。

- note の Status: どの PDH-stage か
- progress の最後の見出しと本文: 最後に何が起きたか、次に何から始めるか
- `git log` と `git status`: 最後の commit と、commit していない変更。commit していない変更は消さず、中身を見て続きに使うかを決める
- `<TMP_DIR>/workers/` の各ディレクトリ: `bash scripts/spawn-worker.sh --wait <ディレクトリ> 0` で、まだ走っている worker と、終わったが結果を読んでいない worker を見つける。走っている worker と同じ仕事を新しく起動しない
- 終わった QA に完了報告が無いときは、`[SKILLS_PATH]/pdh-pm/_execution-team.md`「完了報告の無い QA の結果」に従い、依頼した全コマンドと対象 SHA・終了コード・実出力を照合する。証拠がそろう検査だけを採用し、欠けた検査だけをやり直す。完了報告にしか書かれない判断は別に聞き直す
- note の Checklist の待ち行: 答えが届いているかを、その行の `発行先:` で確かめる
- note の Checklist にある、Status の PDH-stage のチェックリストの行: `[x]` の行は済んでいる。未了の行から続ける。⚠ 再開は遷移ではないので、`scripts/pdh-stage-checklist.sh --enter` を実行しない — 実行すると済んだ印が消える。その PDH-stage の行が 1 つも無いとき（写す前に中断したとき）だけ実行する

### 続ける

note の Status の PDH-stage の skill を読み、その途中から続ける。progress に `## <UTC 日時> [<Status の PDH-stage>] 再開` の見出しを足し、その下に、どの記録を根拠に、どこから続けるかを書く。

## 出力

作業する worktree と、ticket・note・progress のパスが確定し、Status の PDH-stage のどこから続けるかが決まっている。

### 機械で確かめるもの

`[SKILLS_PATH]/pdh-pm/_open-ticket.md`「開けたかを確かめるコマンド」の終了コードが 0 である。

### 判断で確かめるもの

- 読み取った «どこまで進んでいたか» と、どこから続けるかが、progress の «再開» の見出しに根拠つきで書いてある

## 例外

- 再開する ticket が決まらない → ユーザに聞く。聞き方は `pdh-pm`「中断するときと再開するとき」に従う
- `progress.md` が無い旧 ticket → `pdh-pm`「入る前に」に従う
- `start` か`pdh-pm/_open-ticket.md`「開けたかを確かめるコマンド」が失敗する → 先へ進まず、原因を調べる。解決できなければユーザに聞く
