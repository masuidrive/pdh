# 記録の決まり（全 PDH-stage が参照する）

## 判断の優先順位

判断では、user journey が動くことを、engineering aesthetics より優先する。

## ticket / note / progress の役割分担

実パスは、`./ticket.sh start` の前は `./ticket.sh new` の出力（`Created ticket file:` / `Created note file:`）、後は `./ticket.sh start` または `./ticket.sh restore` 出力の `ticket:`/`note:` 行が示す（互換 symlink: `current-ticket.md`/`current-note.md`）。

| file | 役割 | 残す情報 |
|---|---|---|
| ticket file（`[TICKET_DIR]/ticket.md`） | ゴール。後世への記録 | Why、AC、Architectural-Invariants-check、Design-Decisions、Out-of-scope、任意の Implementation Notes |
| note file（`[TICKET_DIR]/note.md`） | 現在値。session 間の引継ぎ | Status、Checklist、Required-Probes、Open-Questions |
| progress file（`[TICKET_DIR]/progress.md`） | 経緯。close 後に工程を追える唯一の記録 | PDH-stage 遷移、中断時に次に何から始めるかと git の状態、実装ログ、`### Findings-PDH-review-N` 表、人から返った答え（承認の PDH-stage・相談とも。ticket を変えるものは ticket 本体も直す）、調べて分かったこと、検証の実 command と実 output |

節構成は `.ticket-config.yaml` の `default_content` / `note_content` が決める。`./ticket.sh new` が出した節と記入ガイドに従い、そこに無い section を前提にしない。次を守る。

- Status 行を冒頭に保ち、timestamp を必ず書く
- 空 section には skip 理由を 1 行書く
- AC は ticket にだけ置き、note へ写さない。AC は承認の単位で、承認後の変更にもユーザの承認が要る（`PDH-AGENTS.md`「PDH-flow」）。note に写すと、ticket の AC が承認を経て変わったときに写しが古いまま残り、どちらが現在の AC か分からなくなる
- PDH-stage の skill の «出力» を通らないまま、次の PDH-stage 名へ Status を進めない
- progress は追記のみ。1 出来事 1 見出しで `## <UTC 日時> [<PDH-stage>] <題>` の形にし、書いた後は編集しない（消す・書き換えると `ticket.sh close` が `append_only_files` で拒否する）。見出しを書く直前に `date -u +%Y-%m-%dT%H:%M:%SZ` で実時刻を取得する。手入力の日時差から経過時間を算出せず、実行の開始・終了の記録を使う。時刻の取得元は文章だけでは数えられないため、PM が追記時に確かめる。書くのは diff を生まない出来事だけ（diff を生む変更は commit が持つ）
- 2 巡目以降は progress に `### Findings-PDH-review-2` のように見出しを自分で追加する
- review と close 前 review が読んだ SHA は、progress の行頭に `review-sha: <SHA>` / `close-gate-sha: <SHA>` の形で書く（行頭の `- ` を許す。値の先頭に続く 16 進の並び全体が 7〜40 桁なら SHA として読み、その直後に空白なしで全角括弧や句読点などの説明を続けてよい。説明の先頭を 16 進文字にすると SHA の続きとして読まれるため、空白などで区切る）。`scripts/pdh-review-range.sh` は 2 種のうち最後に現れた行を起点にし、`scripts/check-pdh-ticket.sh` は最後の `close-gate-sha:` を読む
- 中断するときは `pdh-pm`「中断するときと再開するとき」に、再開するときは `pdh-resume` に従う
- 検証の checkbox は、対象 SHA・実 command・実 output を progress へ貼ってから note で check する

## 成果物セルフチェック

ticket は skill `pdh-ticket-write`「出力」で確かめる。実行指示は提出前に次を確かめ、1 つでも該当すれば抽象化する。

- 実行指示に how-to が混入していないか
- 実装・ticket 候補に投機的拡張または将来要件向けの設計がないか
