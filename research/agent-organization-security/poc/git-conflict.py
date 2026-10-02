"""Actual Git object/ref conflicts in an owned synthetic repository; no hosting provider."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import subprocess
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
records = []
with tempfile.TemporaryDirectory(prefix='issue-2-git-') as temporary:
    root = Path(temporary)
    repo = root / 'repository'; repo.mkdir()
    home = root / 'home'; home.mkdir()
    environment = {'PATH': os.environ['PATH'], 'HOME': str(home), 'GIT_CONFIG_NOSYSTEM': '1',
                   'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_TERMINAL_PROMPT': '0'}
    def git(*argv, check=True):
        result = subprocess.run(['git', '-c', 'core.hooksPath=/dev/null', '-c', 'user.name=synthetic',
                                 '-c', 'user.email=synthetic@example.invalid', *argv], cwd=repo,
                                env=environment, capture_output=True, text=True, timeout=10)
        if check:
            assert result.returncode == 0, 'Synthetic Git command failed'
        return result
    git('init', '-q', '-b', 'baseline')
    (repo / 'shared.txt').write_text('baseline\n')
    git('add', 'shared.txt'); git('commit', '-qm', 'baseline')
    base = git('rev-parse', 'HEAD').stdout.strip()
    candidates = []
    for task in ['a', 'b']:
        git('checkout', '-qb', 'task-' + task, base)
        (repo / 'shared.txt').write_text('task-' + task + '\n')
        git('add', 'shared.txt'); git('commit', '-qm', 'task-' + task)
        candidates.append(git('rev-parse', 'HEAD').stdout.strip())
    git('update-ref', 'refs/heads/accepted', base)
    with ThreadPoolExecutor(2) as pool:
        outcomes = list(pool.map(lambda candidate: git('update-ref', 'refs/heads/accepted', candidate, base, check=False).returncode, candidates))
    accepted = git('rev-parse', 'accepted').stdout.strip()
    passed = sorted(outcomes) == [0, 128] and accepted in candidates
    records.append({'id': 'two-writer-git-ref-cas', 'expected': 'one candidate accepted, stale baseline rejected',
                    'observedExitCodes': sorted(outcomes), 'acceptedMatchesOneCandidate': accepted in candidates, 'passed': passed})
    rejected = candidates[1] if accepted == candidates[0] else candidates[0]
    stale = git('update-ref', 'refs/heads/accepted', rejected, base, check=False)
    records.append({'id': 'stale-baseline-retry-after-race', 'exitCode': stale.returncode,
                    'expectedRevisionMismatch': 'expected' in stale.stderr,
                    'passed': stale.returncode == 128 and 'expected' in stale.stderr
                    and git('rev-parse', 'accepted').stdout.strip() == accepted})
    git('checkout', '-q', 'task-a')
    conflict = git('merge', '--no-commit', '--no-ff', 'task-b', check=False)
    unresolved = git('diff', '--name-only', '--diff-filter=U').stdout.splitlines()
    records.append({'id': 'real-content-merge-conflict', 'mergeExit': conflict.returncode, 'conflictingFiles': unresolved,
                    'passed': conflict.returncode == 1 and unresolved == ['shared.txt']})
    git('merge', '--abort')
    records.append({'id': 'conflict-abort-retains-candidate-and-accepted-ref',
                    'passed': git('rev-parse', 'HEAD').stdout.strip() == candidates[0]
                    and git('rev-parse', 'accepted').stdout.strip() == accepted
                    and git('status', '--porcelain').stdout == ''})
args.output.write_text(json.dumps({'kind': 'actual-git-cas-merge-conflict', 'records': records,
    'limitations': ['Local synthetic Git validates conflict/CAS mechanisms; a production Git broker still must authenticate tenant/task/actor/branch/lease.',
                    'No production repository, GitHub branch or release is changed.']}, indent=2) + '\n')
assert all(record['passed'] for record in records)
print(f'{len(records)} actual Git conflict/CAS observations passed')
