import { isDeepStrictEqual } from 'node:util';

import { describe, expect, it } from 'vitest';

import { isJsonEqual } from './json-equal';

/** A deterministic generator, so the fuzz cases are the same on every run. */
function sequence(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const sparse = [undefined, 1] as unknown[];
delete sparse[0];
const withExtra = Object.assign([1], { extra: true });
const noPrototype = Object.assign(Object.create(null) as object, { a: 1 });

const TABLE: readonly (readonly [unknown, unknown])[] = [
  [1, 1],
  [1, 2],
  [0, -0],
  [-0, -0],
  [NaN, NaN],
  [1, '1'],
  [null, undefined],
  [undefined, undefined],
  [null, null],
  ['a', 'a'],
  ['', 0],
  [true, 1],
  [{}, {}],
  [{}, []],
  [[], []],
  [[], [[]]],
  [{ a: undefined }, {}],
  [{}, { a: undefined }],
  [{ a: undefined }, { a: undefined }],
  [{ a: undefined }, { b: undefined }],
  [
    { a: 1, b: 2 },
    { b: 2, a: 1 },
  ],
  [{ a: 1, b: 2 }, { a: 1 }],
  [{ a: { b: [1, { c: null }] } }, { a: { b: [1, { c: null }] } }],
  [{ a: { b: [1, { c: null }] } }, { a: { b: [1, { c: 0 }] } }],
  [{ a: 0 }, { a: -0 }],
  [{ a: NaN }, { a: NaN }],
  [
    [1, 2, 3],
    [1, 2, 3],
  ],
  [
    [1, 2, 3],
    [3, 2, 1],
  ],
  [
    [1, 2],
    [1, 2, 3],
  ],
  [[undefined], [undefined]],
  [[undefined], []],
  [sparse, [undefined, 1]],
  [sparse, sparse],
  [withExtra, [1]],
  [withExtra, withExtra],
  [noPrototype, { a: 1 }],
  [noPrototype, noPrototype],
  [{ '0': 'x' }, ['x']],
  [{ length: 0 }, []],
  [{ a: [] }, { a: {} }],
  [[[]], [{}]],
  [undefined, []],
  [undefined, {}],
  [{ a: 1 }, null],
  [null, {}],
  [{ a: 'x'.repeat(100) }, { a: 'x'.repeat(100) }],
];

describe('isJsonEqual', () => {
  it.each(TABLE.map(([left, right]) => ({ left, right })))(
    'answers as isDeepStrictEqual does for $left and $right',
    ({ left, right }) => {
      expect(isJsonEqual(left, right)).toBe(isDeepStrictEqual(left, right));
      expect(isJsonEqual(right, left)).toBe(isDeepStrictEqual(right, left));
    },
  );

  it('keeps the three differences a naive comparison loses', () => {
    expect(isJsonEqual({ a: undefined }, {})).toBe(false);
    expect(isJsonEqual(0, -0)).toBe(false);
    expect(isJsonEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it('answers as isDeepStrictEqual does for a stored loop state and its parsed copy', () => {
    const state = {
      loopId: 'loop-1',
      instruction: 'check',
      createdAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-02T00:00:00.000Z',
      revision: 3,
      generation: 2,
      phase: 'waiting',
      nextAllowedAt: '2026-01-01T01:00:00.000Z',
      delaySeconds: 600,
      reason: 'later',
      fallbackUsed: false,
    };
    const copy = JSON.parse(JSON.stringify([state])) as unknown;
    expect(isJsonEqual([state], copy)).toBe(isDeepStrictEqual([state], copy));
    expect(isJsonEqual([state], copy)).toBe(true);
    const withUndefined = [{ ...state, terminalReason: undefined }];
    expect(isJsonEqual(withUndefined, copy)).toBe(isDeepStrictEqual(withUndefined, copy));
    expect(isJsonEqual(withUndefined, copy)).toBe(false);
    expect(isJsonEqual(undefined, [state])).toBe(false);
  });

  it('compares objects that are not plain or array only by identity', () => {
    const date = new Date(0);
    expect(isJsonEqual(date, date)).toBe(true);
    expect(isJsonEqual(new Date(0), new Date(0))).toBe(false);
    expect(isJsonEqual(new Map(), new Map())).toBe(false);
  });

  it('matches isDeepStrictEqual on generated JSON values', () => {
    const next = sequence(41);
    const leaves = [0, -0, 1, 2, NaN, 'a', 'b', '', true, false, null, undefined];
    const make = (depth: number): unknown => {
      const roll = next();
      if (depth === 0 || roll < 0.4) return leaves[Math.floor(next() * leaves.length)];
      if (roll < 0.7) return Array.from({ length: Math.floor(next() * 3) }, () => make(depth - 1));
      return Object.fromEntries(
        Array.from({ length: Math.floor(next() * 3) }, () => [
          ['a', 'b', 'c'][Math.floor(next() * 3)]!,
          make(depth - 1),
        ]),
      );
    };
    for (let round = 0; round < 6000; round += 1) {
      const left = make(3);
      const right = next() < 0.3 ? left : next() < 0.5 ? structuredClone(left) : make(3);
      expect(isJsonEqual(left, right), JSON.stringify([left, right])).toBe(
        isDeepStrictEqual(left, right),
      );
    }
  });
});
