# PDH — 実行モデル: Team (multi-agent CLI)

この規則の目的: PM が、worker の出した結果を自分で確かめてから PDH-stage を進めること。
PM が worker を起動するときに読む。worker の手順は、役割ごとに 1 本ずつ `.codex/agents/pdh-<役割>.toml` の本文にある。

## 役割

- 利用できる環境では、PDH-stage ごとに worker を起動する。Coding Engineer、QA Engineer、reviewer（Devil's Advocate、Code Reviewer。起動の prompt に役割を書く。違いは `.codex/agents/pdh-reviewer.toml`「役割」）、AC 裏取り、Surface Observer は、現実的な範囲で別々の worker にする。各役の手順はその役割の `.codex/agents/pdh-<役割>.toml` の本文にある
- **PM にとって、worker の PASS は入力であって承認ではない。**PDH-stage を進める前に、docs・ticket・diff・実コマンド出力・note の証拠を PM が自分で確かめる
- PM は source code の編集・test の実行・doc 再生成・review 後の修正を行わず、担当の worker へ委譲する
- reviewer の finding は、処置（いま直す / 起票する / 記録だけ残す / 棄却する）を付けてから Coding Engineer へ渡す
- ticket 提出前と worker の prompt 提出前に、`[SKILLS_PATH]/pdh-pm/_records.md`「成果物セルフチェック」を行う
- 広い調査やノイズの多いログ確認は worker へ委譲し、PM の context を判断とユーザとの対話のために空けておく
- PM は、複数の worker に同じ書き込み先を割り当てない。読み取り・review の worker は並行してよいが、書き込む worker には明確な担当を置く。QA の mutation 用の隔離先と server・DB・ログの割り当ては `.codex/agents/pdh-qa.toml`「並行する検証」に従って prompt に書く

## worker を起動できないとき

- worker を起動できないとき、PM だけでの実行を、worker を使った実行と同等のものとして黙って扱わない
- 確信度や承認の PDH-stage の意味に影響する場合は、制約を説明してユーザに確認する

## エンジン割り当て（既定 = 実装と review は別の engine / `AGENTS.md`で上書き）

- **PM は自身の engine・model・profile・reasoning effort を変更しない。**その変更を許可できるのは、現在の作業に対する明示のユーザ指示だけである。worker への model 割り当ては別の話で、下の項目と `AGENTS.md`に従う
- **実装（Coding Engineer）と review（reviewer）は、既定で別の engine にする。**同じ engine が実装と review の両方で見落とす欠陥を、別の engine に見つけさせるためである。engine が 1 つしか無い環境では、同じ engine で review したことと、その理由（別の engine が無い）を progress に記録する
- それ以外の worker の engine は、既定で PM と同じにする。役割ごとの engine / model の上書きは、`AGENTS.md`に明示された場合だけ許す
- 実装と判断（review を含む）は標準以上の model を使う。比べるのは «1 回の単価» ではなく «完了 1 件までの合計» である — 取り違えればやり直し・review の巡数・人が承認や再実行の操作をする回数が増え、その合計は 1 回を安く済ませた差より大きい。**単価だけを見ると、必ず非力な側が勝つように見える**。列挙・抽出・出力の整理は軽量な model も使える。判断は任せた側が持つ。仕事に判断が含まれるかは内容で決まるため、機械では数えられず PM が割り当て時に確かめる
- 委譲先の model は名前で固定しない。CLI の既定（codex は `-m` を付けない）か、CLI の alias（claude は `opus` など）を使う。名前を書くと、書いた側だけが古くなる。どの model で動いたかは worker の出力（stderr の冒頭など）から読む
- PM の engine が未指定で曖昧なときだけ、利用可能な CLI を確認してユーザへ聞く。既に指定されていれば聞かず、session 中は継続する。headless / CI では、その実行系が定義する環境変数を PM の engine とする
- Coding Engineer を最上位クラスの汎用 coding モデルで動かすときは、reasoning effort を `medium` にする。探索・判断・review の役（architecture 検討、root cause 切り分け、review / verify）は既定の effort を使う
- Coding Engineer の profile は、委譲された product / UX / AC の判断を «自分で決めて進む» のではなく «止めて差し戻す» 側を既定にする（`.codex/agents/pdh-coding-engineer.toml`「例外」の停止条件どおり）
  - 判断が残る ticket は、`PDH-ticket-human-review` で解消してから Coding Engineer を起動する
  - 判断を埋めさせるために «進む» model を worker へ当てない — 実装者が決める失敗になる
  - model / effort は `AGENTS.md`とそこから参照する project の規則に従って選ぶ

