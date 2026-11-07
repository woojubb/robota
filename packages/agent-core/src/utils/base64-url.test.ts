import { describe, expect, it } from 'vitest';

import { base64UrlDecode } from './base64-url';

const viaBuffer = (text: string): number[] => [...Buffer.from(text, 'base64url')];

/** A deterministic generator, so the fuzz cases are the same on every run. */
function sequence(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe('base64UrlDecode', () => {
  it.each([
    '',
    'YQ',
    'YQ=',
    'YQ==',
    'YQ==YQ',
    'YQ=Y',
    'Y',
    'Y=Q',
    '=',
    '==',
    '=YWJj',
    'YWJj',
    'YWJjZ',
    'YWJjZA',
    'YWJjZA==',
    'YWJjZA=',
    'YW Jj',
    'Y\nWJj',
    'YW\0Jj',
    'YW-j',
    'YW+j',
    'YW_j',
    'YW/j',
    'YW*j',
    'YW@@j',
    'é',
    'YWJjéZA',
    '\u{1F600}YQ',
    '\uD800YQ',
    '中YWJj',
    'YW中Jj',
    'YWJjZA中',
    'ĀYQ',
    '\u{1F600}YWJj',
    'YQ=\n=',
    'YQ=\nY',
    'eyJqdGkiOiJhYmMiLCJleHAiOjE3MDAwMDAwMDB9',
    'eyJqdGkiOiLtlZwifQ',
  ])('reads %j as Buffer reads it as base64url', (text) => {
    expect([...base64UrlDecode(text)]).toEqual(viaBuffer(text));
  });

  it('reads the same text as base64, whichever alphabet it is spelled in', () => {
    const text = '-_-_+/+/YW-j';
    expect([...base64UrlDecode(text)]).toEqual([...Buffer.from(text, 'base64')]);
  });

  it('matches Buffer on random text over the alphabets, padding and noise', () => {
    const next = sequence(17);
    const alphabet = [...'ABCZaz059-_+/==  \n*é中Ā\u{1F600}'];
    for (let round = 0; round < 5000; round += 1) {
      const text = Array.from(
        { length: Math.floor(next() * 14) },
        () => alphabet[Math.floor(next() * alphabet.length)]!,
      ).join('');
      expect([...base64UrlDecode(text)], JSON.stringify(text)).toEqual(viaBuffer(text));
    }
  });

  it('round-trips the bytes Buffer encodes, at every length', () => {
    const next = sequence(3);
    for (let length = 0; length < 70; length += 1) {
      const bytes = Uint8Array.from({ length }, () => Math.floor(next() * 256));
      for (const encoding of ['base64url', 'base64'] as const) {
        expect([...base64UrlDecode(Buffer.from(bytes).toString(encoding))]).toEqual([...bytes]);
      }
    }
  });

  it('decodes a 4 MiB input as Buffer does', () => {
    const bytes = new Uint8Array(4 * 1024 * 1024);
    for (let at = 0; at < bytes.length; at += 1) bytes[at] = (at * 31 + 7) & 0xff;
    const text = Buffer.from(bytes).toString('base64url');
    expect(Buffer.from(base64UrlDecode(text)).equals(Buffer.from(text, 'base64url'))).toBe(true);
  });
});
