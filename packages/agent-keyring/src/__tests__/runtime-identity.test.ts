/**
 * A runtime's identity: a memory-only instance key, the spawner key from its one exchange, and,
 * once its spawner certified it, the trust root. Installing the trust root checks the certificate
 * against this instance and the given binding, and forgets the spawner key for good.
 */
import { Buffer } from 'node:buffer';
import { createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  createKeyring,
  createRuntimeIdentity,
  openOwnerHandover,
  parseKeyring,
  startSpawnerExchange,
  type IOwnerHandover,
  type IRuntimeIdentity,
} from '../index.js';
import { runtimeIdentitySecrets } from '../runtime-identity.js';
import { FIXTURE_RECOVERY_KEY, KAT_BINDING, codeOf, hex, reachableValues } from './helpers.js';
import { refusalOf } from './link-helpers.js';

const fixture = parseKeyring(
  readFileSync(fileURLToPath(new URL('./fixtures/keyring-v1.json', import.meta.url)), 'utf8'),
);

let owner: IOwnerHandover;
let stranger: IOwnerHandover;

beforeAll(async () => {
  owner = await openOwnerHandover(fixture, {
    type: 'recoveryKey',
    recoveryKey: FIXTURE_RECOVERY_KEY,
  });
  const other = await createKeyring({ passphrase: 'another keyring entirely' });
  stranger = await openOwnerHandover(other.keyring, {
    type: 'recoveryKey',
    recoveryKey: other.recoveryKey,
  });
});

function exchanged(): IRuntimeIdentity {
  const identity = createRuntimeIdentity();
  startSpawnerExchange().complete(identity.answerSpawnerExchange(startSpawnerExchange().message));
  return identity;
}

describe('createRuntimeIdentity', () => {
  it('makes a fresh Ed25519 instance key for every runtime, held only in memory', () => {
    const first = createRuntimeIdentity();
    const second = createRuntimeIdentity();
    expect(first.instancePublicKey).toHaveLength(32);
    expect(hex(first.instancePublicKey)).not.toBe(hex(second.instancePublicKey));
    const { instance } = runtimeIdentitySecrets(first);
    expect(instance.privateKey.asymmetricKeyType).toBe('ed25519');
    expect(
      hex(
        createPublicKey(instance.privateKey).export({ format: 'der', type: 'spki' }).subarray(12),
      ),
    ).toBe(hex(first.instancePublicKey));
    expect(first.certified).toBe(false);
    expect(first.spawnerKeyHeld).toBe(false);
  });

  it('hands out no key: only the instance public key is reachable', () => {
    const identity = exchanged();
    const bytes = reachableValues(identity).filter((value) => ArrayBuffer.isView(value));
    expect(bytes.map((value) => hex(value as Uint8Array))).toEqual([
      hex(identity.instancePublicKey),
    ]);
    expect(Object.keys(JSON.parse(JSON.stringify(identity)) as object)).toEqual([]);
  });
});

describe('installTrustRoot', () => {
  it('keeps a root that certifies this instance for the binding, and forgets the spawner key', () => {
    const identity = exchanged();
    const spawnerKey = runtimeIdentitySecrets(identity).spawnerKey();
    expect(spawnerKey).toBeDefined();
    identity.installTrustRoot(owner.certify(identity.instancePublicKey, KAT_BINDING), KAT_BINDING);
    expect(identity.certified).toBe(true);
    expect(identity.spawnerKeyHeld).toBe(false);
    expect(runtimeIdentitySecrets(identity).spawnerKey()).toBeUndefined();
    expect(spawnerKey!.every((byte) => byte === 0)).toBe(true);
    expect(runtimeIdentitySecrets(identity).trust()?.binding).toEqual(KAT_BINDING);
  });

  it('refuses a certificate for another instance, another binding or under another attach key', () => {
    const identity = exchanged();
    const other = createRuntimeIdentity();
    const forOther = owner.certify(other.instancePublicKey, KAT_BINDING);
    const forThis = owner.certify(identity.instancePublicKey, KAT_BINDING);
    const flipped = Buffer.from(forThis.certificate);
    flipped[0] ^= 1;
    const cases = [
      [forOther, KAT_BINDING],
      [forThis, { ...KAT_BINDING, generation: 'another-start' }],
      [forThis, { ...KAT_BINDING, runtimeId: 'another-runtime' }],
      [
        {
          ...forThis,
          attachPublicKey: stranger.certify(identity.instancePublicKey, KAT_BINDING)
            .attachPublicKey,
        },
        KAT_BINDING,
      ],
      [{ ...forThis, certificate: flipped }, KAT_BINDING],
    ] as const;
    for (const [root, binding] of cases) {
      expect(refusalOf(() => identity.installTrustRoot(root, binding))).toBe(
        'certificate-mismatch',
      );
    }
    // A refused root changes nothing: the spawner can still certify the runtime.
    expect(identity.certified).toBe(false);
    expect(identity.spawnerKeyHeld).toBe(true);
    identity.installTrustRoot(forThis, KAT_BINDING);
    expect(identity.certified).toBe(true);
  });

  it('accepts a root another keyring made for this instance: who may install is the spawner link’s', () => {
    const identity = exchanged();
    identity.installTrustRoot(
      stranger.certify(identity.instancePublicKey, KAT_BINDING),
      KAT_BINDING,
    );
    expect(identity.certified).toBe(true);
  });

  it('refuses a malformed root or binding as a caller bug', () => {
    const identity = exchanged();
    const root = owner.certify(identity.instancePublicKey, KAT_BINDING);
    expect(
      codeOf(() =>
        identity.installTrustRoot(
          { ...root, certificate: root.certificate.subarray(1) },
          KAT_BINDING,
        ),
      ),
    ).toBe('invalid-argument');
    expect(
      codeOf(() =>
        identity.installTrustRoot({ ...root, attachPublicKey: new Uint8Array(31) }, KAT_BINDING),
      ),
    ).toBe('invalid-argument');
    expect(
      codeOf(() => identity.installTrustRoot(root, { runtimeId: 'a b', generation: 'g' })),
    ).toBe('invalid-argument');
    expect(identity.spawnerKeyHeld).toBe(true);
  });

  it('installs once, and only while the spawner key is held', () => {
    const identity = exchanged();
    const root = owner.certify(identity.instancePublicKey, KAT_BINDING);
    identity.installTrustRoot(root, KAT_BINDING);
    expect(refusalOf(() => identity.installTrustRoot(root, KAT_BINDING))).toBe('already-certified');
    const neverExchanged = createRuntimeIdentity();
    expect(
      refusalOf(() =>
        neverExchanged.installTrustRoot(
          owner.certify(neverExchanged.instancePublicKey, KAT_BINDING),
          KAT_BINDING,
        ),
      ),
    ).toBe('spawner-unavailable');
    expect(neverExchanged.certified).toBe(false);
  });
});
