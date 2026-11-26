"""Capture named JUnit results or manual observations against committed ticket tests."""
import argparse
from collections import defaultdict
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import NamedTemporaryFile, TemporaryDirectory
import xml.etree.ElementTree as ET

sys.dont_write_bytecode = True
import pdh

TABLE = "tests/coverage.tsv"
RESULTS = "coverage-results.json"
HEADER = ["ac", "scenario", "kind", "test"]
PRIVATE_EXTENSIONS = {".pem", ".key", ".p12", ".pfx", ".jks", ".keystore", ".env", ".token"}


def committed(git, revision, path):
    if not git("ls-tree", revision, "--", path).startswith((b"100644 blob ", b"100755 blob ")):
        raise ValueError(f"{path}: expected a committed regular file at {revision}")
    return git("show", f"{revision}:{path}")


def read_source(git, revision, path, work):
    if not isinstance(path, str):
        raise ValueError("expected a source filename")
    name = pdh.repo_path(path)
    if (name.suffix.lower() in PRIVATE_EXTENSIONS or any(p.startswith(".") for p in name.parts)
            or any(p.lower().split(".")[0] in {"credentials", "secrets", "tokens", "id_rsa", "id_ed25519"}
                   for p in name.parts)
            or (name.parts[0] in {"work", "tickets"} and not path.startswith(f"{work}/tests/"))):
        raise ValueError(f"{path}: expected a shareable test source file")
    data = committed(git, revision, path)
    if len(data) > 48_000 or b"\0" in data:
        raise ValueError(f"{path}: expected UTF-8 source of at most 48000 bytes")
    if b"PRIVATE KEY-----" in data:
        raise ValueError(f"{path}: private keys cannot be included in a review")
    return data.decode("utf-8")


def mappings(work, head, missing=None):
    path = f"{work}/{TABLE}"
    contents = committed(pdh.git, head, path).decode().splitlines()
    if not contents or contents[0].split("\t") != HEADER:
        raise ValueError(f"{path}: expected tab-separated {' '.join(HEADER)}")
    count = len(pdh.read_scope(pdh.ROOT / work / "scope.md"))
    expected = {f"C{i}" for i in range(1, count + 1)}
    groups = defaultdict(list)
    seen = set()
    for number, line in enumerate(contents[1:], 2):
        row = line.split("\t")
        if (len(row) != 4 or any(not field.strip() or field != field.strip() for field in row)
                or row[0] not in expected or row[2] not in {"auto", "manual"}):
            raise ValueError(f"{path}:{number}: expected AC ID, scenario, auto/manual and test")
        ac, _, mode, test = row
        rows = groups[test]
        if row in rows or (rows and rows[0][2] != mode):
            raise ValueError(f"{path}:{number}: duplicate mapping or inconsistent mode for {test}")
        rows.append(row)
        seen.add(ac)
    if absent := expected - seen:
        message = f"{path}: missing scenarios for {', '.join(sorted(absent))}"
        if missing is None:
            raise ValueError(message)
        missing.append(message)
    return groups


def load(path):
    if path.is_symlink():
        raise ValueError(f"{path}: expected a regular file")
    if not path.exists():
        return {}
    obj = json.loads(path.read_text())
    if not isinstance(obj, dict) or set(obj) != {"rows"} or not isinstance(obj["rows"], list):
        raise ValueError(f"{path}: expected rows array")
    result = {}
    for row in obj["rows"]:
        if not isinstance(row, dict) or not isinstance(row.get("test"), str) or row["test"] in result:
            raise ValueError(f"{path}: duplicate or malformed result")
        result[row["test"]] = row
    return result


def save(path, records):
    with NamedTemporaryFile(mode="w", dir=path.parent, delete=False, encoding="utf-8") as out:
        temp = Path(out.name)
        try:
            json.dump({"rows": [records[k] for k in sorted(records)]}, out, ensure_ascii=False, indent=2)
            out.write("\n")
            out.close()
            temp.replace(path)
        finally:
            temp.unlink(missing_ok=True)


def case_name(case):
    name = case.get("name", "")
    cls = case.get("classname", "")
    return f"{cls}::{name}" if cls else name


