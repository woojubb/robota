import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const [directory, version] = process.argv.slice(2);
const registry = process.env.PROJECT_NPM_REGISTRY_URL;
const scope = process.env.PRODUCT_PACKAGE_SCOPE;
if (!directory || !version || !registry?.startsWith('https://') || !scope?.startsWith('@'))
  throw new Error('Exact release tarballs, version, registry and package scope are required.');
const packages = readdirSync(directory).filter((name) => name.endsWith('.tgz')).sort().map((file) => {
  const tarball = path.resolve(directory, file);
  const manifest = JSON.parse(execFileSync('tar', ['-xzOf', tarball, 'package/package.json'], {
    encoding: 'utf8', timeout: 10_000,
  }));
  if (!manifest.name?.startsWith(`${scope}/`) || manifest.version !== version || manifest.private === true)
    throw new Error(`Unexpected release package in ${file}`);
  return { name: manifest.name, tarball,
    integrity: `sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}` };
});
if (!packages.length || new Set(packages.map((pkg) => pkg.name)).size !== packages.length)
  throw new Error('Release tarballs must contain unique public packages.');

async function concurrently(items, count, work) {
  let cursor = 0;
  let failure;
  await Promise.all(Array.from({ length: Math.min(count, items.length) }, async () => {
    while (!failure && cursor < items.length) {
      const item = items[cursor++];
      try { await work(item); } catch (error) { failure ??= error; }
    }
  }));
  if (failure) throw failure;
}

// Check every package before the first write. Existing immutable versions must match these bytes.
await concurrently(packages, 6, async (pkg) => {
  const response = await fetch(new URL(encodeURIComponent(pkg.name), `${registry.replace(/\/$/, '')}/`), {
    headers: { accept: 'application/vnd.npm.install-v1+json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`${pkg.name}: registry preflight returned ${response.status}; first publication requires owner setup.`);
  const metadata = await response.json();
  const published = metadata.versions?.[version];
  if (published && published.dist?.integrity !== pkg.integrity)
    throw new Error(`${pkg.name}@${version}: existing bytes differ; refusing to replace or certify them.`);
  pkg.exists = Boolean(published);
});

await concurrently(packages, 4, async (pkg) => {
  if (pkg.exists) { console.log(`${pkg.name}@${version}: already published with matching integrity`); return; }
  const args = ['publish', pkg.tarball, '--tag', 'latest', '--registry', registry];
  if (process.env.PROJECT_PACKAGE_ACCESS) args.push('--access', process.env.PROJECT_PACKAGE_ACCESS);
  await new Promise((resolve, reject) => {
    const child = spawn('npm', args, { stdio: 'inherit', timeout: 90_000 });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${pkg.name}: npm publish failed (${signal ?? code})`)));
  });
});
