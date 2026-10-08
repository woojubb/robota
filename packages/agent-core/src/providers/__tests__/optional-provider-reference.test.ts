import { describe, expect, it } from 'vitest';
import { normalizeProviderConfig } from '../provider-factory.js';

describe('optional provider credential references', () => {
  it('rejects an explicit reference with no variable name rather than losing its provenance', () => {
    expect(() =>
      normalizeProviderConfig(
        {
          name: 'local',
          model: 'installed-model',
          apiKey: '$ENV:',
        },
        [],
        () => undefined,
      ),
    ).toThrow('API key environment reference');
  });
});
