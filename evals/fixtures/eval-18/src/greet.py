#!/usr/bin/env python3
"""greet — 小さな挨拶 CLI。"""
import argparse
import sys
from typing import Literal


def greeting(name: str, lang: Literal["en", "ja", "fr"] = "ja") -> str:
    if lang == "en":
        return f"Hello, {name}!"
    if lang == "fr":
        return f"Bonjour {name} !"
    return f"こんにちは、{name}さん！"


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="greet", add_help=False, allow_abbrev=False)
    # Keep existing abbreviations while requiring the full new --shout flag.
    parser.add_argument("--lang", "--l", "--la", "--lan", choices=("en", "ja", "fr"), default="ja")
    parser.add_argument("--repeat", "--r", "--re", "--rep", "--repe", "--repea", type=int, default=1)
    parser.add_argument("--upper", "--u", "--up", "--upp", "--uppe", action="store_true")
    parser.add_argument("--shout", action="store_true")
    parser.add_argument("--mark-0518", action="store_true")
    parser.add_argument("--mark-0601", action="store_true")
    parser.add_argument("--mark-0641", action="store_true")
    parser.add_argument("name")
    arguments = argv[1:]
    # Preserve literal names, including strings that look like options.
    if len(arguments) == 1 and not (
        arguments[0].split("=", 1)[0] in ("--lang", "--repeat", "--upper")
        or arguments[0] == "--shout"
        or arguments[0] == "--mark-0518"
        or arguments[0] == "--mark-0601"
        or arguments[0] == "--mark-0641"
    ):
        arguments = ["--", *arguments]
    elif (
        len(arguments) == 3
        and arguments[0] == "--lang"
        and arguments[2].split("=", 1)[0] not in ("--repeat", "--upper")
        and arguments[2] != "--shout"
        and arguments[2] != "--mark-0518"
        and arguments[2] != "--mark-0601"
        and arguments[2] != "--mark-0641"
    ):
        arguments = [*arguments[:2], "--", arguments[2]]
    args = parser.parse_args(arguments)
    if args.repeat <= 0:
        parser.error(f"argument --repeat: expected a positive integer, got {args.repeat}")
    message = greeting(args.name, args.lang)
    if args.shout:
        message = message[:-1] + "!!!"
    if args.upper:
        message = message.upper()
    if args.mark_0518:
        message = message + " [0518]"
    if args.mark_0601:
        message = message + " [0601]"
    if args.mark_0641:
        message = message + " [0641]"
    for _ in range(args.repeat):
        print(message)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