## ticket の worktree で作業する

この規則の目的: PM と worker が ticket の worktree の中で作業し、並行して動く別の session の作業ツリーがそのまま保たれること。

- PDH-open か pdh-resume で確定した worktree で、PDH-close までのコマンドを実行する
- worker は、その worktree を作業ディレクトリにして起動し、prompt にもそのパスを書く（codex なら `cd <worktree> && codex exec ...` の形）
- コマンドごとに作業ディレクトリが最初の場所へ戻る環境では、毎回そのパスを作業ディレクトリに指定する

### review 専用 worktree

この規則の目的: PM が記録を commit している間も、reviewer が指定 SHA のコードを読み、PM の HEAD と index を保てること。

PM はコードを読む reviewer ごとに `<TMP_DIR>` 内へ `git worktree add --detach <review_tree> <review_sha>` で専用 worktree を作り、そのパスを作業ディレクトリとして渡す。通常の reviewer には ticket の記録を別の入力として渡してよいが、Why の見方には渡さない。起動前と回収後に `test "$(git -C "$review_tree" rev-parse HEAD)" = "$review_sha"` と `test -z "$(git -C "$review_tree" status --porcelain)"` を実行し、結果を progress に残す。失敗した結果は採用せず、原因を調べて同じ SHA でやり直す。worktree の作成と片付けは PM が行い、reviewer は HEAD・branch・index を変える操作をしない。PDH-review と close 前 review の Checklist で、この照合を数える。

## spawn 機構（engine 中立 = subprocess / 結果はファイル）

worker は CLI subprocess で起動し、結果を専用 file で回収する。承認済み in-process worker 機構があれば優先する。**`--dangerously-*` 系 bypass flag は、ユーザまたは session が明示許可した場合だけ使う。**承認待ちが発生したら bypass せず、承認を得るか in-process 機構へ切り替える。

### worker prompt の組み立て

worker の手順は、役割ごとの `.codex/agents/pdh-<役割>.toml` の本文にある（実装は `pdh-coding-engineer`、review は `pdh-reviewer`/`pdh-reviewer-lens1`、QA は `pdh-qa`、verify は `pdh-ac-verifier`/`pdh-surface-observer`、AC だけを読む worker は `pdh-ac-reader`）。本文は `<TICKET_FILE>`、`<NOTE_FILE>`、`<PROGRESS_FILE>`、`<BRANCH>`、`<SCOPE>`、`<RESULT_FILE>`、`<TESTS_DIR>`、`<TMP_DIR>` を参照するので、PM はその実値を prompt に書く。

- `<PROGRESS_FILE>` は `[TICKET_DIR]/progress.md`、`<TMP_DIR>` は `./ticket.sh start` の出力の `tmp_dir:` パス、`<TESTS_DIR>` は `[TICKET_DIR]/tests/`（legacy flat layout では `tests/tickets/<id>/`）で導出する
- `<RESULT_FILE>` は worker が file tool で書く成果物 file であり、stdout とは別のパス（例: `$d/result.md`）を worker ごとに割り当てる
- QA には `.codex/agents/pdh-qa.toml`「結果の貼り方」が定めるログの実パスも prompt に書いて渡す
- Why の見方の reviewer には `<TICKET_FILE>`・`<NOTE_FILE>`・`<PROGRESS_FILE>`・diff を渡さない。Why の原文と review 対象の commit SHA を prompt 本文へ書く

#### PM が worker の prompt に入れるもの

