#!/usr/bin/env bash
# branch を別 worktree で開き、絶対パスだけを標準出力へ返す。
set -euo pipefail

branch=${1:?Usage: enter-branch-worktree.sh BRANCH CREATE_NEW(true|false)}
create_new=${2:?Usage: enter-branch-worktree.sh BRANCH CREATE_NEW(true|false)}
case "$create_new" in
  true|false) ;;
  *) echo 'CREATE_NEW must be true or false' >&2; exit 1 ;;
esac
git check-ref-format --branch "$branch" >/dev/null
repo_root=$(git rev-parse --show-toplevel)
repo_root=$(cd "$repo_root" && pwd -P)
worktree_path=''
listed_path=''
while IFS= read -r -d '' field; do
  case "$field" in
    'worktree '*) listed_path=${field#worktree } ;;
    "branch refs/heads/$branch") worktree_path=$listed_path; break ;;
  esac
done < <(git worktree list --porcelain -z)

if [ -n "$worktree_path" ]; then
  worktree_path=$(cd "$worktree_path" && pwd -P)
  if [ "$worktree_path" = "$repo_root" ]; then
    # 古い run の checkout を切り替えると未保存の作業を壊しうるので、触らずに止める。
    echo "coding-bot: branch $branch is checked out in the original checkout: $repo_root" >&2
    exit 1
  fi
else
  worktree_path="$(dirname "$repo_root")/$(basename "$repo_root").worktrees/${branch//\//-}"
  if [ "$create_new" = true ]; then
    git worktree add -b "$branch" "$worktree_path" >&2
  else
    git worktree add "$worktree_path" "$branch" >&2
  fi
  worktree_path=$(cd "$worktree_path" && pwd -P)
fi

# container の GIT_SAFE_DIRECTORY は元の checkout だけを指す。worktree も明示しておく。
git config --global --add safe.directory "$worktree_path"
if [ "$create_new" = false ]; then
  (cd "$worktree_path" && git pull origin "$branch") >&2 || true
fi
printf '%s\n' "$worktree_path"
