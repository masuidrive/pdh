---
name: pdh-verifying
description: "PDH 検証 worker の規則: QA Engineer / AC 裏取り / Surface Observer / AC 読み手が、それぞれの検証を実行するときに読む。PDH-verify と AC 復元テストで使う。"
---

# PDH Verifying Standards

**この skill は executor-neutral です。**PM から spawn された worker でも、solo / bot で自分が検証も兼ねる場合でも、同じ内容を使用してください。

worker として spawn された場合は、`.claude/skills/pdh-dev/_subagent-context.md`（Codex は `.agents/skills/pdh-dev/_subagent-context.md`）の共通指示（読むもの・書き込み境界・独断で変えない・出力の返し方）に従った上で、自分の役割の節だけを適用する。書き込み境界は配布 agent 定義（`.claude/agents/pdh-*.md` の `tools`、`.codex/agents/pdh-*.toml` の `sandbox_mode`）が機構で強制する。

## QA Engineer

- 全テストを実行し、実出力をverbatimで結果へ貼る
- 影響layer横断test、E2E、実環境確認を行い、失敗の再現commandとoutputを残す

## AC 裏取り Agent

- 各ACを1項目ずつcode、test結果、noteで、形式だけでなくWhyの実質達成か検証する
- 各ACへ`VERIFIED`または`NOT VERIFIED`と根拠を付け、後者は不足を示す
- user-facingのWhyは、実上流data・終端user操作・反証1回の全てで確認する。合成入力だけでcheckせず、dataの出所と操作を結果へ残す

## Surface Observer

- consumer視点の実機で外部surfaceを観察し、UIなら主要user caseを1本以上実行する
- PMのseed実行を前提とし、fixture不足はcommitted seed hook不足として報告する
- `agent-browser`利用直前に`agent-browser --help`を確認する
- 視覚、responseまたはerror文言、型、helpの違和感を報告し、外部surfaceなしなら該当なしと書く
- 観察方法と証拠の要件は`PDH-AGENTS.md`「Browser And Surface Checks」に従う

## AC 読み手（復元テスト）

- この役は**`What`冒頭の1文とAC全件だけ**を渡される。ticket本体、note、diff、repo、この工程の経緯は渡されないし、探して読まない
- **承認者として読む。**知っているのは一般的な技術語と、渡された文に出てくる語だけとする。⚠ **書かれていない前提を自分の知識で埋めない** — 埋めれば復元できてしまうが、承認者は埋められない
- 答えるのは2つ。**(1) この1文とACから「終わると誰が何をできるようになるか」を復元できるか。(2) 復元できないACはどれで、何が足りないか**（登場人物／その人がする操作／その人が見る結果のどれが欠けているか）
- ⚠ **ACを書き直さない。**足りないものを名指しするだけにする。書き直すのは書き手の仕事である
- **復元できたACには何も返さない。**判定するのは復元の可否だけで、精度・網羅・言い回しの改善案もACの追加も挙げない。⚠ **安全側へ倒して「足りない」と答えると、判定の役が指摘を作る役に変わる**
- 「叩けば分かる」「実装を見れば分かる」を根拠にしない。**渡された文だけで判定する**

⚠ この役はread toolを持たない機構（配布agent定義の`pdh-ac-reader`）でspawnされることがある。その場合、PMはこの節の本文をspawn promptへ転記して渡す。

Based on https://github.com/masuidrive/pdh/blob/XXXXXXX/skills/pdh-verifying/SKILL.md
