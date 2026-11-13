import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { confirmRegistryPublication } from './confirm-registry-publication.mjs';

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
const component = process.env.RELEASE_COMPONENT ?? 'cli';
const selected = process.env.RELEASE_PACKAGE ?? (component === 'cli' ? 'agent-cli' : '');
const releaseVersion = process.env.RELEASE_VERSION;
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
    return { name: manifest.name, version: manifest.version, integrity };
  });

if (!['cli', 'sdk'].includes(component) || !/^[a-z0-9][a-z0-9._-]*$/u.test(selected) ||
    (component === 'cli') !== (selected === 'agent-cli') || packages.length !== 1 ||
    packages[0].name !== `${packageScope}/${selected}` || packages[0].version !== releaseVersion)
  throw new Error('invalid release component or tarballs');
// Wait, within a bound, for the registry to serve the uploaded version; a failed receipt can still resume
// from the retained artifact without rebuilding.
await Promise.all(packages.map((pkg) => confirmRegistryPublication(pkg, registry)));
const cli = packages.find((entry) => entry.name === `${packageScope}/agent-cli`);
if (component === 'cli' && !cli) throw new Error('the configured CLI tarball was not published');
if (component === 'sdk' && cli) throw new Error('the SDK release must not contain the CLI');
const roots = component === 'cli' ? [cli] : packages;

const lockRoot = mkdtempSync(join(tmpdir(), 'robota-release-lock-'));
let lockBytes;
try {
  writeFileSync(
    join(lockRoot, 'package.json'),
    `${JSON.stringify({ name: component === 'cli' ? 'robota-release-image' : 'robota-sdk-release', private: true, dependencies: Object.fromEntries(roots.map((pkg) => [pkg.name, pkg.version])) }, null, 2)}\n`,
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
    { cwd: lockRoot, stdio: 'inherit', timeout: 60_000 },
  );
  lockBytes = readFileSync(join(lockRoot, 'package-lock.json'));
  const lock = JSON.parse(lockBytes.toString('utf8'));
  for (const pkg of roots) {
    const selected = lock.packages?.[`node_modules/${pkg.name}`];
    if (selected?.version !== pkg.version || selected?.integrity !== pkg.integrity)
      throw new Error(`the release install graph does not select the reviewed ${pkg.name} tarball`);
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
