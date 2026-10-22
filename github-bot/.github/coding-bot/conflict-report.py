"""Host reports combine this runner’s result with the verified branch ref."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from urllib.parse import quote

sys.path.insert(0, str(Path(__file__).resolve().parent))


def api(path, body=None, pages=False, method="POST"):
    args = ['gh', 'api', path]
    if body is not None:
        args += ['--method', method, '--input', '-']
    if pages:
        args += ['--paginate', '--slurp']
    result = subprocess.run(args, input=json.dumps(body) if body is not None else None,
                            text=True, capture_output=True, check=True)
    data = json.loads(result.stdout)
    return [item for page in data for item in page] if pages else data



UNKNOWN = 'conflict の解消の結果を確かめられませんでした。このスレッドで対応を相談してください。'


def result_file():
    return Path(os.environ['RUNNER_TEMP']) / 'coding-bot-conflict/result.json'


def runner_result(value):
    if not isinstance(value, dict) or value.get('result') not in {'no_conflict', 'pushed', 'failed'}:
        raise ValueError('invalid runner result')
    if value['result'] == 'pushed' and not re.fullmatch(r'[0-9a-f]{40}', value.get('sha', '')):
        raise ValueError('pushed result requires a commit SHA')
    return value


def capture(status, path):
    # The host file is outside the container mounts; only the final runner line is a result.
    prefix = 'CODING_BOT_CONFLICT_RESULT '
    last = Path(path).read_text().splitlines()[-1]
    if not last.startswith(prefix):
        raise ValueError('runner did not finish with a result')
    value = runner_result(json.loads(last[len(prefix):]))
    if status != '0' and value['result'] != 'failed':
        raise ValueError('successful result requires runner exit 0')
    result_file().write_text(json.dumps(value))


def result_text(data, result, ref):
    if result['result'] != 'pushed':
        if data['state'] != 'open':
            return 'PR が閉じているため解消しませんでした。'
        if result['result'] == 'no_conflict':
            return '解消する conflict はありません。'
        return 'conflict の解消を完了できませんでした。このスレッドで対応を相談してください。'
    if ref != result['sha']:
        return UNKNOWN
    if data.get('mergeable') is True:
        return 'conflict を解消して push しました。'
    return 'push しましたが、まだ merge できる状態か確かめられません。'


def report(repo, pr, run, issue):
    attempt = os.environ['GITHUB_RUN_ATTEMPT']
    data = None
    text = UNKNOWN
    try:
        data = api(f'repos/{repo}/pulls/{pr}')
        result = runner_result(json.loads(result_file().read_text()))
        ref = None
        if result['result'] == 'pushed':
            for retry in range(4):
                ref = api(f"repos/{repo}/git/ref/heads/{quote(data['head']['ref'], safe='/')}")['object']['sha']
                if ref == result['sha'] and data.get('mergeable') is not None:
                    break
                if retry < 3:
                    time.sleep(2)
                    data = api(f'repos/{repo}/pulls/{pr}')
        text = result_text(data, result, ref)
    except Exception as error:
        print(f'Conflict result observation failed: {type(error).__name__}', file=sys.stderr)
    marker = f'<!-- coding-bot:conflict-report run={run} attempt={attempt} -->'

    def upsert(number, body):
        old = next((item for item in api(f'repos/{repo}/issues/{number}/comments?per_page=100', pages=True)
                    if item.get('user', {}).get('login') == 'github-actions[bot]'
                    and marker in item.get('body', '')), None)
        if old is not None:
            return api(f"repos/{repo}/issues/comments/{old['id']}", {'body': body}, method='PATCH')
        return api(f'repos/{repo}/issues/{number}/comments', {'body': body})

    comment = upsert(issue, f'{text}\n\n[PR](https://github.com/{repo}/pull/{pr}) / '
                     f'[実行ログ](https://github.com/{repo}/actions/runs/{run})\n\n{marker}')
    (result_file().parent / f'issue-comment-{attempt}').write_text(str(comment['id']))
    if data is not None and data['state'] == 'open':
        try:
            url = comment['html_url']
            if not re.fullmatch(rf'https://github\.com/{re.escape(repo)}/issues/{issue}#issuecomment-[1-9][0-9]*', url):
                raise ValueError('issue report did not return its comment URL')
            upsert(pr, f'conflict 解消の結果は [issue の報告]({url}) をお読みください。\n\n{marker}')
        except Exception as error:
            print(f'PR report delivery failed: {type(error).__name__}; issue result is preserved', file=sys.stderr)
            return 3
    return 0


def main():
    if sys.argv[1] == 'capture':
        capture(*sys.argv[2:])
        return
    repo = os.environ['REPO']
    pr, issue = os.environ.get('TRUSTED_CONFLICT_PR', ''), os.environ.get('TRUSTED_CONFLICT_ISSUE', '')
    if not pr or not issue:
        return 0
    if not re.fullmatch(r'[1-9][0-9]*', issue):
        raise ValueError('trusted conflict issue must be positive')
    if not re.fullmatch(r'[1-9][0-9]*', os.environ['GITHUB_RUN_ATTEMPT']):
        raise ValueError('run attempt must be positive')
    if not re.fullmatch(r'[1-9][0-9]*', pr):
        raise ValueError('resolve_conflict_pr must be a positive PR number')
    run = os.environ['GITHUB_RUN_ID']
    if not re.fullmatch(r'[1-9][0-9]*', run):
        raise ValueError('run id must be positive')
    return report(repo, pr, run, int(issue))


if __name__ == '__main__':
    sys.exit(main())
