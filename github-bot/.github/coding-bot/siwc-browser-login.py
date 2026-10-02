#!/usr/bin/env python3
"""Two workflow dispatches for SIWC; no refresh-token grants here."""
import argparse
import html
import importlib.util
import json
import os
from pathlib import Path
import secrets
import sys
import time
import urllib.parse


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'),
                                               Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


login = load('siwc-login')
refresh = load('codex-refresh')
REDIRECT_URI = f'http://127.0.0.1:{login.DEFAULT_PORT}/callback'
RESTART = '「ChatGPT 認証後の localhost アドレス」の欄を空にして、入力なしで起動し直すことをお願いします。'
NEXT = ('承認すると `http://127.0.0.1:…` のページに移り、開けない（エラー）と表示されますが、それで正しい状態です。'
        'そのときブラウザのアドレス欄にある URL を丸ごとコピーしてください。\n\n'
        '貼る場所: [この workflow のページ]({workflow_url}) を開き、run の一覧の上にある「Run workflow ▾」を押すと入力欄が開きます。'
        '「ChatGPT 認証後の localhost アドレス」にコピーした URL を貼り、緑の「Run workflow」を押してください。'
        'スマホの GitHub アプリにはこのボタンが無いので、ブラウザで開いてください。')


def summary(message):
    with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as out:
        out.write(message + '\n\n')


def read_inputs():
    event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text())
    inputs = event.get('inputs') or {}
    url = inputs.get('callback_url', '')
    if isinstance(url, str):
        url = url.strip()
    refresh.mask(url)
    if isinstance(url, str):
        try:
            query = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query, keep_blank_values=True)
            for name in ('code', 'state'):
                for value in query.get(name, []):
                    refresh.mask(value)
        except ValueError:
            pass
    return url, inputs.get('recreate_client') in (True, 'true')


def prepare(recreate):
    repo = os.environ['GITHUB_REPOSITORY']
    if not os.environ.get('CODING_BOT_CODEX_SIWC_KEY'):
        # A queued run cannot read a key created after its secret snapshot.
        # Never overwrite such a key: a new dispatch will capture it.
        existing = refresh.api(f'repos/{repo}/actions/secrets/CODING_BOT_CODEX_SIWC_KEY', missing=True)
        if existing is not None:
            summary('鍵が別の起動で作られました。' + RESTART)
            return 1
        key = secrets.token_hex(32)
        refresh.mask(key)
        refresh.save_secret('CODING_BOT_CODEX_SIWC_KEY', key)
        os.environ['CODING_BOT_CODEX_SIWC_KEY'] = key
        summary('復号鍵を作り、secret に保存しました。')
        if os.environ.get('CODING_BOT_CODEX_SIWC_JSON'):
            summary('既存のログインがあります。承認をやり直すと access も置き直されます。'
                    '承認せず Actions の「Coding Bot Codex Authentication」を入力なしで起動しても、access を置き直せます。')
    try:
        previous = json.loads(os.environ.get('CODING_BOT_CODEX_SIWC_JSON') or '{}')
    except ValueError:
        previous = {}
    identity = login.client_identity(repo, local=previous, recreate=recreate)
    redirect = login.redirect_uri(identity)
    state, nonce, verifier = (secrets.token_urlsafe(32) for _ in range(3))
    # The runner scrubs summaries too: masking state/nonce breaks this link.
    refresh.mask(verifier)
    pending = dict(identity, state=state, nonce=nonce, code_verifier=verifier,
                   created_at=time.time(), redirect_uri=redirect)
    refresh.set_variable(refresh.PENDING_VARIABLE, refresh.crypt(json.dumps(pending)),
                         token=os.environ['CODING_BOT_GH_PAT'])
    url = login.authorization_url(redirect, state, verifier, nonce,
                                  identity['ext_agent_host_id'], identity.get('client_id'))
    # OAuth needs state/nonce in this URL. They are never logged separately.
    workflow_url = f"https://github.com/{os.environ.get('GITHUB_REPOSITORY', '')}/actions/workflows/coding-bot-codex-siwc-login.yml"
    summary(f'[ChatGPT の承認画面を開く]({url})\n\n{NEXT.format(workflow_url=workflow_url)}\n\n承認 URL は 15 分間有効です。最後に入力なしで起動したログインだけが使えます。')
    return 0


def previous_login():
    repo = os.environ['GITHUB_REPOSITORY']
    raw = os.environ.get('CODING_BOT_CODEX_SIWC_JSON') or ''
    try:
        metadata = refresh.api(f'repos/{repo}/actions/secrets/CODING_BOT_CODEX_SIWC_JSON', missing=True)
        if metadata is None and not raw:
            return {}  # First login: there is no previous account to compare.
        run = refresh.api(f"repos/{repo}/actions/runs/{os.environ['GITHUB_RUN_ID']}", dispatch=True)
        # A queued snapshot may belong to another account. Comparison is only
        # advisory: an unavailable or stale snapshot must never block saving.
        if metadata is None or not raw or refresh.timestamp(metadata['updated_at']) >= refresh.timestamp(run['created_at']):
            return None
        old = json.loads(raw)
        return old if old.get('id_token') and login.account_email(old) else None
    except Exception:
        return None


