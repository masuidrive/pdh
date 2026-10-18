---
name: pdh-change
description: "PDH を変えるときに読む。PDH の規則・skill・agent 定義・PDH-AGENTS.md・PDH の検査を足す・直すとき。PDH の原則、project ごとの違いを書く場所、変える手順、規則の置き場所と書き方を持つ。"
---

# PDH Change

この skill の目的: PDH を変える人が、変更を PDH の原則と照らし合わせ、置き場所・守れたかを数える仕組み・生成物・PDH-repo への同期までを 1 つの手順で終えられること。
PDH の規則・skill・agent 定義・`PDH-AGENTS.md`・PDH の検査を足す・直す人が、この skill の全部を読む。

PDH の規則で使う語は `docs/pdh-glossary.md` を参照する。

## PDH の目的と原則

PDH の目的は `PDH-AGENTS.md`「PDH の構造」の冒頭にある（要望の本来の意図に沿った、抜け漏れのない品質の高いコードを届け、ticket と一緒に commit として残すこと）。PDH を変えるときは、そのために、claude でも codex でも、PM が worker を使いながら PDH-flow を抜け漏れなく最後まで進められるかを見る。

下の原則は、この目的のためにある。原則どうしが食い違う場面や、原則に書いていない場面では、この目的で判断する。

PDH を変える提案は、次の原則と照らし合わせる。原則を外す変更は、ユーザに確認してから入れる（決定済み）。

1. **状態は repo の Markdown に置く**（ticket・note・progress）。目的: compact・session・bot の run が切れても、次の agent がファイルだけを読んで続きを始められること。engine の task list・会話・外部サーバの記録は写しとして扱う
2. **改造していない CLI の上で動かす。**claude と codex を、設定・hook・skill・agent 定義だけで動かす。目的: engine の更新をそのまま取り込み、片方の engine が使えなくてももう片方で同じ flow を回せること。専用のランタイムや常駐プロセスを作らない
3. **コードを書く engine と、確かめる engine を分ける。**目的: 1 つの engine が実装と review の両方で見落とす欠陥を、別の engine が見つけられること
4. **人が決めるのは、2 つの承認の PDH-stage だけにする**（実装前に AC を承認する `PDH-ticket-human-review` と、close を承認する `PDH-human-review`）。目的: 人の時間を判断だけに使うこと。AC と Out-of-scope の承認は内容の hash で記録し、承認の後にどちらかが変わったら close が止まる。それ以外の確認は、agent が自分で調べて済ませる
5. **守れたかは仕組みが数える。**PDH-stage に入るとき、`scripts/pdh-stage-checklist.sh` がその PDH-stage の確かめる行を note の Checklist へ写す。その行と規則が置いた行の未了を、`./ticket.sh close` の `require_checklist` が数える。ticket の記録は `check-pdh-ticket.sh` が close の前と `scripts/test-all.sh` の 1 段で、ファイルの中身は fast-checks が数える（下の «守れたかを数える仕組み»）。目的: 規則が読み落とされても、close の前に見つかること。仕組みは事故が起きてから足す。起きていない事故のための仕組みは、読む量と保守を増やすだけである
6. **テストを 2 種に分ける。**ticket-local は、その変更の確認で、ticket の中に置く。application test は、製品がどう動くべきかを書き、スイートに入れる。目的: スイートが製品の契約だけを持ち、変更のたびに膨らまないこと
7. **PDH-repo から配るファイルには、どの project にも当てはまることだけを書く。**目的: `pdh-update` がそれらのファイルをまるごと上書きしても、project の違いが消えず、PDH-repo の改良がどの project にも 1 コマンドで入ること。project ごとの違いは、下の «project ごとの違いを書く場所» に書く。書く場所が足りなければ、PDH-repo に書く場所を足す。配るファイルを project で書き換えて済ませない

## project ごとの違いを書く場所

