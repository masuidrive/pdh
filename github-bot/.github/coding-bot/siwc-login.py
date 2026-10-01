#!/usr/bin/env python3
"""Create a bot SIWC login locally and save CODING_BOT_CODEX_SIWC_JSON via gh.

Approve in your browser, then use the loopback callback or paste its full URL.
This is an OAuth credential tool, not an OIDC identity-verification service.
"""
import argparse
import base64
import hashlib
import importlib.util
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
from pathlib import Path
import queue
import secrets
import subprocess
import sys
import threading
import time
import urllib.parse
import uuid

_spec = importlib.util.spec_from_file_location('siwc_token', Path(__file__).with_name('siwc-token.py'))
_token = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_token)
atomic_write = _token.atomic_write
credential_lock = _token.credential_lock
credentials_from_response = _token.credentials_from_response
issued_client = _token.issued_client
token_request = _token.token_request


def github_api(repo, suffix, *args):
    result = subprocess.run(['gh', 'api', 'repos/' + repo + suffix, *args],
                            capture_output=True, text=True, timeout=60)
    if result.returncode:
        raise RuntimeError('GitHub API unavailable')
    return result.stdout.strip()


def wait_for_publication(repo):
    """Do not permit retry with an unexpired cache belonging to the old login."""
    metadata = json.loads(github_api(repo, '/actions/secrets/CODING_BOT_CODEX_SIWC_JSON'))
    branch = github_api(repo, '', '--jq', '.default_branch')
    # Secret/run timestamps have seconds precision; ensure a fresh snapshot.
    time.sleep(2)
    github_api(repo, '/actions/workflows/coding-bot-codex-auth.yml/dispatches',
               '--method', 'POST', '-f', 'ref=' + branch)
    deadline = time.monotonic() + 600
    while time.monotonic() < deadline:
        try:
            access = json.loads(github_api(repo, '/actions/variables/CODING_BOT_CODEX_SIWC_ACCESS'))
            if access.get('value') and access['updated_at'] > metadata['updated_at']:
                return
        except (RuntimeError, ValueError, KeyError):
            pass  # Missing initial variable / transient API failure: bounded wait.
        time.sleep(5)
    raise RuntimeError('SIWC publication timeout')

AUTHORIZE_URL = 'https://auth.openai.com/api/accounts/authorize'
RESOURCE = 'https://api.openai.com/v1'
SCOPE = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'


def parse_callback(url, redirect_uri, state, stored_client):
    parsed = urllib.parse.urlsplit(url)
    expected = urllib.parse.urlsplit(redirect_uri)
    if (parsed.scheme, parsed.netloc, parsed.path) != (
            expected.scheme, expected.netloc, expected.path) or parsed.fragment:
        raise ValueError('Unexpected redirect URI')
    query = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
    if any(len(values) != 1 for values in query.values()):
        raise ValueError('Duplicate callback parameter')
    if not secrets.compare_digest(query.get('state', [''])[0], state):
        raise ValueError('Callback state mismatch')
    if 'error' in query:
        raise ValueError('Authorization declined or failed')
    code = query.get('code', [''])[0]
    if not code:
        raise ValueError('Callback missing code')
    client = query.get('client_id', [stored_client])[0]
    issued_client(client)
    if stored_client and client != stored_client:
        raise ValueError('Callback client_id changed')
    return code, client


