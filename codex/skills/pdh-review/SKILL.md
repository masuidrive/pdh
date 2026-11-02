---
name: pdh-review
description: "PM 専用。PDH-review で読む。実装が終わった ticket の diff を reviewer に review させ、finding の処置を決めて、いま直すものを直し終えた状態を作る。reviewer の手順は .codex/agents/pdh-reviewer.toml と pdh-reviewer-lens1.md の本文にある。"
---

# PDH-review

PDH-review は、実装が終わった ticket の diff を受け取り、欠陥を finding として表に出し、処置を決めて、«いま直す» と決めたものを直し終えた状態を作る。
PM がこのファイルを読む。reviewer の手順は `.codex/agents/pdh-reviewer.toml`、Why の見方の reviewer の手順は `.codex/agents/pdh-reviewer-lens1.toml` の本文にある。

## 入力

- ticket が worktree で開かれていて、note の Status は `PDH-review`
- 実装の commit があり、`scripts/test-all.sh` の結果（CI に委ねる運用では、scoped test の実出力と委ねた先。形は `pdh-implement`「機械で確かめるもの」）と、完了報告の要点（確かめた結果・回せなかったもの・AC の書き換え案の有無）が progress にある
- 2 巡目以降と、中断から再開したときは、progress に `review-sha:` の行と `### Findings-PDH-review-N` 表がある
- PDH-human-review から差し戻されて実装をやり直した後は、差し戻しの理由が progress にある

## 処理

`bash scripts/docs-toc.sh --stage PDH-review` を実行し、出力の読む場面と見出しから ticket に関係する文書・節だけを開く。

«巡» は、reviewer が SHA を 1 つ読んで finding を返すまでの 1 回分を指す。巡の 2 つの種類は「巡」にある。

```mermaid
flowchart TD
  prep["準備（「review を始める前に」）"] --> round["巡: reviewer が SHA を読んで finding を返す（S1）"]
  round --> triage["処置の判断"]
  triage --> conv["「収束」の表（S2〜S8）"]
  conv -- 直す・網羅探索 --> round
  conv -- review を終える --> out["出力"]
  conv -- 戻してやり直す --> impl["PDH-implement"]
```

巡を起こす・止める判断は PM が「収束」で行う。

### review を始める前に

- `git merge-base --is-ancestor origin/<base> HEAD` を確かめ、false なら `git merge origin/<base> --no-edit` してから review する（base は ticket frontmatter の `base_branch`。`ticket.sh new` はそこに `default` と書く。値が `default`（大文字小文字を問わない）・空・欄が無いときは `.ticket-config.yaml` の `merge_to`（古い設定の名前）、それも無ければ `default_branch` に読み替える。`./ticket.sh help` の `base_branch`）
- ticket に書かれていない consumer surface・破壊的な操作・権限の変更を、diff から機械的に列挙する。見つけたら Critical として承認の PDH-stage へ出す
- reviewer の prompt に、review 対象の commit SHA と、ticket を始めた SHA（`bash scripts/pdh-review-range.sh [TICKET_DIR] --start` の値。«由来を記録する»）を書く。`[SKILLS_PATH]/pdh-pm/_execution-team.md`「review 専用 worktree」で起動前後の HEAD と作業ツリーを照合する
- 初回の review は reviewer を 1 人以上並行で起動し、同じ SHA の diff 全体を見せる（Why の見方 を除く）。最新 commit の diff（`<SHA>~1..<SHA>`）だけを渡すと、同じ ticket の前の commit が作った状態に起因する欠陥は原理的に見つからない。ユーザが reviewer の構成を指定したら、省略・短縮・統合で代えない。finding の修正は Coding Engineer に、テストの再実行は QA に任せる
- codex の reviewer の起動の仕方（`codex exec review` ではなく `codex exec` に指示文を渡す理由を含む）は `[SKILLS_PATH]/pdh-pm/_execution-team.md`「reviewer に `codex exec review` を使うとき」にある
- 初回の reviewer には diff 全体を渡す。AC の見方 は通常の reviewer が diff とともに行うので、AC・作り方の判断・実装者の完了の主張も渡す。Why の見方の reviewer には Why と、review 対象の SHA と、ticket を始めた SHA だけを渡す（下の「2 つの見方」）
- diff が下の «fail-open を先に探す diff の一覧» に当たるときは、review を省かない。そのうち少なくとも 1 つの review を、コードを書いた model とは別の model に行わせる
  - 別 model の review が完遂できないときは、別 model の reviewer に PM 自身のコードの読解を加えて代わりにし、その理由を progress に書く

