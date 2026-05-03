import { describe, expect, it, vi } from 'vitest';
import type { IProviderDefinition } from '@robota-sdk/agent-core';
import type { InteractiveSession } from '../../interactive/interactive-session.js';
import {
  createProviderCommandModule,
  type IProviderCommandSettingsAdapter,
} from '../provider-command-module.js';
import type { TProviderSettingsDocument } from '../provider-settings.js';
import { SystemCommandExecutor } from '../system-command-executor.js';

const providerDefinitions: readonly IProviderDefinition[] = [
  {
    type: 'openai',
    displayName: 'OpenAI Compatible',
    description: 'Use OpenAI or an OpenAI-compatible endpoint',
    defaults: {
      model: 'supergemma4-26b-uncensored-v2',
      apiKey: 'lm-studio',
      baseURL: 'http://localhost:1234/v1',
    },
    setupSteps: [
      {
        key: 'baseURL',
        title: 'OpenAI-compatible base URL',
        defaultValue: 'http://localhost:1234/v1',
      },
      {
        key: 'model',
        title: 'OpenAI-compatible model',
        defaultValue: 'supergemma4-26b-uncensored-v2',
      },
      {
        key: 'apiKey',
        title: 'OpenAI-compatible API key',
        defaultValue: 'lm-studio',
        masked: true,
      },
    ],
    requiresApiKey: true,
    createProvider: () => {
      throw new Error('not used');
    },
  },
  {
    type: 'anthropic',
    defaults: {
      model: 'claude-sonnet-4-6',
      apiKey: '$ENV:ANTHROPIC_API_KEY',
    },
    requiresApiKey: true,
    createProvider: () => {
      throw new Error('not used');
    },
  },
];

function createSettingsAdapter(
  merged: TProviderSettingsDocument,
  target: TProviderSettingsDocument = {},
): {
  adapter: IProviderCommandSettingsAdapter;
  readTarget: () => TProviderSettingsDocument;
} {
  let writable = target;
  return {
    adapter: {
      readMergedSettings: () => merged,
      readTargetSettings: () => writable,
      writeTargetSettings: (next) => {
        writable = next;
      },
    },
    readTarget: () => writable,
  };
}

function createExecutor(adapter: IProviderCommandSettingsAdapter): SystemCommandExecutor {
  const module = createProviderCommandModule({
    providerDefinitions,
    settings: adapter,
  });
  return new SystemCommandExecutor([...(module.systemCommands ?? [])]);
}

const session = {} as InteractiveSession;

describe('createProviderCommandModule', () => {
  it('contributes /provider metadata and executable command from SDK', () => {
    const { adapter } = createSettingsAdapter({});
    const module = createProviderCommandModule({ providerDefinitions, settings: adapter });
    const commands = module.commandSources?.flatMap((source) => source.getCommands()) ?? [];

    expect(module.name).toBe('sdk-provider');
    expect(commands.map((command) => command.name)).toEqual(['provider']);
    expect(commands[0]?.subcommands?.map((command) => command.name)).toContain('use');
    expect(module.systemCommands?.map((command) => command.name)).toEqual(['provider']);
  });

  it('lists provider profiles from injected merged settings', async () => {
    const { adapter } = createSettingsAdapter({
      currentProvider: 'openai',
      providers: {
        openai: { type: 'openai', model: 'supergemma4-26b-uncensored-v2' },
        anthropic: { type: 'anthropic', model: 'claude-sonnet-4-6' },
      },
    });

    const result = await createExecutor(adapter).execute('provider', session, 'list');

    expect(result?.success).toBe(true);
    expect(result?.message).toContain('* openai');
    expect(result?.message).toContain('anthropic');
  });

  it('confirms provider switch through a generic command interaction', async () => {
    const { adapter, readTarget } = createSettingsAdapter(
      {
        currentProvider: 'anthropic',
        providers: {
          openai: { type: 'openai', model: 'supergemma4-26b-uncensored-v2' },
          anthropic: { type: 'anthropic', model: 'claude-sonnet-4-6' },
        },
      },
      {},
    );

    const result = await createExecutor(adapter).execute('provider', session, 'use openai');
    const submitted = await result?.interaction?.submit('yes');

    expect(result?.interaction?.prompt).toMatchObject({
      kind: 'choice',
      title: 'Change provider to openai? This will restart the session.',
    });
    expect(readTarget().currentProvider).toBe('openai');
    expect(submitted?.effects).toEqual([
      {
        type: 'session-restart-requested',
        reason: 'other',
        message: 'Provider change restart',
      },
    ]);
  });

  it('owns provider setup flow and writes settings after generic prompt submissions', async () => {
    const { adapter, readTarget } = createSettingsAdapter({}, {});
    const first = await createExecutor(adapter).execute('provider', session, 'add openai');

    expect(first?.interaction?.prompt).toMatchObject({
      kind: 'text',
      title: 'OpenAI-compatible base URL',
      placeholder: 'http://localhost:1234/v1',
      allowEmpty: true,
    });

    const second = await first?.interaction?.submit('');
    const third = await second?.interaction?.submit('');
    const completed = await third?.interaction?.submit('');

    expect(readTarget()).toMatchObject({
      currentProvider: 'openai',
      providers: {
        openai: {
          type: 'openai',
          baseURL: 'http://localhost:1234/v1',
          model: 'supergemma4-26b-uncensored-v2',
          apiKey: 'lm-studio',
        },
      },
    });
    expect(completed?.effects).toEqual([
      {
        type: 'session-restart-requested',
        reason: 'other',
        message: 'Provider setup restart',
      },
    ]);
  });

  it('validates provider profile before probe without blocking manual configuration', async () => {
    const probe = vi.fn().mockResolvedValue({ ok: false, message: 'Connection failed' });
    const { adapter } = createSettingsAdapter({
      currentProvider: 'openai',
      providers: {
        openai: {
          type: 'openai',
          model: 'supergemma4-26b-uncensored-v2',
          baseURL: 'http://localhost:1234/v1',
        },
      },
    });

    const module = createProviderCommandModule({
      providerDefinitions: [
        {
          ...providerDefinitions[0]!,
          requiresApiKey: false,
          probeProfile: probe,
        },
      ],
      settings: adapter,
    });
    const result = await new SystemCommandExecutor([...(module.systemCommands ?? [])]).execute(
      'provider',
      session,
      'test openai',
    );

    expect(result?.success).toBe(true);
    expect(result?.message).toContain('Connection failed');
    expect(result?.message).toContain('manual configuration can continue');
    expect(probe).toHaveBeenCalled();
  });
});
