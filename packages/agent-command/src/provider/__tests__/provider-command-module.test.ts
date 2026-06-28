import { describe, expect, it, vi } from 'vitest';
import type { IProviderDefinition } from '@robota-sdk/agent-core';
import { SystemCommandExecutor } from '@robota-sdk/agent-framework';
import type {
  ICommandHostContext,
  IProviderCommandSettingsAdapter,
  TProviderSettingsDocument,
} from '@robota-sdk/agent-framework';
import { createProviderCommandModule } from '../provider-command-module.js';
import { scriptedContext } from './scripted-interaction.js';

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
    setupHelpLinks: [
      {
        kind: 'official',
        label: 'OpenAI-compatible local server docs',
        url: 'https://lmstudio.ai/docs/developer',
      },
    ],
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
    setupSteps: [
      { key: 'apiKey', title: 'anthropic API key', masked: true },
      { key: 'model', title: 'anthropic model', defaultValue: 'claude-sonnet-4-6' },
    ],
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

/** Context with no interactive renderer attached (headless/automation). */
const headlessContext = {} as ICommandHostContext;

describe('createProviderCommandModule', () => {
  it('contributes /provider metadata and executable command from the provider package', () => {
    const { adapter } = createSettingsAdapter({});
    const module = createProviderCommandModule({ providerDefinitions, settings: adapter });
    const commands = module.commandSources?.flatMap((source) => source.getCommands()) ?? [];

    expect(module.name).toBe('agent-command-provider');
    expect(commands.map((command) => command.name)).toEqual(['provider']);
    expect(commands[0]?.subcommands?.map((command) => command.name)).toContain('switch');
    expect(module.systemCommands?.map((command) => command.name)).toEqual(['provider']);
  });

  it('asks the user to pick a provider profile from injected merged settings', async () => {
    const { adapter } = createSettingsAdapter({
      currentProvider: 'openai',
      providers: {
        openai: { type: 'openai', model: 'supergemma4-26b-uncensored-v2' },
        anthropic: { type: 'anthropic', model: 'claude-sonnet-4-6' },
      },
    });

    const { context, requests } = scriptedContext([{ type: 'cancelled' }]);
    const result = await createExecutor(adapter).execute('provider', context, 'list');

    expect(result?.success).toBe(true);
    const picker = requests[0];
    expect(picker?.title).toBe('Select provider profile');
    expect(picker?.options?.map((option) => option.label)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('* openai'),
        expect.stringContaining('anthropic'),
      ]),
    );
  });

  it('returns a plain text list when no interactive renderer is attached', async () => {
    const { adapter } = createSettingsAdapter({
      currentProvider: 'openai',
      providers: {
        openai: { type: 'openai', model: 'supergemma4-26b-uncensored-v2' },
        anthropic: { type: 'anthropic', model: 'claude-sonnet-4-6' },
      },
    });

    const result = await createExecutor(adapter).execute('provider', headlessContext, 'list');

    expect(result?.success).toBe(true);
    expect(result?.message).toContain('* openai');
    expect(result?.message).toContain('anthropic');
  });

  it('opens a provider profile action menu from /provider after picking a profile', async () => {
    const { adapter } = createSettingsAdapter({
      currentProvider: 'openai',
      providers: {
        openai: { type: 'openai', model: 'supergemma4-26b-uncensored-v2' },
        anthropic: { type: 'anthropic', model: 'claude-sonnet-4-6' },
      },
    });

    const { context, requests } = scriptedContext([
      { type: 'answer', values: ['anthropic'] },
      { type: 'cancelled' },
    ]);
    const result = await createExecutor(adapter).execute('provider', context, '');

    expect(result?.success).toBe(true);
    expect(requests[0]?.title).toBe('Select provider profile');
    expect(requests[1]?.title).toBe('Provider profile: anthropic');
  });

  it('switches provider immediately via /provider switch without confirmation dialog', async () => {
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

    const result = await createExecutor(adapter).execute(
      'provider',
      headlessContext,
      'switch openai',
    );

    expect(result?.message).toBe(
      'Switched to openai (supergemma4-26b-uncensored-v2). History preserved.',
    );
    expect(readTarget().currentProvider).toBe('openai');
    expect(result?.effects).toEqual([
      { type: 'provider-hot-swap-requested', profileName: 'openai' },
    ]);
  });

  it('switches from the provider profile action menu immediately without confirmation', async () => {
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

    const { context } = scriptedContext([
      { type: 'answer', values: ['openai'] },
      { type: 'answer', values: ['switch'] },
    ]);
    const result = await createExecutor(adapter).execute('provider', context, 'list');

    expect(result?.message).toBe(
      'Switched to openai (supergemma4-26b-uncensored-v2). History preserved.',
    );
    expect(readTarget().currentProvider).toBe('openai');
    expect(result?.effects).toEqual([
      { type: 'provider-hot-swap-requested', profileName: 'openai' },
    ]);
  });

  it('edits a provider profile through provider-owned setup metadata without exposing secrets', async () => {
    const { adapter, readTarget } = createSettingsAdapter(
      {
        currentProvider: 'anthropic',
        providers: {
          anthropic: {
            type: 'anthropic',
            model: 'claude-sonnet-4-6',
            apiKey: 'sk-ant-secret',
          },
        },
      },
      {},
    );

    const { context, requests } = scriptedContext([
      { type: 'answer', values: ['anthropic'] },
      { type: 'answer', values: ['edit'] },
      { type: 'answer', values: [], text: '' },
      { type: 'answer', values: [], text: 'claude-opus-4-5' },
    ]);
    const completed = await createExecutor(adapter).execute('provider', context, 'list');

    const apiKeyRequest = requests[2];
    expect(apiKeyRequest?.title).toBe('anthropic API key');
    expect(apiKeyRequest?.allowFreeText).toBe(true);
    expect(apiKeyRequest?.placeholder).toBe('(unchanged)');
    expect(apiKeyRequest?.masked).toBe(true);

    expect(readTarget()).toMatchObject({
      providers: {
        anthropic: {
          type: 'anthropic',
          model: 'claude-opus-4-5',
          apiKey: 'sk-ant-secret',
        },
      },
    });
    expect(completed?.message).toBe('Provider anthropic updated. Switching...');
    expect(completed?.effects).toEqual([
      { type: 'provider-hot-swap-requested', profileName: 'anthropic' },
    ]);
  });

  it('duplicates a provider profile from the action menu without switching sessions', async () => {
    const { adapter, readTarget } = createSettingsAdapter({
      currentProvider: 'openai',
      providers: {
        openai: {
          type: 'openai',
          model: 'supergemma4-26b-uncensored-v2',
          apiKey: 'lm-studio',
        },
      },
    });

    const { context, requests } = scriptedContext([
      { type: 'answer', values: ['openai'] },
      { type: 'answer', values: ['duplicate'] },
      { type: 'answer', values: [], text: '' },
    ]);
    const completed = await createExecutor(adapter).execute('provider', context, 'list');

    expect(requests[2]?.title).toBe('Duplicate openai as');
    expect(requests[2]?.placeholder).toBe('openai-copy');
    expect(readTarget()).toMatchObject({
      providers: {
        'openai-copy': {
          type: 'openai',
          model: 'supergemma4-26b-uncensored-v2',
          apiKey: 'lm-studio',
        },
      },
    });
    expect(completed?.effects).toBeUndefined();
  });

  it('deletes inactive provider profiles after confirmation', async () => {
    const { adapter, readTarget } = createSettingsAdapter(
      {
        currentProvider: 'openai',
        providers: {
          openai: { type: 'openai', model: 'supergemma4-26b-uncensored-v2' },
          anthropic: { type: 'anthropic', model: 'claude-sonnet-4-6' },
        },
      },
      {
        currentProvider: 'openai',
        providers: {
          openai: { type: 'openai', model: 'supergemma4-26b-uncensored-v2' },
          anthropic: { type: 'anthropic', model: 'claude-sonnet-4-6' },
        },
      },
    );

    const { context } = scriptedContext([
      { type: 'answer', values: ['anthropic'] },
      { type: 'answer', values: ['delete'] },
      { type: 'answer', values: ['yes'] },
    ]);
    const completed = await createExecutor(adapter).execute('provider', context, 'list');

    expect(completed?.message).toBe('Provider profile deleted: anthropic.');
    expect(readTarget()).toEqual({
      currentProvider: 'openai',
      providers: {
        openai: { type: 'openai', model: 'supergemma4-26b-uncensored-v2' },
      },
    });
  });

  it('requires a replacement before deleting the active provider profile', async () => {
    const { adapter, readTarget } = createSettingsAdapter(
      {
        currentProvider: 'anthropic',
        providers: {
          openai: { type: 'openai', model: 'supergemma4-26b-uncensored-v2' },
          anthropic: { type: 'anthropic', model: 'claude-sonnet-4-6' },
        },
      },
      {
        currentProvider: 'anthropic',
        providers: {
          openai: { type: 'openai', model: 'supergemma4-26b-uncensored-v2' },
          anthropic: { type: 'anthropic', model: 'claude-sonnet-4-6' },
        },
      },
    );

    const { context, requests } = scriptedContext([
      { type: 'answer', values: ['anthropic'] },
      { type: 'answer', values: ['delete'] },
      { type: 'answer', values: ['yes'] },
      { type: 'answer', values: ['openai'] },
    ]);
    const completed = await createExecutor(adapter).execute('provider', context, 'list');

    expect(requests[3]?.title).toBe('Replacement provider for anthropic');
    expect(readTarget()).toEqual({
      currentProvider: 'openai',
      providers: {
        openai: { type: 'openai', model: 'supergemma4-26b-uncensored-v2' },
      },
    });
    expect(completed?.effects).toEqual([
      {
        type: 'session-restart-requested',
        reason: 'other',
        message: 'Provider delete restart',
      },
    ]);
  });

  it('blocks deletion of inherited provider profiles instead of pretending to remove them', async () => {
    const { adapter } = createSettingsAdapter(
      {
        currentProvider: 'openai',
        providers: {
          openai: { type: 'openai', model: 'supergemma4-26b-uncensored-v2' },
          anthropic: { type: 'anthropic', model: 'claude-sonnet-4-6' },
        },
      },
      {},
    );

    const { context } = scriptedContext([
      { type: 'answer', values: ['anthropic'] },
      { type: 'answer', values: ['delete'] },
    ]);
    const result = await createExecutor(adapter).execute('provider', context, 'list');

    expect(result?.success).toBe(false);
    expect(result?.message).toContain('not stored in the active write target');
  });

  it('owns provider setup flow and writes settings after generic prompt submissions', async () => {
    const { adapter, readTarget } = createSettingsAdapter({}, {});

    const { context, requests } = scriptedContext([
      { type: 'answer', values: [], text: '' },
      { type: 'answer', values: [], text: '' },
      { type: 'answer', values: [], text: '' },
    ]);
    const completed = await createExecutor(adapter).execute('provider', context, 'add openai');

    expect(requests[0]?.title).toBe('OpenAI-compatible base URL');
    expect(requests[0]?.description).toBe(
      '  Setup help: Official: OpenAI-compatible local server docs - https://lmstudio.ai/docs/developer',
    );
    expect(requests[0]?.placeholder).toBe('http://localhost:1234/v1');
    expect(requests[0]?.allowEmpty).toBe(true);

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

  it('asks the user to pick a provider type when /provider add is called without one', async () => {
    const { adapter, readTarget } = createSettingsAdapter({}, {});

    const { context, requests } = scriptedContext([
      { type: 'answer', values: ['openai'] },
      { type: 'answer', values: [], text: '' },
      { type: 'answer', values: [], text: '' },
      { type: 'answer', values: [], text: '' },
    ]);
    const completed = await createExecutor(adapter).execute('provider', context, 'add');

    expect(requests[0]?.title).toBe('Select provider');
    expect(requests[0]?.options?.map((option) => option.value)).toEqual(['openai', 'anthropic']);
    expect(readTarget()).toMatchObject({
      currentProvider: 'openai',
      providers: { openai: { type: 'openai' } },
    });
    expect(completed?.success).toBe(true);
  });

  it('reports usage for /provider add without a type when no renderer is attached', async () => {
    const { adapter } = createSettingsAdapter({}, {});

    const result = await createExecutor(adapter).execute('provider', headlessContext, 'add');

    expect(result?.success).toBe(false);
    expect(result?.message).toContain('Usage: provider add <type>');
  });

  it('creates another profile when provider type already exists', async () => {
    const { adapter, readTarget } = createSettingsAdapter(
      {
        currentProvider: 'openai',
        providers: {
          openai: {
            type: 'openai',
            baseURL: 'http://localhost:1234/v1',
            model: 'supergemma4-26b-uncensored-v2',
            apiKey: 'lm-studio',
          },
        },
      },
      {},
    );

    const { context } = scriptedContext([
      { type: 'answer', values: [], text: '' },
      { type: 'answer', values: [], text: '' },
      { type: 'answer', values: [], text: '' },
    ]);
    await createExecutor(adapter).execute('provider', context, 'add openai');

    expect(readTarget()).toMatchObject({
      currentProvider: 'openai-2',
      providers: {
        'openai-2': {
          type: 'openai',
          baseURL: 'http://localhost:1234/v1',
          model: 'supergemma4-26b-uncensored-v2',
          apiKey: 'lm-studio',
        },
      },
    });
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
      headlessContext,
      'test openai',
    );

    expect(result?.success).toBe(true);
    expect(result?.message).toContain('Connection failed');
    expect(result?.message).toContain('manual configuration can continue');
    expect(probe).toHaveBeenCalled();
  });
});