def passed_case(case, test):
    if (case.tag != "testcase" or case_name(case) != test or not case.get("name")
            or case.get("status", "").lower() in {"notrun", "disabled", "skipped", "failed", "error"}
            or any(child.tag in {"skipped", "failure", "error"} for child in case)):
        raise ValueError(f"{test}: expected one executed, passing JUnit testcase")
    return ET.tostring(ET.Element("testcase", {k: case.attrib[k] for k in ("classname", "name")
                                               if k in case.attrib}), encoding="unicode")


def verify(work, agreed, head):
    if not pdh.coverage_required(work, agreed, head):
        return
    groups = mappings(work, head)
    path = pdh.ROOT / work / RESULTS
    if committed(pdh.git, head, f"{work}/{RESULTS}") != path.read_bytes() or pdh.git(
            "diff", "--cached", head, "--", f"{work}/{RESULTS}"):
        raise ValueError(f"{path}: commit observations before review")
    records = load(path)
    latest = load(journal_path(work))
    if groups.keys() != records.keys():
        raise ValueError(f"{path}: missing or unexpected tests {sorted(groups.keys() ^ records.keys())}")
    allowed = pdh.exclusions(work, head) - {f"{work}/scope.md"}
    agreement = pdh.revised_agreement(work, agreed, head)
    for test, rows in groups.items():
        r = records[test]
        if latest.get(test, {}).get("invalid"):
            raise ValueError(f"{test}: latest execution did not confirm this result")
        mode = rows[0][2]
        fields = {"test", "mode", "sha", "observation", "mapping"}
        if mode == "auto":
            fields.update(("runner", "sources", "junit"))
        if (set(r) != fields or r.get("mapping") != rows or r.get("mode") != mode or
                not isinstance(r.get("observation"), str) or not r["observation"].strip()
                or not isinstance(r.get("sha"), str)):
            raise ValueError(f"{test}: stale mapping, mode or missing observation")
        pdh.check_revision(r["sha"], head, allowed, agreement, coverage_work=work)
        if mode == "auto":
            if (not isinstance(r.get("sources"), list) or not r["sources"] or
                    not isinstance(r.get("runner"), list) or not r["runner"]
                    or not all(isinstance(arg, str) for arg in r["runner"])
                    or not any("{junit}" in arg for arg in r["runner"])
                    or not isinstance(r.get("junit"), str)):
                raise ValueError(f"{test}: missing runner, JUnit case or test sources")
            if (passed_case(ET.fromstring(r["junit"]), test) != r["junit"]
                    or r["observation"] != f"JUnit pass: {test}"):
                raise ValueError(f"{test}: expected normalized JUnit observation")
            for source in r["sources"]:
                measured = read_source(pdh.git, r["sha"], source, work)
                if measured != read_source(pdh.git, head, source, work):
                    raise ValueError(f"{test}: {source} differs from the observed revision")


def clean_head(work):
    head = pdh.git("rev-parse", "HEAD").decode().strip()
    dirty = pdh.changed_paths() | pdh.changed_paths("--cached", head)
    dirty.update(os.fsdecode(p) for p in pdh.git("ls-files", "--others", "--exclude-standard",
                                                  "-z").split(b"\0") if p)
    allowed = {f"{work}/{name}" for name in pdh.RECORDS if name != "scope.md"}
    pdh.require_no_changes(dirty, allowed, "commit inputs before capture")
    return head


def journal_path(work):
    git_dir = pdh.git("rev-parse", "--absolute-git-dir").decode().strip()
    key = hashlib.sha256(work.encode()).hexdigest()
    return Path(git_dir) / f"pdh-coverage-{key}.json"


