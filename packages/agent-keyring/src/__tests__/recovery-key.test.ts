import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { formatRecoveryKey, parseRecoveryKey, RECOVERY_KEY_BYTES } from '../recovery-key.js';
import {
  bytesOf,
  codeOf,
  FIXTURE_RECOVERY_KEY,
  FIXTURE_RECOVERY_KEY_BYTES,
  hex,
} from './helpers.js';

describe('recovery key format', () => {
  it('formats known bytes as grouped Crockford base32', () => {
    expect(formatRecoveryKey(FIXTURE_RECOVERY_KEY_BYTES)).toBe(FIXTURE_RECOVERY_KEY);
    expect(formatRecoveryKey(new Uint8Array(RECOVERY_KEY_BYTES))).toBe(
      '0000-0000-0000-0000-0000-0000-0000-0000',
    );
    expect(formatRecoveryKey(new Uint8Array(RECOVERY_KEY_BYTES).fill(0xff))).toBe(
      'ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ',
    );
  });

  it('round-trips random keys', () => {
    for (let index = 0; index < 200; index += 1) {
      const bytes = randomBytes(RECOVERY_KEY_BYTES);
      const text = formatRecoveryKey(bytes);
      expect(text).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){7}$/);
      expect(hex(parseRecoveryKey(text))).toBe(hex(bytes));
    }
  });

  it('reads the key the way a person types it', () => {
    const expected = hex(FIXTURE_RECOVERY_KEY_BYTES);
    const lower = FIXTURE_RECOVERY_KEY.toLowerCase();
    expect(hex(parseRecoveryKey(lower))).toBe(expected);
    expect(hex(parseRecoveryKey(FIXTURE_RECOVERY_KEY.replaceAll('-', '')))).toBe(expected);
    expect(hex(parseRecoveryKey(FIXTURE_RECOVERY_KEY.replaceAll('-', ' ')))).toBe(expected);
    expect(hex(parseRecoveryKey(`  ${FIXTURE_RECOVERY_KEY}\n`))).toBe(expected);
    // Crockford look-alikes: O reads as 0, I and L read as 1.
    expect(
      hex(parseRecoveryKey('0000-0000-0000-0000-0000-0000-0000-0000'.replaceAll('0', 'o'))),
    ).toBe('00'.repeat(RECOVERY_KEY_BYTES));
    expect(
      hex(parseRecoveryKey('1111-1111-1111-1111-1111-1111-1111-1111'.replaceAll('1', 'L'))),
    ).toBe(hex(parseRecoveryKey('1111-1111-1111-1111-1111-1111-1111-1111')));
    expect(
      hex(parseRecoveryKey('1111-1111-1111-1111-1111-1111-1111-1111'.replaceAll('1', 'i'))),
    ).toBe(hex(parseRecoveryKey('1111-1111-1111-1111-1111-1111-1111-1111')));
  });

  it('rejects text that is not a recovery key with invalid-recovery-key', () => {
    const wrong = [
      '',
      FIXTURE_RECOVERY_KEY.slice(0, -1),
      `${FIXTURE_RECOVERY_KEY}0`,
      FIXTURE_RECOVERY_KEY.replace('M', 'U'), // U is not in the Crockford alphabet
      FIXTURE_RECOVERY_KEY.replace('M', '*'),
      FIXTURE_RECOVERY_KEY.replace('M', 'ß'), // would fold to "SS" under toUpperCase
      FIXTURE_RECOVERY_KEY.replace('M', 'ı'), // would fold to "I"
      'x'.repeat(10_000),
    ];
    for (const text of wrong)
      expect(codeOf(() => parseRecoveryKey(text))).toBe('invalid-recovery-key');
    expect(codeOf(() => parseRecoveryKey(undefined))).toBe('invalid-recovery-key');
    expect(codeOf(() => parseRecoveryKey(bytesOf(FIXTURE_RECOVERY_KEY)))).toBe(
      'invalid-recovery-key',
    );
  });

  it('refuses to format anything but 20 bytes', () => {
    expect(codeOf(() => formatRecoveryKey(new Uint8Array(19)))).toBe('invalid-argument');
    expect(codeOf(() => formatRecoveryKey(new Uint8Array(21)))).toBe('invalid-argument');
  });
});
