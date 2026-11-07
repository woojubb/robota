/**
 * An authorship tag is compared in constant time: a comparison that stopped at the first differing
 * byte would let a program that can submit forged records and time the check learn a valid tag byte
 * by byte. Kept apart because it replaces `node:crypto` for the whole file.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const compared = vi.hoisted(() => [] as Array<{ readonly left: string; readonly right: string }>);

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    timingSafeEqual: (left: NodeJS.ArrayBufferView, right: NodeJS.ArrayBufferView) => {
      const hex = (view: NodeJS.ArrayBufferView): string =>
        Buffer.from(view.buffer, view.byteOffset, view.byteLength).toString('hex');
      compared.push({ left: hex(left), right: hex(right) });
      return actual.timingSafeEqual(left, right);
    },
  };
});

const { authorshipTag, deriveAuthorshipKey, verifyAuthorshipTag } =
  await import('../authorship.js');
const { FIXED_MASTER_KEY, bytesOf, tamper } = await import('./helpers.js');

afterEach(() => {
  compared.length = 0;
});

describe('verifying an authorship tag', () => {
  it('compares the whole tag with timingSafeEqual, whether it matches or not', () => {
    const key = deriveAuthorshipKey(FIXED_MASTER_KEY);
    const message = bytesOf('robota/authorship/v1|session-record|sess_a|digest');
    const tag = authorshipTag(key, message);
    const forged = tamper(tag, 0);

    expect(verifyAuthorshipTag(key, message, tag)).toBe(true);
    expect(verifyAuthorshipTag(key, message, forged)).toBe(false);

    expect(compared).toEqual([
      { left: Buffer.from(tag).toString('hex'), right: Buffer.from(tag).toString('hex') },
      { left: Buffer.from(tag).toString('hex'), right: forged.toString('hex') },
    ]);
  });
});
