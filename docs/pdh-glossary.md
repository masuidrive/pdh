---
kind: reference
status: active
read-when: PDH の規則に使う語を選ぶとき
read-at: []
stale-when:
- event: policy-change
---

# PDH 用語集 — skill を書き直す人のためのファイル

**このファイルは、PDH の skill と PDH-AGENTS.md を書く人と書き直す人が使う。**この規則の目的: 同じものがどの skill でも同じ名前で呼ばれ、読む agent が同じものだと分かること。

- 通常の PDH-stage を進める agent は通読しない。規則を書く人が `pdh-change` から開く。
- 規則の文には「使う語」だけを書く。「使わない語」を見つけたら「使う語」に直す。
- 新しい語を規則に入れるときは、先にこのファイルへ足す。足せない（意味を 1 文で書けない）語は、規則に入れない。
- 1 つの語に 1 つの意味だけを持たせる。別の意味で使いたくなったら、別の語を選ぶ。
- 言語ごとの文章の書き方は PDH に置かない。`CLAUDE.md`（codex では `AGENTS.md`）が定める。

skill の分け方は skill `pdh-change` にある。

英語にするか日本語にするか:
- **機械が文字列で照合するものは英語のまま残す。**PDH-stage の名前（`PDH-open` など）、ファイル名、ticket と note の節の見出し（`Required-Probes` など）。
- **識別子の語と語は `-` でつなぐ。空白を使わない。**大文字・小文字は既存の形に合わせて書く（`PDH-open`、`Required-Probes`）。識別子を照合する PDH のコードは、大文字・小文字を区別しない（第三者配布物の ticket.sh には当てない）。
- 英語のままでも意味が通じる語（worker、finding など）は、識別子でなくても英語のまま使ってよい。
- **それ以外の概念の名前は日本語にし、何をするかが語から分かる名前を選ぶ。**英語の造語や比喩（probe、pin、lens、遮断器）は使わない。

各語の形:
- **使う語**
  - 意味: 1 文
  - 定義する場所: その語の意味を決めているファイルと節（ここを直せば意味が変わる）
  - 使わない語: 同じものを指す別名
  - 注意: 取り違えやすい点

## 文書と前提

- **Product Brief**
  - 意味: 人の意思（解きたい問題と目指す状態）を書く、repo に 1 つの最上位の文書。
  - 定義する場所: PDH-AGENTS.md「PDH の構造」
  - 使わない語: Brief（初出の後の略記としてだけ使う）
- **Architectural-Invariants**
  - 意味: Product Brief の節。製品の根本の不変則を書く。変えるにはユーザの承認が要る。
  - 定義する場所: PDH-AGENTS.md
  - 注意: ticket の節 `Architectural-Invariants-check` とは別物。単に「Invariants」と書かない。
- **Architectural-Invariants-check**
  - 意味: ticket が Architectural-Invariants と矛盾しないことを宣言する、ticket の節。
  - 定義する場所: PDH-AGENTS.md「PDH の構造」
  - 使わない語: Architectural-Invariants check、Invariants check、Invariants
- **Appetite**
  - 意味: Product Brief の節。この製品にどこまで時間と複雑さをかける価値があるかの上限感を書く。agent が «作りすぎない» 判断の目安にする。
  - 定義する場所: Product Brief のテンプレート
- **Done**
  - 意味: Product Brief の節。うまくいったと言える状態を書く。達成した項目は消さず、達成済みと追記する。
  - 定義する場所: Product Brief のテンプレート
  - 注意: ticket の完了条件は AC であって、Done ではない。
- **Non-goals**
  - 意味: Product Brief の節。やりたくなるが、議論した上でやらないと決めたことを書く。
  - 定義する場所: Product Brief のテンプレート
  - 注意: ticket の Out-of-scope とは別物。
- **ticket**
  - 意味: Product Brief を実現する実装の単位。1 ticket で、影響範囲を全部扱う。
  - 定義する場所: PDH-AGENTS.md「PDH の構造」
