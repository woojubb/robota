import { describe, it, expect } from 'vitest';
import {
  normalizeProviderConfig,
  resolveProfileApiKey,
  createProviderFromConfig,
  createProviderFromProfile,
} from './provider-factory.js';
import type { IProviderDefinition, IAIProvider } from '@robota-sdk/agent-core';
import type { ISerializableProviderProfile } from '../background-tasks/types.js';

const createStubProvider = (): IAIProvider => ({ type: 'stub' }) as unknown as IAIProvider;

const stubDefs: IProviderDefinition[] = [
  {
    type: 'anthropic',
    credentialRequirement: { anyOf: ['apiKey'] },
    defaults: { model: 'claude-3-opus' },
    createProvider: createStubProvider,
  },
  {
    type: 'ollama',
    defaults: { model: 'llama3', baseURL: 'http://localhost:11434' },
    createProvider: createStubProvider,
  },
];

describe('normalizeProviderConfig', () => {
  it('applies provider defaults for missing fields', () => {
    const config = normalizeProviderConfig({ name: 'anthropic', apiKey: 'sk-test' }, stubDefs);
    expect(config.model).toBe('claude-3-opus');
  });

  it('overrides defaults with explicit model', () => {
    const config = normalizeProviderConfig(
      { name: 'anthropic', model: 'claude-3-sonnet', apiKey: 'sk-test' },
      stubDefs,
    );
    expect(config.model).toBe('claude-3-sonnet');
  });

  it('throws when model cannot be resolved', () => {
    const noModelDefs: IProviderDefinition[] = [
      { type: 'no-model', defaults: {}, createProvider: createStubProvider },
    ];
    expect(() => normalizeProviderConfig({ name: 'no-model' }, noModelDefs)).toThrow(
      'requires model',
    );
  });

  it('resolves $ENV: reference in apiKey', () => {
    process.env.TEST_AGENT_KEY = 'env-resolved-key';
    try {
      const config = normalizeProviderConfig(
        { name: 'anthropic', model: 'claude-3-opus', apiKey: '$ENV:TEST_AGENT_KEY' },
        stubDefs,
      );
      expect(config.apiKey).toBe('env-resolved-key');
    } finally {
      delete process.env.TEST_AGENT_KEY;
    }
  });

  it('returns raw value when apiKey is not an env reference', () => {
    const config = normalizeProviderConfig(
      { name: 'anthropic', model: 'claude-3-opus', apiKey: 'direct-key' },
      stubDefs,
    );
    expect(config.apiKey).toBe('direct-key');
  });

  it('applies baseURL default from definition', () => {
    const config = normalizeProviderConfig({ name: 'ollama' }, stubDefs);
    expect(config.baseURL).toBe('http://localhost:11434');
  });
});

describe('resolveProfileApiKey', () => {
  it('returns direct apiKey value', () => {
    const profile: ISerializableProviderProfile = {
      type: 'anthropic',
      model: 'claude-3-opus',
      apiKey: 'direct-key',
    };
    expect(resolveProfileApiKey(profile)).toBe('direct-key');
  });

  it('resolves apiKey with $ENV: prefix', () => {
    process.env.TEST_RESOLVE_KEY = 'resolved-from-env';
    try {
      const profile: ISerializableProviderProfile = {
        type: 'anthropic',
        model: 'claude-3-opus',
        apiKey: '$ENV:TEST_RESOLVE_KEY',
      };
      expect(resolveProfileApiKey(profile)).toBe('resolved-from-env');
    } finally {
      delete process.env.TEST_RESOLVE_KEY;
    }
  });

  it('resolves apiKeyEnv to env var', () => {
    process.env.TEST_KEY_ENV = 'from-env-var';
    try {
      const profile: ISerializableProviderProfile = {
        type: 'anthropic',
        model: 'claude-3-opus',
        apiKeyEnv: 'TEST_KEY_ENV',
      };
      expect(resolveProfileApiKey(profile)).toBe('from-env-var');
    } finally {
      delete process.env.TEST_KEY_ENV;
    }
  });

  it('returns undefined when no apiKey or apiKeyEnv', () => {
    const profile: ISerializableProviderProfile = { type: 'ollama', model: 'llama3' };
    expect(resolveProfileApiKey(profile)).toBeUndefined();
  });
});

describe('createProviderFromConfig', () => {
  it('creates provider using matching definition', () => {
    const result = createProviderFromConfig(
      { name: 'anthropic', model: 'claude-3-opus', apiKey: 'sk-test' },
      stubDefs,
    );
    expect(result).toBeDefined();
  });

  it('throws for unknown provider type', () => {
    expect(() =>
      createProviderFromConfig({ name: 'unknown-provider', model: 'x' }, stubDefs),
    ).toThrow('Unknown provider');
  });

  it('throws when required credential is missing', () => {
    expect(() =>
      createProviderFromConfig({ name: 'anthropic', model: 'claude-3-opus' }, stubDefs),
    ).toThrow('apiKey');
  });

  it('succeeds for provider without credential requirement', () => {
    const result = createProviderFromConfig(
      { name: 'ollama', model: 'llama3', baseURL: 'http://localhost:11434' },
      stubDefs,
    );
    expect(result).toBeDefined();
  });
});

describe('createProviderFromProfile', () => {
  it('creates provider from serializable profile', () => {
    const profile: ISerializableProviderProfile = {
      type: 'anthropic',
      model: 'claude-3-opus',
      apiKey: 'sk-test',
    };
    const result = createProviderFromProfile(profile, undefined, stubDefs);
    expect(result).toBeDefined();
  });

  it('applies model override over profile model', () => {
    const profile: ISerializableProviderProfile = {
      type: 'anthropic',
      model: 'claude-3-opus',
      apiKey: 'sk-test',
    };
    expect(() => createProviderFromProfile(profile, 'claude-3-sonnet', stubDefs)).not.toThrow();
  });

  it('resolves apiKey from profile', () => {
    const profile: ISerializableProviderProfile = {
      type: 'anthropic',
      model: 'claude-3-opus',
      apiKey: 'sk-from-profile',
    };
    const result = createProviderFromProfile(profile, undefined, stubDefs);
    expect(result).toBeDefined();
  });
});