#### fail-open を先に探す diff の一覧

次のどれかに当たる diff では、review を省かない。

- 認証・認可（session・token・scope・ACL・グループの判定）
- 破壊的な操作・元に戻せない操作と、そこへ至る経路
- DB の migration・schema の変更
- secret
- データの削除
- 課金
- deploy の手順
- 外部 API の契約
- 新しく公開する consumer surface（endpoint・MCP tool・CLI の subcommand など）

diff がどれかに当たるなら、reviewer は happy path より先に、拒否すべきものを通してしまう経路（fail-open）と誤用を探す。PM は初回の巡の reviewer の prompt に、この一覧を転記する。

### 2 つの見方

reviewer は diff を 2 つの見方で確かめる。«AC の見方» は通常の reviewer が網羅探索と一緒に行い、«Why の見方» は Why と 2 つの SHA だけを渡された専任の reviewer が行う。その reviewer には ticket・AC・実装者の結論を渡さないので、ticket の書き方に引きずられずに、Why が本当に満たされたかを見られる。

- AC の見方の reviewer: `.codex/agents/pdh-reviewer.toml`
- Why の見方の reviewer: `.codex/agents/pdh-reviewer-lens1.toml`

### 巡

- 巡は 2 種類ある。**網羅探索の巡**では、reviewer が diff 全体を読み、網羅探索と「diff の外を読む」を行う。初回の巡と、「収束」の表の S6・S8 が指す巡がこれに当たる
- **修正確認の巡**では、«いま直す» と判定した finding、再現条件、修正の diff、実装者が記録した修正前後の出力だけを、同じ reviewer へ渡す。広い探索の review を繰り返さない。Minor を直した差分も、影響する範囲をこの巡で読む。Minor の印だけでは巡を省かない — 小さい修正も退行を持ち込むからである
- 途中の巡では、変更したファイルと、その import の連鎖の上にある影響するテストだけを実行する
- 巡ごとに、reviewer が読んだ SHA を progress へ `review-sha:` の行で追記する（行の形は `[SKILLS_PATH]/pdh-pm/_records.md`）
- 修正の後、«いま直す» と判定した Critical / Major の件数と、修正前に落ちるテストの本数を突き合わせる。足りなければ、それ自体を finding にする（テストを置く規則は `.codex/agents/pdh-coding-engineer.toml`「finding を直すときは、壊していないことを反例で固定する」）

### 処置の判断

reviewer の finding は仮説であり、実装の命令ではない。PM は finding ごとに、次の 4 つの処置から 1 つを選ぶ。この規則の目的: この ticket が持ち込んだ欠陥と、AC を満たさない欠陥がこの ticket で直り、それ以外の実在する欠陥は行き先を持って別の作業へ渡って、ticket の出荷を止めないこと。severity も、安く直せることも、それだけでは ticket の範囲を広げる理由にならない。直すたびに、確かめ直す範囲と退行の危険がこの ticket に増えるからである。

- **いま直す** — 次のどれかに当たる finding だけを、この ticket で直す。この skill ではこれを «必須の修正» と呼ぶ
  - 直さないと AC を満たさない
  - この ticket の変更が持ち込んだ退行。Minor も含み、同じ ticket の前の巡の修正が持ち込んだものも含む
  - この ticket の変更が通る経路から到達できる Critical。既存のものも含む。到達するかを示せないときは、到達を確かめるか、到達するものとして扱う
  - この ticket の変更が、既存の振る舞いか他者が使う契約を壊す
  - 同じ根本原因が、実際に出荷された欠陥を再発させ、その経路がこの ticket の変更・承認された目的・この ticket が保つ契約のどれかに関わる。関わらないものは «起票する»。急ぐなら、起票した ticket の `拾う時機:` を `すぐ対応` にする（下の «起票した ticket に書くこと»）
- **起票する** — 実在する欠陥のうち «必須の修正» に当たらないものは、すべてこれにする。由来が `既存` か `上流` に決まったものだけを起票し、`既存` を理由に分けるなら下の «既存の証拠» を理由の列に書く。証拠が無いものは `未判定` のまま調べ、決まらなければ人に聞く（«由来を記録する»）。証拠が無いことを理由に «いま直す» へ広げない。別の ticket にして、この ticket の close の前に作る（下の「Findings 表」）。«あとで起票する» は処置ではない
- **記録だけ残す** — 欠陥ではない観察と改善の候補（読みにくい名前・将来の拡張の案など）。実在する欠陥にはこの処置を選ばない
  - 後から検索できる anchor（シンボル名・ファイルパス・endpoint・設定キー）を 1 つ以上付ける。anchor を付けられない finding は、後から使うには曖昧すぎるので、書き直すか棄却する
