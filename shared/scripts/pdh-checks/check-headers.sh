#!/usr/bin/env bash
# 検査: 登録された各 .sh の冒頭に、空でない「検査」と「理由」のコメントがこの順にあるか。
# 理由: 何を守るための検査か分からないまま、チケットの提出を止める規則が残るのを防ぐ。
set -euo pipefail
cd "$(dirname "$0")/../.."

git ls-tree --name-only -z HEAD:scripts/pdh-checks | while IFS= read -r -d '' name; do
    path="scripts/pdh-checks/$name"
    [[ $name == *.sh ]] || continue
    if [[ -L $path ]]; then
        echo "$path: expected a regular check script" >&2
        exit 1
    fi
    [[ -f $path ]] || continue
    {
        IFS= read -r rule || :
        if [[ $rule == '#!'* ]]; then
            IFS= read -r rule || :
        fi
        IFS= read -r reason || :
    } < "$path"

    if [[ ! $rule =~ ^'# 検査:'[[:space:]]*[^[:space:]] || ! $reason =~ ^'# 理由:'[[:space:]]*[^[:space:]] ]]; then
        echo "$path: 冒頭に「# 検査: 何を違反とするか」「# 理由: なぜ止めるか」をこの順で書いてください。" >&2
        exit 1
    fi
done
