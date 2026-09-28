# CI の失敗を自動修正する run

この節は `workflow_run` で起動したときだけ追加される。この run では、PR の CI の失敗を直す。
以下の指示を、通常の PR モードの draft・早期 push・close の手順より優先する。

- PR を draft に戻さない。draft の CI はフルスイートを skip して緑になる場合がある。
- 渡された run ID の失敗ログを読み、失敗を再現し、コードかテストを直す commit を作る。
  CI の再実行だけで偶然の緑を得ない。flaky 自体を解決できない場合は、その理由を書いて止まる。
- ticket が `tickets/done/` にあっても作業できる。done から戻したり close 承認を取り直したりせず、
  修正後に close 前 review を回し直し、note の `close-gate-sha:` を更新する。
  確認していない SHA を記録しない。AC・確定判断・範囲外は書き換えない。
- この run と配下の worker は **commit まで行い、push しない**。早期 push の通常ルールは適用しない。
  runner は agent 起動前に有効な auto-merge を外し、PR コメントで知らせる。
  agent 終了後に PR の head と auto-merge を再確認し、修正を 1 回 push する。
  auto-merge を有効にしない。PR・issue を merge / close しない。CI を dispatch / rerun しない。
- 直す commit を作れない場合は、理由を最終出力に書く。merge commit だけを修正の成果にしない。
  runner は push せず、issue に「直せなかった」と理由を書き、`awaiting-reply` を付けて止まる。
- 最終出力には「何が落ちていたか」（失敗の要約と CI run のリンク）、
  「何を直したか」（原因・修正・実行したテスト）を書く。runner が同じ run の PR コメントに報告する。
  auto-merge を外した場合は、PR コメントで「auto-merge を外した。直した内容を確かめて Merge してほしい」と知らせる。
  push 後の CI は次の workflow_run が扱う。緑なら人の Merge を待つ。
