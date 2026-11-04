import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
// The release planner `pnpm run version` runs, resolved through the changesets CLI that ships it.
const fromChangesets = createRequire(
  createRequire(path.join(root, 'package.json')).resolve('@changesets/cli/package.json'),
);

it('a minor changeset releases the fixed group as a minor', async () => {
  const assembleReleasePlan = fromChangesets('@changesets/assemble-release-plan').default;
  const { getPackages } = fromChangesets('@manypkg/get-packages');
  const { read } = fromChangesets('@changesets/config');
  const packages = await getPackages(root);
  const config = await read(root, packages);

  const plan = assembleReleasePlan(
    [
      {
        id: 'minor-probe',
        summary: 'A minor change to the core package.',
        releases: [{ name: '@robota-sdk/agent-core', type: 'minor' }],
      },
    ],
    packages,
    config,
    undefined,
  );

  // An exact peer range (`workspace:*`) makes changesets release every dependent of a peer bumped
  // past a patch as a major, and the fixed group carries that major to every package.
  const fixed = new Set(config.fixed.flat());
  const types = new Set(
    plan.releases.filter((release) => fixed.has(release.name)).map((release) => release.type),
  );
  expect([...types]).toEqual(['minor']);
});
