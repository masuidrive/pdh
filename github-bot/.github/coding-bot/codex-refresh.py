#!/usr/bin/env python3
"""Refresh bot logins only while holding the Actions workflow concurrency group."""
from datetime import datetime
import base64
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time

HERE = Path(__file__).resolve().parent
# A non-authenticating local probe placeholder, never a provider credential.
# Codex reads JWT exp before last_refresh when deciding proactive refresh.
REFRESH_PROBE_ACCESS = 'eyJhbGciOiJub25lIn0.eyJleHAiOjB9.c3ludGhldGlj'
spec = importlib.util.spec_from_file_location('siwc_token', HERE / 'siwc-token.py')
siwc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(siwc)


class RefreshFailure(Exception):
    """Only fixed, credential-free diagnostics leave the refresh process."""


class AuthFailure(RefreshFailure):
    """Authentication is unusable or a rotated login could not be saved."""


def command(args, *, value=None, token=None, env=None, timeout=65):
    context = dict(os.environ) if env is None else dict(env)
    if token is not None:
        context['GH_TOKEN'] = token
    return subprocess.run(args, input=value, text=True, capture_output=True,
                          env=context, timeout=timeout)


def mask(value):
    if os.environ.get('GITHUB_ACTIONS') == 'true' and isinstance(value, str):
        escaped = value.replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')
        print('::add-mask::' + escaped, flush=True)


def api(route, *, dispatch=False, fields=(), missing=False):
    token = os.environ.get('GITHUB_TOKEN' if dispatch else 'CODING_BOT_GH_PAT', '')
    if not token:
        raise RefreshFailure('GitHub credential unavailable; authentication state was not changed')
    result = command(['gh', 'api', route, *fields], token=token)
    if result.returncode:
        if missing and 'HTTP 404' in result.stderr:
            return None
        raise RefreshFailure('GitHub API failed; authentication state could not be checked')
    return json.loads(result.stdout) if result.stdout.strip() else None


def timestamp(value):
    if isinstance(value, str):
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if parsed.tzinfo is None:
            raise RefreshFailure('Authentication timestamp must include its timezone')
        return parsed.timestamp()
    if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
        return float(value)
    raise RefreshFailure('Authentication timestamp is invalid')


def dispatch_fresh_snapshot():
    repo = os.environ['GITHUB_REPOSITORY']
    branch = os.environ.get('GITHUB_DEFAULT_BRANCH')
    if not branch:
        branch = api('repos/' + repo, dispatch=True)['default_branch']
    # Secrets and run creation timestamps have seconds resolution. Wait out an
    # equality before dispatching, so the successor can prove its snapshot fresh.
    time.sleep(2)
    api(f'repos/{repo}/actions/workflows/coding-bot-codex-auth.yml/dispatches',
        dispatch=True, fields=('--method', 'POST', '-f', 'ref=' + branch))
    print('Queued secret snapshot is stale; requested a fresh authentication workflow.')


def snapshot_is_fresh(secret, metadata=None):
    repo = os.environ['GITHUB_REPOSITORY']
    run = api(f"repos/{repo}/actions/runs/{os.environ['GITHUB_RUN_ID']}", dispatch=True)
    if metadata is None:
        metadata = api(f'repos/{repo}/actions/secrets/{secret}')
    # Repository secrets are captured when a run queues, not after its lock.
    # GitHub cannot read back secret values. Never reuse a possibly rotated
    # snapshot: dispatch a successor AFTER the write, while still holding lock.
    if timestamp(metadata['updated_at']) >= timestamp(run['created_at']):
        dispatch_fresh_snapshot()
        return False
    return True


def save_secret(name, credentials):
    value = json.dumps(credentials, separators=(',', ':'))
    token = os.environ.get('CODING_BOT_GH_PAT', '')
    if not token:
        raise AuthFailure(f'{name} write-back credential missing; login may be lost; re-login required')
    for attempt in range(3):
        try:
            result = command(['gh', 'secret', 'set', name, '--repo', os.environ['GITHUB_REPOSITORY']],
                             value=value, token=token)
            if result.returncode == 0:
                return
        except subprocess.TimeoutExpired:
            pass
        if attempt < 2:
            time.sleep(float(os.environ.get('CODING_BOT_REFRESH_RETRY_DELAY', '2')) * (attempt + 1))
    raise AuthFailure(f'{name} write-back failed after 3 attempts; login may be lost; re-login required')


