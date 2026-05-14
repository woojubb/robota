import { describe, expect, it } from 'vitest';
import { checkSettingsDocument } from '../settings-check.js';
import type { TProviderSettingsDocument } from '../provider-settings.js';
import type { IProviderDefinition } from '@robota-sdk/agent-core';

const stubCreateProvider = (): never => {
  throw new Error('not used in tests');
};

describe('checkSettingsDocument', () => {
  it('returns "incomplete" for empty settings', () => {
    const settings: TProviderSettingsDocument = {};
    expect(checkSettingsDocument(settings)).toBe('incomplete');
  });

  it('returns "valid" when legacy provider has apiKey and matching definition', () => {
    const settings: TProviderSettingsDocument = {
      provider: { name: 'anthropic', apiKey: 'sk-ant-real' },
    };
    const defs: IProviderDefinition[] = [
      {
        type: 'anthropic',
        credentialRequirement: { anyOf: ['apiKey'] },
        createProvider: stubCreateProvider,
      },
    ];
    expect(checkSettingsDocument(settings, defs)).toBe('valid');
  });

  it('returns "valid" when legacy provider has apiKey without type (no def needed)', () => {
    const settings: TProviderSettingsDocument = {
      provider: { apiKey: 'sk-legacy' },
    };
    expect(checkSettingsDocument(settings)).toBe('valid');
  });

  it('returns "incomplete" when legacy provider has no apiKey', () => {
    const settings: TProviderSettingsDocument = {
      provider: { name: 'anthropic' },
    };
    expect(checkSettingsDocument(settings)).toBe('incomplete');
  });

  it('returns "valid" when currentProvider profile has apiKey and matching definition', () => {
    const settings: TProviderSettingsDocument = {
      currentProvider: 'myprofile',
      providers: {
        myprofile: { type: 'anthropic', model: 'claude-opus-4-5', apiKey: 'sk-ant-real' },
      },
    };
    const defs: IProviderDefinition[] = [
      {
        type: 'anthropic',
        credentialRequirement: { anyOf: ['apiKey'] },
        createProvider: stubCreateProvider,
      },
    ];
    expect(checkSettingsDocument(settings, defs)).toBe('valid');
  });

  it('returns "incomplete" when currentProvider profile has no apiKey', () => {
    const settings: TProviderSettingsDocument = {
      currentProvider: 'myprofile',
      providers: {
        myprofile: { type: 'anthropic', model: 'claude-opus-4-5' },
      },
    };
    const defs: IProviderDefinition[] = [
      {
        type: 'anthropic',
        credentialRequirement: { anyOf: ['apiKey'] },
        createProvider: stubCreateProvider,
      },
    ];
    expect(checkSettingsDocument(settings, defs)).toBe('incomplete');
  });

  it('returns "incomplete" when currentProvider is missing from providers map', () => {
    const settings: TProviderSettingsDocument = {
      currentProvider: 'missing',
      providers: {},
    };
    expect(checkSettingsDocument(settings)).toBe('incomplete');
  });

  it('uses providerDefinitions credential requirement when provided', () => {
    const settings: TProviderSettingsDocument = {
      currentProvider: 'local',
      providers: {
        local: { type: 'ollama', model: 'llama3' },
      },
    };
    // ollama definition with no credential requirement → valid
    const providerDefinitions: IProviderDefinition[] = [
      {
        type: 'ollama',
        defaults: { model: 'llama3', baseURL: 'http://localhost:11434' },
        createProvider: stubCreateProvider,
      },
    ];
    expect(checkSettingsDocument(settings, providerDefinitions)).toBe('valid');
  });

  it('returns "incomplete" for unknown provider type with no apiKey', () => {
    const settings: TProviderSettingsDocument = {
      currentProvider: 'myprofile',
      providers: {
        myprofile: { type: 'unknown-provider', model: 'model-x' },
      },
    };
    expect(checkSettingsDocument(settings)).toBe('incomplete');
  });
});
