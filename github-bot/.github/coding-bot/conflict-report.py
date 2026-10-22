"""Host-only conflict reports use observed GitHub state, not engine output."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))
from discussion import linked_issue, verify_issue


def api(path, body=None, pages=False):
    args = ['gh', 'api', path]
    if body is not None:
        args += ['--method', 'POST', '--input', '-']
    if pages:
        args += ['--paginate', '--slurp']
    result = subprocess.run(args, input=json.dumps(body) if body is not None else None,
                            text=True, capture_output=True, check=True)
    data = json.loads(result.stdout)
    return [item for page in data for item in page] if pages else data


def target(repo, pr):
    data = api(f'repos/{repo}/pulls/{pr}')
    try:
        issue = linked_issue(data, repo)
    except ValueError:
        return None
    verify_issue(api(f'repos/{repo}/issues/{issue}'), issue)
    return data, issue


def result_text(data, start):
    if data['state'] != 'open':
        return 'PR が閉じているため解消しませんでした。'
    if not re.fullmatch(r'[0-9a-f]{40}', start):
        raise ValueError('starting PR head was not recorded; result cannot be determined')
    if data['head']['sha'] == start:
        return 'conflict の解消を完了できませんでした。'
    if data['mergeable'] is True:
        return 'conflict を解消して push しました。'
    return 'push したが、まだ merge できる状態か確かめられません。'


def report(repo, pr, start, run):
    observed = target(repo, pr)
    if observed is None:
        return
    data, issue = observed
    for _ in range(3):
        if data['state'] != 'open' or data['head']['sha'] == start or data.get('mergeable') is not None:
            break
        time.sleep(2)
        observed = target(repo, pr)
        if observed is None:
            return
        data, issue = observed
    text = result_text(data, start)
    marker = f'<!-- coding-bot:conflict-report run={run} -->'

    def existing(number):
        return next((item for item in api(f'repos/{repo}/issues/{number}/comments?per_page=100', pages=True)
                     if item.get('user', {}).get('login') == 'github-actions[bot]'
                     and marker in item.get('body', '')), None)

    comment = existing(issue)
    if comment is None:
        comment = api(f'repos/{repo}/issues/{issue}/comments', {
            'body': f'{text}\n\n[PR](https://github.com/{repo}/pull/{pr}) / '
                    f'[実行ログ](https://github.com/{repo}/actions/runs/{run})\n\n{marker}'})
    if data['state'] == 'open' and existing(pr) is None:
        url = comment['html_url']
        if not re.fullmatch(rf'https://github\.com/{re.escape(repo)}/issues/{issue}#issuecomment-[1-9][0-9]*', url):
            raise ValueError('issue report did not return its comment URL')
        api(f'repos/{repo}/issues/{pr}/comments', {
            'body': f'conflict 解消の結果は [issue の報告]({url}) をお読みください。\n\n{marker}'})


def main():
    repo, pr = os.environ['REPO'], os.environ['RESOLVE_CONFLICT_PR']
    if not re.fullmatch(r'[1-9][0-9]*', pr):
        raise ValueError('resolve_conflict_pr must be a positive PR number')
    if sys.argv[1] == 'start':
        observed = target(repo, pr)
        if observed is not None:
            with open(os.environ['GITHUB_ENV'], 'a') as env:
                env.write(f"CONFLICT_START_HEAD={observed[0]['head']['sha']}\n")
    else:
        run = os.environ['GITHUB_RUN_ID']
        if not re.fullmatch(r'[1-9][0-9]*', run):
            raise ValueError('run id must be positive')
        report(repo, pr, os.environ.get('CONFLICT_START_HEAD', ''), run)


if __name__ == '__main__':
    main()