- **棄却する** — 誤検出か、前提の誤り（下の «先に裏取りをする»）

根本原因が同じ形で他の箇所にもありうるなら、close の前にその箇所を列挙し、箇所ごとに処置を書く。«ほかにもあるかもしれない» のままでは close へ進まない。

- 先に裏取りをする。行うのは、同じ finding の統合と、コード上の事実誤認の除外だけである。棄却するのは、否定の根拠になるコードの行を引用できるときだけで、引用は Findings 表の理由の列に書く。«推測的» «起きにくそう» だけでは棄却しない。次は行わない
  - ticket の記述だけを理由に棄却する・severity を下げる・対応済みとして扱う
  - 既存の問題（pre-existing）だからと無視する
  - 指定された役割・検査・承認を、別の手順で代える
- finding が承認済み AC の要求する動作を指している場合は、該当する AC とコード・テストで実際の動作を示し、Why との整合を判断する。AC も Why も満たし finding の前提が誤りなら、その前提とコードの根拠を理由に棄却する。AC を満たしても Why に届かないなら、棄却せず、ユーザの承認を得て AC を強めるか、別の ticket にする。未測定の外部 API の応答などの不足する証拠は、バグの判定と分けて記録する
- reviewer の間、または見方の間で結論が割れたら、全員の finding を足し合わせるだけや多数決で決めない。前提の差を確かめて決着する。各 reviewer の元の評価・異なる前提・決着に使ったコードの根拠・PM の最終評価を、Findings 表の理由の列か、その列から参照する決着行に残す
- `PDH-review-2` 以降で初回の finding が誤検出と分かったら棄却する。今回と無関係なら調べて分かったこととして記録し、元の AC と user journey だけを確かめる。2 巡目以降の発見も、«必須の修正» に当たるものだけをいま直す
- **由来を記録する。**この規則の目的: PM と承認者が、この ticket が持ち込んだ欠陥と、ticket の前からある欠陥を取り違えずに分けられること。PM は finding ごとに、欠陥が実在するか・どこから来たか・この ticket が直す責任を持つかを別々に判定する。実在するバグには、Findings 表の理由の列に次のどれかを書く。直前の巡の SHA と比べただけでは «既存» にしない — 同じ ticket の前の巡の修正が持ち込んだ欠陥も、直前の巡には既にあるからである
  - `由来: この ticket <commit か根拠>` — この ticket の commit が持ち込んだ（退行）。持ち込んだ commit（blame・bisect）か、開始 SHA では再現しない記録を添える
  - `由来: 既存 <開始 SHA>` — ticket を始めた SHA で同じ欠陥が起きる。続けて «既存の証拠» を次のどちらかの形で書く
    - `再現:` 開始 SHA で実行したコマンドと、欠陥が出た出力
    - `経路:` 欠陥が起きる入口から欠陥の行までの呼び出しの連鎖（各段の、開始 SHA での path:行）と、`条件:` その入力が開始 SHA でも同じ連鎖を通り、欠陥の行で同じ結果になる条件（引数・分岐・設定・呼び出し側の前提）
    - 同じ行や同じ正規表現が開始 SHA にあるだけでは証拠にしない。この ticket が呼び出し側・入力・周りの条件を変えて、初めて欠陥に届くようにしたことがあるからである
  - `由来: 上流 <commit>` — ticket を始めた後に base から取り込んだ commit が持ち込んだ。その commit を添える
  - `由来: 未判定` — 調べる途中の印である。開始 SHA での再現・blame・bisect で上の 3 つのどれかに決める。調べてこの ticket の退行ではないと示せたら、決まった由来で処置する（«必須の修正» に当たらなければ起票する）。退行の可能性を消せず処置が決まらないものは、Minor でも、«いま直す» にも «起票する» にもせず、どこまで調べたか・何が足りないかを添えて人に聞く（Checklist の待ち行は S8 と同じ形で書く）。この ticket の退行は severity に関わらず必須の修正なので、Minor であることを理由に外へ出さない。«必須の修正» として範囲を広げもしない
  - 開始 SHA は、PDH-open が progress に書いた `start-sha:` の行の値である。`bash scripts/pdh-review-range.sh [TICKET_DIR] --start` が、その行・`[start]` の commit の親の順に探し、値と取り方を返す。どちらからも取れなければ、由来は «未判定» にする。ticket の `started_at` は確定値にせず、調べる手掛かりにだけ使う — 時刻の同値・書き換え・履歴の並びで、その時刻より前の最新の commit が開始の直前と一致する保証が無いからである。base との差（`HEAD ^origin/<base>`）からは求めない — base が ticket の commit を取り込むと値が変わるからである
