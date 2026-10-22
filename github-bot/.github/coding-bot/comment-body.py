"""Keep a GitHub comment below its character limit without losing the log link."""
import json
import sys

MAX_CHARACTERS = 65535


def limit_body(body: str, run_url: str) -> str:
    if len(body) <= MAX_CHARACTERS:
        return body
    suffix = f"\n\n…（本文を省略しました）[実行ログ]({run_url})"
    return body[:MAX_CHARACTERS - len(suffix)] + suffix


if __name__ == "__main__":
    json.dump({"body": limit_body(sys.stdin.read(), sys.argv[1])}, sys.stdout, ensure_ascii=False)
