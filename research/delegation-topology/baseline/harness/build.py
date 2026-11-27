#!/usr/bin/env python3
"""Build the pinned, credential-free Robota experiment image from a clean checkout."""
import argparse
from pathlib import Path
import shutil
import subprocess
import tempfile

PIN = '0f7d2147626674970290fe843c05a9e6e9e6ce05'
HERE = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument('--source', required=True, type=Path)
args = parser.parse_args()
source = args.source.resolve()
assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=source, text=True).strip() == PIN, 'Use the pinned revision'
subprocess.run(['git', 'diff', '--exit-code', 'HEAD', '--'], cwd=source, check=True, stdout=subprocess.DEVNULL)
with tempfile.TemporaryDirectory(prefix='robota-deepseek-image-') as directory:
    context = Path(directory)
    for raw in subprocess.check_output(['git', 'ls-files', '-z'], cwd=source).split(b'\0'):
        if not raw:
            continue
        relative = raw.decode()
        origin = source / relative
        if not origin.is_file():
            continue
        destination = context / 'robota' / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(origin, destination)
    for name in ['Dockerfile', 'worker.mts']:
        shutil.copy2(HERE / name, context / name)
    subprocess.run(['docker', 'build', '-t', 'robota-deepseek-benchmark:20261021', str(context)], check=True)