def crypt(value, *, decrypt=False):
    if not os.environ.get('CODING_BOT_CODEX_SIWC_KEY'):
        raise RefreshFailure('CODING_BOT_CODEX_SIWC_KEY is missing')
    args = ['openssl', 'enc', '-aes-256-cbc', '-pbkdf2', '-iter', '100000', '-a', '-A',
            '-pass', 'env:CODING_BOT_CODEX_SIWC_KEY']
    if decrypt:
        args.append('-d')
    else:
        args.append('-salt')
    result = command(args, value=value)
    if result.returncode:
        raise RefreshFailure('SIWC access encryption/decryption failed')
    return result.stdout


def validate_access(access):
    payload = siwc.check_access(access['access_token'])
    siwc.check_scope(access['scope'])
    return min(timestamp(access['expires_at']), timestamp(payload['exp']))


def publish_access(credentials):
    access = {key: credentials[key] for key in ('access_token', 'expires_at', 'scope')}
    for key in ('obtained_at', 'earliest_refresh_at'):
        if key in credentials:
            access[key] = credentials[key]
    try:
        encrypted = crypt(json.dumps(access, separators=(',', ':')))
        published = command(['gh', 'variable', 'set', 'CODING_BOT_CODEX_SIWC_ACCESS',
                         '--repo', os.environ['GITHUB_REPOSITORY']], value=encrypted,
                        token=os.environ['CODING_BOT_GH_PAT'])
    except subprocess.TimeoutExpired:
        raise RefreshFailure('SIWC access publication timed out; refresh token was saved; check the variable before retrying the updater') from None
    if published.returncode:
        raise RefreshFailure('SIWC access publication failed; refresh token was saved')


def refresh_siwc(raw):
    # Check distribution prerequisites before consuming a rotating credential.
    if not os.environ.get('CODING_BOT_CODEX_SIWC_KEY'):
        raise RefreshFailure('CODING_BOT_CODEX_SIWC_KEY is missing; SIWC refresh was not attempted')
    if shutil.which('openssl') is None:
        raise RefreshFailure('openssl is missing; SIWC refresh was not attempted')
    repo = os.environ['GITHUB_REPOSITORY']
    latest = api(f'repos/{repo}/actions/variables/CODING_BOT_CODEX_SIWC_ACCESS', missing=True)
    metadata = api(f'repos/{repo}/actions/secrets/CODING_BOT_CODEX_SIWC_JSON')
    access = None
    if latest is not None:
        try:
            if timestamp(latest['updated_at']) <= timestamp(metadata['updated_at']):
                raise RefreshFailure('SIWC access cache predates the current login')
            access = json.loads(crypt(latest['value'], decrypt=True))
            expiry = validate_access(access)
            if expiry > time.time() + 1200:
                print('SIWC access token has more than 20 minutes left; refresh skipped.')
                return
        except (ValueError, KeyError, TypeError, RefreshFailure):
            # A changed key or malformed cache can be recovered from the secret.
            access = None
    if not snapshot_is_fresh('CODING_BOT_CODEX_SIWC_JSON', metadata):
        return
    old = json.loads(raw)
    siwc.issued_client(old['client_id'])
    earliest = max((timestamp(state['earliest_refresh_at']) for state in (old, access or {})
                    if state.get('earliest_refresh_at') is not None), default=0)
    old_expiry = 0
    try:
        old_expiry = validate_access(old)
    except (ValueError, KeyError, RefreshFailure):
        pass
    # An admin login already has usable access. Bootstrap or recover its cache
    # without rotating credentials before the server allows another refresh.
    if access is None and old_expiry > time.time() + 1200:
        publish_access(old)
        print('Existing SIWC access token published; refresh skipped.')
        return
    if earliest > time.time():
        if access is None and old_expiry > time.time() + 360:
            publish_access(old)
        print('SIWC earliest_refresh_at has not arrived; refresh skipped.')
        return
    result = siwc.token_request(dict(grant_type='refresh_token', client_id=old['client_id'],
                                     refresh_token=old['refresh_token']))
    rotated = result.get('refresh_token')
    if not isinstance(rotated, str) or not rotated:
        raise AuthFailure('SIWC refresh response did not include a refresh token; re-login required')
    mask(rotated)
    # Persist the rotated long-lived token BEFORE access validation/encryption or
    # publication. Even a malformed access response must not discard rotation.
    recovered = dict(old, refresh_token=rotated)
    if 'earliest_refresh_at' in result:
        # Preserve this server instruction even if subsequent access validation
        # or publication fails. Copying it cannot prevent rotation write-back.
        recovered['earliest_refresh_at'] = result['earliest_refresh_at']
    if isinstance(result.get('id_token'), str) and result['id_token']:
        recovered['id_token'] = result['id_token']
        mask(result['id_token'])
    save_secret('CODING_BOT_CODEX_SIWC_JSON', recovered)
    for field in ('access_token',):
        mask(result.get(field))
    credentials = siwc.credentials_from_response(old, result)
    # First save above protects rotation on malformed responses. This second
    # save makes a failed cache publication recoverable from complete state.
    save_secret('CODING_BOT_CODEX_SIWC_JSON', credentials)
    publish_access(credentials)
    print('SIWC refresh token saved and encrypted access token published.')


