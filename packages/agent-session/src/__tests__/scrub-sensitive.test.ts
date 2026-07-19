import { describe, expect, it } from 'vitest';

import { isSensitiveKey, scrubSensitiveKeys } from '../scrub-sensitive.js';

/**
 * SELFHOST-014 — the shared sensitive-key scrub SSOT (also consumed by FileSessionLogger).
 */

describe('isSensitiveKey', () => {
  it('matches the sensitive key set (case/-/_-insensitive) and nothing else', () => {
    for (const k of [
      'apiKey',
      'api_key',
      'Authorization',
      'access-token',
      'refreshToken',
      'secret',
      'password',
      'x-api-key',
    ]) {
      expect(isSensitiveKey(k)).toBe(true);
    }
    for (const k of ['cwd', 'messages', 'name', 'apiKeyword', 'token']) {
      expect(isSensitiveKey(k)).toBe(false);
    }
  });
});

describe('scrubSensitiveKeys', () => {
  it('redacts values under sensitive keys recursively, leaving others intact', () => {
    const input = {
      cwd: '/work',
      apiKey: 'sk-secret',
      nested: { authorization: 'Bearer x', keep: 1 },
      list: [{ password: 'p' }, { safe: 'ok' }],
    };
    const out = scrubSensitiveKeys(input);
    expect(out.apiKey).toBe('[REDACTED]');
    expect(out.nested.authorization).toBe('[REDACTED]');
    expect(out.nested.keep).toBe(1);
    expect(out.list[0].password).toBe('[REDACTED]');
    expect(out.list[1].safe).toBe('ok');
    expect(out.cwd).toBe('/work');
  });

  it('does not mutate the input and honors a custom redacted value', () => {
    const input = { secret: 'x', ok: 1 };
    const out = scrubSensitiveKeys(input, '***');
    expect(out.secret).toBe('***');
    expect(input.secret).toBe('x'); // original untouched
  });
});
