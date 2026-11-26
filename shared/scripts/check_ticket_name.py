#!/usr/bin/env python3
"""Check one proposed or existing PDH ticket path."""

import argparse
from datetime import datetime
from pathlib import Path
import re


TICKET_NAME = re.compile(r"([0-9]{6}-[0-9]{6})-[a-z0-9]+(?:-[a-z0-9]+)*")


def check_ticket_name(work: str, root: Path) -> None:
    parent, separator, name = work.partition("/")
    if parent != "tickets" or not separator or "/" in name or name in {"", ".", "..", "done"}:
        raise ValueError(f"{work!r}: expected a ticket directly under tickets/")

    match = TICKET_NAME.fullmatch(name)
    if match:
        try:
            datetime.strptime(match[1], "%y%m%d-%H%M%S")
        except ValueError:
            pass
        else:
            return

    exceptions = root / "tickets/ignore.md"
    if exceptions.is_symlink():
        raise ValueError("tickets/ignore.md must be a regular file, not a symlink")
    if exceptions.is_file():
        for line in exceptions.read_text(encoding="utf-8").splitlines():
            entry = line.strip()
            if entry and not entry.startswith("#") and entry.removeprefix("- ") == name:
                return
    raise ValueError(f"{work!r}: expected tickets/YYMMDD-HHMMSS-<slug>; see tickets/PDH.md")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ticket", help="repository-relative ticket directory")
    args = parser.parse_args()
    try:
        check_ticket_name(args.ticket.removesuffix("/"), Path(__file__).resolve().parents[1])
    except (OSError, ValueError) as error:
        parser.exit(1, f"{error}\n")
    print(f"Ticket name OK: {args.ticket}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
