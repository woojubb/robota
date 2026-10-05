/**
 * #3459 — the default command modules hand `/provider` and `/model` the host's environment snapshot.
 *
 * A host that withholds its own credentials from `process.env` passes the snapshot it took first as
 * `providerEnvironment`. This drives both commands through the factory, with the key gone from the
 * live env, so it fails exactly when the factory stops forwarding the snapshot.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';
import { SystemCommandExecutor } from '@robota-sdk/agent-framework';
import { createTestCommandHost } from '@robota-sdk/agent-framework/testing';

import { createDefaultCommandModules } from '../default-command-modules.js';

import type { IProviderDefinition } from '@robota-sdk/agent-core';
import type { IProviderCommandSettingsAdapter, TProviderSettingsDocument } from '@robota-sdk/agent-framework';

const KEY = 'OPENAI_API_KEY';
const providerDefinitions: readonly IProviderDefinition[] = [
  {
    type: 'anthropic',
    displayName: 'anthropic',
    defaults: { model: 'm' },
    modelCatalog: { status: 'live', entries: [{ id: 'm', displayName: 'm' }] },
    createProvider: () => {
      throw new Error('not used');
    },
  },
  {
    type: 'openai',
    displayName: 'openai',
    defaults: { apiKey: `$ENV:${KEY}` },
    modelCatalog: { status: 'unavailable' },
    requiresApiKey: true,
    createProvider: () => {
      throw new Error('not used');
    },
  },
];

const SETTINGS: TProviderSettingsDocument = {
  currentProvider: 'anthropic',
  providers: { anthropic: { type: 'anthropic', model: 'm' }, openai: { type: 'openai', model: 'gpt-x' } },
};
const adapter: IProviderCommandSettingsAdapter = {
  readMergedSettings: () => SETTINGS,
  readTargetSettings: () => ({}),
  writeTargetSettings: () => undefined,
};

const USER_LOCAL_STORAGE_ROOT = mkdtempSync(join(tmpdir(), 'agent-test-provider-env-'));
afterAll(() => rmSync(USER_LOCAL_STORAGE_ROOT, { recursive: true, force: true }));

function executorThroughFactory(moduleName: string): SystemCommandExecutor {
  const { modules } = createDefaultCommandModules({
    cwd: '/work',
    userLocalStorageRoot: USER_LOCAL_STORAGE_ROOT,
    providerDefinitions,
    providerSettingsAdapter: adapter,
    providerEnvironment: { [KEY]: 'snapshot-key' },
  });
  const found = modules.find((module) => module.name === moduleName);
  if (found === undefined) throw new Error(`${moduleName} was not built`);
  return new SystemCommandExecutor([...(found.systemCommands ?? [])]);
}

async function withoutLiveKey<T>(run: () => Promise<T>): Promise<T> {
  const live = process.env[KEY];
  delete process.env[KEY];
  try {
    return await run();
  } finally {
    if (live !== undefined) process.env[KEY] = live;
  }
}

describe('#3459: the default command modules forward the provider environment', () => {
  it('/provider switch checks the key against the snapshot', async () => {
    const result = await withoutLiveKey(() =>
      executorThroughFactory('agent-command-provider').execute('provider', createTestCommandHost(), 'switch openai'),
    );

    expect(result?.success).toBe(true);
  });

  it('a cross-profile /model checks the key against the snapshot', async () => {
    const host = createTestCommandHost({ session: { getModelId: () => 'm' } });
    const result = await withoutLiveKey(() =>
      executorThroughFactory('agent-command-model').execute('model', host, 'gpt-x'),
    );

    expect(result?.success).toBe(true);
  });
});
