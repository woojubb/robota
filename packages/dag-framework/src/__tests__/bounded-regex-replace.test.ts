import { spawnSync } from 'node:child_process';
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

it('preserves native global and sticky replacement semantics across capture templates', () => {
  const inputs = [
    { text: 'ababa', search: '(?<letter>a)|b', flags: 'g' },
    { text: 'ababa', search: '(?=a)', flags: 'g' },
    { text: '😀a', search: '(?:)', flags: 'gu' },
    { text: 'ab', search: '(?:)', flags: 'gy' },
    { text: 'a\nb', search: '^', flags: 'gm' },
  ];
  const replacements = ['', '$&', '$1', '$<letter>', "$$:$`:$'", 'x'];
  for (const { text, search, flags } of inputs) {
    for (const replacement of replacements) {
      const request = { text, search, flags, replacement };
      const expected = text.replace(new RegExp(search, flags), replacement);
      expect(boundedRegexReplace(request, Buffer.byteLength(expected))).toEqual({
        type: 'result', value: expected,
      });
    }
  }
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

it('does not retain a native global match list for an admitted input', () => {
  const script = `
    const boundedRegexReplace = ${boundedRegexReplace.toString()};
    const text = 'a'.repeat(2_000_000);
    const result = boundedRegexReplace({ text, search: '(?:)', flags: 'g', replacement: '' }, 2_000_000);
    if (result.type !== 'result' || result.value !== text) process.exit(1);
    process.stdout.write('ok');
  `;
  const child = spawnSync(process.execPath, ['--max-old-space-size=32', '-e', script], {
    encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024,
  });
  expect(child.status, child.stderr).toBe(0);
  expect(child.stdout).toBe('ok');
});
