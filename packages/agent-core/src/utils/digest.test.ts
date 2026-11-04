import { createHash, createHmac } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { constantTimeEqual, hmacSha256Hex, randomHex, sha1Hex, sha256Hex } from './digest';
import koreanText from './__fixtures__/korean-text.json';

/** Lone surrogates are not valid UTF-16; both Node and `TextEncoder` encode each as U+FFFD. */
const loneSurrogates = ['a\uD800b', '\uDC00', 'x\uD800'];

const texts = [
  '',
  'abc',
  koreanText.greetingWithGlobeEmoji,
  ...loneSurrogates,
  // A byte-order mark is an ordinary character to the digest: Node hashes its three bytes.
  '\uFEFF',
  '\uFEFFabc',
  'a\uFEFFb',
  'a\uD800\uDC62',
  ...[55, 56, 63, 64, 65, 119, 120, 128, 1024].map((length) => 'a'.repeat(length)),
];

describe('sha256Hex', () => {
  it('matches the known abc vector', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it.each(texts.map((input) => ({ input, byteLength: new TextEncoder().encode(input).length })))(
    'matches the Node digest of a string of $byteLength bytes',
    ({ input }) => {
      expect(sha256Hex(input)).toBe(createHash('sha256').update(input).digest('hex'));
    },
  );

  it.each(texts.map((input) => ({ input, bytes: new TextEncoder().encode(input) })))(
    'matches the Node digest of $bytes.length raw bytes',
    ({ bytes }) => {
      expect(sha256Hex(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'));
    },
  );

  it('matches the Node digest of a 4 MiB string and of its bytes', () => {
    const unit = `\uFEFF${koreanText.greetingWithGlobeEmoji}a\uD800b\u{1F600}`;
    const text = unit.repeat(Math.ceil((4 * 1024 * 1024) / unit.length));
    const bytes = new TextEncoder().encode(text);
    expect(bytes.length).toBeGreaterThanOrEqual(4 * 1024 * 1024);
    const expected = createHash('sha256').update(text).digest('hex');
    expect(sha256Hex(text)).toBe(expected);
    expect(sha256Hex(bytes)).toBe(expected);
  });

  it('hashes a string and its UTF-8 bytes identically', () => {
    const text = koreanText.greetingWithGlobeEmoji;
    expect(sha256Hex(text)).toBe(sha256Hex(new TextEncoder().encode(text)));
  });

  it('does not pair a lone surrogate with the character after it', () => {
    expect(sha256Hex('a\uD800b')).not.toBe(sha256Hex('a\uD800\uDC62'));
  });
});

describe('sha1Hex', () => {
  it('matches the known abc vector', () => {
    expect(sha1Hex('abc')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
  });

  it.each(texts.map((input) => ({ input, byteLength: new TextEncoder().encode(input).length })))(
    'matches the Node digest of a string of $byteLength bytes',
    ({ input }) => {
      expect(sha1Hex(input)).toBe(createHash('sha1').update(input).digest('hex'));
    },
  );

  it.each(texts.map((input) => ({ input, bytes: new TextEncoder().encode(input) })))(
    'matches the Node digest of $bytes.length raw bytes',
    ({ bytes }) => {
      expect(sha1Hex(bytes)).toBe(createHash('sha1').update(bytes).digest('hex'));
    },
  );
});

describe('hmacSha256Hex', () => {
  it.each([
    { key: 'secret', text: 'payload' },
    { key: '', text: '' },
    { key: koreanText.greetingWithGlobeEmoji, text: koreanText.greetingWithGlobeEmoji },
    { key: 'k'.repeat(200), text: 'a'.repeat(1024) },
    { key: '\uD800x', text: 'p' },
    { key: 'p', text: 'a\uD800b' },
    { key: '\uFEFFk', text: '\uFEFFp' },
  ])('matches the Node HMAC for a $key.length-character key', ({ key, text }) => {
    expect(hmacSha256Hex(key, text)).toBe(createHmac('sha256', key).update(text).digest('hex'));
  });

  it('matches the Node HMAC of a 4 MiB text', () => {
    const text = 'a\u{1F600}한'.repeat(Math.ceil((4 * 1024 * 1024) / 8));
    expect(hmacSha256Hex('secret', text)).toBe(
      createHmac('sha256', 'secret').update(text).digest('hex'),
    );
  });
});

describe('randomHex', () => {
  it('returns two lowercase hex characters per byte', () => {
    expect(randomHex(32)).toMatch(/^[0-9a-f]{64}$/);
    expect(randomHex(1)).toMatch(/^[0-9a-f]{2}$/);
    expect(randomHex(0)).toBe('');
  });

  it('produces distinct values', () => {
    expect(new Set(Array.from({ length: 100 }, () => randomHex(16))).size).toBe(100);
  });

  it('throws rather than inventing randomness when the platform has none', () => {
    vi.stubGlobal('crypto', undefined);
    try {
      expect(() => randomHex(8)).toThrow(/cryptographic randomness/i);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('constantTimeEqual', () => {
  it('is true for equal strings, including empty ones', () => {
    expect(constantTimeEqual('', '')).toBe(true);
    expect(constantTimeEqual('abc123', 'abc123')).toBe(true);
    expect(
      constantTimeEqual(koreanText.greetingWithGlobeEmoji, koreanText.greetingWithGlobeEmoji),
    ).toBe(true);
  });

  it('is false for strings of different lengths', () => {
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(constantTimeEqual('', 'a')).toBe(false);
  });

  it('is false for strings that differ in any position', () => {
    expect(constantTimeEqual('abcdef', 'xbcdef')).toBe(false);
    expect(constantTimeEqual('abcdef', 'abcdex')).toBe(false);
    expect(constantTimeEqual('abcdef', 'abcxef')).toBe(false);
  });
});
