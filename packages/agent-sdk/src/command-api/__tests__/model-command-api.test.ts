import { describe, expect, it } from 'vitest';
import type { IProviderDefinition } from '@robota-sdk/agent-core';
import {
  buildModelCommandSubcommands,
  formatModelCommandUsageMessage,
  resolveActiveProviderModelCatalog,
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
    expect(formatModelCommandUsageMessage({ providerDefinitions, settings })).toBe(
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
});
