# 計測結果と採用判断（2026-09-05）

PDH の目的は、利用者の意図と合意を作業へ正しく引き継ぎ、必要な実装・検証を遂行し、達成と残る制約を証拠付きで人へ渡すことにある。
今回の変更は、そのための Codex 専用配布と実行手順を worktree に実装したもの。
全工程の実案件完遂や、役割別モデルの最適値まで実証したものではない。

## 同条件の初回比較

非公開の 5 案件のうち切り出しが成立する 3 案件を使用した。
当時の ticket・note・人の回答を固定し、後続の正解を隔離した。
実行者へ rubric は渡さず、出力を見る前に別の Astra が採点条件を監査した。
過去の再承認手順自体を正解にする条件などを修正し、人が選んだ条件は保持した。
各案件 3 条件、計 9 実行を行い、版とモデルを伏せて Astra が採点した。

| 条件 | PASS | 所要時間中央値 | 入力合計 | うちキャッシュ | 出力合計 |
|---|---:|---:|---:|---:|---:|
| 旧版 Sol/high | 18/23 | 164.007 秒 | 134,937 | 9,216 | 22,779 |
| 変更版 Sol/high | 22/23 | 162.945 秒 | 133,803 | 9,216 | 22,636 |
| 変更版 Sol/medium | 21/23 | 95.149 秒 | 133,811 | 6,528 | 14,923 |

これは人の回答を ticket・note の変更案と次工程へ反映する、ツールを使わない評価である。
各条件 1 回、固定した実行順、キャッシュ量の違いがあり、統計的優位や金額の削減を証明しない。
要求モデルは記録したが、実際に提供されたモデルは CLI の JSON だけでは確認できない。
Astra 評価者の使用量は取得できず、総費用は不明。

## 採点以外の欠陥も修正

変更版でも Status 全体の置換によって過去の履歴を失う回答があった。
現在段階の行だけを更新する手順へ直し、人の回答と変更範囲を照合する手順も整理した。
既存値と同じ回答でも、人が確定した事実を ticket に残すことを明確にした。
修正後に 3 案件を再実行し、残った 1 案件をさらに修正・再実行した（追加 4 実行）。
最後の対象別採点は R01 8/8、R02 7/7、R03 8/8。
R01/R03 は最後の R02 用修正前なので、同じ最終版による一括 23/23 とは扱わない。
同じ調整用案件の再確認であり、独立した未使用案件の最終評価でもない。

残る懸念は、短い観測根拠や日時のある履歴の一部省略、条件付きの将来判断を引き継ぎ一覧へ載せ忘れる回答、CI の証拠取得と push 禁止の両立を未解決事項として明示しない回答である。
元の制約を解除したり、未実施を実施済みとする回答ではないが、引き継ぎの完全性は保証できない。
既存 eval-12 も 5/6 のままで、確定判断の対応先ファイル名が 1 件欠けた。
これらを採点上の満点に隠さず残し、追加の個別書式ルールを積み重ねることは避けた。

## モデルの採用判断

実装・レビュー・AC 確認は Sol/high を維持する。
medium はこの比較で速かったが、変更のない値に対する人の確定を ticket に残す項目を落としたため、判断業務を一律に下げない。
QA と Surface Observer の medium は役割に応じた初期設定であり、今回の比較から最適と断定しない。
Astra は独立評価や難しい判断への escalation に使い、通常 worker は明示した Sol を使う。
親モデルの意図しない継承を防ぐ設定と手順を配布した。

## 実際の導入と実装

新規導入、再実行、旧構成からの移行、既存の project/local 指示と独自ファイルの保持を確認した。
導入先で AGENTS と 7 スキルが読み込まれることも確認した。
実ツールによる小さな CLI 修正試験では、依頼された help 文言だけが変更され、既存の ticket とテストは保持された。
実装前には対象テストが失敗し、修正後の独立再実行では 3 テストが成功した。
実行は Sol/high、167.675 秒、入力 369,596（キャッシュ 333,568）、出力 7,488 トークン。
worker の commit は sandbox の制約で失敗し、未実施として正しく報告された。
これは限定した実装試験であり、PDH の review・human gate・close 全工程を通した試験ではない。
配布物の全チェック、計測 runner の 8 テスト、壊れた配布構成を検出する反例も成功した。

