import { expect, it, vi } from 'vitest';
import { boundedRegexReplace } from '../bounded-regex-replace.js';

const cases = [
  { text: 'abc', search: 'b', flags: '', replacement: "$$:$&:$`:$'" },
  { text: 'ab', search: '(a)(b)', flags: '', replacement: '$1/$10/$2/$00/$3' },
  { text: 'abcdefghij', search: '(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)', flags: '', replacement: '$10/$01/$99' },
  { text: 'abc', search: '(?<part>b)', flags: '', replacement: '$<part>/$<missing>' },
  { text: 'abc', search: 'b', flags: '', replacement: '$<part>/$<unfinished' },
  { text: '😀', search: '(?:)', flags: 'g', replacement: '-' },
  { text: '😀', search: '(?:)', flags: 'gu', replacement: '-' },
  { text: '\ud800x\udc00', search: 'x', flags: '', replacement: '' },
  { text: 'x\udc00', search: 'x', flags: '', replacement: '\ud800' },
  { text: 'abc', search: 'b', flags: 'y', replacement: 'x' },
];

it.each(cases)('matches native replacement and exact UTF-8 boundaries for %#', (request) => {
  const expected = request.text.replace(new RegExp(request.search, request.flags), request.replacement);
  const bytes = Buffer.byteLength(expected);
  expect(boundedRegexReplace(request, bytes)).toEqual({ type: 'result', value: expected });
  if (bytes > 0) expect(boundedRegexReplace(request, bytes - 1)).toEqual({ type: 'oversized' });
});

it('rejects an amplified result before native replacement can allocate it', () => {
  const replace = vi.spyOn(String.prototype, 'replace');
  try {
    expect(boundedRegexReplace({
      text: 'x'.repeat(2000), search: 'x', flags: 'g', replacement: 'y'.repeat(3000),
    }, 4 * 1024 * 1024)).toEqual({ type: 'oversized' });
    expect(replace.mock.calls.some(([, value]) => typeof value === 'string')).toBe(false);
  } finally {
    replace.mockRestore();
  }
});
