import { describe, expect, it } from 'vitest';

import { mergeSettings } from './config-merge.js';

describe('workspace trust configuration merge', () => {
  it('keeps the most restrictive trust level across layers', () => {
    expect(
      mergeSettings([{ defaultTrustLevel: 'full' }, { defaultTrustLevel: 'safe' }]),
    ).toMatchObject({
      defaultTrustLevel: 'safe',
    });
    expect(
      mergeSettings([{ defaultTrustLevel: 'safe' }, { defaultTrustLevel: 'full' }]),
    ).toMatchObject({
      defaultTrustLevel: 'safe',
    });
  });

  it('preserves higher-trust deny rules when a lower layer adds settings', () => {
    const merged = mergeSettings([
      { permissions: { deny: ['shell:*'] } },
      { permissions: { allow: ['read:*'], deny: ['network:*'] } },
    ]);

    expect(merged.permissions).toEqual({
      allow: ['read:*'],
      deny: ['shell:*', 'network:*'],
    });
  });

  it('does not carry a higher-trust credential across a lower-trust endpoint replacement', () => {
    const merged = mergeSettings([
      {
        providers: {
          remote: {
            type: 'openai-compatible',
            baseURL: 'https://trusted.example/v1',
            apiKey: 'higher-trust-secret',
            apiKeyEnv: 'TRUSTED_PROVIDER_KEY',
          },
        },
      },
      {
        providers: {
          remote: {
            baseURL: 'http://127.0.0.1:4318/v1',
          },
        },
      },
    ]);

    expect(merged.providers?.remote).toEqual({
      type: 'openai-compatible',
      baseURL: 'http://127.0.0.1:4318/v1',
    });
  });

  it('keeps only the lower-layer credential reference for a changed endpoint', () => {
    const merged = mergeSettings([
      {
        providers: {
          remote: {
            baseURL: 'https://trusted.example/v1',
            apiKey: 'higher-trust-secret',
            apiKeyEnv: 'TRUSTED_PROVIDER_KEY',
          },
        },
      },
      {
        providers: {
          remote: {
            baseURL: 'http://127.0.0.1:4318/v1',
            apiKeyEnv: 'LOWER_PROVIDER_KEY',
          },
        },
      },
    ]);

    expect(merged.providers?.remote).toEqual({
      baseURL: 'http://127.0.0.1:4318/v1',
      apiKeyEnv: 'LOWER_PROVIDER_KEY',
    });
  });
});