worker は PM の会話状態を引き継がない。PM は、すべての worker の prompt に次を入れる。

- タスクの目的と背景
- 対象ファイルパスまたは担当境界（`<SCOPE>`）
- ticket の Why・Acceptance Criteria・Architectural-Invariants-check・Design-Decisions・Out-of-scope の節
- その worker の正確な責務と、ほかの worker との書き込み先の境界（各役の本文の「書き込み境界」）
- 上の placeholder の実値
- テストを行う役には、実行する検査と場所（手元・CI）、手元で回さない検査、CI に委ねる場合に回収する workflow・対象 SHA・必須チェック名。PM が project の規則を読んで決め、worker の結果と照合する。この照合は implement / verify の既存の検査結果の Checklist で数える

例外: Why の見方の reviewer の prompt には、ticket file・AC・実装者の結論を入れない。Why の原文だけを載せる（`[SKILLS_PATH]/pdh-review/SKILL.md`「2 つの見方」）。

#### 本文の渡し方

- Claude Code で `.codex/agents/pdh-*.toml` が配置されているときは、in-process spawn で定義名を指定して起動する。本文は worker 自身の指示として読み込まれるので、prompt には上の «入れるもの» と task 固有依頼を書く
- CLI で起動する worker（`claude -p`・`codex exec`）には、`.codex/agents/<役割>.toml` から developer_instructions の本文を prompt の先頭に入れ、その後に上の «入れるもの» と task 固有依頼を続ける。どちらにも環境変数 `PDH_ROLE=<役割>` を渡す（SessionStart の hook が PM 向けの表示を差し込まないため）
- AC だけを読む worker（`pdh-ac-reader`）の渡し方は `[SKILLS_PATH]/pdh-ticket-review/SKILL.md`「AC だけで伝わるかを確かめる」にある
- read-only sandbox の定義で動く役（Codex の reviewer / AC 裏取り / AC だけを読む worker）には `<RESULT_FILE>` を割り当てず、結果を最終 message で回収する

prompt は file へ書き出す。claude には stdin で渡し、codex には引数で渡して stdin を `/dev/null` にする。

### headless の権限と返却先

この規則の目的: worker が、非対話の実行で承認待ちにならず、許された範囲で結果を返せること。

起動前に、PM は session と project が許した file の読み書き・コマンドの範囲、使う権限 mode と許可する tools、結果を file と stdout のどちらで受けるかを決めて prompt と起動引数へ書く。親の権限は子の CLI へ自動では引き継がれない。実際の書き込み先まで許可されていない worker に RESULT_FILE を割り当てない。許可を持たない `--permission-mode bypassPermissions` を付けて解決しない。許可された tools と実行する操作の対応は意味によるため、機械では数えられず PM が起動前に照合する。

本文と材料を prompt に含め、tools を使わず stdout だけで返す claude の役は次で起動できる。結果は `$d/stdout.txt` から回収する。

```bash
PDH_ROLE="$role" bash scripts/spawn-worker.sh --stdin "$promptfile" "$d" -- claude -p --tools ""
```

file やコマンドが必要な役は、許可済みの範囲に合う `--permission-mode`・`--allowedTools` などを project の起動例に指定する。必要な許可が無い場合は、既存の in-process 機構か stdout で完遂できる範囲を使い、完遂できなければ既存の「worker を起動できないとき」に従う。

### 起動コマンド（engine 別・権限は `AGENTS.md` に従う）

worker は `scripts/spawn-worker.sh` で起動する（理由は下の「並行起動」）。