def is_chatgpt(auth):
    tokens = auth.get('tokens', {})
    return (auth.get('auth_mode') in (None, 'chatgpt') and isinstance(tokens, dict)
            and all(isinstance(tokens.get(field), str) and tokens[field]
                    for field in ('access_token', 'refresh_token')))


def codex_access_expiry(token):
    # Payload inspection only: the provider verifies JWT authenticity. This
    # excludes the temporary refresh trigger from persisted credentials.
    try:
        if not isinstance(token, str) or token.startswith('sk-'):
            raise ValueError()
        parts = token.split('.')
        if len(parts) != 3 or not all(parts):
            raise ValueError()
        payload = json.loads(base64.b64decode(parts[1] + '=' * (-len(parts[1]) % 4),
                                            altchars=b'-_', validate=True))
        expiry = payload['exp']
        if isinstance(expiry, bool) or not isinstance(expiry, (int, float)) or not math.isfinite(expiry):
            raise ValueError()
        return expiry
    except (ValueError, TypeError, KeyError, UnicodeError):
        raise RefreshFailure('codex login access JWT expiry is invalid') from None


def refresh_codex_login(raw, secret='CODING_BOT_CODEX_AUTH_JSON'):
    initial = json.loads(raw)
    if not is_chatgpt(initial):
        raise AuthFailure('codex login credentials are invalid; re-login required')
    last_refresh = initial.get('last_refresh')
    if last_refresh is not None and 0 <= time.time() - timestamp(last_refresh) < 20 * 3600:
        print('codex login refreshed less than 20 hours ago; refresh skipped.')
        return
    if os.environ.get('CODING_BOT_CODEX_INSTALL_FAILED') == 'true':
        raise RefreshFailure('Codex installation failed; daily codex login refresh could not run')
    if not snapshot_is_fresh(secret):
        return
    with tempfile.TemporaryDirectory(prefix='coding-bot-codex-refresh-') as directory:
        home = Path(directory)
        auth_path = home / 'auth.json'
        forced = dict(initial, last_refresh='2000-01-01T00:00:00Z',
                      tokens=dict(initial['tokens'], access_token=REFRESH_PROBE_ACCESS))
        siwc.atomic_write(auth_path, forced)
        (home / 'config.toml').write_text('forced_login_method = "chatgpt"\n')
        context = dict(os.environ, CODEX_HOME=directory, CODING_BOT_CODEX_AUTH_MODE='codex-login')
        for key in list(context):
            if key in ('OPENAI_API_KEY', 'CODEX_API_KEY', 'CODING_BOT_OPENAI_API_KEY',
                       'CODING_BOT_CODEX_AUTH_JSON', 'CODING_BOT_CODEX_SIWC_JSON',
                       'CODING_BOT_CODEX_EXTRA_AUTH_JSON',
                       'CODING_BOT_GH_PAT', 'GITHUB_TOKEN', 'GH_TOKEN') or key.endswith('_SIWC_KEY'):
                context.pop(key, None)
        # Pin ChatGPT login before executing Codex, as on the run side.
        policy = command(['bash', str(HERE / 'codex-requirements.sh')], env=context)
        if policy.returncode:
            raise RefreshFailure('codex login refresh policy could not be installed')
        probe_rc = 1
        probe = None
        try:
            probe = command(['codex', 'exec', '--json', '--ephemeral', '--skip-git-repo-check',
                             '--sandbox', 'read-only', '-C', directory,
                             '-c', 'forced_login_method="chatgpt"', '-c', 'model_reasoning_effort="low"',
                             'Reply only OK. Do not use tools.'], env=context, timeout=45)
            probe_rc = probe.returncode
        except subprocess.TimeoutExpired:
            pass
        current = json.loads(auth_path.read_text())
        old_tokens = initial['tokens']
        current_tokens = current.get('tokens', {})
        account = old_tokens.get('account_id')
        # Establish rotation independently of access shape: an empty/missing
        # access response must not discard a same-account rotated refresh token.
        eligible = (current.get('auth_mode') in (None, 'chatgpt')
                    and isinstance(current_tokens, dict)
                    and isinstance(current_tokens.get('refresh_token'), str)
                    and bool(current_tokens['refresh_token']) and current != initial
                    and current_tokens.get('refresh_token') != old_tokens['refresh_token']
                    and (account is None or current_tokens.get('account_id') == account))
        if eligible:
            access_valid = False
            try:
                candidate_access = current_tokens.get('access_token')
                access_valid = (candidate_access != REFRESH_PROBE_ACCESS
                                and codex_access_expiry(candidate_access) > time.time())
            except RefreshFailure:
                pass
            for value in current_tokens.values():
                mask(value)
            saved = current
            if not access_valid:
                # Protect an already rotated, same-account refresh token even
                # on malformed access. Never write our local placeholder.
                saved = dict(current, tokens=dict(current_tokens, access_token=old_tokens['access_token']))
            save_secret(secret, saved)
            print(f'Daily codex login refresh saved to {secret}.')
            if not access_valid:
                raise RefreshFailure('codex login refresh rotated credentials but did not return valid access; original access retained')
            age = time.time() - timestamp(current.get('last_refresh'))
            if not 0 <= age < 3 * 86400:
                raise RefreshFailure('codex login rotated but last_refresh is stale or invalid; daily refresh could not be verified')
        if probe_rc and probe is not None:
            log = home / 'probe.log'
            log.write_text(probe.stdout + probe.stderr)
            diagnostic = command(['bash', '-c', 'source "$1"; codex_auth_log_is_failure "$2"',
                                  'bash', str(HERE / 'codex-auth.sh'), str(log)], env=context)
            if diagnostic.returncode == 0:
                raise AuthFailure('codex login authentication was rejected during the daily refresh probe; re-login required')
        if not eligible:
            raise RefreshFailure('codex login daily refresh did not produce rotated credentials; check updater policy, provider and tools')
        if probe_rc:
            raise RefreshFailure('codex login refresh succeeded and credentials were saved; provider probe failed (usage limit, network, or timeout); retry later')


