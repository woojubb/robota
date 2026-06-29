import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IProviderDefinition } from '@robota-sdk/agent-core';
import { SystemCommandExecutor } from '@robota-sdk/agent-framework';
import type {
  ICommandHostContext,
  IOrgPolicy,
  IProviderCommandSettingsAdapter,
  TProviderSettingsDocument,
} from '@robota-sdk/agent-framework';
import { createProviderCommandModule } from '../provider-command-module.js';
import { scriptedContext } from './scripted-interaction.js';

const providerDefinitions: readonly IProviderDefinition[] = [
  {
    type: 'anthropic',
    displayName: 'Anthropic',
    defaults: { model: 'claude-sonnet-4-6', apiKey: '$ENV:ANTHROPIC_API_KEY' },
    setupSteps: [
      { key: 'apiKey', title: 'Anthropic API key', masked: true },
      { key: 'model', title: 'Anthropic model', defaultValue: 'claude-sonnet-4-6' },
    ],
    requiresApiKey: true,
    createProvider: () => {
      throw new Error('not used');
    },
  },
  {
    type: 'openai',
    displayName: 'OpenAI',
    defaults: { model: 'gpt-4o', apiKey: '$ENV:OPENAI_API_KEY' },
    setupSteps: [
      { key: 'apiKey', title: 'OpenAI API key', masked: true },
      { key: 'model', title: 'OpenAI model', defaultValue: 'gpt-4o' },
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
): { adapter: IProviderCommandSettingsAdapter } {
  let writable = target;
  return {
    adapter: {
      readMergedSettings: () => merged,
      readTargetSettings: () => writable,
      writeTargetSettings: (next) => {
        writable = next;
      },
    },
  };
}

function createExecutor(
  adapter: IProviderCommandSettingsAdapter,
  orgPolicy?: IOrgPolicy,
): SystemCommandExecutor {
  const module = createProviderCommandModule({ providerDefinitions, settings: adapter, orgPolicy });
  return new SystemCommandExecutor([...(module.systemCommands ?? [])]);
}

/** Context with no interactive renderer attached (headless/automation). */
const headlessContext = {} as ICommandHostContext;

describe('org policy enforcement in provider commands', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  it('blocks /provider switch when target is not in allowedProviders', async () => {
    const { adapter } = createSettingsAdapter({
      currentProvider: 'anthropic',
      providers: {
        anthropic: { type: 'anthropic', model: 'claude-sonnet-4-6' },
        openai: { type: 'openai', model: 'gpt-4o' },
      },
    });
    const orgPolicy: IOrgPolicy = {
      allowedProviders: ['anthropic'],
      adminContact: 'admin@example.com',
    };

    const result = await createExecutor(adapter, orgPolicy).execute(
      'provider',
      headlessContext,
      'switch openai',
    );

    expect(result?.success).toBe(false);
    expect(result?.message).toContain('"openai" is not allowed');
    expect(result?.message).toContain('admin@example.com');
    expect(result?.effects).toBeUndefined();
  });

  it('allows /provider switch when target is in allowedProviders', async () => {
    const { adapter } = createSettingsAdapter({
      currentProvider: 'anthropic',
      providers: {
        anthropic: { type: 'anthropic', model: 'claude-sonnet-4-6' },
        openai: { type: 'openai', model: 'gpt-4o' },
      },
    });
    const orgPolicy: IOrgPolicy = { allowedProviders: ['anthropic', 'openai'] };

    const result = await createExecutor(adapter, orgPolicy).execute(
      'provider',
      headlessContext,
      'switch openai',
    );

    expect(result?.success).toBe(true);
    expect(result?.effects).toEqual([
      { type: 'provider-hot-swap-requested', profileName: 'openai' },
    ]);
  });

  it('rejects plaintext API key during edit when requireApiKeyFromEnv is true', async () => {
    const { adapter } = createSettingsAdapter({
      currentProvider: 'anthropic',
      providers: {
        anthropic: {
          type: 'anthropic',
          model: 'claude-sonnet-4-6',
          apiKey: 'sk-existing-key',
        },
      },
    });
    const orgPolicy: IOrgPolicy = { requireApiKeyFromEnv: true, adminContact: 'sec@example.com' };

    // Anthropic has 2 setup steps: apiKey then model
    const { context } = scriptedContext([
      { type: 'answer', values: ['anthropic'] },
      { type: 'answer', values: ['edit'] },
      { type: 'answer', values: [], text: 'sk-plaintext-key' },
      { type: 'answer', values: [], text: 'claude-sonnet-4-6' },
    ]);
    const completed = await createExecutor(adapter, orgPolicy).execute('provider', context, 'list');

    expect(completed?.success).toBe(false);
    expect(completed?.message).toContain('environment variable references');
    expect(completed?.message).toContain('sec@example.com');
  });

  it('allows env-ref API key during edit when requireApiKeyFromEnv is true', async () => {
    vi.stubEnv('ORG_TEST_KEY', 'sk-test-resolved-value');
    const { adapter } = createSettingsAdapter({
      currentProvider: 'anthropic',
      providers: {
        anthropic: {
          type: 'anthropic',
          model: 'claude-sonnet-4-6',
          apiKey: 'sk-existing-key',
        },
      },
    });
    const orgPolicy: IOrgPolicy = { requireApiKeyFromEnv: true };

    const { context } = scriptedContext([
      { type: 'answer', values: ['anthropic'] },
      { type: 'answer', values: ['edit'] },
      { type: 'answer', values: [], text: '$ENV:ORG_TEST_KEY' },
      { type: 'answer', values: [], text: 'claude-opus-4-5' },
    ]);
    const completed = await createExecutor(adapter, orgPolicy).execute('provider', context, 'list');

    expect(completed?.success).toBe(true);
  });
});
