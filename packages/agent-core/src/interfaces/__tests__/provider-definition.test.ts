import { describe, expect, it } from 'vitest';
import type { IProviderDefinition } from '../provider-definition';
import {
  findProviderDefinition,
  formatSupportedProviderTypes,
  getProviderCredentialRequirement,
} from '../provider-definition';

const providerDefinition: IProviderDefinition = {
  type: 'gemini',
  aliases: ['google'],
  createProvider: () => {
    throw new Error('not used');
  },
};

describe('provider definition helpers', () => {
  it('resolves provider definitions by canonical type', () => {
    expect(findProviderDefinition([providerDefinition], 'gemini')).toBe(providerDefinition);
  });

  it('resolves provider definitions by compatibility alias', () => {
    expect(findProviderDefinition([providerDefinition], 'google')).toBe(providerDefinition);
  });

  it('formats provider types with aliases for user-facing diagnostics', () => {
    expect(formatSupportedProviderTypes([providerDefinition])).toBe('gemini (alias: google)');
  });

  it('returns explicit provider credential requirements before legacy API key metadata', () => {
    expect(
      getProviderCredentialRequirement({
        ...providerDefinition,
        credentialRequirement: { anyOf: ['apiKey'] },
        requiresApiKey: true,
      }),
    ).toEqual({ anyOf: ['apiKey'] });
  });

  it('derives legacy API key requirements for existing provider definitions', () => {
    expect(
      getProviderCredentialRequirement({
        ...providerDefinition,
        requiresApiKey: true,
      }),
    ).toEqual({ anyOf: ['apiKey'] });
  });

  it('allows provider-owned model catalog refresh hooks', async () => {
    const refreshableDefinition: IProviderDefinition = {
      type: 'openai',
      refreshModelCatalog: async ({ profile }) => ({
        status: 'live',
        entries: [
          {
            id: profile.model ?? 'gpt-test',
            displayName: profile.model ?? 'gpt-test',
            lifecycle: 'active',
          },
        ],
      }),
      createProvider: () => {
        throw new Error('not used');
      },
    };

    const catalog = await refreshableDefinition.refreshModelCatalog?.({
      profile: { type: 'openai', model: 'gpt-5.1' },
    });

    expect(catalog?.status).toBe('live');
    expect(catalog?.entries?.[0]?.id).toBe('gpt-5.1');
  });
});
