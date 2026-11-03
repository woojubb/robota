import { Buffer } from 'node:buffer';

import { KeyringError } from './errors.js';

/** 160 random bits: far beyond brute force, and exactly 32 base32 symbols with no padding. */
export const RECOVERY_KEY_BYTES = 20;

const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const BITS_PER_SYMBOL = 5;
const SYMBOL_COUNT = (RECOVERY_KEY_BYTES * 8) / BITS_PER_SYMBOL;
const GROUP_SIZE = 4;
const GROUP_SEPARATOR = '-';
/** Far longer than any spelling of a valid key; stops a pathological input before it is scanned. */
const MAX_INPUT_LENGTH = 128;
// ASCII only: `toUpperCase` would otherwise fold characters such as `ß` or `ı` into valid symbols.
const TYPED_CHARACTERS = /^[0-9A-Za-z\s-]*$/;

function invalidRecoveryKey(): KeyringError {
  return new KeyringError(
    'invalid-recovery-key',
    'The recovery key is not in the expected format.',
  );
}

/** Crockford base32 of the key bytes in groups of four: `XXXX-XXXX-...` (32 symbols, 8 groups). */
export function formatRecoveryKey(bytes: Uint8Array): string {
  if (bytes.length !== RECOVERY_KEY_BYTES) {
    throw new KeyringError('invalid-argument', 'A recovery key is exactly 20 bytes.');
  }
  let symbols = '';
  let accumulator = 0;
  let bits = 0;
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= BITS_PER_SYMBOL) {
      symbols += CROCKFORD_ALPHABET[(accumulator >>> (bits - BITS_PER_SYMBOL)) & 31];
      bits -= BITS_PER_SYMBOL;
    }
    accumulator &= (1 << bits) - 1;
  }
  const groups: string[] = [];
  for (let index = 0; index < symbols.length; index += GROUP_SIZE) {
    groups.push(symbols.slice(index, index + GROUP_SIZE));
  }
  return groups.join(GROUP_SEPARATOR);
}

/**
 * Reads a recovery key as a person types it: case-insensitive, with or without the group hyphens
 * or spaces, and with Crockford's look-alike aliases (`O` is `0`; `I` and `L` are `1`).
 */
export function parseRecoveryKey(text: unknown): Buffer {
  if (typeof text !== 'string' || text.length > MAX_INPUT_LENGTH || !TYPED_CHARACTERS.test(text)) {
    throw invalidRecoveryKey();
  }
  const symbols = text.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (symbols.length !== SYMBOL_COUNT) throw invalidRecoveryKey();
  const bytes = Buffer.alloc(RECOVERY_KEY_BYTES);
  let accumulator = 0;
  let bits = 0;
  let written = 0;
  for (const symbol of symbols) {
    const value = CROCKFORD_ALPHABET.indexOf(symbol);
    if (value < 0) {
      bytes.fill(0);
      throw invalidRecoveryKey();
    }
    accumulator = (accumulator << BITS_PER_SYMBOL) | value;
    bits += BITS_PER_SYMBOL;
    if (bits >= 8) {
      bytes[written] = (accumulator >>> (bits - 8)) & 0xff;
      written += 1;
      bits -= 8;
      accumulator &= (1 << bits) - 1;
    }
  }
  return bytes;
}
