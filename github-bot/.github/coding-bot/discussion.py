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
    if not isinstance(resource, dict) or type(resource.get("number")) is not int or resource["number"] != issue or "pull_request" in resource:
        raise ValueError("PR head must identify a real issue")
    return issue


def pending_question(resource: dict, comments: list, repo: str, issue: int) -> str | None:
    verify_issue(resource, issue)
    if not any(label.get("name") == "awaiting-reply" for label in resource.get("labels", [])):
        return None
    marked = [item for item in comments
              if item.get("user", {}).get("login") == "github-actions[bot]"
              and "<!-- coding-bot:question -->" in item.get("body", "")
              and type(item.get("id")) is int]
    if not marked:
        return None
    return f"https://github.com/{repo}/issues/{issue}#issuecomment-{max(marked, key=lambda item: item['id'])['id']}"


def redirect(repo: str, issue: int, question: str | None = None) -> str:
    text = f"依頼・質問への回答は [issue](https://github.com/{repo}/issues/{issue}) に書いてください。PR では Merge と conflict 解消の依頼を受け付けます。"
    return text + (f" [質問はこちら]({question})" if question else "")


if __name__ == "__main__":
    try:
        data = json.load(sys.stdin)
        action, target = sys.argv[1:3]
        if action == "redirect":
            issue = int(sys.argv[3])
            pages = data.get("comments", [])
            comments = [item for page in pages for item in page]
            try:
                question = pending_question(data["issue"], comments, target, issue)
            except (ValueError, KeyError, TypeError):
                question = None
            print(redirect(target, issue, question))
        else:
            print(linked_issue(data, target) if action == "resolve" else verify_issue(data, int(target)))
    except (ValueError, KeyError, TypeError) as error:
        sys.exit(str(error))
