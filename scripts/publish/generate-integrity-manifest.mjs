import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [packDirectory, output] = process.argv.slice(2);
if (!packDirectory || !output) {
  throw new Error('usage: generate-integrity-manifest.mjs <pack-directory> <output>');
}
const registry = process.env.PROJECT_NPM_REGISTRY_URL;
const tag = process.env.RELEASE_TAG;
const sourceCommit = process.env.RELEASE_SOURCE_COMMIT;
const productConfigSha256 = process.env.PRODUCT_CONFIG_SHA256;
const packageScope = process.env.PRODUCT_PACKAGE_SCOPE;
const installLockOutput = process.env.RELEASE_INSTALL_LOCK;
if (!registry?.startsWith('https://') || !tag || !/^[0-9A-Za-z._+-]+$/u.test(tag)) {
  throw new Error('release registry and a safe release tag are required');
}
if (!/^[0-9a-f]{40}$/u.test(sourceCommit ?? '')) {
  throw new Error('RELEASE_SOURCE_COMMIT must be an exact commit SHA');
}
if (!/^[0-9a-f]{64}$/u.test(productConfigSha256 ?? '')) {
  throw new Error('PRODUCT_CONFIG_SHA256 must bind the canonical product configuration');
}
if (!/^@[a-z0-9][a-z0-9._-]*$/u.test(packageScope ?? '') || !installLockOutput) {
  throw new Error('package scope and release install lock output are required');
}

const packages = readdirSync(packDirectory)
  .filter((name) => name.endsWith('.tgz'))
  .sort()
  .map((name) => {
    const tarball = join(packDirectory, name);
    const manifest = JSON.parse(
      execFileSync('tar', ['-xzOf', tarball, 'package/package.json'], { encoding: 'utf8' }),
    );
    const integrity = `sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}`;
    const published = execFileSync(
      'npm',
      ['view', `${manifest.name}@${manifest.version}`, 'dist.integrity', '--registry', registry],
      { encoding: 'utf8' },
    ).trim();
    if (published !== integrity) {
      throw new Error(
        `${manifest.name}@${manifest.version} registry integrity does not match the reviewed tarball`,
      );
    }
    return { name: manifest.name, version: manifest.version, integrity };
  });

if (packages.length === 0) throw new Error('no release tarballs were found');
const cli = packages.find((entry) => entry.name === `${packageScope}/agent-cli`);
if (!cli) throw new Error('the configured CLI tarball was not published');

const lockRoot = mkdtempSync(join(tmpdir(), 'robota-release-lock-'));
let lockBytes;
try {
  writeFileSync(
    join(lockRoot, 'package.json'),
    `${JSON.stringify({ name: 'robota-release-image', private: true, dependencies: { [cli.name]: cli.version } }, null, 2)}\n`,
  );
  execFileSync(
    'npm',
    [
      'install',
      '--package-lock-only',
      '--omit=dev',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--registry',
      registry,
    ],
    { cwd: lockRoot, stdio: 'inherit' },
  );
  lockBytes = readFileSync(join(lockRoot, 'package-lock.json'));
  const lock = JSON.parse(lockBytes.toString('utf8'));
  const lockedCli = lock.packages?.[`node_modules/${cli.name}`];
  if (lockedCli?.version !== cli.version || lockedCli?.integrity !== cli.integrity) {
    throw new Error('the release install graph does not select the reviewed CLI tarball');
  }
  writeFileSync(installLockOutput, lockBytes, { mode: 0o600 });
} finally {
  rmSync(lockRoot, { recursive: true, force: true });
}
const installLockSha256 = createHash('sha256').update(lockBytes).digest('hex');
writeFileSync(
  output,
  `${JSON.stringify({ version: 1, tag, sourceCommit, productConfigSha256, packageScope, registry, installLockSha256, packages }, null, 2)}\n`,
  { mode: 0o600 },
);