| 違い | 書く場所 |
|---|---|
| project 固有の規則（全員が読む） | `CLAUDE.md`（codex には `AGENTS.md` として生成される） |
| PM だけが読む規則・環境の事実 | `CLAUDE.md` が名前で指すファイル |
| ticket.sh の振る舞い | `.ticket-config.yaml` の設定キー（`tickets_dir`・`require_checklist` など） |
| coding-bot の振る舞いと環境の値 | `.ticket-config.yaml` の `github_bot:`、Actions の変数 `CODING_BOT_*` |
| project の不変条件 | project 固有の `scripts/checks/*.check` |
| テスト・dev server・seed の中身 | `scripts/test-all.sh`・`scripts/dev-server.sh`・`scripts/seed-pdh-verify.sh`（初回だけ配られ、その後は project のもの） |

どのファイルが PDH-repo から配られて上書きされるかは、PDH-repo の `claude/INSTALL.md` の配置表と、それを展開した `.pdh-lock` にある。ticket が触った上書きのファイルが PDH-repo の版と違うまま close しようとすると、`check-pdh-ticket.sh` が `scripts/pdh-lock.sh check` で止める。ticket の途中で書き換えるのはよい。

**`.pdh-lock` が無い間は、この同期の検査は効かない**（`pdh-lock.sh check` は `.pdh-lock` が無いと何も数えずに通る）。PDH-repo に `claude/lock-map.tsv` を置き、導入先で初回の `pdh-lock.sh write`（下の «変える手順» の 6）を先に行う。

## 変える手順

1. 変更を上の原則と照らし合わせる
2. 置き場所を決める（下の «置き場所を決める»）
3. 守れたかを数える仕組みを置く（fast-check なら skill `pdh-check-writing`）
4. 生成物を作り直す: `bash scripts/gen-agents-md.sh`・`bash scripts/gen-codex-agents.sh`
5. PDH-flow・PDH-stage の移り方・再開の手順を変えたら、リハーサルをする。repo を clone し、途中まで進めた ticket を claude と codex のそれぞれで «続けて» だけで再開させ、決めた手順どおりに進むかを見る
6. PDH-repo へ同じ変更を出す（下の «PDH-repo から写したファイルを書き換えたら»）。上書きの前に、共通祖先を挟んだ 3 点比較で、PDH-repo 側にだけある改良が無いかを確かめる。出したら `bash scripts/pdh-lock.sh write --upstream <PDH-repo の checkout> --map <PDH-repo の checkout>/claude/lock-map.tsv` で `.pdh-lock` を進める

## 守れたかを数える仕組み

新しい規則を守らせるときは、この表から仕組みを選び、«足す場所» に足す。何を数えるかの全部は、各 script の冒頭のコメントにある（ここに写さない）。

| 仕組み | いつ動くか | 何を数えるか | 足す場所 |
|---|---|---|---|
| fast-checks（`scripts/fast-checks.sh` と `scripts/checks/*.check`） | `scripts/test-all.sh` の最初の段 | ファイルの中身: 禁止の書き方・行数や文字数の上限・あるべきファイル・生成物と元のずれ | 新しい `.check`（skill `pdh-check-writing`、`scripts/checks/README.md`） |
| `scripts/check-pdh-ticket.sh` | `./ticket.sh close` の前（`.ticket-config.yaml` の `pre_close_command`）と、`scripts/test-all.sh` の 1 段。coding-bot は push の前にも回す | ticket の記録: progress.md・AC の hash・承認待ちの行・close 前 review の区間・`.pdh-lock` のずれ | script に検査を足し、`tests/scripts/pdh_ticket_evidence_checks_test.sh` に通る例と落ちる例を足す |
| `require_checklist`（`ticket.sh`、`.ticket-config.yaml`） | `./ticket.sh close` | note の `## Checklist` の未了の checkbox と、必須の節 | PDH-stage の skill の «出力» の行か、note のテンプレート（`.ticket-config.yaml` の `note_content`） |
| `scripts/pdh-stage-checklist.sh` | PDH-stage に入るとき（`--enter`）と、再開するとき（`--show`） | 数えない。PDH-stage の skill の «出力» の行を note へ写し、未了の行を見せる | PDH-stage の skill の «出力» に `- [ ] <PDH-stage>: …` の行を足す |
| `scripts/pdh-session-hook.sh`（`.claude/settings.json`・`.codex/hooks.json`） | session の開始・再開・compaction のとき。PM だけ（`PDH_ROLE` が無いとき） | 数えない。`pdh-stage-checklist.sh --show` の出力を PM の context に入れる | — |
| `scripts/pdh-lock.sh` | `check-pdh-ticket.sh` から（note の Status が `PDH-human-review` か `PDH-close` のとき） | ticket が触った上書きのファイルと `.pdh-lock` のずれ | PDH-repo の `claude/lock-map.tsv` |
| `tests/scripts/*_test.sh` | `scripts/test-all.sh` | 上の script 自身の振る舞い | script を変えた差分と同じ差分でテストを足す |