```bash
# $d は <TMP_DIR>/workers/<名前>、$role は役割（例: pdh-coding-engineer）、$taskfile は «入れるもの» と task 固有依頼
# prompt = 役割の本文（developer_instructions を読む）+ $taskfile
{ python3 -c 'import sys,tomllib; print(tomllib.load(open(sys.argv[1], "rb"))["developer_instructions"])' ".codex/agents/$role.toml"; cat "$taskfile"; } > "$promptfile"

# claude（prompt は --stdin で渡す。成果物は worker が <RESULT_FILE>=$d/result.md へ書く）
PDH_ROLE="$role" bash scripts/spawn-worker.sh --stdin "$promptfile" "$d" -- claude -p

# codex（prompt は引数。stdin は spawn-worker.sh が /dev/null にする。-o は最終 message の控え。成果物は同上）
PDH_ROLE="$role" bash scripts/spawn-worker.sh "$d" -- codex exec -o "$d/last-message.txt" "$(cat "$promptfile")"
```

回収は `<RESULT_FILE>` を読む。無ければ無言終了として扱い、`$d/rc.txt`・`$d/stdout.txt`・`$d/stderr.txt`（codex は `$d/last-message.txt` も）の末尾から原因を診断する。

#### 完了報告の無い QA の結果

この規則の目的: QA が完了報告を返せなくても、証拠のそろった検査を使い、不足した検査から続けられること。

prompt に書いた実パスから、`.codex/agents/pdh-qa.toml`「結果の貼り方」が定める形式のログを読み、依頼したすべてのコマンドと照合し、検査ごとに対象の commit SHA・コマンドの終了コード・実際の出力がそろっているものだけを採用する。欠けた検査だけをやり直す。worker 全体の終了コードを、個々の検査の終了コードの代わりにしない。完了報告にしか書かれない判断は、別に聞き直す。採用した検査と証拠の場所、やり直す検査、聞き直す判断を progress に残し、既存の検査結果の Checklist と照合する。証拠の対応は実行内容で決まるため、機械では数えず、PM がこの照合で確かめる。

この扱いは QA だけに適用する。結果ファイルが無い reviewer の巡は、`pdh-review`「例外」に従い、同じ SHA でやり直す。

### worker ごとの使用量と経過時間

この規則の目的: PM が、worker の結果と、その結果を得るまでの使用量を同じ実行の記録で比べられること。

worker ごとに、engine の JSON・usage から取れる当該実行分のトークン数と、起動から終了までの経過時間を progress に残す。取得元（出力ファイルと field、時刻の記録）も添える。会話全体の累積値を当該実行分として書かない。親子の usage が別集計なら、親のみ・子のみなど集計の範囲を書く。どちらも取れない値は «不明» と書き、推定で埋めない。

結果を回収するときに記録し、使用量のための Checklist の行は増やさない。

### reviewer に `codex exec review` を使うとき

**この規則の目的: PM が、review が実際に実行されたかどうかを確かめたうえで、«finding ゼロ» を受け取れること。**`codex exec review` は差分を自分で取りに行く review 専用のコマンドで、`codex exec` とは受け付ける引数が違う。

- **差分の指定と指示文は同時に渡せない。**`--base <branch>`（`--commit` / `--uncommitted` も同じ）と、位置引数の指示文 `[PROMPT]` は排他である。`--base` で渡したときは観点を渡せないので、結果の処置の判断は PM が ticket の文脈で行う。**close 前 review は `--base` で代用せず、`pdh-review-range.sh --prompt` の出力を指示文として渡す**（`[SKILLS_PATH]/pdh-verify/SKILL.md`「処理」6）
- **sandbox は `-c sandbox_mode=…` で指定する。**`codex exec review` は `--sandbox` フラグを受け付けない。sandbox を外す値（`danger-full-access`）は、上の `--dangerously-*` と同じく、ユーザか `AGENTS.md`が明示許可した場合だけ使う
- ⚠ **sandbox が起動できない環境では、review は «finding なし» に見える結論を黙って返す。**codex 既定の sandbox（Linux では bubblewrap）が非特権の user namespace を作れない container では、`bwrap: No permissions to create a new namespace` で差分の取得に失敗し、それでも rc 0 で «No actionable correctness issues» のような結論を書く。**結果を読む前に 2 つ確かめる。**
  1. stderr に、行頭から始まる `bwrap: ` が無いこと — `grep -cE '^bwrap: ' "$d/stderr.txt"` が `0`。⚠ **行頭アンカーを外さない。**codex は `AGENTS.md`（この注意を写した文を含む）を読んで出力に引くので、`bwrap` を素朴に検索すると説明文に当たって必ず非ゼロになる。⚠ **条件を足して «精密» にもしない** — 検査式を文書に書けば、その式ごと出力に引かれて自分に当たる。実エラーは行頭から出る
  2. 結論が空でないこと
