# Work Notes — PDH 構造改善（判断ボード 728e8cca の承認分）

判断 4 件（①-B / ②-A / ③-B / ④-A）は承認済み。実装の残りと、作業中に見つかった宿題をここで消し込む。

## Checklist

**フロー遷移のたびにこの節を見る。**節を stage ごとに割らない — 割ると「その stage の分だけ」を見て、他が残っていることに気づかない。

- [x] **確定判断に完了の証跡を持たせる** — **案 A は落とした。**反論（ticket.sh の集計の都合で PDH 文書を変えるのは向きが逆）に加え、`docs/product-delivery-hierarchy.md:120` が「確定判断は記録を残せば再合意なしに書き換えてよい」と決めており、**書き換わることが正常な項目に «済／未» の checkbox は付けられない。**採ったのは B + C + 対応づけの向きの修正:
  - [x] `pdh-reviewing` / `PDH-AGENTS` / `_flow` / `_review` — 順方向の対応づけに確定判断を入れる（従来は AC だけ）。eval-12 で baseline 4/6 → current 6/6
  - [x] `close-gate` — 確定判断を 1 件ずつ «そのまま / 変えた / 実装しなかった»。eval-5 退行なし 7/7
  - [x] `pdh-decision-board/SKILL.md` — ticket を持たない運用では反映先を先に決める
- [x] **`./ticket.sh check --require "<見出し>"` が «節ごと無い» を検出できるか測る** — 測った。**`check --require` は落ちる（exit 1）が、`require_checklist` による close の拒否は通る。**同じ穴に片方だけが効く非対称。ticket.sh#5 と pdh#15 を起票
- [x] **ticket.sh#5 の取り込み** — ticket.sh main `29f33a9` で `require_checklist_groups` が入った。配布テンプレートへ `Required Probes` を宣言し、INSTALL の移行手順に selfupdate 前提と «節が無い既存 ticket は手で足す» を明記。probe で 4 状態を測って確認（節あり未了 / 節ごと無い / 見出しだけ / `--force`）
- [x] **note テンプレートの checklist を `## Checklist` へ再編** — `## Status:` の直後へ移し、stage 順に並べ替え、`require_checklist_groups` へ `Checklist` も宣言（節ごと消えたら close が止まる）。probe で確認。INSTALL に改名の移行手順を追記
- [ ] **移行の «適用したつもり» を塞ぐ強化を配布先へ届ける** — INSTALL 手順 7.5（確認コマンドの再実行）と `pdh-update` の報告義務。**この強化自体が pdh-update で届く必要がある**
- [x] **agent 定義を skill と同じ «常に上書き» にした** — `Based on` を足す案は採らない（thin pointer で project カスタマイズを持たないため、由来を追う相手がいない）。INSTALL 手順 5 / 既知の移行手順 / `pdh-update` skill / この repo の CLAUDE.md に明記
- [x] **pane 1-3 へ `/pdh-update` を投入した**（ユーザ依頼 2026-08-30）。完了後に手順 7.5 を当てるのが残り
- [x] **note へ書く版の規則を測った（eval-14）**（ユーザ依頼 2026-08-30）— 記録では判別（5 行 対 0 行）、引き継ぎでは判別せず。⚠ **note テンプレートのコメントだけでは足りず、`PDH-AGENTS.md` 側の規則があって初めて書かれた**
- [ ] **pane 1-3 の完了後に手順 7.5 の冪等チェックを当てる**
- [ ] **配布先 5 プロジェクトへ `pdh-update` を流す** — 判断 2-A は「ちゃんと更新する前提」で A にした。流すまでが完了。残りは ticket-board / db-codex / db-claude。
  - llmhub: `6b93ad0` 取り込み済み。**gate キー 2 つが落ちていたので手で足した**（2026-08-30）。既存 note 26 本に `## Checklist` が無く、再開して close するときに止まる
  - hanger-cloudflare: worktree `chore/pdh-update-260830` に `7fe778c` 版があるだけで **main へ未マージ**。ticket.sh も 20260827 のまま。`6b93ad0` で回し直しが要る
- [x] **作業一覧の規則は撤去した** — v1 5/5、v2 8/8 で 2 回とも判別せず、**落ちる条件そのものを作れなかった。**⚠ «効かない» の証明ではない。足し直す前に落ちる条件を作ること（`evals/eval-13-work-list.md`）
- [ ] **`pdh-decision-board` の description が発火するか確かめる** — 統合で skill 名が変わった。「判断ボードを作って」で起動するかは測っていない
- [ ] **重複 Artifact `53f86de1-46bc-49cc-91cd-6d46fad1947d` の扱い** — 判断ボードの再発行で誤って作った。中身は正の `728e8cca…` と同じ。私からは削除できない

## 済み（消さずに残す）

- [x] ①-B AC の 1 文からの導出 + 1 問判定 + 復元テスト（`04bf8de` / `f1232c0` / `29fd564`）
- [x] ②-A 判断ボード統合 + `pdh-reviewing` 新設（`726f913` / `29fd564`）。eval 10 シナリオ × 新旧で差なし（`4d56a85`）
- [x] ③-B `ticket.sh` gate + agent 定義 + `allowed-tools`（`04bf8de` / `f5dcec2` / `6b6d13c`）
- [x] ④-A `Where A Rule Belongs` 4 問目 + Stage labels の列（`81c19f1`）
- [x] 原文の worker 指示を `pdh-reviewing` でも対称に（`cd3a597`）
- [x] `Based on` footer を全 skill へ揃え、検査対象へ登録（`6b6d13c`）

## この note が存在する理由

この repo は ticket 運用をしないので、note の `## Checklist` に当たる受け皿が無かった。判断ボードで承認された内容が板に書かれたまま転記されず、`allowed-tools` が落ちた。**承認された内容と頼まれたことは、板でも engine の task list でもなく、消し込める場所に置く** — engine の一覧は context が切れると消えるが、頼まれたことは消えないため。