## 置き場所を決める

ルールを追加するときは、次の 5 問に答える。1〜3 が置き場所を、4 と 5 が書き方を決める。1〜3 のいずれかの答えが skill を指すなら、skill に置く。どの skill に置くかは、下の «skill の構成» に従う。

1. **project 固有か、PDH 共通か？** project 固有は `CLAUDE.md`（codex では `AGENTS.md`）へ。共通は skill か `PDH-AGENTS.md` へ。言語ごとの書き方の規則は PDH に置かず、`CLAUDE.md`（codex では `AGENTS.md`）に置く。
2. **常に要るか、特定の状況だけか？** `CLAUDE.md`（codex では `AGENTS.md`）と `PDH-AGENTS.md` は常に context にある。skill は呼ばれたときだけ読み込まれる。無いと事故が起きるルールだけが、常時読み込みのファイルに載る資格を持つ。
3. **誰が読むか？** 役割を特定できるなら — Coding Engineer だけ、PM だけ — その役割の skill に属する。
4. **このルールの目的は何か、それはどこで見られるか？** どの PDH-stage の出力で、誰が何を正しく受け取れる・見つけられるのかを、«この規則の目的: …» の 1 文で書く。目的は肯定の形で書く — 起きてほしくない事故を書くと、読み手は裏返して目的を組み立て直すことになる。«〜しない» で終わりそうなら、それで誰が何をできるかに書き直す。その 1 文が書けないなら、それはルールではなく手順である — その PDH-stage の note の Checklist へ置く。ルールは**その 1 文を規則の先頭に 1 回だけ置き、動作を後に**書く。動作だけで書かれたルールは、動作を省けると読んだ読み手に落とされる。目的が書いてあれば、読み手は、目的が損なわれない場面かどうかで例外を判断できる。
5. **守られたかを、何が数えるか？** 守れたかを数える仕組み（fast-check・`require_checklist` が数える checkbox・テスト・`check-pdh-ticket.sh`）を、規則と同じ差分に置く。置けないなら、置けない理由を規則の横に 1 行書く。**文章だけの規則は守られない。**この問いは reviewer が見る。

skill の構成:

- **`pdh-pm`** — PM が読む。持つのは PDH-flow の状態遷移と、人とのやり取りだけ。承認の PDH-stage（`PDH-ticket-human-review`・`PDH-human-review`）は人とのやり取りなので、ここで扱う。ほかの PDH-stage に入るたびに、その PDH-stage の skill を呼ぶ
- **PDH-stage の skill** — PDH-stage ごとに 1 つ（`pdh-open`・`pdh-ticket-review`・`pdh-implement`・`pdh-review`・`pdh-verify`・`pdh-close`）。ticket を書くときは `pdh-ticket-write`。作業が中断している ticket を再開するときは `pdh-resume`（PDH-stage ではないが、同じ «入力・処理・出力・例外» の形で書く）。PDH-stage の skill は PM の手順である。出力の条件もその skill が決め、PM が worker の本文を開かずに完了を判定できる形で書く
- **worker の agent 定義** — worker の手順は `.claude/agents/pdh-<役割>.md` の本文に、1 役割 1 本で置く。Claude の subagent は本文を自分の指示として読み込み、codex の worker には PM が本文から frontmatter を除いて prompt に入れて渡す。本文の冒頭には共通の約束（push・`./ticket.sh close`・`gh pr merge`・`gh` での issue / PR / comment の書き込みをしない、note の Status を書き換えない、担当の範囲の外を書き換えない、決められた形で報告を返す）を置く。本文は Claude 固有の tool 名ではなく、操作の意味で書く
- **道具の skill** — 複数の PDH-stage で使う。`pdh-decision-board`（承認者へ渡す材料）・`pdh-check-writing`（fast-check の書き手）・`pdh-change`（PDH を変える人。この skill）
- **複数の skill が使う中身は 1 か所に置き、ほかの skill からはそのファイルを参照させる。**置き場所は、先に読み込まれる skill の中の `_xxx.md` か、`pdh-pm` の下。同じ中身を 2 つの skill に写さない

