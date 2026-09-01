"""経費 CSV の取り込み。"""


def parse_row(line: str) -> dict:
    """1 行を明細へ変換する。"""
    parts = line.rstrip("\n").split(",")
    return {"date": parts[0], "note": parts[1], "amount": int(parts[2])}


def import_csv(text: str) -> list:
    rows = [l for l in text.splitlines() if l.strip()]
    return [parse_row(l) for l in rows[1:]]
