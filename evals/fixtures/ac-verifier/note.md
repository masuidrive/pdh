# Work Notes

## Status: PDH-verify

## Discoveries

- `src/importer.py` に `import_csv` / `parse_row` を実装した
- `tests/test_importer.py` を追加した。`uv run pytest` は 1 passed（実出力: `1 passed in 0.03s`）
- 会計 SaaS が書き出す CSV の実物は取得していない
