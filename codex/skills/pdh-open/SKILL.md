---
name: pdh-open
description: "PM 専用。PDH-open で読む。PDH-ticket-write で書いた ticket を新しく始め、PDH-ticket-review へ進む。作業が中断している ticket を再開するときは使わず、skill pdh-resume を使う。"
---

# PDH-open

PDH-open は、書き終えて base branch に commit された ticket を受け取り、ticket の branch と worktree を作って、PDH-ticket-review が読む ticket・note・progress と、作業する worktree を確定する。

## 入力

- base branch に、書き終えた ticket・note・`progress.md` が commit されている。note の Status は `PDH-open`

## 処理

1. `start` の前に、ticket・note の節を現行のテンプレートと照合する。旧書式なら Status に先立って「例外」の旧書式の手順へ進む。現行の節がそろっている場合は、Status の先頭の `PDH-…` を読み、後ろの括弧内の説明を判定に含めない。`PDH-open` なら続ける。それ以外は「例外」へ（`start` してから気づくと、始めてはいけない ticket を始めてしまう）
2. `[SKILLS_PATH]/pdh-pm/_open-ticket.md` の手順で ticket を開く。PDH-open の途中で作業が中断している ticket も、同じ手順をそのままやり直してよい（`start` は何度実行しても同じ結果になる）

## 出力

PDH-ticket-review が読む ticket・note・progress のパスと、作業する worktree のパスが確定している。

`- [ ] PDH-open:` で始まる行は、この PDH-stage のチェックリストである。この PDH-stage に入るとき、`bash scripts/pdh-stage-checklist.sh PDH-open --enter [TICKET_DIR]/note.md` が note の `## Checklist` へ写す。確かめたら `[x]` にし、当てはまらない行は `- [-] ... - skip: <理由>` にする。

### 機械で確かめるもの

`[SKILLS_PATH]/pdh-pm/_open-ticket.md`「開けたかを確かめるコマンド」の終了コードが 0 である。

- [ ] PDH-open: 「開けたかを確かめるコマンド」が 0 で終わった

### 判断で確かめるもの

なし。PDH-open の出力は、すべて`pdh-pm/_open-ticket.md`「開けたかを確かめるコマンド」で確かめられる。

## 例外

- 開く ticket が無い → PDH-ticket-write へ戻る
- Status が `PDH-ticket-write` のまま → PDH-ticket-write の «出力» の条件を満たしたかが記録されていない。PDH-ticket-write へ戻り、«出力» を確かめてから遷移する
- Status がそれ以外 → 作業が中断している ticket である。skill `pdh-resume` に従う
- `progress.md` が無い旧 ticket → `pdh-pm`「入る前に」に従う
- PDH を更新する前に書かれた、旧い書式の ticket・note → `pdh-ticket-write`「旧書式を移す」に従う。未 start なら PDH-ticket-write へ戻る。start 済みなら `pdh-resume` でその worktree を確定し、Status を戻さずに移行だけを行い、現在の PDH-stage の途中から続ける
- `start` か`pdh-pm/_open-ticket.md`「開けたかを確かめるコマンド」が失敗する → PDH-open から先へ進まず、原因を調べる。解決できなければユーザに聞く。聞き方は `pdh-pm`「中断するときと再開するとき」に従う
