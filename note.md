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

- [x] **kit の «無ければ静かに return» を `check-static.sh` へ** — 3 件（`[data-board-id]` / `.deck` の id / `[data-path]` と `[data-host-input]` の対）。反例で落ちることを確認
- [x] **描画検査に `K. 像の注記` を新設** — 枠のはみ出し・札の位置と大きさ・影の重なり。反例 fixture `broken-k.html` つき。⚠ **実物の板の欠陥（札が枠より大きい）を実際に捕まえた**
- [x] **発行前の手動確認の文面を hanger-cloudflare へ渡した**（こちらから書き込めないため。skill には置けない — skill からブラウザは開けない）
- [x] **今日の 3 件を `evals/examples.md` へ記録**
- [x] **`check-board-render.sh`（A〜K 全 PASS）と `tools/selftest.sh` と `test-all.sh` を回した**。⚠ 途中で `check-board-render.sh` 自身の bash 3.2 バグ（空配列展開）を見つけて直した
- [x] **#21 AC 読み手の巡回の止め時** — `_flow.md` へ 1 文（全件の初見は 1 回 / 同じ AC が 2 巡続けて復元できなければ承認者へ渡す）。提案の «最大巡回数» は採らない — 止め時の半分（書き直した分だけを渡す）は既に `_flow.md:72` にあり、欠けていたのは «書き直しでも閉じないときの出口» だけだった。数は `_review.md` の «2 attempt で再発したら escalate» から引いた。置き場所は Director 側 — worker は自分の 1 回分しか知らない。⚠ **実測の 3 巡目（AC 全件を渡し直して出た指摘）が役の範囲内だったかは未確認**。llmhub 側の ticket を読めないため、issue に書いて渡した
- [x] **#21 の続き — 3 巡目が起きること自体がおかしい**（ユーザ指摘）。上限は症状の蓋であって原因ではなかった。原因は **(a) 合格条件が無い**（「指摘ゼロ」を目指すと毎巡指摘が返るので終わらない）と **(b) 応じ方が無い**（指摘に AC を足して応え、6 → 10 件になった）。⚠ **`PDH-AGENTS.md:36` の «広い探索 review を繰り返し回さない» に 3 巡目は既に反していた** — 新しい規則が要る話ではなく、AC 読み手だけが既存規則の外で運用されていた
- [x] **その修正が過剰だったので削った**（ユーザ指摘「why / problem の解決に向かっているかが評価軸。それに対して過剰になってはいけない」）。4 行入れたうち残したのは 2 行 — `_flow.md` の合格条件と応じ方、`pdh-verifying` の «復元できた AC には何も返さない» だけ。削ったのは «全件の初見は 1 回»（`_flow.md:72` と `PDH-AGENTS.md:36` で既出）と «2 巡続けて復元できなければ板へ»（起きていない事象への蓋。#19 で «やらない» と判断したのと同じ category）。⚠ **判断ボードが名指ししている失敗（指摘に応じて足す）を、その規則を引用しながら踏んだ**
- [x] **2 巡目に 9 件出たこと自体が «1 巡目が網羅でない» 証拠だった**（ユーザ指摘「1 回目で網羅的に見られているのなら、2 巡目はその修正内容に関するものしか出てこないはず」）。⚠ **原因を巡回側に置いたのが誤り。**判断ボードの reviewer と違い、AC 復元テストの対象は閉じた列挙（`What` 冒頭 1 文 + AC 全件）なので 1 巡で全件に判定を付けられる — «収束しない» という board 側の理屈をそのまま持ち込めない。`pdh-verifying` の (2) を «AC 全件に 1 件ずつ判定を付ける。目についたものを挙げる形にしない» にした
- [x] **eval-16 で測った — a・b・d・e が判別**（`evals/eval-16-ac-reader-exhaustive.md`）。baseline の 2 巡目が #21 の実測を再現し、**1 巡目で «復元できる» と判定した AC 2・4・5・8 を蒸し返して 6 件**、うち 1 件は AC の追加要求。current は両巡とも 8/8 の判定で新規指摘 0。⚠ **c（欠落 3 件の検出）は両腕 3/3 で判別せず** — 入れた 2 行は検出力ではなく返し方だけを変える規則である
- [x] **codex でも回し、実在の AC 2 組で交差確認した**（ユーザ依頼 2026-09-01）。**a（全件判定）と e（蒸し返し）は両 engine で判別。b と d は codex では判別せず** — codex の baseline はもともと簡潔で余計な指摘を出さない。⚠ **実在の AC（`calc-modulo` 5 件 / レート制限 3 件）では a が判別しなかった** — 件数が少ないと baseline も取りこぼさない。**この 2 行が効くのは AC が多いときである。**なお `calc-modulo` の AC 4「既存の `+ - * /` 動作は変わらない」は実在の欠陥として両腕が捕まえた
- [x] **model / effort を 6 構成に広げた**（ユーザ依頼 2026-09-01）。⚠ **「c は判別しない」は誤りだった** — AC 7 の検出が baseline 4/6 → current 2/6 に落ちる。**入れた規則は真の欠落を取りこぼす方向にも働く。****a は 6/6 で判別**（engine・model・effort に依らない）、**e は 3/6**（蒸し返すのは弱い設定だけ）。この役は «上を選べば良くなる» が成り立たないので、`_execution-team.md`「spawn のルール」へ «最上位 model / 最大 effort を割り当てない» を入れた（model 名は上書き例、ユーザ承認 2026-09-01）。⚠ **規則の副作用とモデル差が同じ 1 件の上で重なっており、各セル 1 個体では分離できていない**
  - [x] **«軽量 model へ落とす話ではない» を明記した**（ユーザ指摘 2026-09-01「haiku とか使われない？」）。⚠ **«だけは» で始まる例外が、直前の «最小能力の軽量 model へ落とさない» ごと外したように読めていた。**外すのは上端だけで、**下端は一度も測っていない**
  - [x] **model の段落は一度削除し、実在の AC 2 組 × 4 構成で測り直してから 1 文だけ戻した**（ユーザ指摘「1 件だけのルールから書かない」「せめて sol high vs luna max と opus sonnet で確認して」）。⚠ **opus と luna は別々の fixture で落ちた** — 図書館だけ見れば opus が強く、`calc` だけ見れば luna が強い。**1 fixture で model を語ると逆の結論が出る。**見逃し 0 は `gpt-5.6-sol` の既定 effort のみ。effort を上げると落ちる（sol は high→max で AC 7 を失う）。消費は sol/high 10.6k / luna/max 12.1k tok で仕事量に差はなく、違うのは単価だけ。**model 名を書くのはこの 1 件の例外**（ユーザ承認）
  - [x] **実在 ticket を 5 件へ増やしたら、model 差の大半が規則の曖昧さだったと判明**（ユーザ依頼「複数のチケットで比べて」）。関数レベル AC で luna/max が 10/10 落とし、sonnet と opus は逆向きに割れた。原因は «登場人物が AC ごとに要るのか、1 文から補ってよいのか» を規則が決めていなかったこと。`pdh-verifying` の (2) を**書き換えて**塞いだところ、**4 構成とも誤検出 0・検出は 1 件も落ちず**、model 差は図書館 AC 7 の 1 件だけになった
