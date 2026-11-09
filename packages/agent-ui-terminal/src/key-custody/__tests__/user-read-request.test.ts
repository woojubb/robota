/**
 * A read the person started is the only thing that can ask for the passphrase,
 * and only the terminal UI's action modules can say that a read was started by the person. The mint
 * is the one way to make such a request; nothing else type-checks as one.
 */
import { describe, expect, it } from 'vitest';

import { isUserReadRequest } from '../key-custody-port.js';
import { mintUserReadRequest } from '../user-read-request-mint.js';

import type { TReadPurpose, TUserReadRequest } from '../key-custody-port.js';

describe('a user read request', () => {
  it('carries the purpose it was minted for and cannot be changed afterwards', () => {
    const request = mintUserReadRequest('continue-fork');

    expect(request.purpose).toBe('continue-fork');
    expect(Object.isFrozen(request)).toBe(true);
  });

  it('is made only by the mint: a literal of the same shape is not one', () => {
    const purpose: TReadPurpose = 'continue-fork';
    // @ts-expect-error -- the brand is private to the port module, so no literal can carry it.
    const forged: TUserReadRequest = { purpose };

    expect(forged.purpose).toBe(purpose);
  });

  it('is recognised only when the mint made it: a cast of the same shape is not', () => {
    expect(isUserReadRequest(mintUserReadRequest('continue-fork'))).toBe(true);

    const cast = Object.freeze({ purpose: 'continue-fork' }) as unknown as TUserReadRequest;
    expect(isUserReadRequest(cast)).toBe(false);
    for (const value of [undefined, null, 'continue-fork', { purpose: 'continue-fork' }]) {
      expect(isUserReadRequest(value), String(value)).toBe(false);
    }
  });
});
