// Runtime smoke for the BUILT package: create -> seal (public key only) -> unlock -> open.
// Run under both runtimes: `node scripts/smoke.mjs` and `bun scripts/smoke.mjs`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import {
  changePassphrase,
  checkSealingPublicKey,
  createKeyring,
  decryptRecord,
  encryptRecord,
  fingerprint,
  generateArtifactKey,
  generateTransientSealingKeyPair,
  getSealingPublicKey,
  KeyringError,
  openBlob,
  parseKeyring,
  sealBlob,
  serializeKeyring,
  unlockWithPassphrase,
  unlockWithRecoveryKey,
} from '../dist/node/index.js';

const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.version}`;
const passphrase = 'correct horse battery staple';
const aad = new TextEncoder().encode('artifact:smoke|seq:0');
const plaintext = new TextEncoder().encode('{"role":"user","text":"hello"}\n');

const created = await createKeyring({ passphrase });
const onDisk = serializeKeyring(created.keyring);

// A locked process holds the keyring file and nothing else: it can seal, never open.
const publicKeyOnly = getSealingPublicKey(parseKeyring(onDisk));
const blob = sealBlob(publicKeyOnly, plaintext, aad);
assert.equal(
  Buffer.from(blob).includes(Buffer.from(plaintext)),
  false,
  'plaintext leaked into the blob',
);

const unlocked = await unlockWithPassphrase(parseKeyring(onDisk), passphrase);
assert.deepEqual(openBlob(unlocked.sealing.privateKey, blob, aad), Buffer.from(plaintext));
assert.deepEqual(checkSealingPublicKey(parseKeyring(onDisk), unlocked), { matches: true });

const viaRecovery = await unlockWithRecoveryKey(
  parseKeyring(onDisk),
  created.recoveryKey.toLowerCase(),
);
assert.deepEqual(openBlob(viaRecovery.sealing.privateKey, blob, aad), Buffer.from(plaintext));

// Records under one artifact key, as a JSONL log would use them.
const artifactKey = generateArtifactKey();
const record = encryptRecord(artifactKey, plaintext, aad);
assert.deepEqual(decryptRecord(artifactKey, record, aad), Buffer.from(plaintext));

// Tampering is refused with a typed error, never with partial plaintext.
const tampered = Buffer.from(blob);
tampered[tampered.length - 1] ^= 1;
assert.throws(
  () => openBlob(unlocked.sealing.privateKey, tampered, aad),
  (error) => error instanceof KeyringError && error.code === 'decryption-failed',
);

// A wrong passphrase is refused the same way on both runtimes.
await assert.rejects(
  unlockWithPassphrase(parseKeyring(onDisk), `${passphrase}!`),
  (error) => error instanceof KeyringError && error.code === 'wrong-credential',
);

// Changing the passphrase re-wraps the slot and keeps every key.
const changed = await changePassphrase(
  created.keyring,
  { type: 'recoveryKey', recoveryKey: created.recoveryKey },
  'a different passphrase',
);
const afterChange = await unlockWithPassphrase(changed, 'a different passphrase');
assert.deepEqual(openBlob(afterChange.sealing.privateKey, blob, aad), Buffer.from(plaintext));

// Every single-byte change to a blob is refused (the key header, the nonce, the ciphertext, the tag).
for (let index = 0; index < blob.length; index += 1) {
  const changedBlob = Buffer.from(blob);
  changedBlob[index] ^= 1;
  assert.throws(() => openBlob(unlocked.sealing.privateKey, changedBlob, aad), KeyringError);
}

// A transient keypair is built from a seed the way the derived ones are, on either runtime.
const transient = generateTransientSealingKeyPair();
assert.equal(transient.privateKey.asymmetricKeyType, 'x25519');
assert.deepEqual(
  openBlob(transient.privateKey, sealBlob(transient.publicKey, plaintext, aad), aad),
  Buffer.from(plaintext),
);
assert.throws(
  () => openBlob(unlocked.sealing.privateKey, sealBlob(transient.publicKey, plaintext, aad), aad),
  (error) => error instanceof KeyringError && error.code === 'decryption-failed',
);

// A low-order sealing public key has no usable ECDH secret; sealing to it is refused.
assert.throws(
  () => sealBlob(new Uint8Array(32), plaintext, aad),
  (error) => error instanceof KeyringError && error.code === 'invalid-argument',
);

// The checked-in version-1 keyring still unlocks and derives the pinned public keys.
const fixture = parseKeyring(
  readFileSync(new URL('../src/__tests__/fixtures/keyring-v1.json', import.meta.url), 'utf8'),
);
const fixtureKeys = await unlockWithPassphrase(fixture, 'P\u00e4ssw\u00f6rd-fixture-1');
assert.equal(
  Buffer.from(fixtureKeys.sealing.publicKey).toString('hex'),
  '4b73c35676631b6307fb28a3f70aaf47c331b86ada4996ce2f3c9f5c04cdba7a',
);
assert.equal(
  Buffer.from(fixtureKeys.attach.publicKey).toString('hex'),
  '92ffeb9a3ccccde96ea227ff3e2f467989d8fdc5b234e8fdcf1d159a7f56ad54',
);
const fixtureViaRecovery = await unlockWithRecoveryKey(
  fixture,
  'M2GT-58X4-MPKA-FA59-NANT-SBDE-NYRB-3CNK',
);
assert.deepEqual(fixtureViaRecovery.attach.publicKey, fixtureKeys.attach.publicKey);

// Both module formats of the published entry points behave alike.
const cjs = createRequire(import.meta.url)('../dist/node/index.cjs');
assert.equal(typeof cjs.createKeyring, 'function');
assert.equal(fingerprint(unlocked.sealing.publicKey).length, 24);

unlocked.lock();
assert.equal(unlocked.locked, true);

console.log(`OK ${runtime}`);