- rc だけで成否を決めない
- ⚠ **`codex exec review` は組み込みの review 基準に従う。**その基準は既存のバグを報告せず、finding の位置が diff と重なることを求める。位置引数の指示文で «既存のバグも報告する» と頼んでも従わない。既存のバグも探させたい review（PDH-review）では、`codex exec` に review の指示文を渡して起動する。close 前 review のように «区間の commit だけを見る» review には `codex exec review` が合う

```bash
# PDH-review の第 3 reviewer（既存のバグも探させるので codex exec。sandbox を外すことが `AGENTS.md` で許可されている環境の例）
# $review_prompt は .codex/agents/pdh-reviewer.toml の本文（developer_instructions を読む）+ «入れるもの»（review 対象の SHA を含む）
PDH_ROLE=pdh-reviewer bash scripts/spawn-worker.sh "$d" -- codex exec --sandbox danger-full-access -o "$d/codex-review.txt" "$review_prompt"
# close 前 review（区間は指示文で渡す。結論は stdout.txt に出る）
p=$(bash scripts/pdh-review-range.sh <ticket dir> --from last-review --prompt) && \
  bash scripts/spawn-worker.sh "$d" -- codex exec review -c sandbox_mode="danger-full-access" "$p"
# 終わってから（--wait が 0 を返してから）
grep -cE '^bwrap: ' "$d/stderr.txt"   # 0 でなければ、review は実行されていない
```

### PM = Claude Code のときの codex worker 起動

Bash ツールで直接実行する。codex plugin 等の別経路があっても使わない。

- `run_in_background: true` で非同期にし、`timeout` は 7200000（120 分）にする
- prompt は file へ書き出し、`"$(cat <dir>/prompt.txt)"` の形で引数として渡し、stdin を `< /dev/null` にする
- 完了通知後は `<RESULT_FILE>` だけ Read する。`stderr.txt` は失敗時に `tail -50` 程度で部分読みする

### 並行起動（必須パターン: `set -m` で切り離して起動し、待つのは別呼び出しで区切る）

**この規則の目的: worker が仕事を最後まで終えられること。**

⚠ **worker を «起動した shell 呼び出しの中で» 待たない。**engine の shell tool は **1 コマンドごとに timeout** を持ち、超えるとそのコマンドへ SIGTERM を送る。同じ呼び出しの中で `wait` すると、**worker がまだ働いていても一緒に殺される。**

実測では、signal の送り主は runner でも OOM でもなく **親の engine プロセス自身**で、2 件とも «自分が起動してから» 181 秒・183 秒だった。2 件の起動時刻は 73 秒ずれていたので、全体の締切ではなく **1 コマンドごとのタイマー**である。

PDH-repo に実装がある — `scripts/spawn-worker.sh` が、この切り離しと «終わり方の記録»（rc・受けた signal・親子関係）をまとめて行う。`bash scripts/spawn-worker.sh <out-dir> -- <cmd...>` で起動して即座に返り、`bash scripts/spawn-worker.sh --wait <out-dir> [秒]` で短く区切って待つ（`75` = まだ走っている、`0` = 終了して `rc.txt` にある）。出力ディレクトリは `<TMP_DIR>/workers/<名前>` にする。切り離した worker は PM の session が終わっても走り続けるので、再開するときに PM がここで見つける（skill `pdh-resume`「どこまで進んでいたかを読み取る」）。claude に prompt を渡すときは `--stdin <file>` を使う — **切り離した先は呼び出し側の stdin を継承しないので、`-- cmd < prompt.txt` と書くとその `<` は spawn-worker.sh 自身に掛かり worker には届かない。**codex は prompt を引数で渡し、`--stdin` を付けない（stdin は `/dev/null` になる）。

