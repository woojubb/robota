import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import { assertEvidence } from './desktop-release-evidence.mjs';

const [nativeFile, desktopFile, directory] = process.argv.slice(2);
const native = JSON.parse(readFileSync(nativeFile, 'utf8'));
const desktop = JSON.parse(readFileSync(desktopFile, 'utf8'));
const sha = process.env.RELEASE_SHA;
const tag = process.env.RELEASE_TAG;
const identity = native.identity;
const configHash = createHash('sha256')
  .update(process.env.PRODUCT_BUILD_ENV ?? '')
  .digest('hex');
if (
  !process.env.PRODUCT_BUILD_ENV ||
  identity.configHash !== configHash ||
  identity.repository !== `https://github.com/${process.env.GH_REPO}` ||
  !tag.startsWith(identity.tagPrefix)
) {
  throw new Error('Release product identity does not match the selected product');
}
if (
  native.assets.length !== 6 ||
  desktop.assets.length !== 3 ||
  !native.assets.some(({ name }) => name === 'SHA256SUMS.txt') ||
  !desktop.assets.some(({ name }) => name.endsWith('.dmg')) ||
  !desktop.assets.some(({ name }) => name.endsWith('.zip')) ||
  !desktop.assets.some(({ name }) => name.startsWith('SHA256SUMS-desktop-'))
) {
  throw new Error('Producer evidence is missing required release assets');
}
for (const [kind, evidence, run, attempt] of [
  ['native', native, process.env.NATIVE_RUN, process.env.NATIVE_ATTEMPT],
  ['desktop', desktop, process.env.DESKTOP_RUN, process.env.DESKTOP_ATTEMPT],
]) {
  if (
    evidence.assets.some(
      ({ name }) => typeof name !== 'string' || basename(name) !== name || name.includes('\\'),
    )
  )
    throw new Error('Unsafe release asset name');
  assertEvidence(
    { kind, tag, sha, run: Number(run), attempt: Number(attempt), identity },
    evidence,
    evidence.assets.map(({ name }) => join(directory, name)),
  );
}
console.log(`Verified producer evidence for ${tag} at ${sha}`);
