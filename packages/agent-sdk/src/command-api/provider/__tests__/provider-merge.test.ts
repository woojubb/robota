import { describe, it, expect } from 'vitest';
import { mergeSettings, mergeProviders, resolveActiveProvider } from '../provider-merge.js';
import type { TProviderSettingsDocument } from '../provider-settings.js';
import type { IProviderDefinition, IAIProvider } from '@robota-sdk/agent-core';

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

describe('mergeSettings', () => {
  it('merges two empty documents', () => {
    expect(mergeSettings({}, {})).toEqual({});
  });

  it('override takes precedence for top-level keys', () => {
    const base: TProviderSettingsDocument = { currentProvider: 'base' };
    const override: TProviderSettingsDocument = { currentProvider: 'override' };
    expect(mergeSettings(base, override).currentProvider).toBe('override');
  });

  it('merges provider objects shallowly', () => {
    const base: TProviderSettingsDocument = {
      provider: { name: 'anthropic', apiKey: 'base-key' },
    };
    const override: TProviderSettingsDocument = {
      provider: { model: 'claude-3-sonnet' },
    };
    const result = mergeSettings(base, override);
    expect(result.provider?.name).toBe('anthropic');
    expect(result.provider?.apiKey).toBe('base-key');
    expect(result.provider?.model).toBe('claude-3-sonnet');
  });

  it('preserves base provider when override has none', () => {
    const base: TProviderSettingsDocument = {
      provider: { name: 'anthropic', apiKey: 'key' },
    };
    const result = mergeSettings(base, {});
    expect(result.provider?.name).toBe('anthropic');
  });

  it('merges providers map', () => {
    const base: TProviderSettingsDocument = {
      providers: { p1: { type: 'anthropic', model: 'claude-3-opus', apiKey: 'k1' } },
    };
    const override: TProviderSettingsDocument = {
      providers: { p2: { type: 'ollama', model: 'llama3' } },
    };
    const result = mergeSettings(base, override);
    expect(result.providers?.p1?.type).toBe('anthropic');
    expect(result.providers?.p2?.type).toBe('ollama');
  });
});

describe('mergeProviders', () => {
  it('returns empty object for undefined inputs', () => {
    expect(mergeProviders(undefined, undefined)).toEqual({});
  });

  it('applies base when override is undefined', () => {
    const result = mergeProviders({ p1: { type: 'anthropic', model: 'claude-3-opus' } }, undefined);
    expect(result?.p1?.type).toBe('anthropic');
  });

  it('merges profile entries shallowly', () => {
    const base = { p1: { type: 'anthropic', model: 'claude-3-opus', apiKey: 'base-k' } };
    const override = { p1: { type: 'anthropic', model: 'claude-3-sonnet' } };
    const result = mergeProviders(base, override);
    expect(result?.p1?.model).toBe('claude-3-sonnet');
    expect(result?.p1?.apiKey).toBe('base-k');
  });
});

describe('resolveActiveProvider', () => {
  it('resolves from currentProvider profile', () => {
    const settings: TProviderSettingsDocument = {
      currentProvider: 'myprofile',
      providers: {
        myprofile: { type: 'anthropic', model: 'claude-3-opus', apiKey: 'sk-test' },
      },
    };
    const config = resolveActiveProvider(settings, undefined, stubDefs);
    expect(config?.name).toBe('anthropic');
    expect(config?.model).toBe('claude-3-opus');
  });

  it('providerOverride takes precedence over currentProvider', () => {
    const settings: TProviderSettingsDocument = {
      currentProvider: 'default',
      providers: {
        default: { type: 'anthropic', model: 'claude-3-opus', apiKey: 'sk-default' },
        override: { type: 'ollama', model: 'llama3' },
      },
    };
    const config = resolveActiveProvider(settings, 'override', stubDefs);
    expect(config?.name).toBe('ollama');
  });

  it('resolves from legacy provider field', () => {
    const settings: TProviderSettingsDocument = {
      provider: { name: 'anthropic', model: 'claude-3-opus', apiKey: 'sk-legacy' },
    };
    const config = resolveActiveProvider(settings, undefined, stubDefs);
    expect(config?.name).toBe('anthropic');
    expect(config?.apiKey).toBe('sk-legacy');
  });

  it('returns undefined when no provider configured', () => {
    const config = resolveActiveProvider({}, undefined, stubDefs);
    expect(config).toBeUndefined();
  });

  it('throws when profile is not found in providers', () => {
    const settings: TProviderSettingsDocument = {
      currentProvider: 'missing',
      providers: {},
    };
    expect(() => resolveActiveProvider(settings, undefined, stubDefs)).toThrow('"missing"');
  });

  it('throws when profile is missing type', () => {
    const settings: TProviderSettingsDocument = {
      currentProvider: 'notype',
      providers: { notype: { model: 'x' } },
    };
    expect(() => resolveActiveProvider(settings, undefined, stubDefs)).toThrow('missing type');
  });
});
