#!/usr/bin/env bash
# 検査: decision と ready で各完了条件の場面と記録した試験結果が現在の版に対応するか。
# 理由: 未実施や別の製品版に対する試験で確認済みとすることを防ぐ。
set -euo pipefail
[[ ${PDH_PHASE:-ready} != test ]] || exit 0
exec python3 -B pdh/scripts/pdh_coverage.py verify "$1" "$2"