def collect(args, runner, head, observed, recorded, persist):
    if not runner or not any("{junit}" in arg for arg in runner):
        raise ValueError("the runner command must include its {junit} output path")
    for source in args.source:
        read_source(pdh.git, head, source, args.work)
    # Identical invocations replace their previous batch. Filtered commands replace only
    # the cases actually reported, even if they share helpers.
    def invalidate(name):
        observed[name] = dict(test=name, mode="auto", runner=runner, sha=head, invalid=True)
        recorded.pop(name, None)

    for name, row in {**recorded, **observed}.items():
        if row.get("runner") == runner:
            invalidate(name)
    persist()
    with TemporaryDirectory() as directory:
        report = Path(directory) / "results.xml"
        command = [arg.replace("{junit}", str(report)) for arg in runner]
        result = subprocess.run(command, cwd=pdh.ROOT)
        if not report.is_file() or report.is_symlink():
            raise ValueError(f"runner produced no fresh JUnit report (exit {result.returncode})")
        xml = ET.parse(report).getroot()
    if xml.tag not in {"testsuites", "testsuite"}:
        raise ValueError("expected a JUnit testsuite report")
    cases = defaultdict(list)
    for case in xml.iter("testcase"):
        cases[case_name(case)].append(case)
    for name in cases:
        invalidate(name)
    persist()
    if result.returncode and xml.find(".//failure") is None and xml.find(".//error") is None:
        # Without a reported failing case the nonzero exit can be a runner/infrastructure error.
        result.check_returncode()
    if clean_head(args.work) != head:
        raise ValueError("candidate changed during observation")
    for name, matching in cases.items():
        try:
            if len(matching) != 1:
                raise ValueError(f"{name}: duplicate JUnit case")
            junit = passed_case(matching[0], name)
        except ValueError as error:
            print(error, file=sys.stderr)
            continue
        observed[name] = dict(test=name, mode="auto", sha=head, observation=f"JUnit pass: {name}",
                              runner=runner, sources=args.source, junit=junit)
        print(f"PASS {name}")
    persist()
    result.check_returncode()


def capture(args, runner):
    work = args.work
    head = clean_head(work)
    path = pdh.ROOT / work / RESULTS
    cache = journal_path(work)
    recorded = load(path)
    observed = load(cache)

    def persist():
        save(cache, observed)
        if recorded or path.exists():
            save(path, recorded)

    if args.action == "collect":
        collect(args, runner, head, observed, recorded, persist)
        return
    if args.action == "observe":
        if not args.test.strip() or not args.observation.strip():
            raise ValueError("enter a test name and the observed behavior")
        recorded.pop(args.test, None)
        observed[args.test] = dict(test=args.test, mode="manual", sha=head, observation=args.observation)
        persist()
        return

    missing = []
    groups = mappings(work, head, missing)
    for name in recorded.keys() - groups.keys():
        del recorded[name]
    allowed = pdh.exclusions(work, head) - {f"{work}/scope.md"}
    for name in groups:
        row = observed.get(name, recorded.get(name))
        try:
            if not row or row.get("invalid") or row["mode"] != groups[name][0][2]:
                raise ValueError("no passing execution or matching observation")
            # verify additionally checks the agreement at decision/ready time.
            pdh.check_revision(row["sha"], head, allowed, row["sha"], coverage_work=work)
        except (ValueError, pdh.GateError) as error:
            recorded.pop(name, None)
            missing.append(f"{name}: {error}")
        else:
            recorded[name] = dict(row, mapping=groups[name])
    save(path, recorded)
    if missing:
        raise ValueError("\n".join(missing))


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    verify_cmd = sub.add_parser("verify")
    verify_cmd.add_argument("work")
    verify_cmd.add_argument("agreed")
    manual = sub.add_parser("observe")
    manual.add_argument("work")
    manual.add_argument("test")
    manual.add_argument("observation")
    auto = sub.add_parser("collect")
    auto.add_argument("work")
    auto.add_argument("--source", action="append", required=True)
    sub.add_parser("bind").add_argument("work")
    split = argv.index("--") if "--" in argv else len(argv)
    args = parser.parse_args(argv[:split])
    directory = pdh.ROOT / pdh.repo_path(args.work)
    if directory.resolve() != directory:
        raise ValueError("ticket directory must not contain symlinks")
    if args.action == "verify":
        verify(args.work, args.agreed, pdh.git("rev-parse", "HEAD").decode().strip())
    else:
        lock = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            capture(args, argv[split + 1:])
        finally:
            os.close(lock)


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except (OSError, ValueError, pdh.GateError, ET.ParseError, subprocess.CalledProcessError) as error:
        sys.exit(f"coverage: {error}")
