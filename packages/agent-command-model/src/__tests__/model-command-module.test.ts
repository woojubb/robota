import { describe, expect, it } from 'vitest';
import type {
  ICommandHostContext,
  IEditCheckpointRestoreResult,
  IModelCommandModuleOptions,
  TProviderSettingsDocument,
} from '@robota-sdk/agent-sdk';
import { SystemCommandExecutor } from '@robota-sdk/agent-sdk';
import { createModelCommandModule } from '../model-command-module.js';

type TTestProviderDefinition = NonNullable<
  IModelCommandModuleOptions['providerDefinitions']
>[number];

function createCheckpointResult(): IEditCheckpointRestoreResult {
  return {
    target: {
      id: 'checkpoint_1',
      sessionId: 'session_1',
      sequence: 1,
      prompt: 'edit files',
      createdAt: '2026-05-03T00:00:00.000Z',
      fileCount: 1,
    },
    restoredCheckpointCount: 0,
    restoredFileCount: 0,
    removedCheckpointCount: 0,
  };
}

const commandHostContext: ICommandHostContext = {
  getSession: () => {
    throw new Error('model command should not read session runtime');
  },
  getContextState: () => ({
    usedTokens: 0,
    maxTokens: 1,
    usedPercentage: 0,
    remainingPercentage: 100,
  }),
  getAutoCompactThreshold: () => 0.835,
  compactContext: async () => undefined,
  getCwd: () => '/workspace',
  listEditCheckpoints: () => [],
  restoreEditCheckpoint: async () => createCheckpointResult(),
  rollbackEditCheckpoint: async () => createCheckpointResult(),
  getUsedMemoryReferences: () => [],
  recordMemoryEvent: () => undefined,
  listBackgroundTasks: () => [],
  readBackgroundTaskLog: async () => ({ taskId: 'task_1', lines: [] }),
  cancelBackgroundTask: async () => undefined,
  closeBackgroundTask: async () => undefined,
};

const providerDefinitions: readonly TTestProviderDefinition[] = [
  {
    type: 'anthropic',
    defaults: { model: 'claude-sonnet-4-6' },
    modelCatalog: {
      status: 'fallback',
      lastVerifiedAt: '2026-05-04',
      sourceUrl: 'https://platform.claude.com/docs/en/api/models/list',
      entries: [
        {
          id: 'claude-sonnet-4-6',
          displayName: 'Claude Sonnet 4.6',
          contextWindow: 1_000_000,
          lifecycle: 'active',
        },
      ],
    },
    createProvider: () => {
      throw new Error('not used');
    },
  },
  {
    type: 'qwen',
    defaults: { model: 'qwen-plus' },
    modelCatalog: {
      status: 'fallback',
      lastVerifiedAt: '2026-05-04',
      sourceUrl:
        'https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope',
      entries: [
        {
          id: 'qwen-plus',
          displayName: 'Qwen Plus',
          lifecycle: 'active',
        },
        {
          id: 'qwen-max',
          displayName: 'Qwen Max',
          lifecycle: 'active',
        },
      ],
    },
    createProvider: () => {
      throw new Error('not used');
    },
  },
  {
    type: 'openai',
    modelCatalog: {
      status: 'unavailable',
      sourceUrl: 'https://platform.openai.com/docs/api-reference/models/list',
      message: 'OpenAI models should be discovered live.',
    },
    createProvider: () => {
      throw new Error('not used');
    },
  },
];

const refreshableProviderDefinitions: readonly TTestProviderDefinition[] = [
  {
    type: 'openai',
    modelCatalog: {
      status: 'unavailable',
      sourceUrl: 'https://platform.openai.com/docs/api-reference/models/list',
      message: 'OpenAI models should be discovered live.',
    },
    refreshModelCatalog: async () => ({
      status: 'live',
      sourceUrl: 'https://platform.openai.com/docs/api-reference/models/list',
      lastVerifiedAt: '2026-05-05T00:00:00.000Z',
      entries: [{ id: 'gpt-5.1', displayName: 'gpt-5.1', lifecycle: 'active' }],
    }),
    createProvider: () => {
      throw new Error('not used');
    },
  },
];

function createModelModuleForSettings(settings: TProviderSettingsDocument) {
  return createModelCommandModule({
    providerDefinitions,
    settings: {
      readMergedSettings: () => settings,
    },
  });
}

