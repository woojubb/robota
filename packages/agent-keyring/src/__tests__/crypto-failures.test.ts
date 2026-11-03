/**
 * A `node:crypto` call that throws (an OpenSSL build without a curve, memory, a host refusing an
 * operation) must still surface as a `KeyringError` with a code from the closed vocabulary, and the
 * original error, which may describe its inputs, must not be chained. Kept apart because it replaces
 * `node:crypto` for the whole file.
 */
import { Buffer } from 'node:buffer';

import { afterEach, describe, expect, it, vi } from 'vitest';

const broken = vi.hoisted(() => new Set<string>());

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  const breakable =
    <TArgs extends unknown[], TResult>(name: string, original: (...args: TArgs) => TResult) =>
    (...args: TArgs): TResult => {
      if (broken.has(name)) throw new Error(`${name} failed: SECRET-INPUT-DESCRIPTION`);
      return original(...args);
    };
  return {
    ...actual,
    createCipheriv: breakable('createCipheriv', actual.createCipheriv),
    createPrivateKey: breakable('createPrivateKey', actual.createPrivateKey),
    generateKeyPairSync: breakable('generateKeyPairSync', actual.generateKeyPairSync),
    hkdfSync: breakable('hkdfSync', actual.hkdfSync),
  };
});

const {
  KeyringError,
  encryptRecord,
  generateArtifactKey,
  sealBlob,
  unlockWithRecoveryKey,
  parseKeyring,
} = await import('../index.js');
const { readFileSync } = await import('node:fs');
const { fileURLToPath } = await import('node:url');
const { FIXTURE_RECOVERY_KEY, bytesOf } = await import('./helpers.js');
const { KNOWN_SEALING_PUBLIC_KEY_HEX } = await import('./helpers.js');

const fixture = parseKeyring(
  readFileSync(fileURLToPath(new URL('./fixtures/keyring-v1.json', import.meta.url)), 'utf8'),
);
const sealingPublicKey = Buffer.from(KNOWN_SEALING_PUBLIC_KEY_HEX, 'hex');

afterEach(() => broken.clear());

async function failureOf(action: () => unknown): Promise<InstanceType<typeof KeyringError>> {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(KeyringError);
    const keyringError = error as InstanceType<typeof KeyringError>;
    expect(keyringError.message).not.toContain('SECRET-INPUT-DESCRIPTION');
    expect(keyringError.cause).toBeUndefined();
    return keyringError;
  }
  throw new Error('expected the call to fail');
}

describe('node:crypto failures become KeyringErrors', () => {
  it('the AEAD cipher', async () => {
    broken.add('createCipheriv');
    const error = await failureOf(() =>
      encryptRecord(generateArtifactKey(), bytesOf('x'), bytesOf('a')),
    );
    expect(error.code).toBe('invalid-argument');
  });

  it('HKDF', async () => {
    broken.add('hkdfSync');
    const error = await failureOf(() => sealBlob(sealingPublicKey, bytesOf('x'), bytesOf('a')));
    expect(error.code).toBe('kdf-failed');
  });

  it('the ephemeral keypair of a seal', async () => {
    broken.add('generateKeyPairSync');
    const error = await failureOf(() => sealBlob(sealingPublicKey, bytesOf('x'), bytesOf('a')));
    expect(error.code).toBe('kdf-failed');
  });

  it('the keypairs derived at unlock', async () => {
    broken.add('createPrivateKey');
    const error = await failureOf(() => unlockWithRecoveryKey(fixture, FIXTURE_RECOVERY_KEY));
    expect(error.code).toBe('kdf-failed');
  });
});
