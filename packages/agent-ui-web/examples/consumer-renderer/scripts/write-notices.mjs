import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
const packages = Object.entries(lock.packages)
  .filter(([location, metadata]) => location.startsWith('node_modules/') && !metadata.dev)
  .sort(([left], [right]) => left.localeCompare(right));

async function licenseText(location, license) {
  const directory = join(root, location);
  const entries = await readdir(directory);
  const file = entries.find((entry) => /^licen[cs]e(?:[.-]|$)/i.test(entry))
    ?? (location === 'node_modules/pretendard' ? 'dist/LICENSE.txt' : null);
  if (file) return readFile(join(directory, file), 'utf8');
  if (location.startsWith('node_modules/@robota-sdk/') &&
      license === 'AGPL-3.0-only OR LicenseRef-Commercial') {
    return readFile(join(root, 'node_modules/@robota-sdk/agent-ui-web/LICENSE'), 'utf8');
  }
  throw new Error(`No license text for ${location}`);
}

const sections = await Promise.all(packages.map(async ([location, metadata]) => {
  const name = location.slice('node_modules/'.length);
  const text = await licenseText(location, metadata.license);
  return `## ${name}@${metadata.version}\n\nLicense: ${metadata.license}\n\n${text.trim()}\n`;
}));

await writeFile(
  join(root, 'dist/THIRD_PARTY_NOTICES.md'),
  `# Third-party notices\n\nGenerated from the installed production dependency closure in package-lock.json.\n\n${sections.join('\n---\n\n')}`,
);
