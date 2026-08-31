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
- [x] **移行の «適用したつもり» を塞ぐ強化を配布先へ届けた** — llmhub は `08f9f7d`、hanger-cloudflare も最新。手順 7.5 を私からも当てて確認済み
- [x] **agent 定義を skill と同じ «常に上書き» にした** — `Based on` を足す案は採らない（thin pointer で project カスタマイズを持たないため、由来を追う相手がいない）。INSTALL 手順 5 / 既知の移行手順 / `pdh-update` skill / この repo の CLAUDE.md に明記
- [x] **pane 1-3 へ `/pdh-update` を投入した**（ユーザ依頼 2026-08-30）。完了後に手順 7.5 を当てるのが残り
- [x] **note へ書く版の規則を測った（eval-14）**（ユーザ依頼 2026-08-30）— 記録では判別（5 行 対 0 行）、引き継ぎでは判別せず。⚠ **note テンプレートのコメントだけでは足りず、`PDH-AGENTS.md` 側の規則があって初めて書かれた**
- [x] **pane 1-3 へ `/pdh-update` を再投入した** — 3 repo とも `34e0e98` まで取り込み完了（適用と commit の承認待ちで停止中。その判断は各 session のユーザのもの）
- [x] **手順 7.5 を 5 repo すべてに当てた** — 壊れた symlink 0 件、`.agents/skills/` は 8 skill とも symlink で `AI-2` を満たす。`D .agents/skills/pdh-coding/SKILL.md` は実体コピーが symlink へ張り替わった痕跡で、正しい方向
- [x] **`pdh-decision-board` の description は発火する** — 当てる 5 件すべて命中、`pdh-reviewing` に取られない。誤爆も 1 件のみ（測定は «description が正しい 1 つを選ばせるか» までで、実機の発火機構そのものではない）
- [-] **`pdh-coding` の description を直す** - skip: **直す理由が測定で消えた。**6 問（バグ修正 / 指摘の反映 / リファクタ / テスト / 規則の参照 / チケット開始）で **6/6 正解**。`pdh-coding` は «実際にコードを書く» 場面で選ばれ、ticket フローは `pdh-dev` に譲っている。⚠ **前回「実装して」で外れたと報告したのはこちらの期待違い** — `pdh-dev` の description が『実装して』を自分の起動語として明記しており、あの選択は仕様どおり。⚠ **1 問の結果だけで欠陥と断定した**のが誤りで、判断ボードのときは「当てる／当てない」の対を作っていたのに、こちらでは作らなかった
- [x] **#18 を測った** — `required_paths` は**壊れた symlink を検出する**（`-e` が symlink を辿る）。4 状態すべて exit 1。懸念は空振りで、設計待ちではなく作るだけ
- [x] **#17 worktree の制約** — `pdh-coding` へ。⚠ 提案文は `EnterWorktree`/`ExitWorktree` を直書きで `AI-5` 違反だったので、一般の言葉で書き engine 固有は例示に留めた（`f8e8b39`）
- [x] **#16 「正」の再混入** — ⚠ 報告 2 箇所に対し実際は **9 箇所**（1 つは今日こちらが書いた行）。検査を `templates/checks/` と `scripts/checks/` へ配り、9 箇所とも直して 0 件（`f8e8b39`）
- [x] **#18 配布物の消失検出** — check を配り、維持の規律を `CLAUDE.md` と `INSTALL.md` 配置表へ繋いだ（`f8e8b39`）
- [x] **4 issue へ返信し、16 / 17 / 18 / 19 をすべて close した**（ユーザ依頼 2026-08-31）
- [-] **#19（ticket に Constraints 節）** - skip: ユーザ判断でやらない（2026-08-31）。5 か月運用で実害ゼロ、Appetite「小さく保つ」に照らして節も語も増やさない
- [x] **配布は live な 2 repo で完了** — llmhub（`08f9f7d`）と hanger-cloudflare。どちらも ticket.sh `20260830`、手順 7.5 の主要 6 項目と配布物 check まで ✓
  - [-] ticket-board / db-codex / db-claude - skip: **もう使わない repo**（ユーザ 2026-08-31）。`34e0e98` まで入っており symlink も健全。⚠ **配布先として数えない** — これ以降の更新を追わない
- [x] **作業一覧の規則は撤去した** — v1 5/5、v2 8/8 で 2 回とも判別せず、**落ちる条件そのものを作れなかった。**⚠ «効かない» の証明ではない。足し直す前に落ちる条件を作ること（`evals/eval-13-work-list.md`）
- [-] **重複 Artifact `53f86de1…`** - skip: ユーザ判断で気にしない（2026-08-31）
- [x] **stage=skill 化 Phase 1** — `pdh-verifying` skill 新設（QA / AC 裏取り / Surface Observer / AC 読み手の規則を `_subagent-context.md` から移す）+ agent 定義 8 ファイルの参照更新 + 配布整合（ユーザ承認 2026-08-30。Phase 3 = ticket-review の worker 化は含めない判断）
- [x] **stage=skill 化 Phase 2** — `_flow.md` の PDH-implement / PDH-verify を Director 専用へ（整合性 gate + 完了チェックは `pdh-coding` へ移動、移動元 sweep 済み）
- [x] **stage=skill 化 Phase 4** — fresh subagent（実運用と同じ Opus。ユーザ指定）が AC 裏取り役で `pdh-verifying` を読み、合成入力のみの AC を NOT VERIFIED・反証 1 回の欠落・off-by-one の可能性まで指摘し、AC 不可侵を遵守。指示の破綻なし

## 済み（消さずに残す）

- [x] ①-B AC の 1 文からの導出 + 1 問判定 + 復元テスト（`04bf8de` / `f1232c0` / `29fd564`）
- [x] ②-A 判断ボード統合 + `pdh-reviewing` 新設（`726f913` / `29fd564`）。eval 10 シナリオ × 新旧で差なし（`4d56a85`）
- [x] ③-B `ticket.sh` gate + agent 定義 + `allowed-tools`（`04bf8de` / `f5dcec2` / `6b6d13c`）
- [x] ④-A `Where A Rule Belongs` 4 問目 + Stage labels の列（`81c19f1`）
- [x] 原文の worker 指示を `pdh-reviewing` でも対称に（`cd3a597`）
- [x] `Based on` footer を全 skill へ揃え、検査対象へ登録（`6b6d13c`）

## この note が存在する理由

この repo は ticket 運用をしないので、note の `## Checklist` に当たる受け皿が無かった。判断ボードで承認された内容が板に書かれたまま転記されず、`allowed-tools` が落ちた。**承認された内容と頼まれたことは、板でも engine の task list でもなく、消し込める場所に置く** — engine の一覧は context が切れると消えるが、頼まれたことは消えないため。
