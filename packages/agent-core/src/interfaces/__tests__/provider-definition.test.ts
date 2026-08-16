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

  it('carries no model-catalog refresh hook — the contract is discovery, not a live fetch', () => {
    // PROV-008: `refreshModelCatalog` was declared by every provider definition and invoked by
    // nothing, and its path could not have populated the static payloads anyway — a models-list
    // endpoint returns ids. A structure with no caller and no reader is dead structure, not a dead
    // field, so it was removed rather than given a caller nobody asked for.
    const definition: IProviderDefinition = {
      type: 'openai',
      createProvider: () => {
        throw new Error('not used');
      },
    };

    expect('refreshModelCatalog' in definition).toBe(false);
  });

  it('allows provider-owned setup help links', () => {
    const definition: IProviderDefinition = {
      ...providerDefinition,
      setupHelpLinks: [
        {
          kind: 'api-key',
          label: 'Gemini API keys',
          url: 'https://aistudio.google.com/apikey',
          sourceUrl: 'https://ai.google.dev/gemini-api/docs/api-key',
          lastVerifiedAt: '2026-05-08',
        },
      ],
    };

    expect(definition.setupHelpLinks?.[0]).toMatchObject({
      kind: 'api-key',
      label: 'Gemini API keys',
    });
  });
});