- ユーザに聞いてから直す場合は `pdh-pm`「気づいたバグの行き先」にだけ書いてある
- 1 つの finding のために、永続の column / table・公開の endpoint・画面・権限・state の名前か遷移を 2 つ以上増やすことになるなら、自動で直すのを止めてユーザに相談する。1 つでも、より単純な案で AC か security の約束を満たせない理由を note に残す
- 修正のたびに、Coding Engineer の報告にある «足した部品» の一覧を巡ごとに並べ、この ticket の修正が足した部品（状態の項目・フラグ・分岐・見張りの job・後始末）の累計に、別の部品の欠陥を補うために足したものがあるかを問う。あれば、「収束」の表の段を待たずに S7 へ進んでよい。部品を補う部品が積み重なるのは、構造が合っていない合図だからである
- この規則の目的: 1 つの部品に欠陥が集まったとき、ユーザが、欠陥を 1 件ずつ直す案と、部品ごと消す案を並べて選べること。reviewer の報告の «部品» ごとに、«いま直す» の Critical / Major を通算の巡で数え、同じ部品（経路・モード・job）に 2 件以上集まったら、PM は直す前に «その部品を消して、AC か Why を保てるか» を問う。最初から設計にあった部品にも当てる（上の «足した部品» は、修正が足した部分しか問わない）。保てるなら、«部品を消す» 案を直す案と並べてユーザへの選択肢に入れ、消すと AC が変わるなら、その案に AC の再合意を含める。保てないなら、保てない AC か Why を progress に 1 行書いて直す

### 収束

この規則の目的: PM が、巡が返るたびに次の 1 手をこの表から決め、直しても欠陥が尽きない review を、まず別の engine の前提の見直しで立て直し、それでも尽きなければその結論と一緒に人へ戻せること。

巡が返るたびに（S1）、PM は S2 から当てていき、行き先の段へ進む。巡を起こす・止める条件を変えるときは、文章の規則を足さずにこの表を直す。

| 段 | 判定の材料 | はい | いいえ |
|---|---|---|---|
| S2 | 最新の Findings 表に、判定が «いま直す» の finding がある（Minor を含む） | S3 | S6 |
| S3 | そのうち Critical・Major があり、progress の有効な `review-sha:` の異なる SHA が 2 つ以上ある（通算 2 巡を済ませた） | S4 | S5 |
| S4 | この ticket で、前の巡に S7 の前提の見直しを回した | S8 | S7 |
| S5 | `scripts/check-pdh-ticket.sh` が通る（PM は修正を Coding Engineer に渡す前に回す） | 直して S1 に戻る | 止まる（S7・S8 の答えを待つ） |
| S6 | diff が «fail-open を先に探す diff の一覧» に当たり、落ち着いた後の網羅探索がまだ | S1（網羅探索） | review を終える |
| S7 | 止める。前提の見直しを別の engine の 1 人に回し、note の Checklist に «S7» と対象の通算巡と «発行先:» を含む行を書く。PM が結論から次の手を選ぶ | 必須の修正に絞る → 下の «収束の出口» ／ もう 1 巡直す → S5 ／ 前提から書き直す → 書き直して網羅探索の巡へ（通算は数え続ける）／ 戻してやり直す → PDH-implement | — |
| S8 | 止める。S7 の結論と、その後の巡の finding を添えて人に聞き、note の Checklist に «S8» と対象の通算巡と «発行先:» を含む行を書く。人の答え | S7 と同じ 4 つ | — |