def report(mode, cause, kind='auth', secret='CODING_BOT_CODEX_AUTH_JSON'):
    print('::error::' + cause)
    context = dict(os.environ, CODING_BOT_AUTH_ISSUE_SERIALIZED='true', CODING_BOT_CODEX_LOGIN_SECRET=secret)
    result = command(['bash', '-c', 'source "$1"; codex_auth_issue "$2" "$3" "$4"',
                      'bash', str(HERE / 'codex-auth-issue.sh'), mode, cause, kind], env=context)
    if result.returncode:
        print('::error::codex-auth Issue could not be reported.')


def main():
    failed = False
    logins = [('siwc', 'CODING_BOT_CODEX_SIWC_JSON', 'CODING_BOT_CODEX_SIWC_JSON'),
              ('codex-login', 'CODING_BOT_CODEX_AUTH_JSON', 'CODING_BOT_CODEX_AUTH_JSON')]
    extra = os.environ.get('CODING_BOT_CODEX_EXTRA_LOGIN_SECRET', '')
    if extra:
        if not re.fullmatch(r'[A-Z_][A-Z0-9_]*', extra) or extra in {
                'CODING_BOT_CODEX_AUTH_JSON', 'CODING_BOT_CODEX_SIWC_JSON', 'CODING_BOT_CODEX_SIWC_KEY'}:
            report('codex-login', 'Additional codex login secret name is invalid or conflicts with bot credentials', 'operational')
            failed = True
        elif not os.environ.get('CODING_BOT_CODEX_EXTRA_AUTH_JSON'):
            report('codex-login', f'Configured additional codex login secret {extra} is unavailable', 'operational', extra)
            failed = True
        else:
            logins.append(('codex-login', 'CODING_BOT_CODEX_EXTRA_AUTH_JSON', extra))
    for mode, name, secret in logins:
        raw = os.environ.get(name)
        if not raw:
            continue
        mask(raw)
        try:
            if mode == 'siwc':
                refresh_siwc(raw)
            else:
                refresh_codex_login(raw, secret)
        except (AuthFailure, siwc.NeedsLogin) as error:
            report(mode, f'{secret}: {error}', 'auth', secret)
            failed = True
        except RefreshFailure as error:
            report(mode, f'{secret}: {error}', 'operational', secret)
            failed = True
        except Exception:
            report(mode, f'{secret}: Refresh could not be completed; check credentials format, token endpoint, network and tools', 'operational', secret)
            failed = True
    return int(failed)


if __name__ == '__main__':
    sys.exit(main())
