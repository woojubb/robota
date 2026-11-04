# @robota-sdk/agent-keyring

Key custody and sealing primitives for conversations that must stay unreadable to other programs
running as the same operating-system user. A passphrase and a one-time recovery key each unwrap one
master key. The master key derives an X25519 sealing keypair, an Ed25519 attach keypair and an
HMAC-SHA256 authorship key. Artifacts are encrypted under per-artifact data keys that are sealed to
the **public** sealing key, so a locked process can keep writing and only an unlocked keyring can
read; only an unlocked keyring can tag what it wrote (`tagAuthorship`/`verifyAuthorship` on the
read keys), since an artifact that opens says nothing about who sealed it.

An unlock yields the read keys only. The attach key stays inside a short-lived owner handover, which
certifies a served runtime's instance key and proves the owner on the **owner link**: a handshake in
which the runtime proves itself first, so a program on a taken-over socket gets nothing, followed by
AES-256-GCM frames and a read grant that hands a runtime the read keys and never the attach key or
the master key. The carrier that runs the link over a socket is `@robota-sdk/agent-transport-link`.

It uses `node:crypto` only (AES-256-GCM, scrypt, HKDF-SHA256, HMAC-SHA256, SHA-256, X25519,
Ed25519), has no native module and no `@robota-sdk` dependency, and runs on Node.js 22.12 or later
and on Bun.

## Installation

```bash
npm install @robota-sdk/agent-keyring
```

## Usage

```ts
import {
  createKeyring,
  getSealingPublicKey,
  openBlob,
  parseKeyring,
  sealBlob,
  serializeKeyring,
  unlockWithPassphrase,
} from '@robota-sdk/agent-keyring';

// Once: create the keyring, show `recoveryKey` to the user (it cannot be shown again), and store
// the serialized document.
const { keyring, recoveryKey, unlocked } = await createKeyring({ passphrase: 'a long passphrase' });
const document = serializeKeyring(keyring);

// A locked process holds only the file: it can seal, but not open.
const aad = new TextEncoder().encode('artifact:7f3a|seq:0');
const sealed = sealBlob(
  getSealingPublicKey(parseKeyring(document)),
  new TextEncoder().encode('hello'),
  aad,
);

// Later, with the passphrase (or `unlockWithRecoveryKey`), the owner can open it.
const keys = await unlockWithPassphrase(parseKeyring(document), 'a long passphrase');
const plaintext = openBlob(keys.sealing.privateKey, sealed, aad);
keys.lock();
unlocked.lock();
```

For artifacts with many records (a JSONL log), seal one data key with `sealArtifactKey`, encrypt each
batch with `encryptRecord`, and put the artifact id and a sequence number in the `aad` of every call.

## API

| Export                                                      | Description                                                                                   |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `createKeyring`                                             | New keyring with a passphrase slot and a recovery slot; returns it unlocked                   |
| `unlockWithPassphrase`, `unlockWithRecoveryKey`             | Recover the keys; scrypt runs off the event loop                                              |
| `changePassphrase`                                          | Re-wrap the passphrase slot under a new passphrase, proven by the old one or the recovery key |
| `checkSealingPublicKey`, `repairSealingPublicKey`           | Detect and repair a sealing public key swapped in the file                                    |
| `parseKeyring`, `serializeKeyring`, `getSealingPublicKey`   | Strict keyring document I/O and the public key a locked writer needs                          |
| `generateArtifactKey`, `sealArtifactKey`, `openArtifactKey` | Per-artifact data key, sealed to the public key and opened with the private key               |
| `encryptRecord`, `decryptRecord`                            | AES-256-GCM records under a data key, many per key                                            |
| `sealBlob`, `openBlob`                                      | A sealed key header plus one record, in one step                                              |
| `splitSealedBlob`                                           | A blob's sealed key and record, for a caller that keeps opened keys by sealed key             |
| `generateTransientSealingKeyPair`                           | A random X25519 sealing keypair for a key that lives only in one process's memory             |
| `fingerprint`                                               | Short human-comparable string for a public key                                                |
| `openOwnerHandover`                                         | The owner for a moment: certifies runtimes and proves the owner; hands out no key             |
| `startSpawnerExchange`, `SpawnerKey`                        | The spawner's side of the key exchange over the runtime's inherited channel                   |
| `createRuntimeIdentity`                                     | A runtime's memory-only instance key, its spawner key until certified, and its trust root     |
| `createLinkInitiator`, `createLinkResponder`                | The owner link handshake, as a client and as a runtime                                        |
| `linkFrameKind`                                             | The kind of a sealed link frame, before it is opened                                          |
| `KeyringError`, `LinkRefusedError`                          | The only errors thrown deliberately; `code` and `reason` name the refusal, never a secret     |

See [`docs/SPEC.md`](./docs/SPEC.md) for the contract and its limits: `lock()` drops references and
does not erase the keypairs, detecting truncated record sequences is the caller's job, a swapped
sealing public key is detected rather than prevented, sealed data keys have no forward secrecy, and
a runtime's spawner key admits whoever holds it until the runtime is certified.

## License

This package is dual-licensed under the [GNU AGPL-3.0](../../LICENSE) or a [commercial license](../../COMMERCIAL.md). See [LICENSING.md](../../LICENSING.md).
