#!/usr/bin/env bash
# 検査: 新規チケットのパスが tickets/YYMMDD-HHMMSS-<slug> の形式に合うか、個別の命名例外に該当するか。
# 理由: チケットを作成順に並べ、名前から作業内容を見分けられるようにする。
set -euo pipefail
cd "$(dirname "$0")/../.."

# Pre-migration work/ tickets keep the name under which they were agreed.
if [[ $# == 2 && $1 =~ ^work/[^/]+$ && $2 =~ ^([0-9a-f]{40}|[0-9a-f]{64})$ ]]; then
    scope=$(git ls-tree "$2" -- "$1/scope.md")
    checker=$(git ls-tree --name-only "$2" -- scripts/check_ticket_name.py scripts/pdh-checks/ticket-name.sh)
    if [[ $scope =~ ^100(644|755)' blob ' && -z $checker ]]; then
        exit 0
    fi
fi
if (( $# < 1 || $# > 2 )); then
    echo "Usage: bash scripts/pdh-checks/ticket-name.sh TICKET [AGREED]" >&2
    exit 2
fi
exec python3 scripts/check_ticket_name.py "$1"
