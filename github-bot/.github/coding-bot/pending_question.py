"""Find question links only in the ticket's unanswered Checklist rows."""
from pathlib import Path
import re
import sys


def question_links(note: str, repo: str, issue: int) -> list[str]:
    checklist = False
    links = []
    pattern = re.compile(r"発行先:\s*(https://github\.com/" + re.escape(repo)
                         + r"/issues/" + str(issue) + r"#issuecomment-[1-9][0-9]*)(?![0-9])")
    for line in note.splitlines():
        if line.startswith("## "):
            checklist = line.strip() == "## Checklist"
        if checklist and re.match(r"^\s*- \[ \] ", line):
            links.extend(pattern.findall(line))
    return list(dict.fromkeys(links))


def ticket_matches(path: str, text: str, issue: int) -> bool:
    return (Path(path).parent.name.endswith(f"-issue-{issue}")
            or bool(re.search(r"(?m)^branch: *[\"\']?agent/issue-" + str(issue) + r"[\"\']? *$", text))
            or bool(re.search(r"(?m)^issue: *" + str(issue) + r" *$", text)))


def local_links(root: Path, repo: str, issue: int) -> list[str]:
    tickets = [p for p in root.glob("tickets/**/ticket.md")
               if ticket_matches(str(p), p.read_text(), issue)]
    if len(tickets) != 1:
        return []
    note = tickets[0].with_name("note.md")
    return question_links(note.read_text(), repo, issue) if note.is_file() else []


if __name__ == "__main__":
    print("\n".join(local_links(Path.cwd(), sys.argv[1], int(sys.argv[2]))))
