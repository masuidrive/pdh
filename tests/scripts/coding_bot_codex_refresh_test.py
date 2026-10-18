"""Refresh ownership, rotated-token persistence, and queued-snapshot contracts."""
import base64
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import json
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(os.environ['PDH_TEST_ROOT'])
SCRIPT = ROOT / '.github/coding-bot/codex-refresh.py'
DIRECT = 'chatgpt.tokens.use.direct'


def jwt(lifetime=3600):
    def encode(obj):
        return base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip('=')
    return encode({'alg': 'RS256'}) + '.' + encode({'scope': DIRECT, 'exp': time.time() + lifetime}) + '.c2ln'


FAKE_GH = '''#!/usr/bin/env python3
import json, os, pathlib, sys
p = pathlib.Path(os.environ['CASE_DIR'])
a = sys.argv[1:]
with (p / 'calls').open('a') as f: f.write(json.dumps(a[:3]) + '\\n')
if a[:2] == ['secret', 'set']:
    count = int((p / 'attempts').read_text()) + 1
    (p / 'attempts').write_text(str(count))
    value = sys.stdin.read()
    if count <= int(os.environ.get('FAIL_SAVES', '0')):
        print('sensitive-cli-output', file=sys.stderr); sys.exit(1)
    (p / a[2]).write_text(value)
elif a[:2] == ['variable', 'set']:
    if os.environ.get('FAIL_PUBLISH'): sys.exit(1)
    (p / a[2]).write_text(sys.stdin.read())
elif a[0] == 'api':
    route = a[1]
    if route.endswith('/actions/variables/CODING_BOT_CODEX_SIWC_ACCESS'):
        variable = p / 'CODING_BOT_CODEX_SIWC_ACCESS'
        if not variable.exists(): print('HTTP 404', file=sys.stderr); sys.exit(1)
        assert os.environ['GH_TOKEN'] == 'write-pat'
        print(json.dumps({'value': variable.read_text(), 'updated_at': os.environ.get('VARIABLE_UPDATED_AT', '2026-09-29T01:00:00Z')}))
    elif '/actions/secrets/' in route:
        assert os.environ['GH_TOKEN'] == 'write-pat'
        if os.environ.get('METADATA_FAIL'): sys.exit(1)
        print(json.dumps({'updated_at': os.environ.get('UPDATED_AT', '2026-09-29T00:00:00Z')}))
    elif '/actions/runs/' in route:
        assert os.environ['GH_TOKEN'] == 'dispatch-token'
        print(json.dumps({'created_at': os.environ.get('RUN_CREATED_AT', '2026-09-30T00:00:00Z')}))
    elif route.endswith('/dispatches'): (p / 'dispatched').touch()
    elif route == 'repos/example/project': print('main')
    elif route.endswith('/issues'):
        if 'POST' in a: (p / 'issue').write_text(sys.stdin.read() or next((s[5:] for s in a if s.startswith('body=')), 'created')); print('1')
        else: print('[]')
    elif '/issues/' in route: (p / 'issue').write_text(str(a))
elif a[:2] == ['issue', 'list']: print('[]')
elif a[:2] == ['issue', 'create'] or a[:2] == ['issue', 'comment']:
    (p / 'issue').write_text(str(a)); print('https://example/1')
'''

