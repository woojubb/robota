import { describe, expect, it } from 'vitest';

import { isUniversalValueEqual } from './universal-value-equal';
import { decodeJournalValue, encodeJournalValue } from './journal-value-codec';

describe('execution journal value codec', () => {
  it('round-trips the distinctions recovery compares by value', () => {
    const shared = { n: 1 };
    const cyclic: Record<string, unknown> = { name: 'loop' };
    cyclic['self'] = cyclic;
    const value = {
      when: new Date('2026-01-02T03:04:05.678Z'),
      invalid: new Date(NaN),
      gone: undefined,
      zero: -0,
      nan: NaN,
      big: Infinity,
      text: 'a b\ud800',
      list: [shared, shared, undefined, [1, 2]],
      cyclic,
      ['__proto__']: 'plain key',
      $d: 'looks like a tag',
    };
    const stored = JSON.parse(JSON.stringify(encodeJournalValue(value)));
    const decoded = decodeJournalValue(stored) as typeof value;
    expect(isUniversalValueEqual(decoded, value)).toBe(true);
    expect(decoded.list[0]).toBe(decoded.list[1]);
    expect(decoded.cyclic['self']).toBe(decoded.cyclic);
    expect(Object.hasOwn(decoded, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype);
  });

  it('refuses what a record cannot carry', () => {
    class Custom {}
    expect(() => encodeJournalValue({ f: () => 1 })).toThrow(TypeError);
    expect(() => encodeJournalValue({ c: new Custom() })).toThrow(TypeError);
    expect(() => encodeJournalValue({ b: 1n })).toThrow(TypeError);
    const sparse = [1];
    sparse[2] = 3;
    expect(() => encodeJournalValue(sparse)).toThrow(TypeError);
    expect(() =>
      encodeJournalValue({
        get x() {
          return 1;
        },
      }),
    ).toThrow(TypeError);
    expect(() => decodeJournalValue({ $r: 7 })).toThrow(TypeError);
    expect(() => decodeJournalValue({ nope: 1 })).toThrow(TypeError);
  });
});
