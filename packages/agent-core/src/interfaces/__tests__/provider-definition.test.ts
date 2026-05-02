import { describe, expect, it } from 'vitest';
import type { IProviderDefinition } from '../provider-definition';
import { findProviderDefinition, formatSupportedProviderTypes } from '../provider-definition';

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
});
