import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, it } from 'vitest';
import { loadProductConfig } from '../../../packages/product-config/src/node.ts';
import { writeWorkflowProductEnvironment } from '../prepare-workflow-workspace.mjs';

const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

it('writes distinct PR products at the native runner path for the runtime loader', async () => {
  const configs = [];
  for (const label of ['cedar', 'amber']) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'workflow-product-'));
    roots.push(root);
    const filePath = await writeWorkflowProductEnvironment({ RUNNER_TEMP: root, IS_PULL_REQUEST: 'true', FIXTURE_PRODUCT: label });
    expect(filePath).toBe(path.join(root, 'selected-product.env'));
    configs.push(loadProductConfig({ environment: {}, filePath }));
    expect(await readFile(filePath, 'utf8')).not.toContain('undefined');
  }
  expect(configs[0].identity.id).toBe('cedar');
  expect(configs[1].identity.id).toBe('amber');
  expect(configs[0].storage.userRoot).not.toBe(configs[1].storage.userRoot);
  expect(configs[0].crypto.masterKeyDerivationPath).not.toEqual(configs[1].crypto.masterKeyDerivationPath);
  expect(configs.map((config) => config.release.tagPrefix)).toEqual(['cedar-v', 'amber-v']);
});

it('preserves an explicitly selected release environment file', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workflow-product-'));
  roots.push(root);
  const contents = 'PRODUCT_DISPLAY_NAME="Selected Agent"\n';
  const filePath = await writeWorkflowProductEnvironment({ RUNNER_TEMP: root, PRODUCT_BUILD_ENV: contents });
  expect(await readFile(filePath, 'utf8')).toBe(contents);
});

it('requires explicit release selection and a known PR fixture', async () => {
  await expect(writeWorkflowProductEnvironment({ RUNNER_TEMP: os.tmpdir() })).rejects.toThrow('PRODUCT_BUILD_ENV');
  await expect(writeWorkflowProductEnvironment({ RUNNER_TEMP: os.tmpdir(), IS_PULL_REQUEST: 'true', FIXTURE_PRODUCT: 'unknown' })).rejects.toThrow('supported fixture');
});