- **影響範囲**
  - 意味: 1 つの変更が届く先のうち、別々に作られ別々に使われる部分の集まり（例: backend・frontend・SDK・CLI・docs）。区切り方は project が `CLAUDE.md` で決める。
  - 定義する場所: pdh-ticket-write「作り方の判断と対象外を書く」
  - 使わない語: レイヤー、影響レイヤー（«抽象度の段» と読み違えるため）
- **実装の事実**
  - 意味: いまの実装がどうなっているかを、変更する場所で読める形で書いたもの。
  - 定義する場所: PDH-AGENTS.md「PDH の構造」
  - 注意: 製品はコメント・テスト・`specs/`、開発基盤の記録は skill `pdh-change`「文書を書くとき」に従って置く（`CLAUDE.md`「実装の記録の置き場所」）。
- **`CLAUDE.md`（codex では `AGENTS.md`）**
  - 意味: project の入口のファイル。project 固有の規則を置く。
  - 定義する場所: PDH-AGENTS.md 冒頭
  - 使わない語: project ルール、project 規約、プロジェクト規約、プロジェクト設定、project 固有ルール
- **`[SKILLS_PATH]`**
  - 意味: skill を置いたディレクトリ。Claude Code では `.claude/skills`、codex では `.agents/skills`。skill のファイルは `[SKILLS_PATH]/<skill 名>/<ファイル名>` と書く。
  - 定義する場所: PDH-AGENTS.md の冒頭
  - 使わない語: `pdh-pm/_records.md` のような skill 名から始まる書き方、`_records.md` のようなファイル名だけの書き方（どの skill のファイルか分からない）、分冊（skill の中のファイルを指すときは «この skill の各ファイル» と書く）
- **`[TICKET_DIR]`**
  - 意味: その ticket のディレクトリ。`./ticket.sh start` の出力の `ticket_dir:`（close の後は `tickets/done/<ticket 名>`）。ticket のファイルは `[TICKET_DIR]/ticket.md`・`[TICKET_DIR]/note.md`・`[TICKET_DIR]/progress.md`・`[TICKET_DIR]/tests/` のように書く。
  - 定義する場所: PDH-AGENTS.md の冒頭
  - 使わない語: «同じ dir の `progress.md`»、`tickets/<name>/`、`<ticket dir>`（文の中で書くとき。実行するコマンドの中の置き換え用の値は除く）
  - 注意: シェルは展開しないので、実行するコマンドの中には書かない。コマンドには実際のパスを書く
- **PDH-repo**
  - 意味: PDH を配っている repo（`masuidrive/pdh`）。PDH-AGENTS.md・PDH の skill・agent 定義・coding-bot の共有ファイルは、ここから写している。
  - 定義する場所: PDH-AGENTS.md 冒頭
  - 使わない語: PDH 原本、上流 PDH、配布物、配布版、配布レイヤー、上流（単独で。PDH-repo を指すなら «PDH-repo»、第三者配布物の配り元なら «配布元の repo»、データの出どころなら «そのデータを作る処理» と書く）
  - 注意: この repo に写したファイルは、まとめた呼び名を作らず、`PDH-AGENTS.md`・skill の名前のように実物の名前で書く。
- **第三者配布物**
  - 意味: PDH 以外で外から入れたファイル（ticket.sh、依存ライブラリの中身、外部の skill など）。書き換えず、直したい点は配布元の repo へ出す。
  - 定義する場所: PDH-AGENTS.md「第三者配布物は書き換えない」
  - 使わない語: 配布物、外から配られたファイル
- **`.github/coding-bot/` の script**
  - 意味: Actions 上で coding-bot の run を動かす script（`run-action.sh` など）。指せるときは script の名前で書く。
  - 定義する場所: `.github/coding-bot/`
  - 使わない語: harness、machinery
- **coding-bot の共有ファイル**
  - 意味: coding-bot を動かすファイルのうち、PDH-repo の `github-bot/` と中身をバイト単位で同じに保つもの。
  - 定義する場所: project ルールが指す PM の規則と、PDH-repo の `github-bot/INSTALL.md` の配置表
  - 使わない語: coding-bot の層、bot 層、共有 bot 層
- **起動側**
  - 意味: agent を起動し、system prompt に `<Human-Agent-Interface>` を置くもの（coding-bot の `run-action.sh`、端末で起動する人など）。
  - 定義する場所: pdh-pm「起動側が受け渡し経路を指定したとき」
  - 注意: PM が worker を起動するときは «PM» と書く。起動側と書かない。
