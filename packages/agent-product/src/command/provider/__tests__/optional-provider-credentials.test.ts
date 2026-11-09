import { describe, expect, it } from 'vitest';
import type { IProviderDefinition } from '@robota-sdk/agent-core';
import { SystemCommandExecutor } from '@robota-sdk/agent-framework';
import type { TProviderSettingsDocument } from '@robota-sdk/agent-framework';
import { createProviderCommandModule } from '../provider-command-module.js';
import { scriptedContext } from './scripted-interaction.js';

const localDefinition: IProviderDefinition = {
  type: 'local',
  defaults: { model: 'installed-model', baseURL: 'http://localhost:1234/v1' },
  setupSteps: [
    { key: 'baseURL', title: 'Server URL', defaultValue: 'http://localhost:1234/v1' },
    { key: 'model', title: 'Installed model', defaultValue: 'installed-model' },
    { key: 'apiKey', title: 'Server API key (optional)', masked: true, editOnly: true },
  ],
  requiresApiKey: false,
  createProvider: () => {
    throw new Error('not used');
  },
};

function commands(initial: TProviderSettingsDocument = {}) {
  let settings = initial;
  const module = createProviderCommandModule({
    providerDefinitions: [localDefinition],
    env: { LOCAL_TOKEN: 'synthetic-selected-token' },
    settings: {
      readMergedSettings: () => settings,
      readTargetSettings: () => settings,
      writeTargetSettings: (next) => {
        settings = next;
      },
    },
  });
  return {
    executor: new SystemCommandExecutor([...(module.systemCommands ?? [])]),
    read: () => settings,
    module,
  };
}

describe('optional provider credentials', () => {
  it('adds a keyless profile after only endpoint and model answers', async () => {
    const { executor, read } = commands();
    const { context, requests } = scriptedContext([
      { type: 'answer', values: [], text: '' },
      { type: 'answer', values: [], text: '' },
    ]);

    const result = await executor.execute('provider', context, 'add local');

    expect(result?.success).toBe(true);
    expect(requests.map((request) => request.id)).toEqual([
      'provider-setup-baseURL',
      'provider-setup-model',
    ]);
    expect(read().providers?.local).toEqual({
      type: 'local',
      model: 'installed-model',
      baseURL: 'http://localhost:1234/v1',
    });
  });

  it.each([undefined, '$ENV:LOCAL_TOKEN', 'synthetic-existing-token'])(
    'allows blank optional key editing and preserves the previous credential %s',
    async (apiKey) => {
      const profile = {
        type: 'local',
        model: 'installed-model',
        baseURL: 'http://localhost:1234/v1',
        ...(apiKey === undefined ? {} : { apiKey }),
      };
      const { executor, read } = commands({ providers: { local: profile } });
      const { context, requests } = scriptedContext([
        { type: 'answer', values: [], text: '' },
        { type: 'answer', values: [], text: 'another-installed-model' },
        { type: 'answer', values: [], text: '' },
      ]);

      const result = await executor.execute('provider', context, 'edit local');

      expect(result?.success).toBe(true);
      expect(requests[2]).toMatchObject({
        id: 'provider-setup-apiKey',
        masked: true,
        allowEmpty: true,
      });
      expect(JSON.stringify(requests)).not.toContain('synthetic-existing-token');
      expect(read().providers?.local).toEqual({ ...profile, model: 'another-installed-model' });
    },
  );

  it('keeps credential management user-only and advertises the edit recovery action', () => {
    const { module } = commands();
    const entry = module.commandSources?.[0]?.getCommands()[0];
    expect(entry).toMatchObject({ modelInvocable: false });
    expect(module.systemCommands?.[0]).toMatchObject({
      modelInvocable: false,
      userInvocable: true,
    });
    expect(entry?.argumentHint).toContain('edit <profile>');
    expect(entry?.description).toContain('credentials');
  });

  it.each(['$ENV:MISSING_SERVER_TOKEN', '$ENV:'])(
    'leaves the working profile untouched when an edit supplies %s',
    async (apiKey) => {
      const initial = {
        providers: {
          local: {
            type: 'local',
            model: 'installed-model',
            baseURL: 'http://localhost:1234/v1',
            apiKey: 'synthetic-working-token',
          },
        },
      };
      const { executor, read } = commands(initial);
      const { context } = scriptedContext([
        { type: 'answer', values: [], text: '' },
        { type: 'answer', values: [], text: '' },
        { type: 'answer', values: [], text: apiKey },
      ]);
      await expect(executor.execute('provider', context, 'edit local')).rejects.toThrow(
        'missing apiKey',
      );
      expect(read()).toEqual(initial);
    },
  );
});
