# ticket を開く

skill `pdh-open`（新しく始めるとき）と `pdh-resume`（作業が中断している ticket を再開するとき）が使う。ticket の branch と worktree を用意し、作業する worktree と、ticket・note・progress のパスを確定する。この手順は note の Status を変えない。

## 手順

1. `./ticket.sh start <ticket 名>` を実行する。どこで実行するかは、いまの作業ディレクトリで決まる
   - その ticket の worktree にいる: そこで実行する。`start` はパスを出すだけで、何も変えない（commit は増えず、commit していない変更も残る）。bot の run で再開するときは、たいていこれに当たる
   - main の checkout にいる: そこで実行する。始まっていない ticket なら、`start` は branch を作り、`.ticket-config.yaml` の `worktree_mode` が `true` のときは worktree も作る。始まっている ticket なら、既にある worktree をそのまま使う
   - 別の ticket の worktree にいる: そこで実行してよい。`start` は開く ticket の worktree のパスを出すので、以後はそこで作業する
   - worktree を作る `start` は、`.ticket-config.yaml` の `post_start_command`（依存のインストールなど）を走らせることがあり、長くかかる。timeout を長くして呼ぶ。`post_start_command` が途中で止まった・失敗したときは、同じコマンド（失敗したときは `start` が再実行の行を出す）を worktree の root で回す
2. `start` の出力から、worktree のパス（worktree を作らない設定では main の checkout のパス）と、`ticket:`・`note:`・`ticket_dir:` のパスを確かめる。`ticket_dir:` のパスを、skill では `[TICKET_DIR]` と書く。progress は `[TICKET_DIR]/progress.md` である。以後の作業の仕方は `[SKILLS_PATH]/pdh-pm/_execution-team.md`「ticket の worktree で作業する」に従う
3. ticket・note・progress を読む

## 開けたかを確かめるコマンド

`start` に渡した ticket 名と `start` の出力の値を入れて実行し、終了コードが 0 であることを確かめる。

```bash
name='<ticket 名>'
worktree_path='<start の出力の worktree のパス>'
ticket_dir='<start の出力の ticket_dir:>'
cd "$worktree_path" &&
./ticket.sh check &&
test "$(basename "$ticket_dir")" = "$name" &&
test -f "$ticket_dir/ticket.md" &&
test -f "$ticket_dir/note.md" &&
test -f "$ticket_dir/progress.md"
```
