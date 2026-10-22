"""Keep a GitHub comment below its character limit without losing the log link."""
import json
import re
import sys

MAX_CHARACTERS = 65535


def open_fence(body: str) -> str:
    fence = ""
    for line in body.splitlines():
        if fence:
            if re.fullmatch(r" {0,3}" + re.escape(fence[0]) + r"{" + str(len(fence)) + r",}[ \t]*", line):
                fence = ""
        else:
            match = re.match(r" {0,3}(`{3,}|~{3,})(.*)$", line)
            if match and (match[1][0] == "~" or "`" not in match[2]):
                fence = match[1]
    return fence


def limit_body(body: str, run_url: str) -> str:
    if len(body) <= MAX_CHARACTERS:
        return body
    suffix = f"\n\n…（本文を省略しました）[実行ログ]({run_url})"
    prefix = body[:MAX_CHARACTERS - len(suffix)]
    while True:
        fence = open_fence(prefix)
        closing = "\n" + fence if fence else ""
        budget = MAX_CHARACTERS - len(closing) - len(suffix)
        if len(prefix) <= budget:
            return prefix + closing + suffix
        prefix = prefix[:budget]


if __name__ == "__main__":
    body = sys.stdin.buffer.read().decode("utf-8", errors="replace")
    payload = json.dumps({"body": limit_body(body, sys.argv[1])}, ensure_ascii=False)
    sys.stdout.buffer.write(payload.encode("utf-8"))
