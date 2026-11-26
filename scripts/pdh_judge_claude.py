"""Run independent acceptance in a fresh Claude Code subscription session."""

import json
import os
from pathlib import Path
import shutil
import subprocess

from pdh_judge_api import EFFORT, packet_instructions, resolve_verdict, verdict_schema

MODEL = "claude-opus-5-5"


def _sandbox():
    config = Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude")
    auth = config / ".credentials.json"
    bwrap = shutil.which("bwrap")
    binary = shutil.which(os.environ.get("PDH_CLAUDE_BIN") or "claude")
    if not (bwrap and binary and auth.is_file()):
        raise RuntimeError("Claude 検収には Linux の bubblewrap、ネイティブ Claude CLI、Claude Code のログインが必要です")
    args = [
        bwrap, "--die-with-parent", "--new-session", "--unshare-pid", "--unshare-ipc",
        "--clearenv", "--ro-bind", "/usr", "/usr", "--symlink", "usr/bin", "/bin",
        "--dev", "/dev", "--proc", "/proc", "--tmpfs", "/tmp", "--dir", "/work",
        "--dir", "/trial/.claude", "--ro-bind", str(auth.resolve()), "/trial/.claude/.credentials.json",
        "--ro-bind", str(Path(binary).resolve()), "/claude",
        "--setenv", "HOME", "/trial", "--setenv", "PATH", "/usr/bin:/bin", "--chdir", "/work",
    ]
    for name in ("/lib", "/lib64", "/etc/resolv.conf", "/etc/hosts", "/etc/nsswitch.conf", "/etc/ssl/certs"):
        if Path(name).exists():
            args.extend(("--ro-bind", name, name))
    return args + ["--", "/claude"]


def _result(stdout, criteria):
    if len(stdout) > 256 * 1024:
        raise ValueError("oversized result")
    event = json.loads(stdout)
    if (event["type"] != "result" or event["subtype"] != "success" or event["is_error"] is not False
            or event["permission_denials"] != [] or not isinstance(event["modelUsage"], dict)
            or set(event["modelUsage"]) != {MODEL}):
        raise ValueError("incomplete or unexpected Claude result")
    return resolve_verdict(event["structured_output"], criteria)


def judge(packet: str, criteria: dict[str, str]) -> dict:
    sandbox = _sandbox()
    try:
        login = subprocess.run(sandbox + ["auth", "status", "--json"], env={}, stdin=subprocess.DEVNULL,
                               capture_output=True, timeout=20, check=True)
        status = json.loads(login.stdout)
        if status["loggedIn"] is not True or status["authMethod"] != "claude.ai":
            raise ValueError
    except (OSError, subprocess.SubprocessError, ValueError, KeyError, TypeError):
        raise RuntimeError("Claude の隔離環境でログインを確認できませんでした") from None
    args = [
        "--safe-mode", "--restricted", "--strict-mcp-config", "--tools", "",
        "--no-session-persistence", "--model", MODEL, "--effort", EFFORT,
        "--system-prompt", packet_instructions(packet),
        "--json-schema", json.dumps(verdict_schema(criteria)), "--output-format", "json", "-p",
    ]
    try:
        completed = subprocess.run(sandbox + args, env={}, input=packet.encode("utf-8"),
                                   capture_output=True, timeout=180, check=True)
        return _result(completed.stdout, criteria)
    except subprocess.TimeoutExpired:
        raise RuntimeError("Claude 判定が時間内に完了しませんでした") from None
    except (OSError, subprocess.SubprocessError, KeyError, TypeError, ValueError, RecursionError):
        raise RuntimeError("Claude の応答から有効な判定を取得できませんでした") from None
