#!/usr/bin/env python3
"""Distribute SIWC access tokens. This process never receives refresh credentials."""
import argparse
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import time

_spec = importlib.util.spec_from_file_location("siwc_token", Path(__file__).with_name("siwc-token.py"))
token = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(token)

VARIABLE = "CODING_BOT_CODEX_SIWC_ACCESS"
POLL_SECONDS = 180
WAIT_SECONDS = 5
WAIT_LIMIT_SECONDS = 600
REFRESH_AHEAD = 1200


def gh_api(arguments, credential):
    result = subprocess.run(["gh", "api", *arguments],
                            env=dict(os.environ, GH_TOKEN=credential),
                            capture_output=True, text=True, timeout=45)
    if result.returncode:
        # Treat only the observed missing-variable status as bootstrap.
        if "HTTP 404" in result.stderr and "variables/" in arguments[0]:
            return ""
        error = RuntimeError("GitHub API failed (response suppressed)")
        # gh ends its error line with "(HTTP 403)"; take only that trailing status.
        status = re.search(r"\(HTTP ([0-9]{3})\)\s*$", result.stderr)
        if status:
            error.http_status = status.group(1)
        raise error
    return result.stdout.strip()


def dispatch_refresh():
    repo = os.environ["GITHUB_REPOSITORY"]
    credential = os.environ["GITHUB_TOKEN"]
    branch = os.environ.get("GITHUB_DEFAULT_BRANCH") or gh_api(
        [f"repos/{repo}", "--jq", ".default_branch"], credential)
    gh_api([f"repos/{repo}/actions/workflows/coding-bot-codex-auth.yml/dispatches",
            "-X", "POST", "-f", f"ref={branch}"], credential)


def read_access(encrypted):
    try:
        decrypted = subprocess.run(
            ["openssl", "enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "100000",
             "-a", "-A", "-pass", "env:CODING_BOT_CODEX_SIWC_KEY"],
            input=encrypted, capture_output=True, text=True, timeout=10)
        if decrypted.returncode:
            raise ValueError("SIWC access variable cannot be decrypted")
        access = json.loads(decrypted.stdout)
        if not isinstance(access, dict) or set(access) - {
                "access_token", "expires_at", "scope", "obtained_at", "earliest_refresh_at"}:
            raise ValueError("SIWC access variable contains unexpected credential fields")
        token.check_scope(access.get("scope"))
        payload = token.check_access(access.get("access_token"))
        expiry = min(float(access["expires_at"]), float(payload["exp"]))
        if not math.isfinite(expiry):
            raise ValueError("Invalid SIWC access expiry")
        return access, expiry - time.time()
    except (ValueError, KeyError, TypeError):
        # Rotated keys, invalid scope/JWT and malformed data are cache misses.
        # Never install invalid data or remove a previously validated file.
        print("::warning::SIWC access cache invalid; requesting publication from the auth workflow.", flush=True)
        return None, 0


def poll_once(path, previous, dispatched_at):
    stage = "read_variable"
    try:
        repo = os.environ["GITHUB_REPOSITORY"]
        encrypted = gh_api([f"repos/{repo}/actions/variables/{VARIABLE}", "--jq", ".value"],
                           os.environ["CODING_BOT_GH_PAT"])
        remaining = 0
        if encrypted:
            stage = "decrypt"
            access, remaining = read_access(encrypted)
            if access is not None and encrypted != previous and remaining > 360:
                stage = "install"
                # The auth.command output goes only to Codex. Mask it before any model
                # process starts, including delegated Codex workers.
                if os.environ.get("GITHUB_ACTIONS") == "true":
                    print("::add-mask::" + access["access_token"], flush=True)
                token.atomic_write(path, access)
                if previous is not None:
                    print("::notice::SIWC access token replaced during this run.", flush=True)
                previous = encrypted
                dispatched_at = 0
        # Do not wait inside auth.command. The poller requests an update and keeps
        # serving the current file while the workflow runs. Retry dispatch after
        # five minutes if the queued run has not published a replacement.
        stage = "dispatch"
        now = time.time()
        if remaining < REFRESH_AHEAD and now - dispatched_at >= 300:
            dispatch_refresh()
            dispatched_at = now
            print("::notice::SIWC access renewal requested.", flush=True)
    except Exception as error:
        # Carry only a fixed stage label to the loop; preserve the exception type.
        error.siwc_stage = stage
        raise
    return previous, dispatched_at


def report_failure():
    helper = str(Path(__file__).with_name("codex-auth-issue.sh"))
    cause = "SIWC access polling or renewal failed; check GitHub API, workflow queue and Variables/key permissions"
    result = subprocess.run(["bash", "-c", 'source "$1"; codex_auth_issue siwc "$2" operational',
                             "bash", helper, cause],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60)
    if result.returncode:
        raise RuntimeError("SIWC operational Issue could not be requested")
    issue = os.environ.get("ISSUE_NUMBER", "")
    if issue.isdigit():
        body = ("SIWC access polling or renewal failed. Check GitHub API availability, "
                "coding-bot-codex-auth workflow queue and Variables/key permissions; retry when available.\n\n<!-- coding-bot -->")
        subprocess.run(["bash", "-c", 'source "$1"; codex_post_operational_note siwc "$2"',
                        "bash", helper, body], stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, timeout=60, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--creds", required=True, type=Path)
    args = parser.parse_args()
    previous, dispatched_at, reported = None, 0, False
    waiting_since = None
    while True:
        try:
            previous, dispatched_at = poll_once(args.creds, previous, dispatched_at)
            # Keep the report latch across recovery/flapping for this run.
        except Exception as error:
            # Endpoint data, exception text, and decrypted payloads are secret.
            stage = getattr(error, "siwc_stage", "unknown")
            kind = type(error).__name__
            status = getattr(error, "http_status", None)
            if isinstance(status, str) and len(status) == 3 and status.isdigit():
                kind += f", HTTP {status}"
            print(f"::error::SIWC access polling failed at stage={stage} "
                  f"({kind}; details suppressed).", flush=True)
            if not reported:
                try:
                    report_failure()
                    reported = True
                except Exception as report_error:
                    print("::error::SIWC auth Issue could not be requested "
                          f"({type(report_error).__name__}; details suppressed).", flush=True)
        # A queued updater can publish between slow polls. Observe bootstrap
        # and requested replacements promptly while ordinary polling stays slow.
        if previous is None or dispatched_at:
            now = time.monotonic()
            if waiting_since is None:
                waiting_since = now
            interval = WAIT_SECONDS if now - waiting_since < WAIT_LIMIT_SECONDS else POLL_SECONDS
        else:
            waiting_since = None
            interval = POLL_SECONDS
        time.sleep(interval)


if __name__ == "__main__":
    sys.exit(main())
