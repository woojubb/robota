import { expect, it, vi } from 'vitest';
import type { TProviderCredentialResolver } from '@robota-sdk/agent-core';
import { createTestCommandHost } from '@robota-sdk/agent-framework/testing';
import { SystemCommandExecutor } from '@robota-sdk/agent-framework';
import type {
  IProviderCommandModuleOptions,
  TProviderSettingsDocument,
} from '@robota-sdk/agent-framework';
import { executeProviderCommand } from '../provider-command-execution.js';
import { executeModelCommand } from '../../model/model-command.js';
import { createDefaultCommandModules } from '../../default/default-command-modules.js';

function fixture() {
  const initial: TProviderSettingsDocument = {
    currentProvider: 'current',
    providers: {
      current: {
        type: 'current-fixture',
        model: 'current-model',
        apiKey: 'synthetic-existing-key',
      },
      router: {
        type: 'fixture',
        model: 'router-model',
        apiKeyRef: { service: 'fixture', account: 'missing' },
      },
    },
  };
  let settings = initial;
  const resolveCredential = vi.fn<TProviderCredentialResolver>(async () => {
    throw new Error('Saved connection unavailable.');
  });
  const options: IProviderCommandModuleOptions = {
    providerDefinitions: [
      {
        type: 'current-fixture',
        requiresApiKey: false,
        createProvider: () => {
          throw new Error('not used');
        },
      },
      {
        type: 'fixture',
        requiresApiKey: true,
        modelCatalog: { status: 'live', entries: [{ id: 'router-model', displayName: 'Router' }] },
        createProvider: () => {
          throw new Error('not used');
        },
      },
    ],
    resolveCredential,
    settings: {
      readMergedSettings: () => settings,
      readTargetSettings: () => settings,
      writeTargetSettings: (next) => {
        settings = next;
      },
    },
  };
  return { initial, options, resolveCredential, read: () => settings };
}

it('resolves a stored provider connection before changing the active profile', async () => {
  const { initial, options, resolveCredential, read } = fixture();
  const result = await executeProviderCommand(createTestCommandHost(), 'switch router', options);
  expect(resolveCredential).toHaveBeenCalledOnce();
  expect(result.success).toBe(false);
  expect(read()).toEqual(initial);
});

it('resolves a stored connection before persisting a cross-profile model choice', async () => {
  const { initial, options, resolveCredential, read } = fixture();
  const context = createTestCommandHost({ session: { getModelId: () => 'current-model' } });
  const result = await executeModelCommand(context, 'router-model', options);
  expect(resolveCredential).toHaveBeenCalledOnce();
  expect(result.success).toBe(false);
  expect(read()).toEqual(initial);
});

it.each([
  ['agent-command-provider', 'provider', 'switch router'],
  ['agent-command-model', 'model', 'router-model'],
])(
  'forwards the host resolver into %s and retains only the reference after switching',
  async (moduleName, command, args) => {
    const { initial, options, resolveCredential, read } = fixture();
    resolveCredential.mockImplementationOnce(async (config) => ({
      ...config,
      apiKey: 'synthetic-resolved-secret',
    }));
    const { modules } = createDefaultCommandModules({
      cwd: '/fixture',
      userLocalStorageRoot: '/fixture/local',
      providerDefinitions: options.providerDefinitions,
      providerSettingsAdapter: options.settings,
      providerCredentialResolver: resolveCredential,
    });
    const module = modules.find((candidate) => candidate.name === moduleName);
    const executor = new SystemCommandExecutor([...(module?.systemCommands ?? [])]);

    const result = await executor.execute(
      command,
      createTestCommandHost({ session: { getModelId: () => 'current-model' } }),
      args,
    );

    expect(result?.success).toBe(true);
    expect(resolveCredential).toHaveBeenCalledOnce();
    expect(read().currentProvider).toBe('router');
    expect(read().providers?.router).toEqual(initial.providers?.router);
    expect(JSON.stringify([read(), result])).not.toContain('synthetic-resolved-secret');
  },
);
