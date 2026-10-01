#!/usr/bin/env python3
"""Validate a login snapshot; exit 2 requests a stale-daily-refresh warning."""
import base64
from datetime import datetime
import json
import math
import os
from pathlib import Path
import sys
import time


def check_state(path):
    auth = json.loads(Path(path).read_text())
    refreshed = datetime.fromisoformat(auth["last_refresh"].replace("Z", "+00:00"))
    if refreshed.tzinfo is None:
        raise ValueError("last_refresh must include timezone")
    now = time.time()
    age = now - refreshed.timestamp()
    if age >= 8 * 86400 or age < -300:
        return 1
    # Runs use externally managed access-only auth, and cannot renew it. Require
    # enough lifetime for the whole run; three-day age only requests an Issue.
    access = auth["tokens"]["access_token"]
    parts = access.split(".")
    if len(parts) != 3 or access.startswith("sk-"):
        return 1
    payload = json.loads(base64.urlsafe_b64decode(parts[1] + "=" * (-len(parts[1]) % 4)))
    expiry = payload["exp"]
    duration = int(os.environ.get("CODING_BOT_TIMEOUT", "5400"))
    if not (isinstance(expiry, (int, float)) and not isinstance(expiry, bool)
            and math.isfinite(expiry) and expiry > now + duration + 300):
        return 1
    return 2 if age > 3 * 86400 else 0


if __name__ == "__main__":
    try:
        sys.exit(check_state(sys.argv[1]))
    except Exception:
        sys.exit(1)  # Credentials and exception details never enter logs.
