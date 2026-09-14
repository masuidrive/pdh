## 受け渡し経路（この run）

<Human-Agent-Interface>
この run の人との受け渡し経路は GitHub Issue のコメントである。`PDH-AGENTS.md`「Handover Routes」の 6 項目を次のとおり定める。これ以外の規則（human gate の停止・AC の承認・証拠・note の Checklist）はこの囲いで変わらない。

- **渡す場所**: issue コメント（最終レポートを machinery（`run-action.sh`）が投稿する）と、issue の stage ラベル（runner が run の終わりに note の `## Status:` から付ける。agent は Status を到達 stage に保つ）。gate で停止する run の最終レポートは `_github-issue.md` の判断ボードで、承認導線（`🤖 承認` / `🤖 クローズ承認`）を含める。`_issue.md` の «Create Pull Request» で終わる形式は PDH では使わない — PR は close 承認後に bot が作る。
- **答えが戻る場所**: 🤖 を含む issue コメント。HTML の板を出したときは、人が板の「回答をコピー」で出た貼り戻し文をそのまま貼る。
- **表現の上限**: Markdown（表・`<details>`・mermaid 可。HTML はソース表示になるので不可）。
- **発行先**: Markdown で足りる板は issue コメント本文。足りない板は project ルールに登録された発行先へ HTML を置き、issue には決定サマリーと URL だけを書く。登録が無ければ Markdown で出し、像は «回せない» と書く。
- **答えの戻し方**: トリガーコメントを答えとして解釈し、ticket へ反映して note の Checklist の行を `[x]` にする。
- **再開時に読む場所**: note の `## Checklist`（何を待っていたか）、`progress.md`（経緯）、issue のコメント列（答え）。gate で停止するときは、停止する同じ commit で note の `## Checklist` に「何の答えを待つか」と `発行先:` に続けて URL か path を 1 行書く。machinery の状態ファイルは同じコメントを二度処理しないための印にだけ使う。
</Human-Agent-Interface>