- **捨てたもの**
  - 意味: その規則を採るために諦めた時間・コスト・機能。規則の横に書き、上書きするかの判断に使う。
  - 定義する場所: pdh-change「規則の文の書き方」
- **知らずに変えると壊れる前提**
  - 意味: コードが黙って依存していて、知らずに変えると壊れる前提。コメントかテストか `scripts/checks/` に書いて残す。
  - 定義する場所: `.claude/agents/pdh-coding-engineer.md`「変えるファイルの最近の変更を読む」、`.claude/agents/pdh-reviewer.md`
  - 使わない語: 地雷、踏む（«知らずに変えて壊す» «Architectural-Invariants に反しない» «Out-of-scope に入らざるを得ない» のように、何が起きるかで書く。«踏まえて» は別の語なので使ってよい）

## ticket の中身

- **Why**
  - 意味: なぜ作るか。すべての判断の基準。
  - 定義する場所: PDH-AGENTS.md「PDH の構造」
  - 使わない語: Why / Intent、Why / Problem
- **What 冒頭の 1 文**
  - 意味: 「この ticket が終わると、〈誰〉が、いままでできなかった〈何〉をできるようになる」という形の文。AC はこの文を分割して書く。
  - 定義する場所: pdh-ticket-write「AC の書き方」
- **AC**（初出は Acceptance Criteria）
  - 意味: 承認者が観察できる振る舞いで書いた、ticket の完了条件。
  - 定義する場所: pdh-ticket-write「AC の書き方」、`[SKILLS_PATH]/pdh-pm/_records.md`
  - 使わない語: 受け入れ条件
  - 注意: AC は承認の単位であって、設計の上限ではない（PDH-AGENTS.md「PDH-flow」）。
- **AC-approved**
  - 意味: ticket に書く、承認した AC と Out-of-scope のハッシュの行。両方の節の文からコメント・checkbox の印・空白を除いて取るので、AC か Out-of-scope を書き換えたとき値が合わなくなる。
  - 定義する場所: `pdh-pm`「承認の PDH-stage」、`scripts/check-pdh-ticket.sh`
- **作り方の判断**
  - 意味: ticket の書き手が実装前に決めた、どう作るかの選択とその理由（例: 「保存形式は data URI にする」）。AC が «何ができるようになるか» なのに対し、こちらは «どう作るか»。記録を残せば、再合意なしで書き換えてよい。
  - 定義する場所: `.claude/agents/pdh-coding-engineer.md`「ticket の変更は再合意で行う」
  - 使わない語: 確定判断、解き方、設計判断（ticket の節の見出しは `Design-Decisions`）
- **Out-of-scope**
  - 意味: この ticket で扱わないこと。
  - 定義する場所: PDH-AGENTS.md「PDH の構造」
- **再合意**
  - 意味: AC・Architectural-Invariants-check・Out-of-scope を変えるときに、ユーザの承認を取り直すこと。
  - 定義する場所: `.claude/agents/pdh-coding-engineer.md`「ticket の変更は再合意で行う」
- **PDH-stage のチェックリスト**
  - 意味: 各 PDH-stage の skill の «出力» にある `- [ ] <PDH-stage>: …` の行。PDH-stage に入るとき `scripts/pdh-stage-checklist.sh <PDH-stage> --enter` が note の `## Checklist` へ写し、確かめたら `[x]` にする。同じ PDH-stage を 2 回目以降に通るときは写し直して未了に戻す。再開では写さない。
  - 定義する場所: pdh-change「PDH-stage の skill の形」、pdh-pm「進め方」
- **Required-Probes**
  - 意味: まだ確かめていない AC について、確かめる手段を書く note の節。実装前の承認より前に実行する。
  - 定義する場所: pdh-ticket-review
  - 使わない語: Required Probes
- **Open-Questions**
  - 意味: 未決事項と、迷ったときに採った既定の値を書く note の節。
  - 定義する場所: `[SKILLS_PATH]/pdh-pm/_records.md`
  - 使わない語: Open Questions
