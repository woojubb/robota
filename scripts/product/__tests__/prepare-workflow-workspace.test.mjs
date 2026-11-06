import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { loadProductConfig } from '../../../packages/product-config/src/node.ts';
import {
  ensurePrWorkflowVersion,
  writeWorkflowProductEnvironment,
} from '../prepare-workflow-workspace.mjs';

const roots = [];
const peers = [
  'agent-builtin-providers',
  'agent-core',
  'agent-framework',
  'agent-interface-command',
  'agent-tools',
];
async function setPeerVersions(root, version) {
  for (const peer of peers) {
    const dir = path.join(root, 'packages', peer);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: `@robota-sdk/${peer}`, version }),
    );
  }
}
async function createPeerFixture(version, kind) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workflow-peer-version-'));
  roots.push(root);
  await setPeerVersions(root, version);
  const peerDependencies = Object.fromEntries(
    peers.map((peer) => [`@robota-sdk/${peer}`, '~3.1.0']),
  );
  const dependencies = Object.fromEntries(
    peers.map((peer) => [`@robota-sdk/${peer}`, `link:packages/${peer}`]),
  );
  if (kind === 'bad-peer') {
    peerDependencies['@robota-sdk/wrong'] = '~3.1.0';
    dependencies['@robota-sdk/wrong'] = 'link:packages/agent-core';
  }
  if (kind === 'missing-peer') delete peerDependencies['@robota-sdk/agent-core'];
  if (kind === 'bad-range') peerDependencies['@robota-sdk/agent-core'] = 'invalid';
  if (kind === 'wrong-manifest')
    await writeFile(
      path.join(root, 'packages/agent-core/package.json'),
      JSON.stringify({ name: '@robota-sdk/wrong', version }),
    );
  const lock = {
    importers: {
      'packages/agent-cli': {
        devDependencies: {
          '@robota-sdk/workflows': { specifier: '0.0.4', version: '0.0.4(peer)' },
        },
      },
    },
    packages: { '/@robota-sdk/workflows@0.0.4(peer)': { peerDependencies, dependencies } },
  };
  await writeFile(path.join(root, 'pnpm-lock.yaml'), stringify(lock));
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it('writes distinct PR products at the native runner path for the runtime loader', async () => {
  const configs = [];
  for (const label of ['cedar', 'amber']) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'workflow-product-'));
    roots.push(root);
    const filePath = await writeWorkflowProductEnvironment({
      RUNNER_TEMP: root,
      IS_PULL_REQUEST: 'true',
      FIXTURE_PRODUCT: label,
    });
    expect(filePath).toBe(path.join(root, 'selected-product.env'));
    configs.push(loadProductConfig({ environment: {}, filePath }));
    expect(await readFile(filePath, 'utf8')).not.toContain('undefined');
  }
  expect(configs[0].identity.id).toBe('cedar');
  expect(configs[1].identity.id).toBe('amber');
  expect(configs[0].storage.userRoot).not.toBe(configs[1].storage.userRoot);
  expect(configs[0].crypto.masterKeyDerivationPath).not.toEqual(
    configs[1].crypto.masterKeyDerivationPath,
  );
  expect(configs.map((config) => config.release.tagPrefix)).toEqual(['cedar-v', 'amber-v']);
});

it('preserves an explicitly selected release environment file', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workflow-product-'));
  roots.push(root);
  const contents = 'PRODUCT_DISPLAY_NAME="Selected Agent"\n';
  const filePath = await writeWorkflowProductEnvironment({
    RUNNER_TEMP: root,
    PRODUCT_BUILD_ENV: contents,
  });
  expect(await readFile(filePath, 'utf8')).toBe(contents);
});

it('requires explicit release selection and a known PR fixture', async () => {
  await expect(writeWorkflowProductEnvironment({ RUNNER_TEMP: os.tmpdir() })).rejects.toThrow(
    'PRODUCT_BUILD_ENV',
  );
  await expect(
    writeWorkflowProductEnvironment({
      RUNNER_TEMP: os.tmpdir(),
      IS_PULL_REQUEST: 'true',
      FIXTURE_PRODUCT: 'unknown',
    }),
  ).rejects.toThrow('supported fixture');
});

it('versions a PR candidate only when workflow peers require it, and rejects an incomplete version', async () => {
  const root = await createPeerFixture('3.0.7');
  let runs = 0;
  await expect(
    ensurePrWorkflowVersion({
      sourceRoot: root,
      isPullRequest: false,
      version: async () => {
        runs += 1;
      },
    }),
  ).rejects.toThrow('pull request');
  expect(runs).toBe(0);
  await expect(
    ensurePrWorkflowVersion({
      sourceRoot: root,
      isPullRequest: true,
      version: async () => {
        runs += 1;
      },
    }),
  ).rejects.toThrow('supported version');
  expect(runs).toBe(1);
  await ensurePrWorkflowVersion({
    sourceRoot: root,
    isPullRequest: true,
    version: async () => {
      runs += 1;
      await setPeerVersions(root, '3.1.0');
    },
  });
  expect(runs).toBe(2);
  await ensurePrWorkflowVersion({
    sourceRoot: root,
    isPullRequest: true,
    version: async () => {
      runs += 1;
    },
  });
  expect(runs).toBe(2);
});

it.each(['bad-peer', 'missing-peer', 'bad-range', 'wrong-manifest'])(
  'refuses %s without attempting a version',
  async (kind) => {
    const root = await createPeerFixture('3.0.7', kind);
    let runs = 0;
    await expect(
      ensurePrWorkflowVersion({
        sourceRoot: root,
        isPullRequest: true,
        version: async () => {
          runs += 1;
        },
      }),
    ).rejects.toThrow();
    expect(runs).toBe(0);
  },
);
