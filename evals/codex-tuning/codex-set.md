# Codex 配布セットへの移植（2026-09-06）

`origin/main` の `1d9854a` を起点に `codex/set` を作り、`codex/pdh-codex-tuning` の `1fa9e3e` から Codex 配布物を移した。元のチューニングブランチは保持する。この文書より前の評価・HTMLは当時の構成の履歴であり、共有契約を戻した今回のセットの振る舞いを再評価した結果ではない。

## 取り込んだ範囲

- `codex/skills/`: 7 skillsと分冊・判断ボードkit。tmux-directorは元のチューニング版に無い
- `codex/templates/`: project入口、設定・検査・実行script、7 Codex agent定義
- `codex/INSTALL.md`: コピー元とBased-onのパス、更新skillの参照先を新構造へ変更
- `evals/codex-tuning/` と3本の評価script。履歴のモデル名と測定値は保存
- root `INSTALL.md` はCodex行を導入先へのリンクに変更しただけ
- 必須配布物registryへCodexのskills・agent定義を追加。配布先のregistryは `.agents/skills/` と `.codex/agents/`

`check-distribution.sh` のCodex用Based-on一覧は、mainの時点で今回の13ファイル（7 skills、6 templates）と一致していたため変更していない。共有docsの2ファイルを合わせて導入時の置換対象は15ファイル。

特定モデル名は散文の規則から除き、役割と評価へのescalationで記述した。TOMLのmodel / reasoning effortはprojectの上書き例と明記して保持した。`AGENTS.md`の配布テンプレートはmainの入口言語方針に合わせて英語にした。

## 実行した検証

- `./scripts/test-all.sh`: exit 0。両セットの配置表・Based-on・長い同一行重複・リンク、fast-checks通常/色付き、両kitの通常/BSD相当selftest、shell構文が成功
- `scripts/test-codex-eval.py`: 8 tests成功。全体入口にも追加し、Pythonが無い場合はこの追加検査をskipする
- Codex kitのselftestはNode/PythonをPATHから除いた環境でも成功。追加したPython検査も同じ環境でskipしてexit 0。mainから存在するリンク検査のPython必須条件は変更しておらず、全体入口がPython無しで成功すると主張しない
- 7 skillsのquick validator、7 agent TOMLのparse成功。標準PythonにはPyYAMLが無いため、既存の検証用Python環境でvalidatorを実行した。依存の追加installはしていない
- 必須skillを一時的に除いた反例でfast-checksがexit 1となり、消えたパスを報告。直後に復元
- 評価入力生成を新しいworking treeと旧チューニングrevisionの両方で実行。旧構造は `--source-set legacy` で指定し、manifestに記録
- 一時projectで公開ticket.shの取得・initを実行後、INSTALLから取り出した配置・commit ID置換・導入検査・backup・更新コマンドを実行。更新2回目の配布物hashは同一、project/local設定と個人追加skill/agentは不変
- 一時projectの旧symlinkを実ディレクトリへ移行し、backup後に列挙された旧PDHファイルだけを退役。個人のClaude agentと旧project文書が保持されることも確認
- コピー後のpdh-dev/pdh-update入口を実際に読み、参照先の存在と `codex/INSTALL.md` の選択を確認

導入検証では未mergeのローカルスナップショットを `tmp/pdh` に置き、リモートmainの取得だけを置き換えた。導入先の実製品テストや、対話Codexでのagent選択UI、新構成の実案件再評価は実行していない。生ログは `/private/tmp/pdh-codex-set-validation/` に保存した。

## 取り込まなかったもの・判断した点

共有 `docs/`、`claude/`、rootのproduct-brief / CLAUDE / AGENTS / READMEはmainから不変。root INSTALLのCodexリンク以外の書き換え、Claude側の削除、hookbus削除は取り込まない。

共有契約に対する「依頼文から実装許可を読む」「Checklistの文言」「実行不能と失敗の区別」の3点は保留。両engineを同じ切り出しで測る前に、今回の移植で共有契約を変えない。

判断点は、モデル名をagent定義の上書き例へ限定すること、過去revisionを読む評価scriptの旧パス指定を明示的なoptionとして残すこと、既存の共有検査の依存条件を広げないことだった。新しい判断ボードの規則変更やkit変更は加えていない。mainにはmergeせず、`codex/set`をレビュー対象としてpushする。

付属のminified Mermaid bundleには元版から行末空白があり、通常の `git diff --check` はこれを報告する。bundleは元branchとの全byte一致を確認して保持し、この1ファイルを除くdiff検査は成功。文書の既存行末空白だけを整えた。
