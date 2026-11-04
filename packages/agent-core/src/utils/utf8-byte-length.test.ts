import { describe, expect, it } from 'vitest';

import koreanText from './__fixtures__/korean-text.json';
import { utf8ByteLength } from './utf8-byte-length';

describe('utf8ByteLength', () => {
  it.each(['', 'abc', koreanText.greetingWithGlobeEmoji, '\u{1F600}', 'é', '\0'])(
    'matches the Node byte length of %j',
    (text) => {
      expect(utf8ByteLength(text)).toBe(Buffer.byteLength(text, 'utf8'));
    },
  );

  it('counts a lone surrogate as the three bytes of its replacement character', () => {
    expect(utf8ByteLength('\ud800')).toBe(Buffer.byteLength('\ud800', 'utf8'));
  });
});