**`scripts/spawn-worker.sh` は、`setsid` がある環境では worker を別 session へ出し、無い環境（macOS）では `set -m`（job control）で別 process group へ出す。**どちらでも、呼び出し側の group へ送られた signal が worker へ届かない。同じ実測で、`set -m` 有りの worker は完走し、無しの worker は殺されることを確かめた。

engine 自身の background 機構（Claude Code の `run_in_background`）を使う経路は、この限りではない。あちらは engine が寿命を管理するので、上の `timeout` 指定のままでよい。ここで言っているのは **shell の中で worker を起動して待つ場合**である。

```bash
# 起動する呼び出し: worker の数だけ spawn-worker.sh を呼んで、この呼び出しは «待たずに» 終える
PDH_ROLE=pdh-reviewer bash scripts/spawn-worker.sh --stdin "$TMP_DIR/workers/da/prompt.txt" "$TMP_DIR/workers/da" -- claude -p
PDH_ROLE=pdh-reviewer bash scripts/spawn-worker.sh "$TMP_DIR/workers/codex" -- codex exec -o "$TMP_DIR/workers/codex/last-message.txt" "$(cat "$TMP_DIR/workers/codex/prompt.txt")"
```

待つのは **別の shell 呼び出し**で行い、**1 回を短く区切る**。

```bash
# 待つ呼び出し: 1 人ずつ 150 秒まで待つ。75 が返ったら、同じ呼び出しをもう一度行う
for name in da codex; do bash scripts/spawn-worker.sh --wait "$TMP_DIR/workers/$name" 150; done
```

⚠ **1 回の待ち時間を長くして «1 回で済ませる» ことをしない。**長くした分だけ shell tool の timeout に近づくだけで、**元の症状がそのまま戻る。**`RUNNING`（終了コード 75）が返るのは失敗ではなく、**呼び直しの合図**である。

worker ごとに `rc.txt` と `stderr.txt` の末尾を診断証跡へ残す。signal で止まった worker は `diag.txt` にも記録がある。non-zero rc または空・欠落 result では、rc と stderr を併読して報告する。rc が `143` の worker は «失敗した» のではなく «殺された» のであって、結果が無いことの理由が違う。そのまま報告する。

同時に起動する worker が多い場合は、batch に分けて起動数の上限を設ける。

**codex の混雑時は自動で続きを走らせる。**`scripts/spawn-worker.sh` は 0 以外で終わり、最後のエラーがモデルの混雑なら、`codex exec` を同じ会話で再開し、`codex exec review` を元の引数・cwd・起動時に保存した stdin で最初から起動し直す（`--json` も対象）。非 JSON は stderr の最後の見出しより後にある最後の行頭 `ERROR:`、JSON は stdout の最後の `error` / `turn.failed` のメッセージに `Selected model is at capacity` を含むときに混雑と判定する。review の起動し直しには session id は要らず、再開指示のファイルは作らない。初回を 0、再開・起動し直しを 1 から数える。exec の再開指示は `resume-<回>.prompt.txt` に保存し、stdin で渡す。`--stdin` が通常ファイル以外なら、混雑しても再開・起動し直しをしない。`resume.log` の各回の行で `action=exec-resume` / `action=review-restart` を区別する。既定は最大 4 回、待ち時間は 1・2・4・8 分。`PDH_CODEX_RESUME_MAX=0` で無効にでき、上限と最初の待ち秒数は `PDH_CODEX_RESUME_MAX` / `PDH_CODEX_RESUME_DELAY_SECONDS` に非負整数を指定して変えられる。`--wait` は再開が有効になったとき、実際に再開した回数を `resumes=<回数>` で添える。再開が混雑以外で失敗したら `--wait` の診断に従って `stderr.<回>.txt` を確認する。

各 PDH-stage で誰を起動するかは、その PDH-stage の skill（`[SKILLS_PATH]/<skill 名>/SKILL.md`。PM の手順）に書く。
