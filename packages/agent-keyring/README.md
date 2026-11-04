# @robota-sdk/agent-keyring

Key custody and sealing primitives for conversations that must stay unreadable to other programs
running as the same operating-system user. A passphrase and a one-time recovery key each unwrap one
master key. The master key derives an X25519 sealing keypair, an Ed25519 attach keypair and an
HMAC-SHA256 authorship key. Artifacts are encrypted under per-artifact data keys that are sealed to
the **public** sealing key, so a locked process can keep writing and only an unlocked keyring can
read; only an unlocked keyring can tag what it wrote (`tagAuthorship`/`verifyAuthorship` on the
unlocked keys), since an artifact that opens says nothing about who sealed it.

It uses `node:crypto` only (AES-256-GCM, scrypt, HKDF-SHA256, X25519, Ed25519), has no native
module and no `@robota-sdk` dependency, and runs on Node.js 22.12 or later and on Bun.

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
| `KeyringError`                                              | The only error thrown deliberately; `code` names the refusal and no message carries a secret  |

See [`docs/SPEC.md`](./docs/SPEC.md) for the contract and its limits: `lock()` drops references and
does not erase the keypairs, detecting truncated record sequences is the caller's job, a swapped
sealing public key is detected rather than prevented, and sealed data keys have no forward secrecy.

## License

This package is dual-licensed under the [GNU AGPL-3.0](../../LICENSE) or a [commercial license](../../COMMERCIAL.md). See [LICENSING.md](../../LICENSING.md).
