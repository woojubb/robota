import { describe, expect, it } from 'vitest';

import {
  describeModelFallback,
  parseFallbackModelList,
  resolveModelFallbackChain,
  selectFallbackModelEntries,
} from '../model-fallback-chain.js';

import type { IResolveModelFallbackChainInput } from '../model-fallback-chain.js';
import type { TProviderSettingsDocument } from '../../command-api/provider/provider-settings.js';
import type { IAIProvider, IProviderDefinition } from '@robota-sdk/agent-core';

function definition(type: string, model?: string): IProviderDefinition {
  return {
    type,
    requiresApiKey: true,
    ...(model !== undefined && { defaults: { model } }),
    createProvider: (config) => ({ name: type, model: config.model }) as unknown as IAIProvider,
  };
}

const DEFINITIONS = [
  definition('anthropic'),
  definition('openai', 'gpt-default'),
  definition('gemini'),
];

const SETTINGS: TProviderSettingsDocument = {
  currentProvider: 'claude',
  providers: {
    claude: { type: 'anthropic', model: 'claude-main', apiKey: 'sk-ant' },
    openai: { type: 'openai', model: 'gpt-profile', apiKey: 'sk-oai' },
    gemini: { type: 'gemini', model: 'gemini-profile', apiKey: 'g-key' },
    nokey: { type: 'openai', model: 'gpt-nokey' },
  },
};

function input(
  entries: string[],
  overrides: Partial<IResolveModelFallbackChainInput> = {},
): IResolveModelFallbackChainInput {
  return {
    entries,
    settings: SETTINGS,
    primary: {
      profile: 'claude',
      config: { name: 'anthropic', model: 'claude-main', apiKey: 'sk-ant' },
    },
    providerDefinitions: DEFINITIONS,
    ...overrides,
  };
}

const refs = (chain: ReturnType<typeof resolveModelFallbackChain>): string[] =>
  chain.targets.map((target) => `${target.ref.provider}/${target.ref.model}`);

describe('resolveModelFallbackChain', () => {
  it('reads each entry form: profile, profile:model, bare model, and default', () => {
    const chain = resolveModelFallbackChain(
      input(['openai', 'gemini:gemini-pro', 'claude-smaller'], {
        primary: {
          profile: 'claude',
          config: { name: 'anthropic', model: 'claude-override', apiKey: 'sk-ant' },
        },
      }),
    );
    expect(refs(chain)).toEqual([
      'openai/gpt-profile',
      'gemini/gemini-pro',
      'anthropic/claude-smaller',
    ]);

    const withDefault = resolveModelFallbackChain(
      input(['default'], {
        primary: {
          profile: 'claude',
          config: { name: 'anthropic', model: 'claude-override', apiKey: 'sk-ant' },
        },
      }),
    );
    expect(refs(withDefault)).toEqual(['anthropic/claude-main']);
  });

  it('reads a colon that does not follow a profile as part of a model id', () => {
    const chain = resolveModelFallbackChain(input(['llama3:8b']));
    expect(refs(chain)).toEqual(['anthropic/llama3:8b']);
    expect(chain.notices).toEqual([
      'Fallback model "llama3:8b": "llama3" is not a provider profile, so it is read as a model on the primary\'s provider.',
    ]);
  });

  it('builds each entry from its own profile, on the entry model', () => {
    const chain = resolveModelFallbackChain(input(['openai', 'gemini:gemini-pro']));
    const built = chain.targets.map(
      (target) => target.create() as unknown as { name: string; model: string },
    );
    expect(built).toEqual([
      { name: 'openai', model: 'gpt-profile' },
      { name: 'gemini', model: 'gemini-pro' },
    ]);
  });

  it('leaves an entry that cannot be reached to fail when it is built, not when it is read', () => {
    const chain = resolveModelFallbackChain(input(['nokey', 'gemini']));
    expect(refs(chain)).toEqual(['openai/gpt-nokey', 'gemini/gemini-profile']);
    expect(() => chain.targets[0]!.create()).toThrow();
  });

  it('removes repeats and the primary, keeps three, and says what it dropped', () => {
    const chain = resolveModelFallbackChain(
      input([
        'claude-main',
        'openai',
        'openai:gpt-profile',
        'gemini',
        'claude-b',
        'claude-c',
        'claude-d',
      ]),
    );
    expect(refs(chain)).toEqual([
      'openai/gpt-profile',
      'gemini/gemini-profile',
      'anthropic/claude-b',
    ]);
    expect(chain.notices).toEqual([
      'Only the first 3 fallback models are used; dropped: claude-c, claude-d.',
    ]);
  });

  it('drops entries the organization does not allow, with a notice', () => {
    const chain = resolveModelFallbackChain(
      input(['openai', 'gemini:gemini-pro', 'claude-b'], {
        allowedProviders: ['claude', 'gemini'],
      }),
    );
    expect(refs(chain)).toEqual(['gemini/gemini-pro', 'anthropic/claude-b']);
    expect(chain.notices).toEqual([
      'Fallback models not allowed by your organization policy were dropped: openai.',
    ]);
  });
});

describe('selectFallbackModelEntries', () => {
  const settings: TProviderSettingsDocument = { ...SETTINGS, fallbackModel: ['openai', 'gemini'] };

  it('uses the flag over the settings', () => {
    expect(
      selectFallbackModelEntries(parseFallbackModelList('gemini:x, claude-b'), settings),
    ).toEqual(['gemini:x', 'claude-b']);
  });

  it('uses the settings when no flag is given', () => {
    expect(selectFallbackModelEntries(undefined, settings)).toEqual(['openai', 'gemini']);
    expect(selectFallbackModelEntries(undefined, SETTINGS)).toEqual([]);
  });
});

describe('describeModelFallback', () => {
  it('says which model failed and where the turn went', () => {
    expect(
      describeModelFallback({
        from: { provider: 'anthropic', model: 'claude-main' },
        to: { provider: 'openai', model: 'gpt-profile' },
        reason: 'overloaded',
      }),
    ).toBe('claude-main was overloaded; this turn continued on gpt-profile (openai).');
  });
});
