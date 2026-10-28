import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const [lockPath, packagePath] = process.argv.slice(2);
const version = process.env.ROBOTA_VERSION;
const expectedSha256 = process.env.ROBOTA_LOCK_SHA256;
const packageName = '@robota-sdk/agent-cli';
const registryPrefix = 'https://registry.npmjs.org/';

if (!lockPath || !packagePath || !version || !/^[0-9a-f]{64}$/u.test(expectedSha256 ?? '')) {
  throw new Error('release lock path, package path, version, and SHA-256 are required');
}

const lockBytes = readFileSync(lockPath);
const actualSha256 = createHash('sha256').update(lockBytes).digest('hex');
if (actualSha256 !== expectedSha256) throw new Error('release install graph digest mismatch');

const lock = JSON.parse(lockBytes.toString('utf8'));
const root = lock.packages?.[''];
const dependencyNames = Object.keys(root?.dependencies ?? {});
if (
  dependencyNames.length !== 1 ||
  dependencyNames[0] !== packageName ||
  root.dependencies[packageName] !== version
) {
  throw new Error('release lock root must select only the requested CLI version');
}

const cli = lock.packages?.[`node_modules/${packageName}`];
if (
  cli?.version !== version ||
  !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(cli.integrity ?? '') ||
  !String(cli.resolved ?? '').startsWith(registryPrefix)
) {
  throw new Error('release lock CLI entry is not an integrity-bound npm artifact');
}

for (const [name, entry] of Object.entries(lock.packages ?? {})) {
  if (name === '') continue;
  if (
    entry.link === true ||
    !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(entry.integrity ?? '') ||
    !String(entry.resolved ?? '').startsWith(registryPrefix)
  ) {
    throw new Error(`release lock entry ${name} is not bound to the approved registry`);
  }
}

writeFileSync(
  packagePath,
  `${JSON.stringify({ name: lock.name, private: true, dependencies: root.dependencies })}\n`,
  { mode: 0o600 },
);
