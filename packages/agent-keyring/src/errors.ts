/**
 * Why an operation was refused. The union is the whole error vocabulary: a caller decides on `code`,
 * never on the message.
 *
 * - `wrong-credential` — the passphrase or recovery key did not open the keyslot. A mistyped
 *   credential and a tampered slot are indistinguishable by design (both fail authentication).
 * - `malformed-keyring` / `unsupported-version` — the keyring document is not a valid version-1
 *   document, or names a version this build does not know. `unsupported-version` also covers an
 *   unknown version byte on a sealed key, record or blob.
 * - `kdf-parameters-out-of-bounds` — a slot asks for a scrypt cost outside the accepted range; raised
 *   before any key derivation runs. `kdf-failed` means a key derivation or key generation could not
 *   run on this host (for example memory, or a crypto build without the curve), with inputs that
 *   were in range.
 * - `empty-passphrase` / `invalid-recovery-key` — the credential has the wrong form; no key
 *   derivation ran.
 * - `slot-not-found` — the keyring has no slot of the type the operation needs.
 * - `malformed-ciphertext` — a sealed key, record or blob is structurally impossible (too short).
 * - `decryption-failed` — authentication failed: wrong key, wrong AAD, or modified bytes.
 * - `invalid-argument` — a key or buffer argument has the wrong type or length, or a key the
 *   cipher or key import refuses.
 * - `keys-locked` — the unlocked key set was locked and no longer hands out keys.
 */
export type TKeyringErrorCode =
  | 'wrong-credential'
  | 'malformed-keyring'
  | 'unsupported-version'
  | 'kdf-parameters-out-of-bounds'
  | 'kdf-failed'
  | 'empty-passphrase'
  | 'invalid-recovery-key'
  | 'slot-not-found'
  | 'malformed-ciphertext'
  | 'decryption-failed'
  | 'invalid-argument'
  | 'keys-locked';

/**
 * The only error this package throws on purpose. Messages are fixed text that names a field or a
 * rule; no message or property ever carries a passphrase, a key, a recovery key or any value derived
 * from them, and the original `node:crypto` error is deliberately not chained.
 */
export class KeyringError extends Error {
  readonly code: TKeyringErrorCode;

  constructor(code: TKeyringErrorCode, message: string) {
    super(message);
    this.name = 'KeyringError';
    this.code = code;
  }
}
