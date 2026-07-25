/**
 * SEC-003 — the linear trimmers must be *exactly* the regexes they replaced.
 *
 * The equivalence is checked exhaustively rather than by example: every string over the relevant alphabet up to
 * length 12 is compared against the original `replace(/^[c]+|[c]+$/g, '')` / `replace(/[c]+$/, '')`. That is the
 * property a reviewer needs, because the point of the change was to keep the accepted set identical while
 * removing the quadratic scan.
 */
import { describe, expect, it } from 'vitest';

import { trimEdgeChars, trimTrailingChars } from '../trim-char.js';

const MAX_LEN = 12;

function everyStringOver(alphabet: readonly string[], maxLen: number): string[] {
  const all: string[] = [];
  const walk = (prefix: string): void => {
    all.push(prefix);
    if (prefix.length >= maxLen) return;
    for (const c of alphabet) walk(prefix + c);
  };
  walk('');
  return all;
}

describe('trimEdgeChars', () => {
  it('equals /^-+|-+$/g over every string of a/- up to 12 characters', () => {
    const mismatches = everyStringOver(['a', '-'], MAX_LEN).filter(
      (s) => trimEdgeChars(s, '-') !== s.replace(/^-+|-+$/g, ''),
    );
    expect(mismatches).toEqual([]);
  });

  it('equals /^_+|_+$/g over every string of a/_/- up to 8 characters', () => {
    const mismatches = everyStringOver(['a', '_', '-'], 8).filter(
      (s) => trimEdgeChars(s, '_') !== s.replace(/^_+|_+$/g, ''),
    );
    expect(mismatches).toEqual([]);
  });

  it('treats `chars` as a set, like a character class', () => {
    expect(trimEdgeChars('_-_a-b_-_', '_-')).toBe('a-b');
    expect(trimEdgeChars('___', '_-')).toBe('');
  });
});

describe('trimTrailingChars', () => {
  it('equals /\\/+$/ over every string of a// up to 12 characters', () => {
    const mismatches = everyStringOver(['a', '/'], MAX_LEN).filter(
      (s) => trimTrailingChars(s, '/') !== s.replace(/\/+$/, ''),
    );
    expect(mismatches).toEqual([]);
  });

  it('equals /[_-]+$/g over every string of a/_/- up to 8 characters', () => {
    const mismatches = everyStringOver(['a', '_', '-'], 8).filter(
      (s) => trimTrailingChars(s, '_-') !== s.replace(/[_-]+$/g, ''),
    );
    expect(mismatches).toEqual([]);
  });

  it('leaves leading characters alone', () => {
    expect(trimTrailingChars('///a///', '/')).toBe('///a');
  });
});

describe('linearity', () => {
  const PUMP = 200_000;

  it('trims a 200 000-character run under 250 ms', () => {
    const started = performance.now();
    expect(trimEdgeChars(`x${'-'.repeat(PUMP)}y`, '-')).toHaveLength(PUMP + 2);
    expect(trimTrailingChars(`x${'/'.repeat(PUMP)}y`, '/')).toHaveLength(PUMP + 2);
    expect(performance.now() - started).toBeLessThan(250);
  });
});