def warn(message):
    annotation = message.replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')
    print('::warning::' + annotation, flush=True)
    summary('⚠ ' + html.escape(message))


def complete(url):
    pending = refresh.pending_login()
    if pending is None:
        summary('この URL は既に保存に使ったか、ログインの準備がありません。' + RESTART)
        return 1
    try:
        age = time.time() - refresh.timestamp(pending['created_at'])
        if not 0 <= age < refresh.PENDING_TTL:
            summary('入力なしの起動から 15 分を過ぎたため、URL は期限切れです。' + RESTART)
            return 1
        redirect = login.redirect_uri(pending)
        if pending['redirect_uri'] != redirect:
            raise ValueError('Unexpected redirect URI')
        code, client = login.parse_callback(url, redirect, pending['state'], pending.get('client_id'))
    except ValueError as error:
        # parse_callback messages are fixed strings, never callback contents.
        reasons = {'Callback state mismatch': 'その後に入力なしで起動したログインがあるか、state が一致しません。',
                   'Authorization declined or failed': 'ChatGPT の承認が拒否されたか、失敗しました。'}
        summary(reasons.get(str(error), '貼った URL の形が違います。') + RESTART)
        return 1
    old = previous_login()
    try:
        result = login.token_request(dict(grant_type='authorization_code', client_id=client,
                                          code=code, code_verifier=pending['code_verifier'],
                                          redirect_uri=redirect, resource=login.RESOURCE))
        for field in ('access_token', 'refresh_token', 'id_token'):
            refresh.mask(result.get(field))
        login.validate_nonce(result.get('id_token'), pending['nonce'])
        credentials = login.credentials_from_response(
            dict(client_id=client, ext_agent_host_id=pending['ext_agent_host_id']), result)
        # Record the issued registration before saving credentials. Only the
        # original authorization exchange uses a dynamically issued client.
        current_identity = login.read_client(os.environ['GITHUB_REPOSITORY'])
        if current_identity and current_identity.get('ext_agent_host_id') == pending['ext_agent_host_id']:
            login.save_client(os.environ['GITHUB_REPOSITORY'],
                              dict(client_id=client, ext_agent_host_id=pending['ext_agent_host_id'],
                                   redirect_port=pending['redirect_port']))
        refresh.save_secret('CODING_BOT_CODEX_SIWC_JSON', credentials)
    except Exception:
        summary('承認 URL を token に交換できなかったか、ログインを保存できませんでした（保存は最大 3 回試行）。' + RESTART)
        return 1
    finally:
        # A consumed code cannot be retried, even if publication fails. Never
        # delete a different state prepared while this exchange was running.
        try:
            refresh.clear_pending(pending['state'])
        except Exception:
            summary('受け渡し用の値を消せませんでした。GitHub の Variables 権限を確認してください。値は次の日次更新でも掃除します。')
    email = login.account_email(credentials)
    summary('SIWC のログインを保存した。承認したアカウント: ' + html.escape(email or 'メールアドレスを取得できませんでした'))
    if old is None or (old and not email):
        warn('前のアカウントと比べられなかった（保存済みログインが読めない、メールアドレスがない、または待機中に更新されたため）。ログインは保存しました。')
    else:
        warning = login.account_warning(old, credentials)
        if warning:
            warn(warning)
    try:
        refresh.publish_access(credentials)
    except Exception:
        summary('ログインは保存済みですが access の配布に失敗しました。Actions の「Coding Bot Codex Authentication」を入力なしで起動してください。')
        return 1
    summary('bot はもう SIWC で動ける。🤖 で bot を再実行できます。')
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--phase', choices=['prepare', 'complete'], required=True)
    args = parser.parse_args()
    try:
        url, recreate = read_inputs()
        if os.environ.get('GITHUB_REF') != 'refs/heads/' + os.environ['GITHUB_DEFAULT_BRANCH']:
            summary('default branch 以外からは起動できません。default branch を選んで起動してください。')
            return 1
        os.environ['GH_TOKEN'] = os.environ['CODING_BOT_GH_PAT']
        if not isinstance(url, str) or bool(url) != (args.phase == 'complete'):
            summary('貼った URL の形が違います。' + RESTART)
            return 1
        return complete(url) if url else prepare(recreate)
    except Exception:
        summary('SIWC ログイン処理に失敗しました。鍵・PAT の Secrets / Variables 権限・ネットワークを確認してください。' + RESTART)
        return 1


if __name__ == '__main__':
    sys.exit(main())
