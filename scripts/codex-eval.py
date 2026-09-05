#!/usr/bin/env python3
"""Run one prompt-only Codex evaluation and retain evidence per invocation.

This is a repository development tool, not a distributed PDH runtime.
The output directory must be outside the prompt-only working directory.
Task execution and grading are separate: 'completed' never means 'PASS'.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
from datetime import datetime, timezone
from uuid import uuid4


USAGE_KEYS = ("input_tokens", "cached_input_tokens", "output_tokens")
NON_TOOL_ITEMS = {"agent_message", "reasoning", "plan_update"}


def summarize_events(path):
    """Missing/partial usage is unknown, not zero; retain invalid evidence."""
    threads, turns, errors, tools = [], [], [], []
    for line_no, line in enumerate(path.read_text().splitlines(), 1):
        if not line.strip():
            continue
        try:
            event = json.loads(line)
            if not isinstance(event, dict):
                raise ValueError("event must be an object")
        except (json.JSONDecodeError, ValueError) as exc:
            errors.append({"line": line_no, "error": str(exc)})
            continue
        kind = event.get("type")
        if kind == "thread.started":
            threads.append(event.get("thread_id"))
        elif kind == "turn.completed":
            turns.append(event.get("usage"))
        elif kind in {"turn.failed", "error"}:
            errors.append(event)
        elif kind in {"item.started", "item.updated", "item.completed"}:
            item = event.get("item") or {}
            item_type = item.get("type")
            if item_type not in NON_TOOL_ITEMS:
                tools.append({"id": item.get("id"), "type": item_type})
    usage = {}
    for key in USAGE_KEYS:
        values = [u.get(key) if isinstance(u, dict) else None for u in turns]
        usage[key] = (
            sum(values)
            if values and all(type(v) is int and v >= 0 for v in values)
            else None
        )
    return {
        "thread_ids": threads,
        "completed_turns": len(turns),
        "usage": usage,
        "usage_complete": all(v is not None for v in usage.values()),
        "errors": errors,
        "tool_events": tools,
    }


def execution_status(returncode, timed_out, events, final_text):
    if timed_out:
        return "timeout"
    if returncode != 0 or events["errors"] or not events["completed_turns"]:
        return "failed"
    if events["tool_events"]:
        return "invalid_tool_use"
    if not final_text.strip():
        return "missing_output"
    return "completed"


def run(args):
    prompt = args.prompt.read_bytes()
    prompt.decode("utf-8")
    if not prompt.strip():
        raise ValueError("prompt is empty")
    if args.timeout <= 0:
        raise ValueError("timeout must be positive")
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid4().hex[:12]
    root = args.output_root.resolve() / run_id
    root.mkdir(parents=True, mode=0o700)
    workspace = root / "workspace"
    workspace.mkdir()
    (root / "prompt.md").write_bytes(prompt)
    events_path, stderr_path = root / "events.jsonl", root / "stderr.log"
    final_path = root / "response.md"
    command = ([str(args.node)] if args.node else []) + [str(args.codex)]
    command += [
        "exec", "--ignore-user-config", "--ephemeral", "--json",
        "--skip-git-repo-check", "--sandbox", "read-only",
        "--model", args.model,
        "-c", 'model_reasoning_effort="' + args.effort + '"',
        "-c", 'forced_login_method="chatgpt"',
        "-c", 'approval_policy="never"',
        "-c", "project_doc_max_bytes=0",
        "-c", "features.shell_tool=false",
        "-c", "features.multi_agent=false",
        "-c", "features.apps=false",
        "-c", "tools.view_image=false",
        "-c", 'web_search="disabled"',
        "--cd", str(workspace), "--output-last-message", str(final_path), "-",
    ]
    env = dict(os.environ)
    for key in ("OPENAI_API_KEY", "CODEX_API_KEY", "ANTHROPIC_API_KEY"):
        env.pop(key, None)
    record = {
        "run_id": run_id,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "task": args.task,
        "variant": args.variant,
        "requested_model": args.model,
        "requested_effort": args.effort,
        "observed_model": None,
        "model_evidence": "explicit CLI argument; JSON stream does not attest served model",
        "prompt_sha256": hashlib.sha256(prompt).hexdigest(),
        "prompt_bytes": len(prompt),
        "auth": "chatgpt",
        "command": command,
        "evaluation_scope": "prompt-only; tool calls invalidate the run",
        "status": "running",
        "grade": None,
    }
    record_path = root / "run.json"
    record_path.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"run_id": run_id, "directory": str(root)}, ensure_ascii=False), flush=True)
    started = time.monotonic()
    timed_out = False
    returncode = None
    launch_error = None
    with events_path.open("w") as stdout, stderr_path.open("w") as stderr:
        try:
            proc = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=stdout,
                                    stderr=stderr, cwd=workspace, env=env,
                                    start_new_session=True)
            try:
                proc.communicate(prompt, timeout=args.timeout)
            except subprocess.TimeoutExpired:
                timed_out = True
                os.killpg(proc.pid, signal.SIGTERM)
                try:
                    proc.communicate(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(proc.pid, signal.SIGKILL)
                    proc.communicate()
            returncode = proc.returncode
        except OSError as exc:
            launch_error = str(exc)
    events = summarize_events(events_path)
    final_text = final_path.read_text() if final_path.exists() else ""
    record.update(events)
    record.update({
        "ended_at": datetime.now(timezone.utc).isoformat(),
        "elapsed_seconds": round(time.monotonic() - started, 3),
        "returncode": returncode,
        "launch_error": launch_error,
        "status": execution_status(returncode, timed_out, events, final_text),
        "response_sha256": hashlib.sha256(final_text.encode()).hexdigest() if final_text else None,
    })
    record_path.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({k: record[k] for k in ("run_id", "status", "elapsed_seconds", "usage", "usage_complete")}, ensure_ascii=False))
    return 0 if record["status"] == "completed" else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prompt", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--task", required=True)
    parser.add_argument("--variant", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--effort", choices=("low", "medium", "high", "xhigh", "max"), required=True)
    parser.add_argument("--codex", type=Path, required=True)
    parser.add_argument("--node", type=Path)
    parser.add_argument("--timeout", type=int, default=300)
    args = parser.parse_args()
    args.prompt = args.prompt.resolve()
    args.codex = args.codex.resolve()
    if args.node:
        args.node = args.node.resolve()
    try:
        return run(args)
    except (OSError, ValueError) as exc:
        parser.exit(2, str(exc) + "\n")


if __name__ == "__main__":
    sys.exit(main())
