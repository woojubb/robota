/**
 * When a supervised runtime may start in secure mode: the exchange with its spawner and the secure
 * mode of its state root must agree, and the start refuses before it listens on anything when they
 * do not. The decision is one function over what argv and the state root say.
 */
import { describe, expect, it } from 'vitest';

import {
  SUPERVISED_SPAWNER_PAIR_FLAG,
  secureStartupRefusal,
  spawnerPairRequested,
} from '../secure-runtime-startup.js';

const secureServing = { secure: true, pairFlag: true, tokenFlag: false, supervised: true, serve: true };

describe('the flag that hands a runtime its spawner pair', () => {
  it('is read from the options of argv, and not from a prompt that spells it', () => {
    expect(spawnerPairRequested(['node', 'cli', '--serve', SUPERVISED_SPAWNER_PAIR_FLAG])).toBe(true);
    expect(spawnerPairRequested(['node', 'cli', '--serve'])).toBe(false);
    expect(spawnerPairRequested(['node', 'cli', '-p', '--', SUPERVISED_SPAWNER_PAIR_FLAG])).toBe(false);
  });
});

describe('agreement of the spawner pair and secure mode', () => {
  it('lets a secure supervised runtime start with its pair', () => {
    expect(secureStartupRefusal(secureServing)).toBeUndefined();
  });

  it('lets a plain runtime start as it always did, with or without a token', () => {
    const plain = { secure: false, pairFlag: false, tokenFlag: false, supervised: true, serve: true };
    expect(secureStartupRefusal(plain)).toBeUndefined();
    expect(secureStartupRefusal({ ...plain, tokenFlag: true })).toBeUndefined();
    expect(secureStartupRefusal({ ...plain, supervised: false, serve: false })).toBeUndefined();
  });

  it.each([
    ['the pair in plain mode', { ...secureServing, secure: false }, /secure mode is not on/u],
    ['secure mode without the pair', { ...secureServing, pairFlag: false }, /only with the pair/u],
    ['a secure serve that is not supervised, without the pair', { ...secureServing, pairFlag: false, supervised: false }, /only with the pair/u],
    ['both flags', { ...secureServing, tokenFlag: true }, /exclusive/u],
    ['the pair without a supervised launch', { ...secureServing, supervised: false }, /supervised launch/u],
  ])('refuses %s with a fixed message', (_name, input, message) => {
    expect(secureStartupRefusal(input)).toMatch(message);
  });

  it('does not ask a secure process that is not a runtime for a pair', () => {
    expect(
      secureStartupRefusal({ secure: true, pairFlag: false, tokenFlag: false, supervised: false, serve: false }),
    ).toBeUndefined();
  });
});