- **変更のコスト**
  - 意味: 変えたあとに戻すときの高さと、変更の後に残るもの。DB（スキーマの変更・既存データの変換）と、他者が使う契約（HTTP API・SDK・CLI・webhook・設定ファイルの形式）の変更を高く数える。増える行と仕組みも負債として数え、減る行と仕組みはコストを下げる側に数える。実装・調査・検証にかかる時間は数えない。
  - 定義する場所: PDH-AGENTS.md「変更のコストの数え方」
  - 使わない語: 実装コスト、工数（コストの意味で使うとき）
- **consumer surface**
  - 意味: 利用者が触れるもの（UI・HTTP API・SDK・CLI・設定・生成物・ログ・メトリクスなどの観測の出力）。
  - 定義する場所: pdh-ticket-review・`[SKILLS_PATH]/pdh-verify/SKILL.md`
  - 使わない語: 外部 surface、公開 surface、Surface

## PDH-stage

- **PDH-flow**
  - 意味: PDH-stage の並び全体（PDH-ticket-write から PDH-close まで）と、その間の遷移。
  - 定義する場所: PDH-AGENTS.md「PDH-flow」
  - 使わない語: Stage Flow、stage flow、PDH の流れ
- **PDH-stage**
  - 意味: PDH の工程を表す 9 つの識別子（PDH-ticket-write から PDH-close まで）。改名しない。
  - 定義する場所: PDH-AGENTS.md「PDH-flow」
  - 使わない語: stage（単独で）、フェーズ、phase、ステップ
  - 注意: 図と一覧（すること）は PDH-AGENTS.md「PDH-flow」の 1 か所だけに置く。各 PDH-stage の入力・処理・出力・例外は、その PDH-stage の skill に置く（pdh-change「PDH-stage の skill の形」）。
- **中断**
  - 意味: ticket の作業が PDH-stage の途中で止まること。PM が人の答えを待つと決めて作業を止める場合と、compact・session の終了・bot の run の timeout・API のエラーで作業が止まる場合の両方を含む。note の Status は変わらない。
  - 定義する場所: pdh-pm「中断するときと再開するとき」
  - 使わない語: 止まった ticket、suspend
- **再開**
  - 意味: 中断している ticket の作業を、note の Status の PDH-stage の途中から続けること。PDH-flow の遷移ではないので、Status を変えない。
  - 定義する場所: skill pdh-resume
  - 使わない語: 戻る（差し戻しと取り違える）、resume（skill の名前 `pdh-resume` を除く）
- **PDH-ticket-human-review**
  - 意味: 実装前に、ユーザから AC の承認を得る PDH-stage。
  - 使わない語: 実装前 gate（PDH-stage を指すときは PDH-stage の名前で書く）
- **PDH-human-review**
  - 意味: close の前に、やったことをユーザの想定と突き合わせ、close の承認を得る PDH-stage。
  - 使わない語: close 前 gate、close 板
  - 注意: PDH-verify の中の「close 前 review」とは別の工程。
- **巡**
  - 意味: PDH-review の中で、review と修正を 1 回行う単位。progress の見出しでは `PDH-review-N` と書く。
  - 定義する場所: `[SKILLS_PATH]/pdh-review/SKILL.md`
  - 使わない語: attempt、ラウンド

## 役割

- **PM**
  - 意味: worker を起動して統括し、PDH-stage を進め、finding の処置を決める役。コードは書かない。
  - 定義する場所: `[SKILLS_PATH]/pdh-pm/_execution-team.md`
  - 使わない語: Director、main agent、main、上位（Coding Engineer から見た PM）
- **worker**
  - 意味: PM が起動する、会話の状態を引き継がない別の実行単位。
  - 定義する場所: `[SKILLS_PATH]/pdh-pm/_execution-team.md`（各役の手順は `.claude/agents/pdh-<役割>.md` の本文）
  - 使わない語: subagent、Agent
  - 注意: tmux の別 window で動くセッションは「window」と呼び、worker と書かない。
- **PM だけでの実行**
  - 意味: worker を起動できないときに、PM が worker を使わずに実装や review を自分で行う形。
  - 定義する場所: `[SKILLS_PATH]/pdh-pm/_execution-team.md`「worker を起動できないとき」
  - 使わない語: solo、solo 実行