- **収束の出口。**この規則の目的: 必須の修正が尽きた ticket が、残りの finding を別の作業へ渡して PDH-verify へ進めること。最新の Findings 表の «いま直す» を «処置の判断» の «必須の修正» と照らし直し、当たらないものを «起票する» に変える（表の後ろに «処置の変更» の行を追記する。下の「Findings 表」）。残った必須の修正があれば S5 へ進み、S5 が通ってから Coding Engineer に渡し、直した差分を修正確認の巡で読む（S1）。必須の修正が 0 件なら S6 へ進む。AC を満たさない欠陥と、この ticket の退行を残す出口にはしない。PDH-verify と承認の PDH-stage は省かない
- 止まるか進むかの例。必須の修正をすべて直した後でも、S7・S8 の行が未回答なら止まる（S5 の «いいえ»）。S7 の結論で PM が «必須の修正に絞る» を選び、S7 の行を `[x]` にして直した後の修正確認の巡で «いま直す» が 0 件なら、S6 を経て PDH-verify へ進む。S8 で人が «必須の修正に絞る» と答え、progress に答えを書いて S8 の行を `[x]` にした後も同じである。直した差分に修正確認の巡で新しい «いま直す» の Critical・Major が付けば、S3 から当て直す
- 通算の巡は、progress の有効な `review-sha:` の異なる SHA の数である。同じ SHA の訂正の追記は数えない。Findings 表の見出しの N を通算の巡にし、書き直しや差し戻しの後も数え直さない
- 人に聞くのは、S7 の見直しで立て直した後の巡でも欠陥が尽きないときである。S7 を回した後は、人が «もう 1 巡直す» を選んでも、次の巡でまた S8 で止まる。巡ごとに人の答えが要る
- S8 で人に «もう 1 巡直す» を選ばせてよいのは、S7 の見直しの結論が、やる前に答えるための材料になるからである
- S6 の網羅探索は、承認者に聞かずに回す。回さないのは、承認者が AC の承認で覆したときだけである（`[SKILLS_PATH]/pdh-decision-board/ticket-gate.md`「本文の固定部」の «決めること»）
- «前提から書き直す» では、`.codex/agents/pdh-coding-engineer.toml`「finding を直すときは、壊していないことを反例で固定する」の順序で、再現テスト・«まとめる»・«直す» の差分を分ける。AC が変わるなら、S7 でも S8 でも、ユーザの承認を得て再合意する
- `scripts/check-pdh-ticket.sh` は、Findings 表の見出しの N で巡を読み、S3 で止まるべき巡に S7 の行が無いこと、S7 を回した後の巡に S8 の行が無いこと、S7・S8 の行が未回答のまま次の `review-sha:` が増えたこと（S5）、PDH-verify 以降に未回答の S7・S8 の行が残っていることを落とす

**S7 の前提の見直し**は、経緯を持たない worker 1 人に回す。engine は PM と別にし、その engine で使える最も強い推論の model と最も高い effort（claude は `max`、codex は `xhigh`）を使う（`[SKILLS_PATH]/pdh-pm/_execution-team.md`「エンジン割り当て」）。PM と同じ engine の worker は、PM と同じところを見落とし、PM の考えた枠の中で案を組み替えがちだからである。

- 渡すのは、Why・AC・外の契約（API などの仕様）・ticket の前の base のコードと文書と、それまでの Findings の要旨を «構造で起きなくしたい失敗» の種類として整理した一覧である。今の差分・Findings 表・note・progress・PM の考えた案は渡さない。今の作りの局所的な組み替えではなく、前提から案を出させるためである
- 問いは «本当に難しいのは何かと、問題の立て方・AC・責任の置き場所のどこに無理があるかを挙げる。前提（状態をどこに持つか・誰が何を知るか・何に任せられるか）を疑い、AC を変える案も含めて案を 2〜3 個出し、案ごとにどの失敗が構造で起きなくなるか・AC と API の変更・作る量・確かめやすさ・作る前に確かめる前提を書く。今の実装を直し続ける場合との比べと、進め方の問題も書く» である
- PM は結論から次の手を選び、選んだ手と理由を progress に書いて、S7 の行を `[x]` にする。結論が作る前に確かめる前提を挙げたら、書き直す前に確かめる
- 人に渡す選択肢（S8）は «必須の修正に絞る / もう 1 巡直す / 前提から書き直す（案ごと）/ 戻してやり直す» である。«必須の修正に絞る» には、起票する finding の一覧を添える。渡した時点で、Checklist に `- [ ] S8 PDH-review-4 人の答え待ち 発行先: <URL か path>` の形の行を書き、答えを反映するまで未了にする（`PDH-AGENTS.md`「受け渡し経路」）