## PDH-stage の skill の形

PDH-stage の skill は、関数のように «入力・処理・出力・例外» の 4 つの節で書く。この形の目的: PM が、どの PDH-stage でも同じ場所で確かめ方を見つけ、ある PDH-stage の出力と、次に入る PDH-stage の入力の食い違いに気づけること。

```
# <PDH-stage 名>
<1 文: この PDH-stage は、何を受け取って、何を作るか>
<1 文: 誰がこの skill のどこを読むか。読む人が複数いて、読む範囲が違うときだけ書く>

## 入力   この PDH-stage を始めるときに成り立っている状態（どこに何があり、note の Status が何か）
## 処理   作業の順（### の小見出しは自由）
## 出力   作るものと、それが満たす条件（= 終了条件）
          ### 機械で確かめるもの
          ### 判断で確かめるもの（誰が判断し、どこに残すか）
## 例外   止まる・差し戻す・人に聞く条件と、その行き先
```

- «入力» には、どの PDH-stage から来たかを書かず、始めるときに成り立っている状態を書く。同じ PDH-stage に、前の PDH-stage から進む・差し戻される・pdh-resume で再開する、と複数の道から入るため
- «出力» に書く状態と、その先の PDH-stage の «入力» に書く状態は、同じ言葉で書く
- «出力» で確かめることは、`- [ ] <PDH-stage>: <終わったときに成り立っている状態>` の行で書く。この行がその PDH-stage のチェックリストの元で、PDH-stage に入るとき `scripts/pdh-stage-checklist.sh` が note へ写す。写した行は印と skip 理由以外を変えず、補足は次の行に書く。`check-pdh-ticket.sh` が元の行との完全一致を数えるためである。手順をやったことではなく、終わった状態と証拠の場所を書く — 手順の印は、手順を飛ばしても付けられる
- 人に聞くときの聞き方と再開は、各 skill に書かず `pdh-pm`「中断するときと再開するとき」を参照する
- 4 つの節がそろっているかは `scripts/checks/pdh-stage-skill-sections.check` が数える。形を直した skill は、その script の一覧へ足す

## 規則の文の書き方

**規則の文には、読み手のすることを変える文だけを書く。**規則を読む agent が指示に効かない文を読まされると、経緯を規則と取り違える。段落ごとに 1 つ問う — **«これを消したら、読み手のすることが変わるか。»**

- **変わらないものは書かない。**誰がいつ決めたか（「ユーザ指示 <日付>」のような括弧）、ticket 名・commit・issue 番号・run id の出典、«以前は〜だった» «〜で気づいた» の経緯、«〜行だったものが〜行になった» のような数字の履歴。
- **変わるものは残す。**規則の理由（例外に出会ったときの判断に使う）、捨てたもの（上書きするかの判断に使う）、版や日付が条件になっている記述（«<版> 以降» — それより前の版では扱いが違う）、日付を含む見出しや anchor を参照するための文字列。
- **件数・一覧のように、ファイルを見れば分かる現在の値を写さない。代わりに、確かめるコマンドを書く**（«現在の並びは `ls <dir>/*.spec.ts` で確認する»）。写した値は増減しても誰も直さず、古い数字が現状把握を誤らせる。
- 規則の本文には行動を変える条件と理由を残し、測定の経緯は実測の記録へ分ける。実測の記録には日付・対象（SHA や版）・入力と環境の条件・出典を残す。数字を新しい判断の根拠に使う人が、同じ条件かを確かめ直せるようにする。
- **出典を消すと «人が決めたことで、agent が変えてはいけない» という情報まで消えるなら、その情報を指示の形で書く**（«決定済み。変えるときはユーザに確認する»）。⚠ すべての規則に付けない — 規則はどれも人が決めたものなので、付けるのは agent が変えたくなりやすい箇所だけにする。

経緯は git が持つ。`git blame` で行の commit を特定し、commit message の ticket 名から ticket と progress を辿る。規則の文に写さない。

