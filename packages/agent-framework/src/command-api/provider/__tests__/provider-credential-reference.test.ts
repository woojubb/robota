import { describe, expect, it, vi } from 'vitest';
import { SettingsSchema } from '../../../config/config-types.js';
import { mergeSettings as mergeGeneralSettings } from '../../../config/config-merge.js';
import { buildProviderSetupPatch } from '../provider-settings.js';
import { mergeSettings, resolveActiveProvider } from '../provider-merge.js';
import { buildProviderProfilesSnapshot } from '../provider-profile-summary.js';

const reference = { service: 'robota.provider.openrouter', account: 'test-account' };
const definitions = [{ type: 'openrouter', requiresApiKey: true, createProvider: vi.fn() }];
const profile = {
  type: 'openrouter',
  model: 'test-model',
  baseURL: 'https://openrouter.ai/api/v1',
  apiKeyRef: reference,
};

describe('stored provider credential references', () => {
  it('persists references through schema parsing, setup and active profile resolution', () => {
    const parsed = SettingsSchema.parse({
      currentProvider: 'router',
      providers: { router: profile },
    });
    expect(parsed.providers?.router.apiKeyRef).toEqual(reference);
    const patch = buildProviderSetupPatch(
      { profile: 'router', type: 'openrouter', model: 'test-model', apiKeyRef: reference },
      { providerDefinitions: definitions },
    );
    expect(patch.providers.router.apiKeyRef).toEqual(reference);
    expect(patch.providers.router.apiKey).toBeUndefined();
    expect(resolveActiveProvider(parsed, undefined, definitions)?.apiKeyRef).toEqual(reference);
  });

  it('clears inherited stored credentials when another settings layer changes the endpoint', () => {
    const base = { providers: { router: profile } };
    const override = { providers: { router: { baseURL: 'https://different.example/v1' } } };
    expect(mergeSettings(base, override).providers?.router.apiKeyRef).toBeUndefined();
    expect(mergeGeneralSettings([base, override]).providers?.router.apiKeyRef).toBeUndefined();
  });

  it('clears an inherited reference when a layer explicitly selects an environment key', () => {
    const merged = mergeSettings(
      { providers: { router: profile } },
      { providers: { router: { apiKey: '$ENV:ROUTER_KEY' } } },
    );
    expect(merged.providers?.router.apiKeyRef).toBeUndefined();
    expect(merged.providers?.router.apiKey).toBe('$ENV:ROUTER_KEY');
  });

  it('does not silently substitute an environment account after a stored connection destination changes', () => {
    const registry = [{ ...definitions[0], defaults: { apiKey: '$ENV:OTHER_ROUTER_ACCOUNT' } }];
    const merged = mergeSettings(
      { currentProvider: 'router', providers: { router: profile } },
      { providers: { router: { baseURL: 'https://different.example/v1' } } },
    );
    const config = resolveActiveProvider(merged, undefined, registry, {
      OTHER_ROUTER_ACCOUNT: 'different-account-secret',
    });
    expect(config?.apiKey).not.toBe('different-account-secret');
  });

  it('does not label a stored credential reference as a missing manual key', () => {
    const snapshot = buildProviderProfilesSnapshot({ router: profile }, 'router', definitions);
    expect(snapshot.profiles[0]?.connectionState).toBeUndefined();
  });
});
