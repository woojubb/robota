import { describe, expect, it } from 'vitest';

import koreanText from './__fixtures__/korean-text.json';
import { utf8Decode } from './utf8-decode';

const asBuffer = (bytes: Uint8Array): string => Buffer.from(bytes).toString('utf8');

/** A deterministic byte generator, so the fuzz cases are the same on every run. */
function sequence(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state >>> 24;
  };
}

const TEXTS = [
  '',
  'abc',
  koreanText.greetingWithGlobeEmoji,
  '\u{1F600}',
  'é',
  '\0',
  '\uFEFF',
  '\uFEFFabc',
  'a\uFEFFb',
  '\uFEFF\uFEFF',
  'a\uD800b',
  '\uDC00',
  'x\uD800',
  '\u{10FFFF}',
];

describe('utf8Decode', () => {
  it.each(TEXTS)('decodes the UTF-8 bytes of %j as Buffer does', (text) => {
    const bytes = new TextEncoder().encode(text);
    expect(utf8Decode(bytes)).toBe(asBuffer(bytes));
  });

  it('keeps a leading byte-order mark, which TextDecoder would drop by default', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x61]);
    expect(utf8Decode(bytes)).toBe('\uFEFFa');
    expect(new TextDecoder().decode(bytes)).toBe('a');
    expect(asBuffer(bytes)).toBe('\uFEFFa');
  });

  it('keeps a byte-order mark on a prefix cut from text, as the framework truncates it', () => {
    const bytes = new TextEncoder().encode('\uFEFFhello');
    expect(utf8Decode(bytes.subarray(0, 4))).toBe(asBuffer(bytes.subarray(0, 4)));
    expect(utf8Decode(bytes.subarray(0, 4)).startsWith('\uFEFF')).toBe(true);
  });

  it('replaces a sequence cut short at every length, as Buffer does', () => {
    for (const text of ['é', '€', '\u{1F600}', 'a€b', koreanText.greetingWithGlobeEmoji]) {
      const bytes = new TextEncoder().encode(text);
      for (let end = 0; end <= bytes.length; end += 1) {
        const cut = bytes.subarray(0, end);
        expect(utf8Decode(cut), `${text} cut at ${end}`).toBe(asBuffer(cut));
      }
    }
  });

  it.each([
    [0xc0, 0x80],
    [0xc1, 0xbf],
    [0xe0, 0x80, 0x80],
    [0xed, 0xa0, 0x80],
    [0xed, 0xbf, 0xbf],
    [0xf0, 0x80, 0x80, 0x80],
    [0xf4, 0x90, 0x80, 0x80],
    [0xf5, 0x80, 0x80, 0x80],
    [0xff],
    [0x80],
    [0xbf, 0xbf],
    [0xe2, 0x82],
    [0xe2, 0x82, 0x61],
    [0xf0, 0x9f, 0x98],
    [0xf0, 0x9f, 0x98, 0x61],
    [0xc3, 0x28],
    [0x61, 0xef, 0xbb],
  ])('replaces the malformed bytes %j as Buffer does', (...bytes) => {
    const input = Uint8Array.from(bytes);
    expect(utf8Decode(input)).toBe(asBuffer(input));
  });

  it('decodes a UTF-8 encoded surrogate as replacement characters, as Buffer does', () => {
    const input = Uint8Array.from([0x61, 0xed, 0xa0, 0x80, 0x62, 0xed, 0xb0, 0x80]);
    expect(utf8Decode(input)).toBe(asBuffer(input));
  });

  it('matches Buffer on random bytes, valid and not', () => {
    const next = sequence(5);
    for (let round = 0; round < 3000; round += 1) {
      const input = Uint8Array.from({ length: 1 + (next() % 24) }, () => next());
      expect(utf8Decode(input), JSON.stringify([...input])).toBe(asBuffer(input));
    }
  });

  it('matches Buffer on random bytes biased toward continuation and lead bytes', () => {
    const next = sequence(9);
    const alphabet = [0x61, 0x80, 0xbf, 0xc2, 0xdf, 0xe0, 0xe2, 0xed, 0xef, 0xf0, 0xf4, 0xf8, 0xbb];
    for (let round = 0; round < 3000; round += 1) {
      const input = Uint8Array.from(
        { length: 1 + (next() % 12) },
        () => alphabet[next() % alphabet.length]!,
      );
      expect(utf8Decode(input), JSON.stringify([...input])).toBe(asBuffer(input));
    }
  });

  it('decodes a 4 MiB input as Buffer does', () => {
    const unit = new TextEncoder().encode(`\uFEFF${koreanText.greetingWithGlobeEmoji}a\u{1F600}`);
    const bytes = new Uint8Array(4 * 1024 * 1024);
    for (let at = 0; at < bytes.length; at += unit.length)
      bytes.set(unit.subarray(0, bytes.length - at), at);
    expect(utf8Decode(bytes)).toBe(asBuffer(bytes));
  });
});
