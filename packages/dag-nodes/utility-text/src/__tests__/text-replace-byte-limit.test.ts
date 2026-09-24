import { expect, it } from 'vitest';
import { replaceLiteralWithinByteLimit } from '../text-replace.js';

it.each([
  ['xx', 'x', 'é'], ['aaaaa', 'aa', '$&'], ['', '', 'x'], ['abc', '', '-'],
  ['😀', '', ''], ['\ud800x\udc00', 'x', ''], ['x\udc00', 'x', '\ud800'],
  ['aaa', 'a', ''], ['abc', 'missing', 'ignored'], ['\ud800\udc00', '\ud800', ''],
])('preserves literal semantics and exact UTF-8 boundaries for %j, %j, %j', (text, search, replacement) => {
  const expected = text.split(search).join(replacement);
  const bytes = Buffer.byteLength(expected);
  expect(replaceLiteralWithinByteLimit(text, search, replacement, bytes)).toEqual({ ok: true, value: expected });
  if (bytes > 0) expect(replaceLiteralWithinByteLimit(text, search, replacement, bytes - 1)).toMatchObject({
    ok: false, error: { code: 'DAG_TASK_EXECUTION_BYTE_LIMIT_EXCEEDED', retryable: false },
  });
});

it('rejects virtual output larger than a native string without attempting expansion', () => {
  expect(replaceLiteralWithinByteLimit('x'.repeat(100_000), 'x', 'y'.repeat(100_000), 4_194_304)).toMatchObject({
    ok: false, error: { code: 'DAG_TASK_EXECUTION_BYTE_LIMIT_EXCEEDED', retryable: false },
  });
});