- **Coding Engineer**
  - 意味: 担当範囲の調査・実装・テストを行う worker。
  - 使わない語: 実装 worker、実装担当、implementor
- **QA Engineer**
  - 意味: 実装者とは別にテストを回し、実際の出力を貼る worker。
- **reviewer**
  - 意味: diff を review する worker の総称。
  - 使わない語: 独立 reviewer、レビュアー
  - 注意: Devil's Advocate（DA）と Code Reviewer（CR）は reviewer の役割の名前。違いは `.claude/agents/pdh-reviewer.md`「役割」にある。DA は振る舞いを AC・ユーザの判断・利用場面に照らし、CR はコードと周辺の細部を見る
- **見方**
  - 意味: PDH-review で diff を確かめる見方。Why の見方 は Why が端から端まで成り立つかを追う見方、AC の見方 は AC と作り方の判断を diff と突き合わせる見方。
  - 定義する場所: `[SKILLS_PATH]/pdh-review/SKILL.md`「2 つの見方」
  - 使わない語: レンズ、レンズ1、レンズ2
  - 注意: agent の名前 `pdh-reviewer-lens1` は起動に使う識別子なので変えない
- **Why の見方の reviewer**
  - 意味: Why と作業ツリーだけを渡され、Why が端から端まで成立するかを追う reviewer。
  - 定義する場所: `[SKILLS_PATH]/pdh-review/SKILL.md`「2 つの見方」、`.claude/agents/pdh-reviewer-lens1.md`
- **AC 裏取り**
  - 意味: 各 AC が実際に達成されたかを判定する worker。
- **Surface Observer**
  - 意味: 利用者の視点で、実際の consumer surface を観察する worker。
  - 使わない語: Observer（単独で）
- **AC だけで伝わるかの確認**
  - 意味: 背景を知らない別の worker に、What 冒頭の 1 文と AC だけを渡し、「終わると誰が何をできるようになるか」を答えさせる。答えが書き手の意図と合わなければ、AC を書き直す。
  - 定義する場所: pdh-ticket-review「AC だけで伝わるかを確かめる」
  - 使わない語: 復元テスト、AC 読み手
- **AC だけを読む worker**
  - 意味: 上の確認で、What 冒頭の 1 文と AC だけを渡されて答える worker。
  - 定義する場所: `.claude/agents/pdh-ac-reader.md`
  - 使わない語: AC 読み手、«書いていない agent»、`pdh-ac-reader`（agent 定義のファイル名としてだけ残る）
- **承認者**
  - 意味: ticket と承認の PDH-stage でユーザとして判断する人。AC を読むのもこの人。
  - 使わない語: 判断する人、意思決定者、ticket を承認する人
- **ticket の書き手 / 実装者 / decision-board の書き手**
  - 意味: それぞれ、ticket を書く agent、実装する worker、decision-board を作る agent。
  - 注意: 単に「書き手」と書かない。指す相手が文脈で変わる。

## 記録

- **note**
  - 意味: 現在の状態と次の session への引き継ぎを書く、上書きするファイル。
  - 使わない語: 作業ノート、作業記録
- **progress**
  - 意味: 経緯を追記だけで残すファイル。行を消すと close が拒否する。
  - 使わない語: 経緯ファイル
  - 注意: issue に出す途中経過のコメントを progress と呼ばない。
- **Checklist**
  - 意味: 頼まれたこと・後回しにしたこと・人の答えを待つことを 1 行 1 件で書く、note の節。未了が残ると close が拒否する。
  - 定義する場所: PDH-AGENTS.md「頼まれたことを Checklist に書く」
  - 使わない語: process check、process checklist
- **待ち行**
  - 意味: 人の答えを待つものを出した時点で、Checklist に書く 1 行。
  - 定義する場所: PDH-AGENTS.md「受け渡し経路」
- **Findings 表**
  - 意味: finding を見つけた時点で 1 行ずつ足す、progress の中の表。見出しは `Findings-PDH-review-N`。
  - 定義する場所: `[SKILLS_PATH]/pdh-review/SKILL.md`