- [x] **skill の他の箇所へ同じやり方を広げた**（ユーザ依頼 2026-09-02）。まず grep で «閉じたリストを、入力が制限された読み手に渡している» 箇所を洗い、3 か所を特定（AC 読み手＝修正済み、判断ボード問 6＝未検証、レンズ 1＝対象外）。次に `eval-17` を新設して AC 裏取りの «合成入力だけで check しない» を測った。⚠ **当初立てた判定条件（`NOT VERIFIED` になるか・合成入力を挙げるか・実上流 data を名指しするか）は 3 つとも判別しなかった** — baseline も全部満たす。**判別したのは codex `gpt-5.6-sol`/high の AC 2 だけ**（baseline `VERIFIED` → current `NOT VERIFIED`）。claude 2 構成は両腕とも `NOT VERIFIED` で判別しない。⚠ **一度«反証を実際に走らせたか»を判別条件に据えたが誤りだった** — opus は current が、sonnet は baseline が走らせる逆相関で、規則の効果ではなく実行ごとの振れだった。⚠ **対照群がまた汚れていた** — note の «`uv run pytest` は 1 passed» が再現せず `PYTHONPATH=.` が要る。3 個体が独立に指摘。直した
  - [x] **model 名の 1 文は結局外した**（ユーザ判断 2026-09-02「書かなくていい」）。書き換えで 4 構成の判定が揃い、model を指定する理由が消えたため。⚠ **`sol/high` の書き換え後だけ測らずに «0 → 0» と書いていたので、測り直した**（実測でも 0 / 3-3）
  - [x] **luna high / xhigh と sol max も埋めた**（ユーザ依頼）。⚠ **effort の効く向きは model ごとに逆** — sol は high→max で落ち、**luna は max でだけ拾う**（high と xhigh は同じ 2 見逃し）。skill の 1 文を «上げても良くならない» から «向きも model ごとに違う» へ直した
- [x] **判断ボードの独立 reviewer も 5 構成で測った（eval-10）**（ユーザ依頼 2026-09-01）。⚠ **対照群 `v0-clean` の欠陥を 3 度目に見つけた**（数の矛盾。opus 2 個体が独立に検出）。直した。⚠ **sonnet は `v1` を通した** — 見落としであり、«v0 を通す» だけを合格条件にすると見落とす読み手が最高得点になる。採点条件を両面で見ると明記した。対照群を直したら opus と codex の落とす理由が «承認者への委ね» に一致したので、**依頼文の立場 3 行へ «名指しで委ねた事実は持っているものとして扱う» を追加**。追加後 `sol/high` で v0 が «決められる»、v1〜v4 は落ちたまま。⚠ **知識量ではなく «明示的に委ねたか» で線を引く**（知識量は連続量で engine ごとに割れる）

## 済み（消さずに残す）

- [x] ①-B AC の 1 文からの導出 + 1 問判定 + 復元テスト（`04bf8de` / `f1232c0` / `29fd564`）
- [x] ②-A 判断ボード統合 + `pdh-reviewing` 新設（`726f913` / `29fd564`）。eval 10 シナリオ × 新旧で差なし（`4d56a85`）
- [x] ③-B `ticket.sh` gate + agent 定義 + `allowed-tools`（`04bf8de` / `f5dcec2` / `6b6d13c`）
- [x] ④-A `Where A Rule Belongs` 4 問目 + Stage labels の列（`81c19f1`）
- [x] 原文の worker 指示を `pdh-reviewing` でも対称に（`cd3a597`）
- [x] `Based on` footer を全 skill へ揃え、検査対象へ登録（`6b6d13c`）

## この note が存在する理由

この repo は ticket 運用をしないので、note の `## Checklist` に当たる受け皿が無かった。判断ボードで承認された内容が板に書かれたまま転記されず、`allowed-tools` が落ちた。**承認された内容と頼まれたことは、板でも engine の task list でもなく、消し込める場所に置く** — engine の一覧は context が切れると消えるが、頼まれたことは消えないため。
