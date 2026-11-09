import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const fromChangesets = createRequire(
  createRequire(path.join(root, 'package.json')).resolve('@changesets/cli/package.json'),
);

async function plan(name, type) {
  const assemble = fromChangesets('@changesets/assemble-release-plan').default;
  const packages = await fromChangesets('@manypkg/get-packages').getPackages(root);
  const config = await fromChangesets('@changesets/config').read(root, packages);
  return assemble(
    [{ id: 'probe', summary: 'A package change.', releases: [{ name, type }] }],
    packages, config, undefined,
  ).releases.filter((release) => release.type !== 'none');
}

it('versions a compatible SDK change without bumping unrelated packages or products', async () => {
  expect(await plan('@robota-sdk/agent-core', 'patch')).toMatchObject([
    { name: '@robota-sdk/agent-core', type: 'patch' },
  ]);
  expect(await plan('@robota-sdk/agent-keyring', 'patch')).toMatchObject([
    { name: '@robota-sdk/agent-keyring', type: 'patch' },
  ]);
});

it('versions a CLI change without bumping the app or SDK', async () => {
  expect(await plan('@robota-sdk/agent-cli', 'patch')).toMatchObject([
    { name: '@robota-sdk/agent-cli', type: 'patch' },
  ]);
});

it('still updates SDK dependents when a dependency leaves their compatible range', async () => {
  const releases = await plan('@robota-sdk/agent-core', 'major');
  expect(releases).toContainEqual(expect.objectContaining({ name: '@robota-sdk/agent-core', type: 'major' }));
  expect(releases.some((release) => release.name === '@robota-sdk/agent-framework')).toBe(true);
  expect(releases.some((release) => ['@robota-sdk/agent-cli', '@robota-sdk/agent-app'].includes(release.name))).toBe(false);
});
