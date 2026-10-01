#!/usr/bin/env python3
"""SIWC credentials helpers and read-only Codex bearer command.

JWT inspection prevents API-key billing; the OpenAI endpoint validates signatures.
Only the dedicated refresh workflow may call token_request with a refresh token.
"""
import argparse
import base64
from contextlib import contextmanager
from datetime import datetime
import fcntl
import json
import math
import os
from pathlib import Path
import re
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

TOKEN_URL = 'https://auth.openai.com/api/accounts/oauth/token'
DIRECT = 'chatgpt.tokens.use.direct'
RELOGIN_ERRORS = {'invalid_grant', 'invalid_refresh_token', 'token_expired',
                  'refresh_token_reused'}


class NeedsLogin(Exception):
    pass


@contextmanager
def credential_lock(path):
    fd = os.open(str(path) + '.lock', os.O_CREAT | os.O_RDWR, 0o600)
    with os.fdopen(fd, 'a') as lock:
        os.fchmod(lock.fileno(), 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX)
        yield


def atomic_write(path, data):
    path = Path(path)
    fd, tmp = tempfile.mkstemp(prefix='.' + path.name + '.', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as out:
            os.fchmod(out.fileno(), 0o600)
            json.dump(data, out)
            out.write('\n')
            out.flush()
            os.fsync(out.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def issued_client(value):
    if not isinstance(value, str) or not re.fullmatch(r'oaiapp_[A-Za-z0-9_-]+', value):
        raise ValueError('Missing or invalid issued client_id; re-login needed')
    return value


def check_scope(scope):
    scopes = scope.split() if isinstance(scope, str) else scope
    if not isinstance(scopes, list) or DIRECT not in scopes:
        raise ValueError('Required direct-use scope is missing')


def check_access(token):
    if not isinstance(token, str) or token.startswith('sk-'):
        raise ValueError('Access token must be a JWT, not an API key')
    parts = token.split('.')
    if len(parts) != 3 or any(not re.fullmatch(r'[A-Za-z0-9_-]+', p) for p in parts):
        raise ValueError('Access token must have three base64url JWT parts')
    try:
        decoded = [base64.b64decode(p + '=' * (-len(p) % 4),
                                   altchars=b'-_', validate=True) for p in parts]
        payload = json.loads(decoded[1])
        if not isinstance(payload, dict):
            raise ValueError()
    except (ValueError, UnicodeError):
        raise ValueError('Invalid JWT payload or encoding') from None
    check_scope(payload.get('scope'))
    payload['exp'] = finite_timestamp(payload.get('exp'), allow_iso=False)
    return payload


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def token_request(fields):
    request = urllib.request.Request(
        os.environ.get('SIWC_TOKEN_URL', TOKEN_URL),
        data=urllib.parse.urlencode(fields).encode('ascii'),
        headers={'Content-Type': 'application/x-www-form-urlencoded'})
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=30) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        try:
            result = json.loads(error.read())
        except (ValueError, UnicodeError):
            result = {}
        if isinstance(result, dict) and result.get('error') in RELOGIN_ERRORS:
            raise NeedsLogin('Refresh credentials unusable; re-login needed') from None
        raise ValueError('Token endpoint HTTP error (response suppressed)') from None
    if not isinstance(result, dict):
        raise ValueError('Invalid token response')
    if result.get('error') in RELOGIN_ERRORS:
        raise NeedsLogin('Credentials unusable; re-login needed')
    if 'error' in result:
        raise ValueError('Token endpoint rejected request (response suppressed)')
    return result


def finite_timestamp(value, allow_iso=True):
    if isinstance(value, bool):
        raise ValueError('Invalid credential timestamp')
    if isinstance(value, str) and not re.fullmatch(r'[0-9]+(?:\.[0-9]+)?', value):
        if not allow_iso:
            raise ValueError('Timestamp must be numeric')
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if parsed.tzinfo is None:
            raise ValueError('Timestamp must include timezone')
        value = parsed.timestamp()
    number = float(value)
    if not math.isfinite(number) or number <= 0:
        raise ValueError('Invalid credential timestamp')
    return number


def credentials_from_response(old, result):
    scope = result.get('scope')
    if not isinstance(scope, str):
        raise ValueError('Token response scope must be a string')
    check_scope(scope)
    payload = check_access(result.get('access_token'))
    for key in ('refresh_token', 'id_token'):
        if not isinstance(result.get(key), str) or not result[key]:
            raise ValueError('Token response missing required token field')
    lifetime = finite_timestamp(result['expires_in'], allow_iso=False)
    now = time.time()
    creds = dict(client_id=issued_client(old['client_id']),
                 ext_agent_host_id=old['ext_agent_host_id'],
                 access_token=result['access_token'], refresh_token=result['refresh_token'],
                 id_token=result['id_token'], expires_at=min(now + lifetime, payload['exp']),
                 scope=scope, obtained_at=now)
    if creds['expires_at'] <= now:
        raise ValueError('Token response has expired')
    if 'earliest_refresh_at' in result:
        creds['earliest_refresh_at'] = finite_timestamp(result['earliest_refresh_at'])
    return creds


def get_token(path, min_valid):
    # No locks, network calls, or writes: auth.command has a five-second timeout.
    try:
        creds = json.loads(Path(path).read_text())
    except FileNotFoundError:
        raise NeedsLogin('SIWC access credentials missing; re-login needed') from None
    if not isinstance(creds, dict) or creds.get('needs_login'):
        raise NeedsLogin('SIWC access credentials unusable; re-login needed')
    check_scope(creds.get('scope'))
    payload = check_access(creds.get('access_token'))
    expiry = min(finite_timestamp(creds.get('expires_at')), payload['exp'])
    if expiry <= time.time() + min_valid:
        raise NeedsLogin('SIWC access token needs renewal by the auth workflow')
    return creds['access_token']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--creds', required=True, type=Path)
    parser.add_argument('--min-valid', type=int, default=360)
    args = parser.parse_args()
    try:
        if args.min_valid < 0:
            raise ValueError('--min-valid must be nonnegative')
        print(get_token(args.creds, args.min_valid))
        return 0
    except NeedsLogin as error:
        print(str(error), file=sys.stderr)
        return 2
    except Exception:
        # Never expose exception text that could contain endpoint data or tokens.
        print('SIWC token failed: invalid credentials, scope/JWT, response, or I/O.',
              file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
