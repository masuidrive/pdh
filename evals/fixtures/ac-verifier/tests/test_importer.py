from src.importer import import_csv

SAMPLE = "date,note,amount\n2026-05-01,taxi,1200\n2026-05-02,lunch,980\n"


def test_import_csv():
    rows = import_csv(SAMPLE)
    assert len(rows) == 2
    assert rows[0] == {"date": "2026-05-01", "note": "taxi", "amount": 1200}
    assert rows[1]["amount"] == 980