- **実装ログ**
  - 意味: 何をどの commit で実装したかを、progress に追記する記録。
  - 定義する場所: `[SKILLS_PATH]/pdh-pm/_records.md`
  - 使わない語: 作業ログ
- **調べて分かったこと**
  - 意味: 作業中に調べて分かった事実を、progress に追記する記録。
  - 定義する場所: `[SKILLS_PATH]/pdh-pm/_records.md`
  - 使わない語: Discoveries、Discovery
- **review-sha / close-gate-sha**
  - 意味: review と close 前 review が読んだ commit を書く progress の行。
  - 注意: 名前に「close-gate」とあるが、記録するのは close 前 review であって PDH-human-review ではない。

## review と検証

- **review**
  - 意味: 実装者とは別の worker が diff を読み、finding を出すこと。
  - 定義する場所: pdh-review
  - 使わない語: 独立 review、独立レビュー、実装前の独立レビュー
- **finding**
  - 意味: reviewer の指摘。仮説であって、実装の命令ではない。
  - 使わない語: 指摘、指摘事項
- **Critical / Major / Minor**
  - 意味: Critical は直さないと出荷できないもの。Major はこの ticket の user journey を劣化させるもの。Minor はそれ以外。
  - 定義する場所: `.claude/agents/pdh-reviewer.md`「報告」
- **処置**
  - 意味: finding ごとに決める扱い。
  - とりうる値: いま直す / 起票する / 記録だけ残す / 棄却する（Findings 表の判定の列には、この 4 つの文字列だけを書く）
  - 定義する場所: `[SKILLS_PATH]/pdh-review/SKILL.md`「処置の判断」
  - 使わない語: fix now / file / record only / reject、採用、記録のみ、別 ticket にした、退けた、保留
- **処置の判断**
  - 意味: finding の処置を決めること。
  - 定義する場所: `[SKILLS_PATH]/pdh-review/SKILL.md`「処置の判断」
  - 使わない語: いま直すかの判断、scope gate、Scope boundary、triage
- **修正前に落ちるテスト**
  - 意味: finding の欠陥があるために、修正前は落ち、修正後は通る ticket-local-test。
  - 定義する場所: `.claude/agents/pdh-coding-engineer.md`「finding を直すときは、壊していないことを反例で固定する」
  - 使わない語: pin、再現テスト、Pin before fix
- **close 前 review**
  - 意味: PDH-verify の最後に、最後に review した commit より後に入った ticket 自身の commit を review すること。
  - 定義する場所: `[SKILLS_PATH]/pdh-verify/SKILL.md`
  - 使わない語: 最終 code-review gate
- **2 巡目で設計を見直して人に戻す**
  - 意味: 1 巡目の finding を直した差分への review（2 巡目）で、修正が新しい Critical / Major を持ち込んだら、3 巡目の修正に入る前に、経緯を渡さない worker に設計を見直させ、その結論を添えてユーザに判断を渡すこと。
  - 定義する場所: `[SKILLS_PATH]/pdh-review/SKILL.md`
  - 使わない語: 遮断器、circuit breaker
- **user journey**
  - 意味: 利用者が通る操作の流れ。
  - 注意: まだどこにも定義されていない。定義を足すまでは、意味を同じ文の中で開いて書く。

## テスト

- **application-test**
  - 意味: `scripts/test-all.sh` と CI に常に置き、製品の約束・Architectural-Invariants・一般化した regression を守るテスト。ticket や一時 fixture の名前を出さずに、続く製品の約束として書けるものだけがこれになる。
  - 定義する場所: `.claude/agents/pdh-coding-engineer.md`「テスト設計ルール」
  - 使わない語: 恒久テスト
- **ticket-local-test**
  - 意味: その ticket の変更が正しく入ったかを確かめるためだけに `[TICKET_DIR]/tests/` に置き、test-all と CI には入れないテスト。close の後は `tickets/done/<name>/tests/` に記録として残り、再実行できる（例: 名前を変えた API の旧 URL が 404 を返す）。test-all と CI には入れない。
  - 注意: application-test との分け方は 1 問で決める — «ticket や一時 fixture の名前を出さずに、続く製品の約束として書けるか»。書けるなら application-test、書けないなら ticket-local-test
  - 定義する場所: `.claude/agents/pdh-coding-engineer.md`「テスト設計ルール」
  - 使わない語: 一時確認、ticket 固有の一時確認
