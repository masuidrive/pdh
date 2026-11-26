"""Run the independent judge through an isolated Codex subscription session."""

import json
import os
from pathlib import Path
import platform
import shutil
import subprocess

from pdh_judge_api import EFFORT, MODEL, packet_instructions, resolve_verdict, verdict_schema


_TIMEOUT_SECONDS = 120
_MAX_OUTPUT_BYTES = 256 * 1024
_FALLBACK_PREFIX = "Falling back from WebSockets to HTTPS transport."
_DISABLED_FEATURES = (
    "apps", "browser_use", "code_mode", "code_mode_only", "computer_use", "goals", "hooks",
    "image_generation", "multi_agent", "multi_agent_v2", "plugins", "shell_tool",
    "skill_search", "sleep_tool", "tool_suggest", "unified_exec", "view_image",
)


def _native(path):
    if not path or not os.access(path, os.X_OK):
        return None
    try:
        path = Path(path).resolve(strict=True)
        with path.open("rb") as binary:
            if binary.read(4) == b"\x7fELF":
                return path
    except (OSError, RuntimeError):
        pass
    return None


def _codex_binary(home):
    override = os.environ.get("PDH_CODEX_BIN")
    if override:
        return _native(override)
    on_path = shutil.which("codex")
    binary = _native(on_path) or _native(
        home / ".codex/packages/app-server-daemon/current/bin/codex"
    )
    if binary or not on_path:
        return binary
    architecture = {"aarch64": "arm64", "x86_64": "x64"}.get(platform.machine())
    if not architecture:
        return None
    package = Path(on_path).resolve().parent.parent
    target = f"codex-linux-{architecture}"
    packages = (package, package / f"node_modules/@openai/{target}", package.parent / target)
    for npm_package in packages:
        for directory in ("bin", "codex"):
            for candidate in sorted(npm_package.glob(f"vendor/*/{directory}/codex")):
                binary = _native(candidate)
                if binary:
                    return binary
    return None


def _sandbox(bwrap, binary, auth):
    args = [
        bwrap, "--die-with-parent", "--new-session", "--unshare-pid",
        "--unshare-ipc", "--clearenv", "--ro-bind", "/usr", "/usr",
        "--symlink", "usr/bin", "/bin", "--dev", "/dev", "--proc", "/proc",
        "--tmpfs", "/tmp", "--dir", "/work", "--dir", "/trial/.codex",
        "--ro-bind", str(auth), "/trial/.codex/auth.json",
        "--ro-bind", str(binary), "/codex", "--setenv", "HOME", "/trial",
        "--setenv", "CODEX_HOME", "/trial/.codex", "--setenv", "PATH", "/usr/bin:/bin",
        "--chdir", "/work",
    ]
    # Recent Codex builds probe their native helper even with Code Mode disabled.
    helper = _native(binary.with_name("codex-code-mode-host"))
    if helper:
        args.extend(("--ro-bind", str(helper), "/codex-code-mode-host"))
    for path in ("/lib", "/lib64", "/etc/resolv.conf", "/etc/hosts",
                 "/etc/nsswitch.conf", "/etc/ssl/certs"):
        if Path(path).exists():
            args.extend(("--ro-bind", path, path))
    return args


def _exec_args(instructions):
    args = [
        "exec", "--ephemeral", "--ignore-user-config", "--ignore-rules",
        "--skip-git-repo-check", "-s", "read-only", "-m", MODEL,
        "-c", f"model_reasoning_effort={json.dumps(EFFORT)}",
        "-c", f"developer_instructions={json.dumps(instructions, ensure_ascii=False)}",
        "-c", 'web_search="disabled"', "-c", "project_doc_max_bytes=0",
        "-c", 'approval_policy="never"',
    ]
    for feature in _DISABLED_FEATURES:
        args.extend(("--disable", feature))
    return args + ["--output-schema", "/schema.json", "--json", "-"]


def _result(stdout, criteria):
    if len(stdout) > _MAX_OUTPUT_BYTES:
        raise ValueError
    state = "initial"
    message = None
    for line in stdout.splitlines():
        event = json.loads(line)
        kind = event["type"]
        if kind == "thread.started" and state == "initial":
            state = "thread"
        elif kind == "turn.started" and state == "thread":
            state = "turn"
        elif kind == "turn.completed" and state == "turn":
            state = "complete"
        elif kind == "error" and state == "turn":
            if not event["message"].startswith(_FALLBACK_PREFIX):
                raise ValueError
        elif kind in ("item.started", "item.updated", "item.completed") and state == "turn":
            item = event["item"]
            if item["type"] == "reasoning":
                continue
            if item["type"] != "agent_message" or message is not None:
                raise ValueError
            if kind == "item.completed":
                message = resolve_verdict(json.loads(item["text"]), criteria)
        else:
            raise ValueError
    if state != "complete" or message is None:
        raise ValueError
    return message


def judge(packet: str, criteria: dict[str, str]) -> dict:
    """Return a validated verdict or raise a diagnostic without session output."""
    home = Path.home()
    bwrap = shutil.which("bwrap")
    binary = _codex_binary(home)
    auth = home / ".codex/auth.json"
    if not bwrap or not hasattr(os, "memfd_create"):
        raise RuntimeError("Codex 判定には Linux の bubblewrap が必要です")
    if not binary:
        raise RuntimeError("Codex 判定に使用する Linux バイナリが見つかりません")
    if not auth.is_file():
        raise RuntimeError("Codex 判定には ChatGPT ログインが必要です")

    sandbox = _sandbox(bwrap, binary, auth)
    try:
        login = subprocess.run(
            sandbox + ["--", "/codex", "login", "status"],
            stdin=subprocess.DEVNULL, capture_output=True, timeout=15, env={},
        )
        if login.returncode or b"logged in using chatgpt" not in (
            login.stdout + login.stderr
        ).lower():
            raise RuntimeError("隔離環境で Codex の ChatGPT ログインを確認できませんでした")

        with os.fdopen(os.memfd_create("pdh-judge-schema"), "w+b") as schema:
            schema.write(json.dumps(verdict_schema(criteria)).encode("utf-8"))
            schema.seek(0)
            fd = schema.fileno()
            result = subprocess.run(
                sandbox + ["--ro-bind-data", str(fd), "/schema.json", "--", "/codex"]
                + _exec_args(packet_instructions(packet)),
                input=packet.encode("utf-8"), capture_output=True,
                timeout=_TIMEOUT_SECONDS, pass_fds=(fd,), env={},
            )
    except subprocess.TimeoutExpired:
        raise RuntimeError("Codex 判定が時間内に完了しませんでした") from None
    except (OSError, ValueError):
        raise RuntimeError("隔離環境で Codex 判定を起動できませんでした") from None

    try:
        if result.returncode:
            raise ValueError
        return _result(result.stdout, criteria)
    except (AttributeError, KeyError, TypeError, ValueError, RecursionError):
        raise RuntimeError("Codex の応答から有効な判定を取得できませんでした") from None