describe('createModelCommandModule', () => {
  it('provides model metadata and executable command from one module owner', () => {
    const module = createModelCommandModule();
    const command = module.systemCommands?.[0];
    const entry = module.commandSources?.[0]?.getCommands()[0];

    expect(module.name).toBe('agent-command-model');
    expect(entry).toEqual(
      expect.objectContaining({
        name: 'model',
        description: 'Change AI model',
        argumentHint: '<model-id>',
        source: 'model',
      }),
    );
    expect(entry?.subcommands?.map((subcommand) => subcommand.name)).toContain('claude-sonnet-4-6');
    expect(command).toEqual(
      expect.objectContaining({
        name: 'model',
        description: 'Change AI model',
        argumentHint: '<model-id>',
        lifecycle: 'inline',
      }),
    );
    expect(command?.subcommands).toEqual(entry?.subcommands);
  });

  it('deduplicates date-suffixed model variants in descriptor subcommands', () => {
    const entry = createModelCommandModule().commandSources?.[0]?.getCommands()[0];
    const names = entry?.subcommands?.map((subcommand) => subcommand.name) ?? [];

    expect(names).toContain('claude-opus-4-6');
    expect(names).toContain('claude-sonnet-4-6');
    expect(names).toContain('claude-haiku-4-5');
    expect(names).not.toContain('claude-haiku-4-5-20251001');
    expect(names).not.toContain('claude-sonnet-4-5-20250929');
    expect(names).not.toContain('claude-opus-4-5-20251101');
  });

  it('formats subcommand descriptions with human-readable names and context windows', () => {
    const entry = createModelCommandModule().commandSources?.[0]?.getCommands()[0];
    const subcommands = entry?.subcommands ?? [];

    expect(
      subcommands.find((subcommand) => subcommand.name === 'claude-opus-4-6')?.description,
    ).toBe('Claude Opus 4.6 (1M)');
    expect(
      subcommands.find((subcommand) => subcommand.name === 'claude-haiku-4-5')?.description,
    ).toBe('Claude Haiku 4.5 (200K)');
  });

  it('lists models for the effective active provider instead of Claude defaults', () => {
    const entry = createModelModuleForSettings({
      currentProvider: 'qwen',
      providers: {
        qwen: { type: 'qwen', model: 'qwen-plus' },
        anthropic: { type: 'anthropic', model: 'claude-sonnet-4-6' },
      },
    }).commandSources?.[0]?.getCommands()[0];

    const names = entry?.subcommands?.map((subcommand) => subcommand.name) ?? [];
    expect(names).toEqual(['qwen-plus', 'qwen-max']);
    expect(names).not.toContain('claude-sonnet-4-6');
  });

  it('keeps manual model input available when the active provider has no catalog', async () => {
    const executor = new SystemCommandExecutor([
      ...(createModelModuleForSettings({
        currentProvider: 'openai',
        providers: {
          openai: { type: 'openai', model: 'gpt-5.1' },
        },
      }).systemCommands ?? []),
    ]);

    const usage = await executor.execute('model', commandHostContext, '');
    const manual = await executor.execute('model', commandHostContext, 'gpt-5.1');

    expect(usage?.success).toBe(false);
    expect(usage?.message).toContain('No model catalog available for provider openai');
    expect(manual?.success).toBe(true);
    expect(manual?.effects).toEqual([{ type: 'model-change-requested', modelId: 'gpt-5.1' }]);
  });

  it('surfaces refreshed catalog freshness when usage is requested', async () => {
    const executor = new SystemCommandExecutor([
      ...(createModelCommandModule({
        providerDefinitions: refreshableProviderDefinitions,
        settings: {
          readMergedSettings: () => ({
            currentProvider: 'openai',
            providers: {
              openai: { type: 'openai', model: 'gpt-5.1', apiKey: 'sk-test' },
            },
          }),
        },
      }).systemCommands ?? []),
    ]);

    const usage = await executor.execute('model', commandHostContext, '');

    expect(usage?.success).toBe(false);
    expect(usage?.message).toContain('Catalog: live; 1 model(s)');
    expect(usage?.message).toContain('verified 2026-05-05T00:00:00.000Z');
  });

  it('requests model changes through a typed command effect', async () => {
    const executor = new SystemCommandExecutor([
      ...(createModelCommandModule().systemCommands ?? []),
    ]);

    const result = await executor.execute('model', commandHostContext, 'claude-sonnet-4-6');

    expect(result?.success).toBe(true);
    expect(result?.data?.modelId).toBe('claude-sonnet-4-6');
    expect(result?.effects).toEqual([
      { type: 'model-change-requested', modelId: 'claude-sonnet-4-6' },
    ]);
  });

  it('shows usage when no model id is provided', async () => {
    const executor = new SystemCommandExecutor([
      ...(createModelCommandModule().systemCommands ?? []),
    ]);

    const result = await executor.execute('model', commandHostContext, '');

    expect(result?.success).toBe(false);
    expect(result?.message).toBe('Usage: model <model-id>');
  });
});