- **fast-check**
  - 意味: ミリ秒で終わる、grep による決定論的な検査。
  - 定義する場所: pdh-check-writing
- **フルスイート**
  - 意味: project の全テストをまとめて回す最終の検査（`scripts/test-all.sh`）。
  - 使わない語: 全体スイート、全スイート
- **retry-pass**
  - 意味: 再実行でだけ通ったテスト。件数と名前を付けて報告する。
  - 定義する場所: `.claude/agents/pdh-qa.md`「結果の貼り方」
- **固定する**（テストで）
  - 意味: その振る舞いが変わると落ちるテストを置くこと。
  - 定義する場所: `.claude/agents/pdh-coding-engineer.md`「テスト設計ルール」
  - 注意: テストで使う値・role を選ぶ意味では使わない（«低い権限の role で確かめるテスト» のように書く）。
- **守れたかを数える仕組み**
  - 意味: 規則が守られたかを機械が数えるもの。fast-check・`require_checklist` が数える checkbox・テスト・`check-pdh-ticket.sh`。
  - 定義する場所: pdh-change「置き場所を決める」の問 5
  - 使わない語: 数える機構、安全網

## 承認と decision-board

- **承認の PDH-stage**
  - 意味: PDH-ticket-human-review と PDH-human-review の 2 つ。
  - 使わない語: human gate、人間 gate、gate、human review
  - 注意: 「gate」は、人の承認・agent の検査・CI など 9 通りの意味で使われていて、読み手が区別できない。新しい規則では「gate」を使わず、人の承認なら「承認の PDH-stage」、agent が回す確認なら「検査」と書く。
- **decision-board**
  - 意味: 承認者が追加の調査なしに決められるよう、判断の材料をまとめたもの。
  - 定義する場所: pdh-decision-board `SKILL.md`
  - 使わない語: 判断ボード、board、板、gate report
  - 注意: «資料» は ticket に添付・リンクされた資料の意味で使うので、decision-board を指すときだけ使わない。
- **承認者が必ず読む本文**（短く言うときは «本文»）
  - 意味: decision-board のうち、承認者が開かずに必ず読む部分。判断に要る材料はここに置く。
  - 定義する場所: `[SKILLS_PATH]/pdh-decision-board/base.md`「承認者が必ず読む本文の構成」
  - 使わない語: 主線
- **開いて読む根拠**（短く言うときは «根拠»）
  - 意味: decision-board で、本文から閉じた `<details>` に入れて置き、承認者が確かめたいときに開いて読む材料。
  - 定義する場所: `[SKILLS_PATH]/pdh-decision-board/ticket-gate.md`
  - 使わない語: 裏付け、畳む（«閉じた `<details>` に入れる» と書く）
- **画面写真か出力の実例**
  - 意味: decision-board に載せる、出来上がりの画面写真か、実際の出力。
  - 定義する場所: `[SKILLS_PATH]/pdh-decision-board/base.md`「出来上がりの実例」
  - 使わない語: 像
- **ゴール**
  - 意味: PDH-ticket-human-review の decision-board で、承認者が必ず読む本文の固定の 5 節（なぜ / ゴール / 作り方の判断 / 決めること / 返す）のうちの 1 つの名前。ticket の Why と AC が達成された状態を書く。
  - 定義する場所: `[SKILLS_PATH]/pdh-decision-board/ticket-gate.md`
  - 注意: 節の名前は `reader-profile.md` の «なぜ→ゴール→判断» と `kit/ui-sample.html` の見本にも同じ文字列で出るので、変えるなら全部を一緒に変える。判断カードの欄では «ゴールの達成のされ方» と書く。
- **受け渡し経路**
  - 意味: agent が人へ渡す場所と、人の答えが戻る場所（会話・ファイル・issue コメントなど）。
  - 定義する場所: PDH-AGENTS.md「受け渡し経路」、pdh-pm「起動側が受け渡し経路を指定したとき」
  - 使わない語: 経路（受け渡し経路の意味で単独で使うとき。コードの実行経路は一般の技術語として使ってよい）
