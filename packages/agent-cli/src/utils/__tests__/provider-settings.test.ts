import { describe, it, expect } from 'vitest';
import {
  buildProviderSetupPatch,
  deleteProviderProfile,
  setCurrentProvider,
  upsertProviderProfile,
  validateProviderProfile,
} from '../provider-settings.js';
import type { IProviderDefinition } from '../provider-definition.js';

const providerDefinitions: readonly IProviderDefinition[] = [
  {
    type: 'anthropic',
    defaults: { model: 'claude-sonnet-4-6' },
    requiresApiKey: true,
    createProvider: () => {
      throw new Error('not used');
    },
  },
  {
    type: 'custom',
    defaults: {
      model: 'custom-model',
      apiKey: 'custom-key',
      baseURL: 'http://localhost:9999/v1',
    },
    requiresApiKey: true,
    createProvider: () => {
      throw new Error('not used');
    },
  },
];

describe('provider settings helpers', () => {
  it('updates one profile without changing other profiles or unrelated settings', () => {
    const settings = {
      language: 'ko',
      currentProvider: 'openai',
      providers: {
        openai: {
          type: 'openai',
          model: 'supergemma4-26b-uncensored-v2',
          apiKey: 'lm-studio',
        },
        anthropic: {
          type: 'anthropic',
          model: 'claude-sonnet-4-6',
          apiKey: '$ENV:ANTHROPIC_API_KEY',
        },
      },
    };

    const next = upsertProviderProfile(settings, 'anthropic', {
      type: 'anthropic',
      model: 'claude-opus-4-5',
      apiKey: '$ENV:NEW_ANTHROPIC_KEY',
    });

    expect(next.language).toBe('ko');
    expect(next.currentProvider).toBe('openai');
    expect(next.providers?.openai).toEqual(settings.providers.openai);
    expect(next.providers?.anthropic).toEqual({
      type: 'anthropic',
      model: 'claude-opus-4-5',
      apiKey: '$ENV:NEW_ANTHROPIC_KEY',
    });
  });

  it('does not mutate settings when setting a missing current provider', () => {
    const settings = {
      currentProvider: 'openai',
      providers: {
        openai: { type: 'openai', model: 'supergemma4-26b-uncensored-v2' },
      },
    };

    expect(() => setCurrentProvider(settings, 'anthropic')).toThrow(
      'Provider profile "anthropic" was not found',
    );
    expect(settings.currentProvider).toBe('openai');
  });

  it('stores api-key-env as an env reference without reading the environment value', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-real-value';

    const patch = buildProviderSetupPatch(
      {
        profile: 'anthropic',
        type: 'anthropic',
        model: 'claude-sonnet-4-6',
        apiKeyEnv: 'ANTHROPIC_API_KEY',
        setCurrent: true,
      },
      { providerDefinitions },
    );

    expect(patch.providers.anthropic?.apiKey).toBe('$ENV:ANTHROPIC_API_KEY');
    expect(patch.providers.anthropic?.apiKey).not.toBe('sk-real-value');
    expect(patch.currentProvider).toBe('anthropic');
  });

  it('validates required fields by provider type', () => {
    expect(() =>
      validateProviderProfile(
        'anthropic',
        { type: 'anthropic', model: 'claude-sonnet-4-6' },
        { providerDefinitions },
      ),
    ).toThrow('missing apiKey');

    expect(() =>
      validateProviderProfile('openai', { type: 'openai', apiKey: 'lm-studio' }),
    ).toThrow('missing model');
  });

  it('builds provider profiles from injected provider defaults', () => {
    const patch = buildProviderSetupPatch(
      {
        profile: 'custom',
        type: 'custom',
        setCurrent: true,
      },
      { providerDefinitions },
    );

    expect(patch.currentProvider).toBe('custom');
    expect(patch.providers.custom).toEqual({
      type: 'custom',
      model: 'custom-model',
      apiKey: 'custom-key',
      baseURL: 'http://localhost:9999/v1',
    });
  });

  it('deletes inactive provider profiles without changing the current provider', () => {
    const settings = {
      currentProvider: 'openai',
      providers: {
        openai: { type: 'openai', model: 'gpt-4o', apiKey: 'sk-openai' },
        anthropic: {
          type: 'anthropic',
          model: 'claude-sonnet-4-6',
          apiKey: '$ENV:ANTHROPIC_API_KEY',
        },
      },
    };

    const next = deleteProviderProfile(settings, 'anthropic');

    expect(next.currentProvider).toBe('openai');
    expect(next.providers).toEqual({
      openai: { type: 'openai', model: 'gpt-4o', apiKey: 'sk-openai' },
    });
  });

  it('requires a valid replacement when deleting the active provider profile', () => {
    const settings = {
      currentProvider: 'anthropic',
      providers: {
        openai: { type: 'openai', model: 'gpt-4o', apiKey: 'sk-openai' },
        anthropic: {
          type: 'anthropic',
          model: 'claude-sonnet-4-6',
          apiKey: '$ENV:ANTHROPIC_API_KEY',
        },
      },
    };

    const next = deleteProviderProfile(settings, 'anthropic', {
      replacementCurrentProvider: 'openai',
    });

    expect(next.currentProvider).toBe('openai');
    expect(next.providers).toEqual({
      openai: { type: 'openai', model: 'gpt-4o', apiKey: 'sk-openai' },
    });
    expect(() =>
      deleteProviderProfile(settings, 'anthropic', { replacementCurrentProvider: 'missing' }),
    ).toThrow('Provider profile "missing" was not found');
  });
});
