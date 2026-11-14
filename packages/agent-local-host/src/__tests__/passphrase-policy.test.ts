import { describe, expect, it } from 'vitest';

import {
  MIN_PASSPHRASE_CHARACTERS,
  PASSPHRASE_RULE_EXPLANATION,
  passphraseProblem,
} from '../passphrase-policy.js';

describe('passphrase policy', () => {
  it('requires at least 12 characters', () => {
    expect(MIN_PASSPHRASE_CHARACTERS).toBe(12);
    expect(passphraseProblem('abcdefghijk')).toContain('at least 12');
    expect(passphraseProblem('abcdefghijkl')).toBeUndefined();
    expect(passphraseProblem('')).toContain('at least 12');
  });

  it('counts characters, not UTF-16 units, after the normalization key derivation applies', () => {
    const emoji = Array.from('😀😁😂🤣😃😄😅😆😉😊😋😎');
    expect(passphraseProblem(emoji.slice(0, 11).join(''))).toBeDefined();
    expect(passphraseProblem(emoji.join(''))).toBeUndefined();
    // "é" typed as e + a combining accent is two code points that NFKC composes into one character.
    const decomposed = 'e\u0301';
    expect(passphraseProblem(`${decomposed}abcdefghij`)).toBeDefined();
    expect(passphraseProblem(`${decomposed}abcdefghijk`)).toBeUndefined();
  });

  it('refuses trivially repetitive input however long it is', () => {
    for (const repetitive of [
      'a'.repeat(40),
      'ab'.repeat(20),
      'aabbccddaabbccdd',
      '1234123412341234',
      'abcdeabcdeabcdeab',
      'correct horse correct horse ',
    ]) {
      expect(passphraseProblem(repetitive), repetitive).toMatch(/repeat/);
    }
    for (const fine of [
      'correct horse battery staple',
      'brand new long passphrase',
      'abcdeabcdeXY',
    ]) {
      expect(passphraseProblem(fine), fine).toBeUndefined();
    }
  });

  it('claims only that the rule raises the cost of offline guessing', () => {
    expect(PASSPHRASE_RULE_EXPLANATION).toMatch(/raises the cost/);
    expect(PASSPHRASE_RULE_EXPLANATION).not.toMatch(/out of reach/);
  });

  it('says why the minimum exists: the file is readable by every program of the account', () => {
    expect(PASSPHRASE_RULE_EXPLANATION).toMatch(/offline/);
    expect(PASSPHRASE_RULE_EXPLANATION).toContain('12');
  });
});
