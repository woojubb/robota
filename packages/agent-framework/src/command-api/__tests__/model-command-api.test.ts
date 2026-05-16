import { describe, expect, it } from 'vitest';
import type { IProviderDefinition } from '@robota-sdk/agent-core';
import {
  buildModelCommandSubcommands,
  formatModelCommandUsageMessageAsync,
  formatModelCommandUsageMessage,
  resolveActiveProviderModelCatalog,
  resolveActiveProviderModelCatalogState,
} from '../model/model-command-api.js';

const providerDefinitions: readonly IProviderDefinition[] = [
  {
    type: 'anthropic',
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
    refreshModelCatalog: async ({ profile }) => ({
      status: profile.apiKey === 'sk-test' ? 'live' : 'unavailable',
      sourceUrl: 'https://platform.openai.com/docs/api-reference/models/list',
      message: profile.apiKey === 'sk-test' ? '2 model(s) discovered.' : 'missing apiKey',
      ...(profile.apiKey === 'sk-test'
        ? {
            entries: [
              { id: 'gpt-5.1', displayName: 'gpt-5.1', lifecycle: 'active' },
              { id: 'gpt-5.1-mini', displayName: 'gpt-5.1-mini', lifecycle: 'active' },
            ],
            lastVerifiedAt: '2026-05-05T00:00:00.000Z',
          }
        : {}),
    }),
    createProvider: () => {
      throw new Error('not used');
    },
  },
];

describe('model command common API', () => {
  it('builds model subcommands from the effective active provider catalog', () => {
    const subcommands = buildModelCommandSubcommands({
      providerDefinitions,
      settings: {
        currentProvider: 'qwen',
        providers: {
          qwen: { type: 'qwen', model: 'qwen-plus' },
          anthropic: { type: 'anthropic', model: 'claude-sonnet-4-6' },
        },
      },
    });

    expect(subcommands.map((command) => command.name)).toEqual(['qwen-plus']);
    expect(subcommands[0]?.description).toBe('Qwen Plus');
  });

  it('returns no subcommands and a manual usage message for unavailable catalogs', () => {
    const settings = {
      currentProvider: 'openai',
      providers: {
        openai: { type: 'openai', model: 'gpt-5.1' },
      },
    };

    expect(buildModelCommandSubcommands({ providerDefinitions, settings })).toEqual([]);
    expect(formatModelCommandUsageMessage({ providerDefinitions, settings })).toContain(
      'No model catalog available for provider openai. Usage: model <model-id>',
    );
  });

  it('resolves catalog metadata without exposing provider-specific branches to callers', () => {
    const catalog = resolveActiveProviderModelCatalog(
      {
        currentProvider: 'anthropic',
        providers: {
          anthropic: { type: 'anthropic', model: 'claude-sonnet-4-6' },
        },
      },
      providerDefinitions,
    );

    expect(catalog?.status).toBe('fallback');
    expect(catalog?.lastVerifiedAt).toBe('2026-05-04');
  });

  it('refreshes the active provider catalog through provider-owned adapters', async () => {
    const state = await resolveActiveProviderModelCatalogState({
      refresh: true,
      providerDefinitions,
      settings: {
        currentProvider: 'openai',
        providers: {
          openai: { type: 'openai', model: 'gpt-5.1', apiKey: 'sk-test' },
        },
      },
    });

    expect(state?.refreshAttempted).toBe(true);
    expect(state?.catalog?.status).toBe('live');
    expect(state?.catalog?.entries?.map((entry) => entry.id)).toEqual(['gpt-5.1', 'gpt-5.1-mini']);
  });

  it('falls back to unavailable catalog metadata when refresh fails', async () => {
    const state = await resolveActiveProviderModelCatalogState({
      refresh: true,
      providerDefinitions,
      settings: {
        currentProvider: 'openai',
        providers: {
          openai: { type: 'openai', model: 'gpt-5.1' },
        },
      },
    });

    expect(state?.refreshAttempted).toBe(true);
    expect(state?.refreshMessage).toBe('missing apiKey');
    expect(state?.catalog?.status).toBe('unavailable');
    expect(state?.catalog?.message).toBe('OpenAI models should be discovered live.');
  });

  it('auto-refreshes stale catalog when modelCatalogCacheTtlSeconds is set', async () => {
    const staleDate = new Date(Date.now() - 2 * 86400 * 1000).toISOString();
    const staleProviderDefs: readonly IProviderDefinition[] = [
      {
        type: 'openai',
        modelCatalog: {
          status: 'fallback',
          lastVerifiedAt: staleDate,
          entries: [{ id: 'old-model', displayName: 'Old Model', lifecycle: 'active' }],
        },
        modelCatalogCacheTtlSeconds: 86400,
        refreshModelCatalog: async () => ({
          status: 'live',
          sourceUrl: 'https://platform.openai.com/docs/api-reference/models/list',
          lastVerifiedAt: new Date().toISOString(),
          entries: [{ id: 'fresh-model', displayName: 'Fresh Model', lifecycle: 'active' }],
        }),
        createProvider: () => {
          throw new Error('not used');
        },
      },
    ];

    const state = await resolveActiveProviderModelCatalogState({
      providerDefinitions: staleProviderDefs,
      settings: {
        currentProvider: 'openai',
        providers: { openai: { type: 'openai', apiKey: 'sk-test' } },
      },
    });

    expect(state?.refreshAttempted).toBe(true);
    expect(state?.catalog?.status).toBe('live');
    expect(state?.catalog?.entries?.[0]?.id).toBe('fresh-model');
  });

  it('does not auto-refresh when catalog is within TTL', async () => {
    const freshDate = new Date().toISOString();
    const refreshFn = async (): Promise<never> => {
      throw new Error('should not be called');
    };
    const freshProviderDefs: readonly IProviderDefinition[] = [
      {
        type: 'openai',
        modelCatalog: {
          status: 'fallback',
          lastVerifiedAt: freshDate,
          entries: [{ id: 'current-model', displayName: 'Current Model', lifecycle: 'active' }],
        },
        modelCatalogCacheTtlSeconds: 86400,
        refreshModelCatalog: refreshFn,
        createProvider: () => {
          throw new Error('not used');
        },
      },
    ];

    const state = await resolveActiveProviderModelCatalogState({
      providerDefinitions: freshProviderDefs,
      settings: {
        currentProvider: 'openai',
        providers: { openai: { type: 'openai', apiKey: 'sk-test' } },
      },
    });

    expect(state?.refreshAttempted).toBe(false);
    expect(state?.catalog?.status).toBe('fallback');
    expect(state?.catalog?.entries?.[0]?.id).toBe('current-model');
  });

  it('formats refreshed catalog freshness in model usage', async () => {
    const usage = await formatModelCommandUsageMessageAsync({
      refresh: true,
      providerDefinitions,
      settings: {
        currentProvider: 'openai',
        providers: {
          openai: { type: 'openai', model: 'gpt-5.1', apiKey: 'sk-test' },
        },
      },
    });

    expect(usage).toContain('Usage: model <model-id>');
    expect(usage).toContain('Catalog: live; 2 model(s)');
    expect(usage).toContain('verified 2026-05-05T00:00:00.000Z');
  });
});