FAKE_CODEX = '''#!/usr/bin/env python3
import base64, datetime, json, os, pathlib, sys, time
p = pathlib.Path(os.environ['CASE_DIR'])
(p / 'codex-called').touch()
if sys.argv[1:] == ['login', 'status']: print('Logged in using ChatGPT'); sys.exit(0)
auth = pathlib.Path(os.environ['CODEX_HOME']) / 'auth.json'
a = json.loads(auth.read_text())
assert a['last_refresh'] < '2020-01-01'
# Codex 0.159.2 checks access exp first; last_refresh alone does not force
# refresh when the JWT still has its ordinary ten-day lifetime.
exp = json.loads(base64.urlsafe_b64decode(a['tokens']['access_token'].split('.')[1] + '=='))['exp']
(p / 'probe-access-expiry').write_text(str(exp))
if exp > time.time() + 300: sys.exit(0)
behavior = os.environ.get('CODEX_BEHAVIOR', 'rotate')
if behavior == 'rotate': a['tokens']['refresh_token'] = 'new-codex-refresh'; a['last_refresh'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
elif behavior == 'rotate-stale': a['tokens']['refresh_token'] = 'new-codex-refresh'
elif behavior == 'rotate-no-access': a['tokens']['refresh_token'] = 'new-codex-refresh'; a['last_refresh'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
elif behavior in ('rotate-empty-access', 'rotate-missing-access'):
    a['tokens']['refresh_token'] = 'new-codex-refresh'; a['last_refresh'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    if behavior == 'rotate-empty-access': a['tokens']['access_token'] = ''
    else: a['tokens'].pop('access_token')
elif behavior == 'account': a['tokens']['account_id'] = 'different'; a['tokens']['refresh_token'] = 'new-codex-refresh'
elif behavior == 'api': a['auth_mode'] = 'api'; a['tokens']['refresh_token'] = 'new-codex-refresh'
if behavior not in ('unchanged', 'rotate-no-access', 'rotate-empty-access', 'rotate-missing-access'):
    a['tokens']['access_token'] = os.environ['CODEX_TEST_FRESH_ACCESS']
auth.write_text(json.dumps(a))
sys.exit(int(os.environ.get('CODEX_RC', '0')))
'''

FAKE_BASH = '''#!/usr/bin/env python3
import os, sys
if sys.argv[1].endswith('/codex-requirements.sh'):
    assert os.environ['CODING_BOT_CODEX_AUTH_MODE'] == 'codex-login'
    assert 'OPENAI_API_KEY' not in os.environ
    sys.exit(0)
os.execv('/bin/bash', ['bash', *sys.argv[1:]])
'''


class RefreshTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)
        (self.path / 'bin').mkdir()
        # Policy placement is covered by the requirements tests. Stub only that
        # subprocess here so refresh tests never write the host's /etc policy.
        for name, body in [('gh', FAKE_GH), ('codex', FAKE_CODEX), ('bash', FAKE_BASH)]:
            executable = self.path / 'bin' / name
            executable.write_text(body)
            executable.chmod(0o755)
        (self.path / 'attempts').write_text('0')
        (self.path / 'calls').touch()
        self.requests = []
        self.response = dict(access_token=jwt(), refresh_token='rotated-siwc-refresh',
                             id_token='new-id', scope=DIRECT, expires_in=3600)
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                owner.requests.append(self.rfile.read(int(self.headers['Content-Length'])))
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps(owner.response).encode())

        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        self.creds = dict(client_id='oaiapp_test', ext_agent_host_id='urn:uuid:test',
                          refresh_token='old-siwc-refresh', access_token=jwt(),
                          id_token='old-id', expires_at=time.time() - 1, scope=DIRECT)
        self.env = dict(os.environ, CASE_DIR=str(self.path), PATH=str(self.path / 'bin') + ':' + os.environ['PATH'],
                        GITHUB_REPOSITORY='example/project', GITHUB_RUN_ID='11',
                        GITHUB_TOKEN='dispatch-token', CODING_BOT_GH_PAT='write-pat',
                        GITHUB_DEFAULT_BRANCH='main', CODING_BOT_CODEX_SIWC_KEY='test-encryption-key',
                        CODING_BOT_CODEX_SIWC_JSON=json.dumps(self.creds),
                        CODING_BOT_CODEX_AUTH_JSON='', SIWC_TOKEN_URL=f'http://127.0.0.1:{server.server_port}',
                        CODEX_TEST_FRESH_ACCESS=jwt(10 * 86400),
                        CODING_BOT_AUTH_ISSUE_SERIALIZED='true', CODING_BOT_REFRESH_RETRY_DELAY='0')
        self.env.pop('GITHUB_ACTIONS', None)

    def run_refresh(self, **env):
        result = subprocess.run(['python3', str(SCRIPT)], env=dict(self.env, **env),
                                capture_output=True, text=True, timeout=20)
        for secret in ('old-siwc-refresh', 'rotated-siwc-refresh', 'new-id', 'sensitive-cli-output', 'write-pat'):
            self.assertNotIn(secret, result.stdout + result.stderr)
        return result

    def access_value(self):
        encrypted = (self.path / 'CODING_BOT_CODEX_SIWC_ACCESS').read_bytes()
        result = subprocess.run(['openssl', 'enc', '-d', '-aes-256-cbc', '-pbkdf2', '-iter', '100000', '-a', '-A',
                                 '-pass', 'env:CODING_BOT_CODEX_SIWC_KEY'], input=encrypted,
                                env=self.env, capture_output=True, check=True)
        return json.loads(result.stdout)

    def test_rotation_saved_before_access_publish_and_no_refresh_in_variable(self):
        self.assertEqual(self.run_refresh().returncode, 0)
        self.assertEqual(json.loads((self.path / 'CODING_BOT_CODEX_SIWC_JSON').read_text())['refresh_token'], self.response['refresh_token'])
        access = self.access_value()
        self.assertEqual(access['access_token'], self.response['access_token'])
        self.assertNotIn('refresh_token', access)
        self.assertNotIn('id_token', access)
        calls = [json.loads(line) for line in (self.path / 'calls').read_text().splitlines()]
        self.assertLess(calls.index(['secret', 'set', 'CODING_BOT_CODEX_SIWC_JSON']), calls.index(['variable', 'set', 'CODING_BOT_CODEX_SIWC_ACCESS']))

    def test_writeback_retries_and_permanent_failure_reports_issue(self):
        for failures, success in [('2', True), ('10', False)]:
            with self.subTest(failures=failures):
                (self.path / 'attempts').write_text('0')
                (self.path / 'CODING_BOT_CODEX_SIWC_ACCESS').unlink(missing_ok=True)
                result = self.run_refresh(FAIL_SAVES=failures)
                self.assertEqual(result.returncode == 0, success)
                self.assertEqual((self.path / 'attempts').read_text(), '4' if success else '3')
                self.assertEqual((self.path / 'CODING_BOT_CODEX_SIWC_ACCESS').exists(), success)
                if not success:
                    self.assertTrue((self.path / 'issue').exists())

    def test_rotated_refresh_survives_invalid_access_response(self):
        self.response['access_token'] = 'sk-must-reject'
        self.assertNotEqual(self.run_refresh().returncode, 0)
        saved = json.loads((self.path / 'CODING_BOT_CODEX_SIWC_JSON').read_text())
        self.assertEqual(saved['refresh_token'], 'rotated-siwc-refresh')
        self.assertFalse((self.path / 'CODING_BOT_CODEX_SIWC_ACCESS').exists())

    def test_serialized_dispatches_read_latest_access_after_workflow_lock(self):
        # The workflow lock belongs to Actions; simulate only that external contract.
        lock = threading.Lock()

        def dispatch(_):
            with lock:
                return self.run_refresh().returncode

        with ThreadPoolExecutor(max_workers=5) as pool:
            self.assertEqual(list(pool.map(dispatch, range(5))), [0] * 5)
        self.assertEqual(len(self.requests), 1)

    def test_stale_and_same_second_secret_snapshots_dispatch_fresh_run(self):
        for updated in ['2026-09-30T00:00:01Z', '2026-09-30T00:00:00Z']:
            with self.subTest(updated=updated):
                self.assertEqual(self.run_refresh(UPDATED_AT=updated).returncode, 0)
                self.assertTrue((self.path / 'dispatched').exists())
                self.assertEqual(self.requests, [])

    def test_metadata_unavailable_fails_closed(self):
        self.assertNotEqual(self.run_refresh(METADATA_FAIL='true').returncode, 0)
        self.assertEqual(self.requests, [])
        self.assertTrue((self.path / 'issue').exists())

    def test_missing_encryption_prerequisites_do_not_consume_refresh_token(self):
        isolated_path = self.path / 'bin'
        (isolated_path / 'python3').symlink_to(sys.executable)
        for tool in ('jq', 'timeout'):
            (isolated_path / tool).symlink_to(shutil.which(tool))
        for override in [dict(CODING_BOT_CODEX_SIWC_KEY=''), dict(PATH=str(isolated_path))]:
            with self.subTest(override=override):
                self.requests.clear()
                (self.path / 'CODING_BOT_CODEX_SIWC_JSON').unlink(missing_ok=True)
                (self.path / 'issue').unlink(missing_ok=True)
                result = self.run_refresh(**override)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.requests, [])
                self.assertFalse((self.path / 'CODING_BOT_CODEX_SIWC_JSON').exists())
                self.assertTrue((self.path / 'issue').exists())

    def test_valid_secret_access_recovers_non_object_cache_json(self):
        self.creds['expires_at'] = time.time() + 3600
        for cached in ('[]', 'null', 'true'):
            with self.subTest(cached=cached):
                result = subprocess.run(['openssl', 'enc', '-aes-256-cbc', '-pbkdf2', '-iter', '100000', '-a', '-A',
                                         '-salt', '-pass', 'env:CODING_BOT_CODEX_SIWC_KEY'], input=cached,
                                        env=self.env, text=True, capture_output=True, check=True)
                (self.path / 'CODING_BOT_CODEX_SIWC_ACCESS').write_text(result.stdout)
                self.assertEqual(self.run_refresh(CODING_BOT_CODEX_SIWC_JSON=json.dumps(self.creds)).returncode, 0)
                self.assertEqual(self.access_value()['access_token'], self.creds['access_token'])
                self.assertEqual(self.requests, [])

    def test_earliest_refresh_at_prevents_early_refresh(self):
        self.creds['earliest_refresh_at'] = time.time() + 60
        self.assertEqual(self.run_refresh(CODING_BOT_CODEX_SIWC_JSON=json.dumps(self.creds)).returncode, 0)
        self.assertEqual(self.requests, [])

    def test_short_lifetime_refresh_waits_for_server_earliest_time(self):
        self.response['expires_in'] = 10
        self.response['earliest_refresh_at'] = time.time() + 5
        self.assertEqual(self.run_refresh().returncode, 0)
        access = self.access_value()
        self.assertLessEqual(access['expires_at'] - access['obtained_at'], 10)
        self.assertEqual(access['earliest_refresh_at'], self.response['earliest_refresh_at'])
        saved = json.loads((self.path / 'CODING_BOT_CODEX_SIWC_JSON').read_text())
        self.assertEqual(saved['earliest_refresh_at'], self.response['earliest_refresh_at'])
        self.assertEqual(self.run_refresh().returncode, 0)
        self.assertEqual(len(self.requests), 1)

    def test_initial_login_access_published_before_earliest_refresh_time(self):
        for lifetime in [3600, 600, 300]:
            with self.subTest(lifetime=lifetime):
                (self.path / 'CODING_BOT_CODEX_SIWC_ACCESS').unlink(missing_ok=True)
                self.creds['expires_at'] = time.time() + lifetime
                self.creds['earliest_refresh_at'] = time.time() + 120
                result = self.run_refresh(CODING_BOT_CODEX_SIWC_JSON=json.dumps(self.creds))
                self.assertEqual(result.returncode, 0)
                if lifetime > 360:
                    self.assertEqual(self.access_value()['access_token'], self.creds['access_token'])
                else:
                    self.assertFalse((self.path / 'CODING_BOT_CODEX_SIWC_ACCESS').exists())
                self.assertEqual(self.requests, [])

    def test_failed_publication_recovers_complete_saved_state_without_rotation(self):
        result = self.run_refresh(FAIL_PUBLISH='true')
        self.assertNotEqual(result.returncode, 0)
        saved = json.loads((self.path / 'CODING_BOT_CODEX_SIWC_JSON').read_text())
        self.assertEqual(saved['access_token'], self.response['access_token'])
        self.assertGreater(saved['expires_at'], time.time() + 1200)
        self.assertEqual(self.run_refresh(CODING_BOT_CODEX_SIWC_JSON=json.dumps(saved)).returncode, 0)
        self.assertEqual(len(self.requests), 1)
        self.assertEqual(self.access_value()['access_token'], self.response['access_token'])

    def test_relogin_replaces_unexpired_old_cache_without_refresh(self):
        self.assertEqual(self.run_refresh().returncode, 0)
        self.requests.clear()
        fresh = dict(self.creds, client_id='oaiapp_new_login', access_token=jwt(),
                     refresh_token='new-login-refresh', expires_at=time.time() + 3600)
        for cached_at in ('2026-09-29T01:00:00Z', '2026-09-30T00:00:01Z'):
            with self.subTest(cached_at=cached_at):
                result = self.run_refresh(CODING_BOT_CODEX_SIWC_JSON=json.dumps(fresh),
                                          UPDATED_AT='2026-09-30T00:00:01Z',
                                          VARIABLE_UPDATED_AT=cached_at,
                                          RUN_CREATED_AT='2026-09-30T00:00:02Z')
                self.assertEqual(result.returncode, 0)
                self.assertEqual(self.access_value()['access_token'], fresh['access_token'])
                self.assertEqual(self.requests, [])

    def test_stale_snapshot_does_not_republish_cache_older_than_relogin(self):
        self.assertEqual(self.run_refresh().returncode, 0)
        previous = (self.path / 'CODING_BOT_CODEX_SIWC_ACCESS').read_bytes()
        self.requests.clear()
        self.assertEqual(self.run_refresh(UPDATED_AT='2026-09-30T00:00:01Z').returncode, 0)
        self.assertTrue((self.path / 'dispatched').exists())
        self.assertEqual((self.path / 'CODING_BOT_CODEX_SIWC_ACCESS').read_bytes(), previous)
        self.assertEqual(self.requests, [])

    def test_workflow_queues_dispatches_and_daily_refresh(self):
        workflow = (ROOT / '.github/workflows/coding-bot-codex-auth.yml').read_text()
        self.assertIn('queue: max', workflow)
        self.assertIn('group: coding-bot-codex-auth', workflow)
        self.assertIn('schedule:', workflow)
        self.assertIn('workflow_dispatch:', workflow)
        self.assertNotIn('cancel-in-progress: true', workflow)

    def codex_creds(self):
        old = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
        return dict(auth_mode='chatgpt', tokens=dict(access_token=jwt(10 * 86400), refresh_token='codex-refresh', account_id='account', id_token='id'), last_refresh=old)

    def test_daily_codex_refresh_ahead_and_retry_on_writeback(self):
        result = self.run_refresh(CODING_BOT_CODEX_SIWC_JSON='', CODING_BOT_CODEX_AUTH_JSON=json.dumps(self.codex_creds()), FAIL_SAVES='2')
        self.assertEqual(result.returncode, 0, result.stderr)
        saved = json.loads((self.path / 'CODING_BOT_CODEX_AUTH_JSON').read_text())
        self.assertEqual(saved['tokens']['refresh_token'], 'new-codex-refresh')
        self.assertEqual(saved['tokens']['access_token'], self.env['CODEX_TEST_FRESH_ACCESS'])
        self.assertLessEqual(float((self.path / 'probe-access-expiry').read_text()), time.time())
        self.assertEqual((self.path / 'attempts').read_text(), '3')

    def test_extra_login_uses_same_rotation_safety_and_own_secret(self):
        for behavior, saved in [('rotate', True), ('account', False), ('api', False),
                                ('rotate-missing-access', True)]:
            with self.subTest(behavior=behavior):
                target = self.path / 'EXTRA_CODEX_AUTH_JSON'
                target.unlink(missing_ok=True)
                result = self.run_refresh(
                    CODING_BOT_CODEX_SIWC_JSON='',
                    CODING_BOT_CODEX_EXTRA_LOGIN_SECRET='EXTRA_CODEX_AUTH_JSON',
                    CODING_BOT_CODEX_EXTRA_AUTH_JSON=json.dumps(self.codex_creds()),
                    CODEX_BEHAVIOR=behavior)
                self.assertEqual(result.returncode == 0, behavior == 'rotate')
                self.assertEqual(target.exists(), saved)
                self.assertFalse((self.path / 'CODING_BOT_CODEX_AUTH_JSON').exists())
                calls = (self.path / 'calls').read_text()
                self.assertIn('/actions/secrets/EXTRA_CODEX_AUTH_JSON', calls)
                if saved:
                    self.assertEqual(json.loads(target.read_text())['tokens']['refresh_token'], 'new-codex-refresh')

    def test_extra_login_save_failure_reports_correct_relogin_secret(self):
        result = self.run_refresh(
            CODING_BOT_CODEX_SIWC_JSON='', FAIL_SAVES='10',
            CODING_BOT_CODEX_EXTRA_LOGIN_SECRET='EXTRA_CODEX_AUTH_JSON',
            CODING_BOT_CODEX_EXTRA_AUTH_JSON=json.dumps(self.codex_creds()))
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.path / 'attempts').read_text(), '3')
        self.assertIn('gh secret set EXTRA_CODEX_AUTH_JSON', (self.path / 'issue').read_text())

    def test_extra_login_snapshot_and_recent_refresh_guards(self):
        initial = self.codex_creds()
        for recent in (False, True):
            with self.subTest(recent=recent):
                if recent:
                    initial['last_refresh'] = datetime.now(timezone.utc).isoformat()
                result = self.run_refresh(
                    CODING_BOT_CODEX_SIWC_JSON='', UPDATED_AT='2026-09-30T00:00:01Z',
                    CODING_BOT_CODEX_EXTRA_LOGIN_SECRET='EXTRA_CODEX_AUTH_JSON',
                    CODING_BOT_CODEX_EXTRA_AUTH_JSON=json.dumps(initial))
                self.assertEqual(result.returncode, 0)
                self.assertFalse((self.path / 'EXTRA_CODEX_AUTH_JSON').exists())
                self.assertFalse((self.path / 'codex-called').exists())
                if not recent:
                    self.assertTrue((self.path / 'dispatched').exists())
                else:
                    self.assertIn('less than 20 hours', result.stdout)

    def test_extra_login_is_not_exposed_to_codex_child(self):
        binary = self.path / 'bin/codex'
        binary.write_text(FAKE_CODEX.replace(
            'import base64, datetime, json, os, pathlib, sys, time',
            'import base64, datetime, json, os, pathlib, sys, time\n'
            "assert 'CODING_BOT_CODEX_EXTRA_AUTH_JSON' not in os.environ"))
        result = self.run_refresh(
            CODING_BOT_CODEX_SIWC_JSON='',
            CODING_BOT_CODEX_EXTRA_LOGIN_SECRET='EXTRA_CODEX_AUTH_JSON',
            CODING_BOT_CODEX_EXTRA_AUTH_JSON=json.dumps(self.codex_creds()))
        self.assertEqual(result.returncode, 0)
        self.assertTrue((self.path / 'EXTRA_CODEX_AUTH_JSON').exists())

    def test_recent_codex_login_skips_before_snapshot_api(self):
        initial = self.codex_creds()
        initial['last_refresh'] = datetime.now(timezone.utc).isoformat()
        result = self.run_refresh(CODING_BOT_CODEX_SIWC_JSON='', CODING_BOT_CODEX_AUTH_JSON=json.dumps(initial), METADATA_FAIL='true')
        self.assertEqual(result.returncode, 0)
        self.assertIn('less than 20 hours', result.stdout)
        self.assertFalse((self.path / 'dispatched').exists())

    def test_install_failure_does_not_prevent_siwc_refresh(self):
        result = self.run_refresh(CODING_BOT_CODEX_INSTALL_FAILED='true',
                                  CODING_BOT_CODEX_AUTH_JSON=json.dumps(self.codex_creds()))
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(len(self.requests), 1)
        self.assertEqual(self.access_value()['access_token'], self.response['access_token'])
        self.assertIn('Codex installation failed', result.stdout)

    def test_probe_has_no_github_or_siwc_credentials(self):
        # Assert at the actual child-process boundary, alongside rotation checks.
        binary = self.path / 'bin/codex'
        binary.write_text(FAKE_CODEX.replace("import base64, datetime, json, os, pathlib, sys, time", "import base64, datetime, json, os, pathlib, sys, time\n" +
            "assert not any(k in os.environ for k in ('CODING_BOT_CODEX_SIWC_JSON','CODING_BOT_CODEX_SIWC_KEY','CODING_BOT_GH_PAT','GITHUB_TOKEN','GH_TOKEN','CODING_BOT_CODEX_AUTH_JSON'))"))
        result = self.run_refresh(CODING_BOT_CODEX_AUTH_JSON=json.dumps(self.codex_creds()),
                                  CODING_BOT_CODEX_SIWC_JSON='', GH_TOKEN='fake-sensitive')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_saved_rotation_with_failed_provider_probe_is_operational(self):
        result = self.run_refresh(CODING_BOT_CODEX_SIWC_JSON='', CODING_BOT_CODEX_AUTH_JSON=json.dumps(self.codex_creds()), CODEX_RC='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue((self.path / 'CODING_BOT_CODEX_AUTH_JSON').exists())
        self.assertIn('refresh succeeded and credentials were saved', result.stdout)
        self.assertNotIn('re-login', result.stdout)

    def test_publication_timeout_preserves_accurate_saved_secret_diagnostic(self):
        spec = importlib.util.spec_from_file_location('refresh', SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with patch.dict(os.environ, self.env), patch.object(module, 'crypt', return_value='encrypted'), \
             patch.object(module, 'command', side_effect=subprocess.TimeoutExpired('gh', 65)):
            with self.assertRaisesRegex(module.RefreshFailure, 'publication timed out; refresh token was saved'):
                module.publish_access(self.creds)

    def test_codex_refresh_guard_and_failed_probe_rotation(self):
        for behavior, rc, saved in [('account', '0', False), ('api', '0', False), ('unchanged', '0', False), ('rotate-no-access', '0', True), ('rotate-empty-access', '0', True), ('rotate-missing-access', '0', True), ('rotate', '1', True), ('rotate-stale', '0', True)]:
            with self.subTest(behavior=behavior):
                (self.path / 'CODING_BOT_CODEX_AUTH_JSON').unlink(missing_ok=True)
                (self.path / 'issue').unlink(missing_ok=True)
                original = self.codex_creds()
                result = self.run_refresh(CODING_BOT_CODEX_SIWC_JSON='', CODING_BOT_CODEX_AUTH_JSON=json.dumps(original), CODEX_BEHAVIOR=behavior, CODEX_RC=rc)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual((self.path / 'CODING_BOT_CODEX_AUTH_JSON').exists(), saved)
                if behavior in ('rotate-no-access', 'rotate-empty-access', 'rotate-missing-access'):
                    recovered = json.loads((self.path / 'CODING_BOT_CODEX_AUTH_JSON').read_text())
                    self.assertEqual(recovered['tokens']['refresh_token'], 'new-codex-refresh')
                    self.assertEqual(recovered['tokens']['access_token'], original['tokens']['access_token'])
                    self.assertTrue((self.path / 'issue').exists())


if __name__ == '__main__':
    unittest.main()
