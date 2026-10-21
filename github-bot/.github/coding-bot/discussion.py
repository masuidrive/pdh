"""Shared PR-to-issue policy for runners and their Python clients."""
import json
import re
import sys


def linked_issue(data: dict, repo: str) -> int:
    head = data.get("head") or {}
    if (head.get("repo") or {}).get("full_name") != repo:
        raise ValueError("fork PRs cannot drive coding-bot")
    match = re.fullmatch(r"agent/issue-([1-9][0-9]*)", head.get("ref", ""))
    if not match:
        raise ValueError("PR head must be exactly agent/issue-<linked-issue>")
    return int(match[1])


def verify_issue(resource: dict, issue: int) -> int:
    if type(resource.get("number")) is not int or resource["number"] != issue or "pull_request" in resource:
        raise ValueError("PR head must identify a real issue")
    return issue


if __name__ == "__main__":
    try:
        data = json.load(sys.stdin)
        print(linked_issue(data, sys.argv[2]) if sys.argv[1] == "resolve" else verify_issue(data, int(sys.argv[2])))
    except (ValueError, KeyError, TypeError) as error:
        sys.exit(str(error))
