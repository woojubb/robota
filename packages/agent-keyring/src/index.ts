/**
 * `@robota-sdk/agent-keyring` — key custody and sealing primitives for secure conversations, on
 * `node:crypto` only. A passphrase and a recovery key each unwrap one master key; the master key
 * derives an X25519 sealing keypair, an Ed25519 attach keypair and an HMAC authorship key; artifacts
 * are encrypted under per-artifact keys that are sealed to the public sealing key, so a locked process
 * can still write, and only an unlocked one can tag what it wrote. An unlock yields the read keys;
 * the attach key stays inside a short-lived owner handover, which certifies runtimes.
 */
export { KeyringError, LinkRefusedError } from './errors.js';
export type { TKeyringErrorCode, TLinkRefusalReason } from './errors.js';

export type {
  IKeyring,
  IPassphraseKeyslot,
  IRecoveryKeyslot,
  IScryptKdfParameters,
  TKeyslot,
  TKeyslotType,
} from './keyring-types.js';
export { KEYRING_VERSION } from './keyring-types.js';
export { getSealingPublicKey, parseKeyring, serializeKeyring } from './keyring-document.js';

export {
  changePassphrase,
  checkSealingPublicKey,
  createKeyring,
  repairSealingPublicKey,
  unlockWithPassphrase,
  unlockWithRecoveryKey,
} from './keyring.js';
export type { ICreateKeyringOptions, ICreatedKeyring, TKeyringCredential } from './keyring.js';

export type { IReadKeys } from './read-keys.js';
export { openOwnerHandover } from './owner-handover.js';
export type { IOwnerHandover } from './owner-handover.js';
export type { ILinkBinding, ITrustRoot } from './runtime-certificate.js';
export { SpawnerKey, startSpawnerExchange } from './spawner-exchange.js';
export type { ISpawnerExchange, ISpawnerExchangeResult } from './spawner-exchange.js';
export { createRuntimeIdentity } from './runtime-identity.js';
export type { IRuntimeIdentity } from './runtime-identity.js';
export type { IKeyPair } from './key-pairs.js';
export { generateTransientSealingKeyPair } from './key-pairs.js';

export { fingerprint } from './fingerprint.js';

export {
  decryptRecord,
  encryptRecord,
  generateArtifactKey,
  openArtifactKey,
  openBlob,
  sealArtifactKey,
  sealBlob,
  splitSealedBlob,
} from './sealing.js';