### Findings 表

finding は、処置の判断で判定と理由まで決めてから、progress の `### Findings-PDH-review-N` 表へ 1 行足す。2 巡目以降と、修正確認で出た新しい finding も同じ形で足す。

- progress は追記だけである。既に書いた行を後から変えると close が止まるので、空欄の行を先に足して後で埋める書き方はしない
- 判定を決める前に記録を残したいときは、reviewer の報告の要点を progress へ追記する。表の行は判定が決まってから足す
- 足した後で処置が変わったら、元の行は書き換えず、表の後ろに finding の識別子（表の `#` と見出しの巡、例: `PDH-review-1 #3`）を付けて «処置の変更: 起票する → いま直す — 理由» の行を追記する（`[SKILLS_PATH]/pdh-decision-board/close-gate.md` と同じ書き方）

```
| # | 出した人 | 観点 | Sev | 要旨 | 判定 | 記録先 | 理由 |
|---|---|---|---|---|---|---|---|
```

出した人は reviewer の役割（`DA`・`CR`・`Why の見方`）か engine（`codex`）か `PM` で、複数なら `+` でつなぐ（例 `DA+codex`）。後で reviewer ごとの採用率と誤検出の率を数えるための列で、空にしない（`scripts/check-pdh-ticket.sh` が、この branch で足した表の空欄を数える）。集計は `bash scripts/pdh-review-tally.sh` で実行する。観点は `.codex/agents/pdh-reviewer.toml`「網羅探索」の観点 label、Sev は Critical / Major / Minor、判定は いま直す / 起票する / 記録だけ残す / 棄却する。

過去の欠陥と対照の評価セットは、`bash scripts/pdh-review-eval.sh --cases <cases.json> --measured`（1 件だけなら `--case <id>`）で reviewer ごとに測る。サブスクリプション枠で動くため手で起動し、評価の実行は CI に入れない。

**`記録先` は、finding がどこに残ったかを書く列である。**`PDH-human-review` で承認者が、finding の行方を表から読めるようにするためにある。4 つの判定のうち `記録だけ残す` だけは、行方を追う仕組みを持たない — `いま直す` はテストが落ち、`起票する` は ticket の一覧に残るが、`記録だけ残す` は人が書いた文章にしか残らない。

- 判定が `記録だけ残す` なら `note` / `コード` / `なし`（この表だけ）のどれか。その行を `git blame` した人が辿れるなら `note`、別の ticket の人が知らずに変えて壊す性質なら `コード`（置いたファイルを理由の列に書く）
  - `scripts/checks/findings-table-record-target.check` は `tickets/done/` を見ない。ticket を done へ移した後に Findings 表へ行を足したとき（PR の merge を close にする運用など）は、`記録だけ残す` の行に `記録先` があるかを、行を足した PM が自分で確かめる
- 判定が `起票する` なら、その ticket 名（Checklist の `起票:` 行と同じ名前）
- 判定が `いま直す` と `棄却する` なら `—`

判定が `起票する` の行は、close の前にその ticket を `./ticket.sh new` で作り、note の `## Checklist` に `- [ ] 起票: <anchor> → <ticket 名>` を 1 行書く。`scripts/check-pdh-ticket.sh` が `→` の後の名前の ticket が `tickets/` か `tickets/done/` に実在するかを確かめ、`require_checklist` が未了の間 close を拒否する。

#### 起票した ticket に書くこと

この規則の目的: 起票した ticket を後で拾う人が、起票元の会話を読まずに、いつ・なぜ拾うかを決められること。新しく作る ticket の `Why` に、`pdh-ticket-write`「Why を書く」の行に加えて次を書く。

- `派生元:` 起票元の ticket 名。同じ欠陥の再発で前の ticket も指すなら、名前を並べる
- `拾う時機:` 次の 4 つのどれか。«いつ着手するか» の目安であり、着手を自動で起こすものではない
  - `すぐ対応` — この ticket の範囲外だが、放置すると害が続く。起票元の ticket の «いま直す» には戻さない。PM は起票した時点で人に知らせ、起票元の note の Checklist に、起票先の名前と `発行先:` を含む行を書く（`PDH-AGENTS.md`「受け渡し経路」）
  - `次に選ぶ` — 次に着手する ticket を選ぶときの候補にする
  - `近くを触るとき` — 同じ箇所を変える ticket が PDH-ticket-review で拾う（`pdh-ticket-review` の Checklist の行）
  - `症状の報告時` — 症状が報告されるまで待ってよい。害が重いと分かっている欠陥と、重い害に届くかが分からない欠陥には選ばない
  - 害の重さの基準は project が決める（`AGENTS.md`）。基準が無い project では、重いかどうか迷ったら `症状の報告時` を選ばない