def wait_callback(port, state, verifier, nonce, host_id, client, name):
    arrivals = queue.Queue(maxsize=1)

    def offer(url):
        try:
            arrivals.put_nowait(url)
        except queue.Full:
            pass

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # Default HTTP logs would expose the authorization code.

        def do_GET(self):
            if urllib.parse.urlsplit(self.path).path != '/callback':
                self.send_error(404)
                return
            offer(redirect_uri + self.path[len('/callback'):])
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain')
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(b'Callback received. Check the terminal.\n')

    server = HTTPServer(('127.0.0.1', port), Handler)
    redirect_uri = 'http://127.0.0.1:%d/callback' % server.server_port
    params = dict(client_id=client or 'dynamic_agent_client',
                  ext_agent_host_id=host_id, response_type='code', scope=SCOPE,
                  resource=RESOURCE, state=state, nonce=nonce,
                  code_challenge=base64.urlsafe_b64encode(
                      hashlib.sha256(verifier.encode('ascii')).digest()).decode().rstrip('='),
                  code_challenge_method='S256', redirect_uri=redirect_uri)
    if not client:
        params['agent_name_hint'] = name
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()

    def read_stdin():
        for line in sys.stdin:
            if line.strip():
                offer(line.strip())
                return

    threading.Thread(target=read_stdin, daemon=True).start()
    try:
        print(AUTHORIZE_URL + '?' + urllib.parse.urlencode(params), flush=True)
        print('Approve in a browser; waiting for callback or pasted full redirect URL.',
              file=sys.stderr, flush=True)
        code, issued = parse_callback(arrivals.get(), redirect_uri, state, client)
        return code, issued, redirect_uri
    finally:
        server.shutdown()
        server.server_close()
        worker.join()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', required=True, help='GitHub owner/repository')
    parser.add_argument('--secret', choices=['CODING_BOT_CODEX_SIWC_JSON'],
                        default='CODING_BOT_CODEX_SIWC_JSON')
    parser.add_argument('--creds', type=Path, help='Local 0600 credentials file; reuse it for re-login')
    parser.add_argument('--port', type=int, default=1455)
    parser.add_argument('--name', default='coding-bot')
    args = parser.parse_args()
    try:
        parts = args.repo.split('/')
        if len(parts) != 2 or any(not part or part in ('.', '..') or not all(
                char.isalnum() or char in '_.-' for char in part) for part in parts):
            raise ValueError('Invalid GitHub repository')
        if args.creds is None:
            args.creds = Path.home() / '.local/state/coding-bot/siwc' / parts[0] / (parts[1] + '.json')
        args.creds.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with credential_lock(args.creds):
            if args.creds.exists():
                args.creds.chmod(0o600)
            old = json.loads(args.creds.read_text()) if args.creds.exists() else {}
            client = old.get('client_id')
            if client:
                issued_client(client)
            host_id = old.get('ext_agent_host_id')
            if not host_id:
                host_id = 'urn:uuid:' + str(uuid.uuid4())
                old['ext_agent_host_id'] = host_id
                # Persist host identity even if the first sign-in is interrupted.
                atomic_write(args.creds, old)
            if not host_id.startswith('urn:uuid:') or uuid.UUID(host_id[9:]).version != 4:
                raise ValueError('Invalid host UUID')
            state, nonce, verifier = (secrets.token_urlsafe(32) for _ in range(3))
            code, client, redirect_uri = wait_callback(
                args.port, state, verifier, nonce, host_id, client, args.name)
            result = token_request(dict(grant_type='authorization_code', client_id=client,
                                        code=code, code_verifier=verifier,
                                        redirect_uri=redirect_uri, resource=RESOURCE))
            creds = credentials_from_response(
                dict(client_id=client, ext_agent_host_id=host_id), result)
            atomic_write(args.creds, creds)
            # stdin keeps token values out of process argv; suppress gh output too.
            result = subprocess.run(
                ['gh', 'secret', 'set', args.secret, '--repo', args.repo],
                input=json.dumps(creds), text=True, stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL, timeout=60)
            if result.returncode:
                print('Could not save CODING_BOT_CODEX_SIWC_JSON. Credentials retained in %s; '
                      'retry: gh secret set CODING_BOT_CODEX_SIWC_JSON --repo %s < %s' %
                      (args.creds, args.repo, args.creds), file=sys.stderr)
                return 1
            # Retain identity only: the updater owns the rotating credentials.
            atomic_write(args.creds, {key: creds[key] for key in ('client_id', 'ext_agent_host_id')})
            print('Saved SIWC login; waiting for coding-bot-codex-auth access publication.', file=sys.stderr)
        try:
            wait_for_publication(args.repo)
        except Exception:
            print('Secret saved, but access publication could not be confirmed. Check coding-bot-codex-auth '
                  'workflow, Actions/Variables permissions and queue; do not retry the bot until new access '
                  'is published. Dispatch the updater again after resolving the cause.', file=sys.stderr)
            return 1
        print('New SIWC access published for %s; retry the bot with 🤖.' % args.repo)
        return 0
    except KeyboardInterrupt:
        print('Login cancelled.', file=sys.stderr)
        return 1
    except Exception:
        print('SIWC login failed: callback, credentials, scope/JWT, endpoint, or I/O invalid.',
              file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
