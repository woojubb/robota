import { describe, expect, it, vi } from 'vitest';
import type { IProviderDefinition } from '@robota-sdk/agent-core';
import { SystemCommandExecutor } from '@robota-sdk/agent-sdk';
import type {
  ICommandHostContext,
  IProviderCommandSettingsAdapter,
  TProviderSettingsDocument,
} from '@robota-sdk/agent-sdk';
import { createProviderCommandModule } from '../provider-command-module.js';

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

const session = {} as ICommandHostContext;

describe('createProviderCommandModule', () => {
  it('contributes /provider metadata and executable command from the provider package', () => {
    const { adapter } = createSettingsAdapter({});
    const module = createProviderCommandModule({ providerDefinitions, settings: adapter });
    const commands = module.commandSources?.flatMap((source) => source.getCommands()) ?? [];

    expect(module.name).toBe('agent-command-provider');
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
    expect(result?.interaction?.prompt).toMatchObject({
      kind: 'choice',
      title: 'Select provider profile',
    });
  });

  it('opens a provider profile picker from /provider without CLI-owned routing', async () => {
    const { adapter } = createSettingsAdapter({
      currentProvider: 'openai',
      providers: {
        openai: { type: 'openai', model: 'supergemma4-26b-uncensored-v2' },
        anthropic: { type: 'anthropic', model: 'claude-sonnet-4-6' },
      },
    });

    const result = await createExecutor(adapter).execute('provider', session, '');
    const selected = await result?.interaction?.submit('anthropic');

    expect(result?.message).toContain('* openai');
    expect(selected?.interaction?.prompt).toMatchObject({
      kind: 'choice',
      title: 'Provider profile: anthropic',
    });
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

  it('switches from the provider profile action menu through the same restart interaction', async () => {
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

    const listed = await createExecutor(adapter).execute('provider', session, 'list');
    const selected = await listed?.interaction?.submit('openai');
    const switchRequested = await selected?.interaction?.submit('switch');
    const submitted = await switchRequested?.interaction?.submit('yes');

    expect(switchRequested?.message).toBe('Provider change requested: openai');
    expect(readTarget().currentProvider).toBe('openai');
    expect(submitted?.effects).toEqual([
      {
        type: 'session-restart-requested',
        reason: 'other',
        message: 'Provider change restart',
      },
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

    const listed = await createExecutor(adapter).execute('provider', session, 'list');
    const selected = await listed?.interaction?.submit('anthropic');
    const editRequested = await selected?.interaction?.submit('edit');

    expect(editRequested?.interaction?.prompt).toMatchObject({
      kind: 'text',
      title: 'anthropic API key',
      placeholder: '(unchanged)',
      masked: true,
    });

    const modelPrompt = await editRequested?.interaction?.submit('');
    const completed = await modelPrompt?.interaction?.submit('claude-opus-4-5');

    expect(readTarget()).toMatchObject({
      providers: {
        anthropic: {
          type: 'anthropic',
          model: 'claude-opus-4-5',
          apiKey: 'sk-ant-secret',
        },
      },
    });
    expect(completed?.message).toBe('Provider anthropic updated. Restarting...');
    expect(completed?.effects).toEqual([
      {
        type: 'session-restart-requested',
        reason: 'other',
        message: 'Provider edit restart',
      },
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

    const listed = await createExecutor(adapter).execute('provider', session, 'list');
    const selected = await listed?.interaction?.submit('openai');
    const duplicateRequested = await selected?.interaction?.submit('duplicate');
    const completed = await duplicateRequested?.interaction?.submit('');

    expect(duplicateRequested?.interaction?.prompt).toMatchObject({
      kind: 'text',
      title: 'Duplicate openai as',
      placeholder: 'openai-copy',
    });
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

    const listed = await createExecutor(adapter).execute('provider', session, 'list');
    const selected = await listed?.interaction?.submit('anthropic');
    const deleteRequested = await selected?.interaction?.submit('delete');
    const completed = await deleteRequested?.interaction?.submit('yes');

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

    const listed = await createExecutor(adapter).execute('provider', session, 'list');
    const selected = await listed?.interaction?.submit('anthropic');
    const deleteRequested = await selected?.interaction?.submit('delete');
    const replacementPrompt = await deleteRequested?.interaction?.submit('yes');
    const completed = await replacementPrompt?.interaction?.submit('openai');

    expect(replacementPrompt?.interaction?.prompt).toMatchObject({
      kind: 'choice',
      title: 'Replacement provider for anthropic',
    });
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

    const listed = await createExecutor(adapter).execute('provider', session, 'list');
    const selected = await listed?.interaction?.submit('anthropic');
    const deleteRequested = await selected?.interaction?.submit('delete');

    expect(deleteRequested?.success).toBe(false);
    expect(deleteRequested?.message).toContain('not stored in the active write target');
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
      currentProvider: 'supergemma4-26b-uncensored-v2',
      providers: {
        'supergemma4-26b-uncensored-v2': {
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

  it('creates another profile when provider type and model already exist', async () => {
    const { adapter, readTarget } = createSettingsAdapter(
      {
        currentProvider: 'supergemma4-26b-uncensored-v2',
        providers: {
          'supergemma4-26b-uncensored-v2': {
            type: 'openai',
            baseURL: 'http://localhost:1234/v1',
            model: 'supergemma4-26b-uncensored-v2',
            apiKey: 'lm-studio',
          },
        },
      },
      {},
    );
    const first = await createExecutor(adapter).execute('provider', session, 'add openai');
    const second = await first?.interaction?.submit('');
    const third = await second?.interaction?.submit('');

    await third?.interaction?.submit('');

    expect(readTarget()).toMatchObject({
      currentProvider: 'supergemma4-26b-uncensored-v2-2',
      providers: {
        'supergemma4-26b-uncensored-v2-2': {
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
      session,
      'test openai',
    );

    expect(result?.success).toBe(true);
    expect(result?.message).toContain('Connection failed');
    expect(result?.message).toContain('manual configuration can continue');
    expect(probe).toHaveBeenCalled();
  });
});
