#!/usr/bin/env python3
"""Emit the managed subscription provider (paths are escaped as TOML strings)."""
import json
import os
from pathlib import Path
import sys


def requirement(args=None):
    if args is None:
        script = str(Path(__file__).with_name("siwc-token.py").resolve())
        access = str(Path(os.environ["CODEX_HOME"], "siwc-access.json").resolve())
        args = [script, "--creds", access]
    return '\n'.join([
        '# Managed by coding-bot: subscription provider',
        'allowed_login_methods = ["chatgpt"]',
        'model_provider = "openai_chatgpt_plan"',
        '[model_providers.openai_chatgpt_plan]',
        'name = "ChatGPT plan"',
        'base_url = "https://api.openai.com/v1"',
        'wire_api = "responses"',
        'supports_websockets = false',
        '[model_providers.openai_chatgpt_plan.auth]',
        'command = "python3"',
        'args = ' + json.dumps(args),
        'refresh_interval_ms = 300000',
        'timeout_ms = 5000',
    ])


def owns(path):
    text = Path(path).read_text()
    lines = text.splitlines()
    if not lines or lines[0] != '# Managed by coding-bot: subscription provider':
        return False
    args = json.loads(next(line.removeprefix('args = ') for line in lines if line.startswith('args = ')))
    return (isinstance(args, list) and len(args) == 3 and args[1] == '--creds'
            and all(isinstance(value, str) for value in args)
            and Path(args[0]).name == 'siwc-token.py' and Path(args[0]).is_absolute()
            and Path(args[2]).name == 'siwc-access.json' and Path(args[2]).is_absolute()
            and text == requirement(args) + '\n')


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == '--owns':
        try:
            sys.exit(0 if owns(sys.argv[2]) else 1)
        except Exception:
            sys.exit(1)
    print(requirement())