## 記録と作業場所

変更は `/private/tmp/pdh-codex-tuning` の `codex/pdh-codex-tuning` に限定した。
元 checkout の ignored データ 6,877 ファイルをコピーし、SHA-256 一致を確認した。
入力原文・採点根拠・実行ログは ignored の `evals/private/codex-tuning/` に保存し、公開ページには集計だけを載せる。
初回比較は `replay/graded-summary.json`、追加採点は `replay/grading/*-followup/` と `R02-final/`、実装試験は `installed-execution/` に保存した。

[HTML 報告](https://5uhod24n.aboutme.style/) は Hanger Sites MCP 経由で更新する。
ブラウザを利用できず視覚確認は未実施。HTML の構造と公開先の内容一致を検査する。

## 2026-09-05: 5案件の実作業検証（進行中）

文章評価とは別に、開始時点のソースを独立Gitコピーへ復元し、実装・実テスト・独立レビューを実行している。元のPDH checkoutと実装リポジトリは変更していない。後続の正解、元リポジトリ、他案件はworkerの読み取り対象から隔離した。5案件のcutoff・実行依存と境界を固定している。

| 案件 | 固定した修正版と確認範囲 | 未完了 |
|---|---|---|
| R01 ラベル | 832d00e7。Astra採用3件は修正確認で解消。新しい回帰テストを旧実装へ適用すると実PGで2件失敗、修正後はAPIを含め104成功・SQLite専用2スキップ。実ブラウザの両一覧・AND絞り込み、実CLI出力、両タグのpublish/rollbackも成功 | 最終版の全体QAと独立AC確認、承認済み合流時migration |
| R02 会話集計 | 78d5a8c4。Astraと同じSol reviewerが採用3件の解消を確認。実PG集計6件、Ruby3.2 SDK230件成功。実ブラウザ/APIで集計・ゼロ/不明・明暗・service表示を確認 | providerはローカルstub。実paid provider、full QA、独立AC確認は完了としない |
| R03 抽出診断 | 初回4be0fd64。AstraがPPTX画像欠落、DOCX表内の印、mixed failure説明等8項目を採用しSol/highで修正中 | 実PDF/OCR受入、出荷前caller調査と連絡、修正後検証 |
| R04 E2E診断 | 2add7adb。Vitest1139成功、Playwright174件のdiscovery。Astra修正確認で3件解消、readinessの外側timeout時に試行履歴が失われるMajorが残り修正中 | 追加修正、最終QA、実CI、AC文言の明示確認、上流連絡 |
| R05 Excel | ローカルの決定的な測定のみ保存 | 自動承認レビューが具体的添付のモデル送信を拒否。許可を質問済みで、未送信 |

R02修正版とR03初回版のtest-allは14区分中10区分成功、全体exit 1。R03のPostgreSQL区分は成功した。環境のRuby3.0はSDK要求を満たさず、別のRuby3.2・固定依存・実SDK fixtureで検証した。未設定providerによるE2E失敗は、stubの成功で代替しない。

QAコンテナのPID1が子プロセスを回収しない問題は、--initで既存テストを変えず7件成功した。MockTransportが参照する公開DNSだけを隔離コンテナへ補い、R03の対象18件が成功した。R04の2add7adb全体QAではSQLite3686件が成功したが、別コンテナのPGテストと共有DBの古いPID削除処理が競合した。影響したPG結果は無効とし、R04のDBインスタンスを分離して再検証する。環境修正を製品修正や全体成功へ数えない。

通常の独立レビューはSol/high。Why視点の指摘には目的達成に必要な修正と新しい機能の提案が混ざり、Astraが契約と実装に照らして裁定した。単純にunionしたり件数で達成率を作ったりしない。合流時migration、実PDF確認、caller調査・通知、実CIなどの未了条件を保持する。

project規則と今回の明示許可の引き継ぎ不足から、初回workerが単なるcwd修正にも確認を求めて停止した。Worker Instructionsへ許可済み・未承認操作とproject規則の明示的な上書きを渡す一文を追加し、配布元test-allは成功。権限packetを明記したR01/R02修正担当は再確認で停止せず完遂した。これは対象別の観測であり、独立した一般化評価や改善率ではない。

記録はignored `evals/private/codex-tuning/lifecycle/`。各runのprompt/events/responseと実QAログを保存し、sessionとturnを固定して使用量を集計する。初期中断3回のusageは不明として残す。要求modelと実際に返されたmodel名も区別し、取得できない実model名を要求値で埋めない。[途中報告10](https://5uhod24n.aboutme.style/)を公開し、HTMLの保存SHA256と全量readbackの一致を確認した。アプリの実ブラウザ画像は確認したが、報告サイト自体のブラウザ視覚確認は未実施。

## 2026-09-05: 実作業の独立検証と最終状態

4案件で実装・独立レビュー・採用指摘修正・実DB/API/ブラウザまたはterminal観察・独立AC確認を行った。5件目のExcelは具体的添付のモデル送信が承認待ちで、全5件を完遂したとは報告しない。通常実装とレビュー/ACはSol/high、Surfaceは4案件すべてSol/mediumを実際に用いた。Astraは難しい採否裁定と修正確認、PDH全体の評価へ限定した。

| 案件 | 最終コードと実測 | 未了と制約 |
|---|---|---|
| R01 ラベル | 832d00e7。採用3件の修正確認済み。実PG/API104成功2skip、両一覧とCLI・初期page外AND・publish/rollbackを実測。独立Surfaceは12画像で問題なし | 全体10/14。合流時migration。Surfaceの操作は成功したがglobal console assertionでexit1（外部font DNS8件/pre-auth401）。fallback font。ラベルSQLは1→20行で1回、既存service集計fallbackは全SELECT7→26のまま |
| R02 会話集計 | bb8fdd6f。3件修正後、実PG3565/SQLite3562、Ruby230成功。独立Surfaceが小さく薄いlabelを発見し、12px/alpha.60へ修正。同じ実ブラウザ試験と同じ観察担当が解消確認 | 全体10/14を個別再試験でgreenへ変えない。実provider未確認。元AC verifierのAC1 VERIFIEDは過大判定と同じ担当が認め、NOT VERIFIEDへ訂正済み |
| R03 抽出診断 | e22adbf9。採用8件とfollow-up2件を修正確認。新規合成PDFの上限0/過大画像/OCR失敗、copy/focus/明暗、最終見出しを実測。独立Surfaceは重大問題なし。全体11/14、PG2109成功 | SQLite未変更timing test失敗は単独1成功、Ruby標準環境とprovider不足。実OCR成功、元PDF2件、mockup、caller90日調査/所有者/承認後予告未了。Minorの「上の」位置文言は承認済みACなので独断変更しない |
| R04 E2E診断 | 62d66179。採用指摘解消、実HTTP4methods+child出力+外側timeout前の履歴6成功、実E2Eでserver名と原因が対応。独立terminal観察で重大な実装問題なし。全体10/14、PG2141成功 | 未変更SQLite/frontendタイミング失敗は単独1/8成功。Ruby環境/provider、実CI、AC3定義/4methods・Functions2/1serverの明示確認、上流連絡とhuman gate。最終probeを未変更test-allへ追加した同一runで500→201と同じrequest/worker/tracebackをstdout確認。追加run12/14（PG2141/SQLite3686/frontend成功） |
| R05 Excel | 隔離コピーとローカルの決定的測定のみ | 具体的な非公開添付のモデル送信承認待ち。モデル実作業を未実施とする |

実コードのSHAと後続のnoteだけのcommitを区別した。R01/R02/R03のcurrent Status・commit checklist・現在の証拠を更新し、過去の実行不能/未commitは履歴として残した。Ruby3.2の古い実行結果を使う場合はSDK全blob/lockの不変を記録し、現在の全体QAが成功したとは言わない。R02のobserver JSON内sourceが初回SHAの固定文字列のままという記録不備も保持し、実行brokerの最終SHA/入力hash/build記録へ結び付けた。

Surfaceの実行はDirector transportを用いた。R01/R02は観察担当がシナリオ作成し、Directorが実行、同じ担当が画像/値/traceを観察。初回のtheme移動/selector不備はharnessとして記録。R03はDirectorがシナリオ作成・実行し別担当が観察、R04は保存済み実terminal出力を別担当が観察した。完全に独立した実行とは称しない。

実測で有効だったのは、実DB並行更新、実package入口、既存全体test entry、実画面を含めて確認し、採用指摘を同じreviewerへ返す手順だった。一方、既に「条件全体が揃って初めてVERIFIED」と明記した規則でもR02の過大な部分判定が残った。規則の存在だけで遵守を保証せず、Directorが条件/証拠/未了を照合する必要がある。古いcurrent Statusの放置も同様に実行上の課題として残した。

これらは調整に使った同じ案件であり、未使用案件による最終一般化評価ではない。モデル比較のための同条件反復もなく、役割別最適値・金額削減率・完遂率の主張はしない。

### Astraによる実作業・引き継ぎ評価

限定パケットを読むAstra評価は、PDH配布へ追加の重大なルール欠陥を認めず、評価限界を明示した配布は支持できると判断した。採用指摘はR02のAC1過大判定とR03/R04等の古い現在Status/Resume Point。既存の条件全体・履歴保持の規則で扱えるため、案件別規則の追加は不要とした。

同じAC担当がR02を訂正し、4案件の現在Status/Resume Point・最終コード・収集結果・次手を照合した。過去のcommit失敗や旧Resumeは履歴として残し、現在指示として参照させない。同じAstraの限定修正確認では2件とも解消、合意・履歴・残る義務への重大な退行なし、追加の修正巡回は不要と確認した。これはベンチマーク製品のcloseではなく、引き継ぎ指摘の解消である。

次の有用な評価は、規則を凍結して未使用の小案件を中断/再開し、既存の明示許可と利用不能な検証条件を含む引き継ぎを確認するもの。今回は全5案件中4件の実施とR05承認待ちであり、その未使用案件評価まで済ませたとは報告しない。

R04の終端surfaceは同じAC担当が最終test-allの同一runで確認し、AC7をVERIFIEDへ訂正した。未変更script、本番Playwright設定、temporary import-only adapterと実probeのhashを保存し、adapterは終了時除去した。追加run12/14の未完条件は保持する。

### 実作業CLI使用量（取得できた範囲）

| 要求モデル | 起動/使用量あり | 入力 | うちキャッシュ | 出力 | 実行時間の和 |
|---|---:|---:|---:|---:|---:|
| gpt-5.6-sol | 41/38 | 149,732,731 | 143,177,472 | 749,579 | 23490.502秒 |
| gpt-6-astra | 13/12 | 11,340,878 | 10,107,776 | 47,804 | 2274.019秒 |

実案件workerと限定Astra評価のみ。初期3実行とGit前提不足で起動前に終了したAstra1回のusageは不明。既知usageだけの小計であり、Directorの調整・実行transport・準備agent・前段の文章評価は含まない。並列のwall timeを足した値で、実経過時間ではない。キャッシュは入力の内数、JSON/rolloutの同じturnを二重加算しない。実提供モデル名と金額は取得できず、要求モデル名やtoken数から費用削減を断定しない。

最終報告12をHanger Sitesへ公開し、HTML7,819bytes・SHA256 `f051802e5edbce37819e17bfa94acc1d8b9ca94a04898e7656268ec39be72848` と全量readbackの一致を確認した。視認性の修正前後は新規合成データの実ブラウザ画像を掲載。報告サイト自体のブラウザ視覚検査は未実施。

## 2026-09-06: 推奨5案件の実作業検証を終了

ここまでの9月5日の状態は履歴であり、R05の添付送信承認待ちは解消した。ユーザーの「いいよ」で具体的添付をSol/highへ渡す許可を受領し、5件目も切り出しで指定されたticket-reviewの調査・提案・検証を実行した。R01〜R04は上記の実装・検証、R05は実装前レビューであり、5製品すべてのAC承認・出荷・closeを意味しない。

R05はarchive source b0273636、独立Git baseline 442749b8、初回candidate 941de73、修正probe c1e45c6、明確化した提案437bdea、最終note635ba8f。production sourceはbaselineから不変。67,067 bytesの添付はignoredで保持し、commit・HTML掲載をしていない。Astraの追加評価へも送っていない。

実添付は1 worksheet、1,016行×27列、formula cells 0。11候補を比較し、空行・数式行だけの削除は0行で効果なし。同一の数値0と特定errorの末尾反復を除く候補は884行、111,707→30,379 UTF-8 bytes（72.805%減）。ただしnumeric zero 884 cellsとerror 884 cellsを削除し、正当な同形反復も失う。無損失、自動で業務上不要な行を判定できる、一般的な削減率とはしない。

独立Sol/high reviewerは、worksheet単位と100,000行上限の扱い、zero/errorを除外した損失指標の誤解をMajorとして指摘。両方を採用し、上限到達時はfilterを適用しない候補へ修正した。複数worksheet、Boolean False、100,000行ちょうど、100,001行目の有効値を合成XLSXで実行し、上限2例では現行全文と一致。保持する内容と順序も直接比較した。既存XLSX tests 2成功62 deselected、Ruff・diff検査成功。同じreviewerが両Majorの解消を確認した。

Directorも凍結probeを実添付と新規生成した境界XLSXで再実行しexit0。実extractor5回中央値0.091151秒。時間と合成XLSXのZIP/core metadata以外の測定値はwriterと一致し、生成worksheet XMLも一致。候補のproduction経路・LLM token/費用は未測定。

変更後7 proposed ACの独立読み手は、保持範囲、上限前提、複数sheet入力、truncation表示を文面から復元できなかった。既存proposalの条件と結果だけを明記し、同じ読み手が7件とも復元。同じreviewerも意味が変わらず引き継ぎのfreeze記録が解消したと確認した。読みやすさは承認・実装達成と区別する。Q1〜Q4は製品作業の次段階で決める事項として残す。

### AC読み手の入力境界を修正

実起動では、application cwdへの全読取を禁止するとモデル開始前のAGENTS読込で失敗した。別の中立cwdでの起動は成功した。配布指示にも「ACの文面だけ」と「全workerがproject文書を読む」の矛盾があった。

非公開案件情報を含まない指示と観測だけをAstra/highへ渡した限定評価は、2ファイルの最小修正を採用した。`_execution-team.md`では親会話・project contextを継承しない新規入力を要求し、CLIの場合の中立cwdと祖先からの自動読込を明記。`_subagent-context.md`の共通入力・読込からAC読み手を除外した。役割・モデル・AC判定規則は増やしていない。

これは実際の回答汚染、Git初期化の必要性、全実行環境での入力隔離を立証したものではない。先の4案件評価で追加ルール不要とされた部分判定・古いhandoffとは別の観測である。配布元 `./scripts/test-all.sh` は全成功。独立読み手の起動と変更AC再読も成功したが、未使用案件による一般化評価は未実施。

### 全5案件終了時のCLI使用量

| 要求モデル | 起動/usage取得 | 入力 | うちcache | 出力 | wall timeの和 |
|---|---:|---:|---:|---:|---:|
| gpt-5.6-sol | 50/46 | 166,642,027 | 159,445,888 | 899,369 | 26896.693秒 |
| gpt-6-astra | 14/13 | 11,391,196 | 10,137,600 | 49,136 | 2360.389秒 |

初期3実行と起動前失敗2回のusageは不明。取得できた同一thread/turnだけを集計し、JSONとrolloutを二重加算しない。Director調整・transport・準備agent・以前の文章評価は除外。並列wall timeの和は実経過時間ではない。金額、実提供モデル名、役割別最適値、費用削減率は未確定。要求モデルは通常Sol/high、観察Sol/medium、限定評価Astraとした。

最新HTMLは [報告14](https://5uhod24n.aboutme.style/report-14.html)。報告サイトのブラウザ視覚検査は未実施で、構造・保存hash・全量readbackを検査する。変更は専用worktreeへ保存し、元mainの別作業によるd1463d4への更新を上書き・自動合流しない。

報告14をHanger Sitesへ保存し、indexと版付きHTMLの全量readbackがローカルと一致。9,640 bytes、SHA256 `5848116b4f663c1e5d3ed32e87e20482fcf6e5abcce7ee617cc9dc54c279517d`。HTMLのタグ対応とローカルリンクも成功。
