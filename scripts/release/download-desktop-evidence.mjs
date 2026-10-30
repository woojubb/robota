import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { execFileSync } from 'node:child_process';

const [nativeFile, desktopFile, directory] = process.argv.slice(2);
const records = [nativeFile, desktopFile].map((file) => JSON.parse(readFileSync(file, 'utf8')));
const names = records.flatMap((record) => record.assets.map(({ name }) => name));
if (
  names.length !== new Set(names).size ||
  names.some((name) => typeof name !== 'string' || basename(name) !== name || name.includes('\\'))
)
  throw new Error('Unsafe or duplicate evidence asset names');
const args = [
  'release',
  'download',
  process.env.RELEASE_TAG,
  '--repo',
  process.env.GH_REPO,
  '--dir',
  directory,
];
for (const name of names) args.push('--pattern', name);
execFileSync('gh', args, { stdio: 'inherit', timeout: 120_000 });