- `Reproduction-or-measurement:` finding の証拠（`再現:` か `経路:` と `条件:`）をそのまま写す
- `Why-not-fix-now:` 起票元の ticket の «必須の修正» に当たらない理由。直す手間や規模は理由にしない — 安く直せても、必須の修正でなければ別の ticket にする
- 後から検索できる anchor（Checklist の `起票:` の行と同じもの）

`scripts/check-pdh-ticket.sh` は、起票元の Status が PDH-review 以降のとき、この branch で新しく作った起票先に `派生元:`・`拾う時機:` があり、`Why-not-fix-now:` が «該当なし» でないことを数える。`すぐ対応` なら、起票元の Checklist の `発行先:` の行も数える。既存の ticket への集約と、この検査が入る前に作った ticket は数えない。

#### 同じ欠陥の ticket があるとき

この規則の目的: 同じ欠陥の ticket が増えず、違う欠陥が既存の ticket に吸い込まれないこと。新しく作る前に、tickets と tickets/done を検索する（GitHub の issue を起票先にする project では、issue も。`github-bot/_github-issue.md`）。

- 同じかどうかは、原因・対象（anchor）・期待する修正の 3 つが同じかで決める。症状が似ているだけでは同じにしない
- 同じ ticket が見つかったら、その状態で分ける
  - 未完了 — 集約する。`起票:` の行の `→` の後にその ticket の名前を書き、新しく作らない
  - done で直した記録がある — その修正の後でも起きるかを確かめる。起きるなら再発として新しく作り、`派生元:` に起票元と前の ticket を並べる。起きないなら新しく作らず、理由を Findings 表の理由の列に書く
  - 中止（CANCELED）・却下 — 中止した理由を読む。理由がいまも当てはまるなら新しく作らず、当てはまらなくなったなら、その差を書いて新しく作る
  - 重複として閉じた — 重複先の ticket をたどり、その状態で上の分け方を当てる
- 集約するとき、ほかの ticket のファイル（ticket・note・progress）は書き換えない。その ticket の担当の作業と競合するからである。証拠と anchor は起票元の progress に書き、Checklist の `起票:` の行で結ぶ。その ticket を拾う人は、`git grep -n '起票:.*→ <ticket 名>'` で tickets と tickets/done から集約された finding を見つける
- 共有するコード（別の repo が持つライブラリ・配布物）の欠陥は、修正を持つ repo へ起票するのが基本である。手元の repo には、その起票先への参照を残す（GitHub の issue なら `github-bot/_github-issue.md`「review の finding を issue にする」）

この PDH-stage の最後に、下の「出力」を確かめる。

### 記録だけの差分

review の入力を保ったまま結果を受け取れるよう、記録の範囲は、設定された tickets_dir 配下にあるすべての ticket のディレクトリ全体（done を含む）とする。`note.md`・`progress.md`・`related-docs.md`・検査の証拠もこの範囲に入る。`scripts/pdh-review-range.sh` は、この定義で各 ticket の記録を除外する。

repo root で `source scripts/pdh-review-range.sh` と `pdh_review_tickets_dir` を実行し、設定された記録の root を `pdh_tickets` に得る。固定して渡した SHA を `review_sha` に指定し、`git diff --exit-code "$review_sha" HEAD -- . ":(top,exclude)$pdh_tickets"` が 0 で終わることを確かめる。除外したすべての ticket 内の差分も読み、review の入力（AC・作り方の判断・検証対象）を変えていないか判断する。`ticket.md` の AC と Out-of-scope は、`scripts/check-pdh-ticket.sh` の `AC-approved:` の hash 検査で承認後の変更を照合する。再承認で hash を更新した場合も、固定 SHA の `ticket.md` と比較して AC・Out-of-scope が変わっていたら、影響する review を新しい SHA でやり直す。

記録だけなら固定 SHA の結果を保ち、比較した 2 つの SHA・コマンド・出力・判断を progress に残す。入力やコードが変わったら、影響する review を新しい SHA でやり直す。

## 出力

最新の SHA で «いま直す» と決めた Critical と Major が直っていて、すべての finding の行方が progress の Findings 表から読める。

