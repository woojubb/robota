import { describe, expect, it, vi } from 'vitest';
import { createProviderFromConfig, normalizeProviderConfig } from './provider-factory.js';

const reference = { service: 'robota.provider.openrouter', account: 'test-account' };

describe('host provider credential references', () => {
  it('retains the reference and never substitutes a default environment credential', () => {
    const config = normalizeProviderConfig(
      { name: 'openrouter', model: 'test-model', apiKeyRef: reference },
      [{ type: 'openrouter', defaults: { apiKey: '$ENV:OTHER_KEY' }, createProvider: vi.fn() }],
      () => 'unrelated-secret',
    );
    expect(config.apiKeyRef).toEqual(reference);
    expect(config.apiKey).toBeUndefined();
    expect(config.apiKeyEnv).toBeUndefined();
  });

  it('rejects conflicting key origins rather than selecting one silently', () => {
    expect(() =>
      normalizeProviderConfig(
        { name: 'openrouter', model: 'test-model', apiKeyRef: reference, apiKey: 'literal-secret' },
        [],
      ),
    ).toThrow(/credential/i);
  });

  it('requires host resolution before a synchronous provider can consume a reference', () => {
    const createProvider = vi.fn();
    expect(() =>
      createProviderFromConfig({ name: 'openrouter', model: 'test-model', apiKeyRef: reference }, [
        { type: 'openrouter', createProvider },
      ]),
    ).toThrow(/resolve|credential/i);
    expect(createProvider).not.toHaveBeenCalled();
  });
});
