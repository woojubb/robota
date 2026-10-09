import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
const candidates = Object.entries(lock.packages)
  .filter(([location, metadata]) =>
    location.startsWith('node_modules/') && (!metadata.dev || location === 'node_modules/electron'))
  .sort(([left], [right]) => left.localeCompare(right));
const packages = [];
for (const entry of candidates) {
  try { await access(join(root, entry[0])); packages.push(entry); }
  catch { /* Optional dependencies for other platforms are absent from this installation. */ }
}

// These packages declare a license but omit its text from their npm tarball.
// The checked-in copies cite the upstream license or the installed README.
const fallbackFiles = {
  '@bufbuild/protobuf': ['bufbuild-apache.txt', 'protobuf-bsd.txt'],
  '@connectrpc/connect': ['connectrpc-apache.txt'],
  '@connectrpc/connect-web': ['connectrpc-apache.txt'],
  'data-uri-to-buffer': ['data-uri-mit.txt'],
  'nostr-wasm': ['nostr-wasm-mit.txt'],
  'openai/node_modules/undici-types': ['undici-mit.txt'],
  standardwebhooks: ['standardwebhooks-mit.txt'],
  tr46: ['tr46-mit.txt'],
  'uint8-util': ['uint8-util-mit.txt'],
  'yoga-layout': ['yoga-mit.txt'],
};

async function licenseText(location, license) {
  const directory = join(root, location);
  const entries = await readdir(directory);
  const file = entries.find((entry) => /^licen[cs]e(?:[.-]|$)/i.test(entry))
    ?? (location === 'node_modules/pretendard' ? 'dist/LICENSE.txt' : null);
  if (file) return readFile(join(directory, file), 'utf8');
  const name = location.slice('node_modules/'.length);
  const fallback = fallbackFiles[name]
    ?? (name.startsWith('@koromix/koffi-') ? ['koffi-mit.txt'] : undefined)
    ?? (name.startsWith('@napi-rs/keyring-') ? ['keyring-mit.txt'] : undefined)
    ?? (name.startsWith('@node-datachannel/') ? ['datachannel-mpl.txt'] : undefined);
  if (fallback) {
    return (await Promise.all(fallback.map((name) =>
      readFile(join(root, 'licenses', name), 'utf8')))).join('\n\n');
  }
  if (location.startsWith('node_modules/@robota-sdk/') &&
      license === 'AGPL-3.0-only OR LicenseRef-Commercial') {
    const owner = await readdir(join(root, 'node_modules/@robota-sdk/agent-ui-web'));
    if (owner.includes('LICENSE'))
      return readFile(join(root, 'node_modules/@robota-sdk/agent-ui-web/LICENSE'), 'utf8');
  }
  throw new Error(`No license text for ${location}`);
}

const sections = await Promise.all(packages.map(async ([location, metadata]) => {
  const text = await licenseText(location, metadata.license);
  return `## ${location.slice('node_modules/'.length)}@${metadata.version}\n\nLicense: ${metadata.license}\n\n${text.trim()}\n`;
}));
const chromium = join(root, 'node_modules/electron/dist/LICENSES.chromium.html');
let chromiumNotice = '';
try { chromiumNotice = `\n---\n\n## Electron Chromium notices\n\n${await readFile(chromium, 'utf8')}\n`; }
catch { throw new Error('Electron Chromium notices are required for desktop packaging.'); }

await writeFile(
  join(root, 'dist/THIRD_PARTY_NOTICES.md'),
  `# Third-party notices\n\nInstalled production dependency closure and Electron runtime from package-lock.json.\n\n${sections.join('\n---\n\n')}${chromiumNotice}`,
);
