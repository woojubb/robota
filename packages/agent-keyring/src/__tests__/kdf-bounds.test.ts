import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Counts calls into `crypto.scrypt` while still running the real thing. The bounds check has to
// refuse BEFORE any derivation, and a call count is the only direct evidence of that.
const scryptCalls = vi.hoisted(() => ({ count: 0 }));

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  const counted = ((...args: Parameters<typeof actual.scrypt>) => {
    scryptCalls.count += 1;
    return (actual.scrypt as (...rest: unknown[]) => void)(...args);
  }) as typeof actual.scrypt;
  return { ...actual, scrypt: counted, default: { ...actual, scrypt: counted } };
});

import {
  createKeyring,
  parseKeyring,
  unlockWithPassphrase,
  unlockWithRecoveryKey,
  type IKeyring,
} from '../index.js';
import {
  assertScryptParametersInBounds,
  DEFAULT_SCRYPT_PARAMETERS,
  SCRYPT_BOUNDS,
} from '../kdf.js';
import { codeOf, codeOfAsync, FIXTURE_PASSPHRASE_AS_TYPED } from './helpers.js';

const fixtureText = readFileSync(
  fileURLToPath(new URL('./fixtures/keyring-v1.json', import.meta.url)),
  'utf8',
);
const fixture = parseKeyring(fixtureText);

function withKdf(change: Record<string, number>): IKeyring {
  const [passphrase, recovery] = fixture.slots;
  if (passphrase.type !== 'passphrase') throw new Error('fixture layout changed');
  return {
    ...fixture,
    slots: [{ ...passphrase, kdf: { ...passphrase.kdf, ...change } }, recovery],
  };
}

beforeEach(() => {
  scryptCalls.count = 0;
});

describe('scrypt cost bounds', () => {
  it('accepts the default cost and the inclusive edges of the range', () => {
    expect(() => assertScryptParametersInBounds(DEFAULT_SCRYPT_PARAMETERS)).not.toThrow();
    for (const [N, r] of [
      [SCRYPT_BOUNDS.minN, SCRYPT_BOUNDS.minR],
      [SCRYPT_BOUNDS.minN, SCRYPT_BOUNDS.maxR],
      [SCRYPT_BOUNDS.maxN, SCRYPT_BOUNDS.minR], // exactly the 512 MiB ceiling
    ]) {
      expect(() => assertScryptParametersInBounds({ N, r, p: 1 })).not.toThrow();
    }
  });

  it('caps the memory a keyring may request, whatever N and r are combined', () => {
    // Each of N and r is in range on its own; together they would need 1 GiB.
    expect(
      codeOf(() =>
        assertScryptParametersInBounds({ N: SCRYPT_BOUNDS.maxN, r: SCRYPT_BOUNDS.maxR, p: 1 }),
      ),
    ).toBe('kdf-parameters-out-of-bounds');
  });

  it('refuses a cost outside the range, with its own error code', () => {
    const outside = [
      { N: 2 ** 14, r: 8, p: 1 },
      { N: 2 ** 20, r: 8, p: 1 }, // above the ceiling
      { N: 2 ** 21, r: 8, p: 1 },
      { N: 3 * 2 ** 15, r: 8, p: 1 }, // in range but not a power of two
      { N: 2 ** 17, r: 7, p: 1 },
      { N: 2 ** 17, r: 17, p: 1 },
      { N: 2 ** 17, r: 8, p: 2 },
      { N: 2 ** 17, r: 8, p: 0 },
      { N: 2 ** 17 + 0.5, r: 8, p: 1 },
      { N: Number.NaN, r: 8, p: 1 },
    ];
    for (const parameters of outside) {
      expect(codeOf(() => assertScryptParametersInBounds(parameters))).toBe(
        'kdf-parameters-out-of-bounds',
      );
    }
  });
});

describe('unlock refuses hostile KDF parameters before doing any work', () => {
  it('runs no scrypt for any out-of-range slot', async () => {
    const hostile = [
      withKdf({ N: 2 ** 14 }), // a downgrade
      withKdf({ N: 2 ** 21 }), // a memory bomb
      withKdf({ N: 2 ** 19, r: 16 }), // a 1 GiB request, each value in range on its own
      withKdf({ N: 2 ** 20, r: 17 }),
      withKdf({ r: 7 }),
      withKdf({ p: 2 }),
      withKdf({ N: 3 * 2 ** 15 }),
    ];
    for (const keyring of hostile) {
      expect(await codeOfAsync(unlockWithPassphrase(keyring, FIXTURE_PASSPHRASE_AS_TYPED))).toBe(
        'kdf-parameters-out-of-bounds',
      );
    }
    expect(scryptCalls.count).toBe(0);
  });

  it('checks every passphrase slot before deriving for the first', async () => {
    const [passphrase, recovery] = fixture.slots;
    if (passphrase.type !== 'passphrase') throw new Error('fixture layout changed');
    const hostileSecond = withKdf({ N: 2 ** 21 }).slots[0];
    const keyring: IKeyring = {
      ...fixture,
      slots: [passphrase, { ...hostileSecond, id: 'AAAAAAAAAAAAAAAAAAAAAA' }, recovery],
    };
    expect(await codeOfAsync(unlockWithPassphrase(keyring, FIXTURE_PASSPHRASE_AS_TYPED))).toBe(
      'kdf-parameters-out-of-bounds',
    );
    expect(scryptCalls.count).toBe(0);
  });

  it('does run scrypt for an in-range slot (so the counter is not vacuous)', async () => {
    // The lowest accepted cost with the fixture's wrapped key: derives a different key, then fails.
    expect(
      await codeOfAsync(unlockWithPassphrase(withKdf({ N: 2 ** 15 }), FIXTURE_PASSPHRASE_AS_TYPED)),
    ).toBe('wrong-credential');
    expect(scryptCalls.count).toBe(1);
  });

  it('does not refuse the recovery path because of a hostile passphrase slot', async () => {
    // Nothing to unlock with here (the fixture's recovery key is not under test); only that no
    // scrypt ran and no KDF error was raised for a credential that never reaches the passphrase slot.
    expect(
      await codeOfAsync(
        unlockWithRecoveryKey(withKdf({ N: 2 ** 21 }), 'ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ'),
      ),
    ).toBe('wrong-credential');
    expect(scryptCalls.count).toBe(0);
  });
});

describe('createKeyring', () => {
  it('runs scrypt once, at the default cost', async () => {
    const { keyring } = await createKeyring({ passphrase: 'a passphrase' });
    expect(scryptCalls.count).toBe(1);
    const slot = keyring.slots[0];
    expect(slot.type === 'passphrase' && slot.kdf).toMatchObject(DEFAULT_SCRYPT_PARAMETERS);
  });
});
