/**
 * Tool arguments are rendered for telemetry by an iterative, early-abort stringify that masks
 * sensitive keys by whole word and never walks past the bound.
 */
import { describe, expect, it } from 'vitest';

import {
  isTelemetrySensitiveKey,
  stringifyBounded,
} from '../interactive-session-live-content-bounded.js';

describe('isTelemetrySensitiveKey', () => {
  it.each<[string, unknown]>([
    ['author', 'Ada'],
    ['oauthScope', 'repo'],
    ['maxTokens', 100],
    ['tokenCount', 5],
    ['min_tokens', 1],
    ['retryLimit', 3],
    ['file_path', '/x'],
    ['keyboard', 'us'],
  ])('keeps %s', (key, value) => {
    expect(isTelemetrySensitiveKey(key, value)).toBe(false);
  });

  it.each<[string, unknown]>([
    ['password', 12345678],
    ['accessTokens', ['a', 'b']],
    ['functionSignature', 'abc'],
    ['apiKey', 'x'],
    ['OPENAI_API_KEY', 'x'],
    ['x-api-key', 'x'],
    ['authToken', { nested: true }],
    ['auth', 'x'],
    ['Cookie', 'x'],
    ['client_secret', 'x'],
    ['privateKey', 'x'],
    ['credentials', { user: 'u' }],
    ['maxTokens', 'not a number'],
    ['tokenCount', '5'],
  ])('masks %s', (key, value) => {
    expect(isTelemetrySensitiveKey(key, value)).toBe(true);
  });
});

describe('stringifyBounded', () => {
  it('renders JSON and masks a sensitive value whatever its type', () => {
    const out = stringifyBounded({
      command: 'ls',
      password: 12345678,
      accessTokens: ['a', 'b'],
      nested: { functionSignature: { x: 1 }, maxTokens: 100, tokenCount: 5, author: 'Ada' },
    }, 4096);
    expect(JSON.parse(out.text)).toEqual({
      command: 'ls',
      password: '[redacted]',
      accessTokens: '[redacted]',
      nested: { functionSignature: '[redacted]', maxTokens: 100, tokenCount: 5, author: 'Ada' },
    });
    expect(out.truncated).toBe(false);
    expect(out.bytes).toBe(Buffer.byteLength(out.text));
  });

  it('marks cycles, bounds depth, and renders dates as ISO strings', () => {
    const cyclic: Record<string, unknown> = { name: 'a' };
    cyclic['self'] = cyclic;
    let deep: Record<string, unknown> = { leaf: true };
    for (let index = 0; index < 40; index += 1) deep = { d: deep };
    const out = JSON.parse(stringifyBounded({
      cyclic, shared: [1, 2], again: undefined, when: new Date('2026-09-24T00:00:00.000Z'), deep,
    }, 1 << 20).text) as Record<string, unknown>;
    expect(out['cyclic']).toEqual({ name: 'a', self: '[circular]' });
    expect(out['when']).toBe('2026-09-24T00:00:00.000Z');
    expect('again' in out).toBe(false);
    expect(JSON.stringify(out['deep'])).toContain('[depth limit]');
    expect(JSON.stringify(out['deep'])).not.toContain('leaf');
    // A value seen twice but not an ancestor is not a cycle.
    const twice = { v: 1 };
    expect(JSON.parse(stringifyBounded({ a: twice, b: twice }, 1024).text)).toEqual({ a: { v: 1 }, b: { v: 1 } });
  });

  it('omits binary and base64 payloads, keeping their size', () => {
    const base64 = 'QUJD'.repeat(300); // 1200 chars
    const out = JSON.parse(stringifyBounded({
      buffer: Buffer.alloc(2000),
      typed: new Uint8Array(3000),
      raw: new ArrayBuffer(4000),
      image: `data:image/png;base64,${base64}`,
      data: base64,
      bytes: base64,
      note: base64, // not a binary-named key and not a data URI: kept
      short: 'data:image/png;base64,QUJD',
    }, 1 << 20).text) as Record<string, unknown>;
    expect(out['buffer']).toBe('[binary omitted, 2000 bytes]');
    expect(out['typed']).toBe('[binary omitted, 3000 bytes]');
    expect(out['raw']).toBe('[binary omitted, 4000 bytes]');
    expect(out['image']).toBe('[binary omitted, 900 bytes]');
    expect(out['data']).toBe('[binary omitted, 900 bytes]');
    expect(out['bytes']).toBe('[binary omitted, 900 bytes]');
    expect(out['note']).toBe(base64);
    expect(out['short']).toBe('data:image/png;base64,QUJD');
  });

  it('stops early on a 10 MB Write content, never visiting what follows', () => {
    let visited = false;
    const args = {
      file_path: '/repo/a.txt',
      content: 'x'.repeat(10 * 1024 * 1024),
      get after(): string {
        visited = true;
        return 'late';
      },
    };
    const started = performance.now();
    const out = stringifyBounded(args, 3072);
    expect(performance.now() - started).toBeLessThan(250);
    expect(out.truncated).toBe(true);
    expect(out.bytes).toBeLessThanOrEqual(3072);
    expect(out.text.startsWith('{"file_path":"/repo/a.txt","content":"xxx')).toBe(true);
    expect(visited).toBe(false);
  });

  it('cuts on a UTF-8 boundary', () => {
    const out = stringifyBounded({ text: '😀'.repeat(100) }, 50);
    expect(out.truncated).toBe(true);
    expect(out.bytes).toBeLessThanOrEqual(50);
    expect(out.text).not.toContain('�');
  });

  it('renders undefined as nothing and odd scalars as JSON would', () => {
    expect(stringifyBounded(undefined, 100).text).toBe('');
    expect(stringifyBounded([undefined, () => 1, Number.NaN, 10n], 100).text).toBe('[null,null,null,"10"]');
  });
});