`- [ ] PDH-review:` で始まる行は、この PDH-stage のチェックリストである。この PDH-stage に入るとき、`bash scripts/pdh-stage-checklist.sh PDH-review --enter [TICKET_DIR]/note.md` が note の `## Checklist` へ写す。確かめたら `[x]` にし、当てはまらない行は `- [-] ... - skip: <理由>` にする。

チェックリストの行の「review を始める前に」の一覧は、このファイルの «fail-open を先に探す diff の一覧» である。「diff の外を読む」は `.codex/agents/pdh-reviewer.toml` の節である。

### 機械で確かめるもの

- [ ] PDH-review: `bash scripts/fast-checks.sh` が 0 で終わった（Findings 表の `記録先` 列 — finding がどこに残ったかを書く列 — の検査を含む）

### 判断で確かめるもの

- [ ] PDH-review: reviewer の専用 worktree の HEAD と作業ツリーを起動前後に照合し、結果が progress にある
- [ ] PDH-review: 最後の巡で reviewer が読んだ SHA が、progress に `review-sha:` の行で残っている。ref が進んだ場合は、記録だけと判定した比較か、新しい SHA の review 結果がある

- [ ] PDH-review: 初回の巡で、reviewer が「diff の外を読む」の 3 つ（周りの文脈・git の履歴・変わるべきだった箇所）を行い、読んだ commit を報告に書いた
- [ ] PDH-review: 初回の巡で、reviewer が同じ SHA の diff 全体を読んだ。「review を始める前に」の一覧に当たる diff では、少なくとも 1 つの review を、コードを書いた model と別の model が行った
- [ ] PDH-review: 通常の reviewer の報告に、全 AC と全 Design-Decisions の実装・検証の対応表があり、未実装・未確認も明記されている。修正確認の巡は影響する行を更新した（Why だけを渡す pdh-reviewer-lens1 は対象外）
- [ ] PDH-review: 最新の SHA で «いま直す» と判定した Critical と Major が解消し、結果が `### Findings-PDH-review-N` 表にある
- [ ] PDH-review: «いま直す» と判定した Critical / Major の件数と、修正前に落ちるテストの本数が合っている。組み直した場合は再現テスト→挙動を保つ整理→挙動の修正の順序と各段階の出力がある
- [ ] PDH-review: 修正のたびに、Coding Engineer の報告に足した部品の一覧と、そのうち別の部品の欠陥を補うもの（無ければ 0 件）があり、PM が巡ごとに並べて見た（「処置の判断」）
- [ ] PDH-review: «いま直す» の Critical / Major が 2 件以上付いた部品（無ければ 0 件）ごとに、«その部品を消して AC か Why を保てるか» の答えが progress にあり、保てる部品は «部品を消す» 案をユーザへの選択肢に入れた（「処置の判断」）
- [ ] PDH-review: reviewer の見方が割れた finding は、元の評価・前提の差・コードの根拠・PM の最終評価が理由の列から辿れる。«いま直す» 以外と判定した finding すべてに判定の理由があり、`起票する` と判定した ticket は作ってある

## 例外

- **reviewer が review を完遂できない**（sandbox が起動しない・timeout・API のエラー・空の結論）: その巡の結果は使わない。原因を確かめて同じ SHA で起動し直す。別 model の reviewer がどうしても完遂できないときは、PM 自身のコードの読解で代え、その理由を progress に書く（「review を始める前に」）
- **review の途中で、review 対象の ref に commit が積まれた**: 固定して渡した SHA の結果として受け取り、「記録だけの差分」の比較と判定に従う。
- **中断した**（compact・session の終了・timeout）: progress の最後の `review-sha:` と Findings 表で、どの巡のどこまで済んだかを確かめる。結果ファイルの無い reviewer の巡は、同じ SHA で最初からやり直す
- **現在の ticket と無関係な、実在する Critical / Major を見つけた**: «必須の修正» に当たるか（この ticket の変更が通る経路から到達できる Critical か）で処置を決め、当たらなければ起票する（「処置の判断」）。ユーザへ持ち込むのは、`pdh-pm`「気づいたバグの行き先」がユーザに聞くと定めた場合だけである
- PM が自動で進めずにユーザへ戻す条件（修正が永続の column・公開 endpoint・権限などを増やす、AC が緩くて Why に届かない、「収束」の S8）は「処置の判断」と「収束」にある