同じルールを 2 箇所に書かない。文言を移動したら、移動元に同じ文言が残っていないかを grep で洗い出す。

## 文書を書くとき

この規則の目的: 読み手が必要な時点で現行の文書へ辿り着き、関係する変更の出荷前に内容を確かめ直せること。

`docs/` にはソース（コード・テスト・設定・git の履歴）から作れない、repo の外の状態・作っていないものについての決定・人の意図と方針だけを置く。製品の利用契約は `specs/`、コードの落とし穴はそのコードのコメント、作業の記録は ticket に置く。ソースから繰り返し集める情報が必要なら script・`--help`・生成物にし、文書には取得するコマンドを 1 行残す。たまにしか使わない写しは消す。

- ファイル名は英語の kebab-case で主題の名詞句にする。日付・ticket 名・版を入れない。ディレクトリは複数ファイルの組にだけ作る。分ける単位は読む人と読む場面にする
- 文書の先頭に下の YAML frontmatter を置く。`docs/**/*.md` と `specs/*.md` が対象で、`results/` 配下の過去の実測記録は対象にしない。通常の文書へ生成物というコメントを書いて検査から外さない
- `stale-when` は誤りの判定ではなく、再確認のきっかけである。path は変わったら読み直す狭い範囲を選ぶ。まだ無い機能や人の判断は event で書く。旧 describes の値を機械的に写さない
- `read-at` は読む PDH-stage の一覧である。空の文書は到達できる文書・skill・agent 定義・Product Brief・project の規則からリンクする。自己リンク・ticket の履歴・fixture は読む入口に数えない

```yaml
---
kind: reference  # reference / decision / contract / roadmap。specs/ は contract
status: active   # active / proposed / superseded / retired
read-when: 誰が何をするときに読むかを 1 行で書く
read-at: [PDH-ticket-review, PDH-implement]  # PDH-AGENTS.md の stage 名。空リスト可
stale-when:     # 1 件以上。以下から必要なものを選ぶ
  - path: scripts/example.sh
  - event: before-use  # before-use / policy-change / plan-change
  - check: [python3, scripts/query-example.py]  # 必要な外部照会だけ。argv と期待値を対にする
    expect: {exit-code: 0}
# replaced-by: docs/replacement.md#scope  # superseded のときだけ必須
---
```

`bash scripts/docs-toc.sh --stage <PDH-stage>` が読む候補と見出しを出す。`docs-metadata.check` は型・path と後継の実在・後継の循環を、`docs-references.check` は読む入口からの到達を数える。外部照会は lint と close からは実行しない。外部事実を使う担当が利用前に `python3 scripts/docs-policy.py check-external <doc>` を実行する。文書の check を argv のまま、1 件につき既定 30 秒の上限で照会し、一致（exit 0）・不一致（exit 1）・取得不能（exit 2）を返す。目次も check がある文書にこの入口を表示する。

照合した文書と節は ticket の `related-docs.md` に残す。`python3 scripts/docs-policy.py record <doc#anchor> --base <close と同じ基点> --note <note.md> --resolution unchanged --reason '<理由>'` が文書と関連入力の hash を記録する。resolution は updated / unchanged / retired / not-applicable で、unchanged と not-applicable は理由が要る。close の `check-pdh-ticket.sh` は base と出荷側の両方の監視条件を見て、削除・rename・未追跡の追加を含む変更に対して現在の hash と一致する記録を求める。文書を直しただけ・文書名を含む済み行・skip では代わりにならない。文書や関連入力を変えたら記録し直す。

## PDH-repo から写したファイルを書き換えたら

**`PDH-AGENTS.md`・PDH の skill・agent 定義・coding-bot の共有ファイル（どれが当たるかは PDH-repo の `claude/INSTALL.md` の配置表と `.pdh-lock` にある）を書き換えたら、その ticket の close の前に PDH-repo（`masuidrive/pdh`）にも同じ変更を出し、`.pdh-lock` を進める（«変える手順» の 6）。**この規則の目的: 手元の変更が次の `pdh-update` の後も残り、PDH-repo と手元が同じ内容を保つこと。出し忘れは close の検査（`scripts/pdh-lock.sh check`）が数える。
