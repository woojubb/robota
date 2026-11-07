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
 * - `link-refused` — an owner-link step was refused; the error is a {@link LinkRefusedError}, whose
 *   `reason` names the check that failed. The other end of a link is never told the reason.
 * - `link-closed` — the link was closed, by `close()` or by a frame that did not open, and protects
 *   nothing more.
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
  | 'keys-locked'
  | 'link-refused'
  | 'link-closed';

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

/**
 * Why an owner-link step was refused. Each names the one check that failed, for logs and for the
 * caller's fixed wording; none says anything about a key.
 *
 * - `malformed` — a message or value of the wrong length, version, mode or encoding.
 * - `out-of-order` — a step taken twice, or before its turn.
 * - `spawner-unavailable` — spawner standing was asked of a runtime without a spawner key: it never
 *   ran its exchange, or its spawner key was forgotten when its trust root was installed.
 * - `not-certified` — owner mode was asked of a runtime with no trust root.
 * - `already-certified` — a second trust root.
 * - `certificate-mismatch` — the certificate is not the attach key's signature over this instance
 *   and binding: made by another keyring, or for another runtime or start.
 * - `instance-mismatch` — the runtime answered with an instance key other than its exchange's.
 * - `binding-mismatch` — the authenticated runtime is not the selected runtime start.
 * - `bad-runtime-proof` — the runtime's proof of the transcript did not verify.
 * - `bad-proof` — the initiator's proof of the transcript did not verify.
 */
export type TLinkRefusalReason =
  | 'malformed'
  | 'out-of-order'
  | 'spawner-unavailable'
  | 'not-certified'
  | 'already-certified'
  | 'certificate-mismatch'
  | 'instance-mismatch'
  | 'binding-mismatch'
  | 'bad-runtime-proof'
  | 'bad-proof';

const LINK_REFUSAL_MESSAGES: Readonly<Record<TLinkRefusalReason, string>> = {
  malformed: 'The owner link refused a malformed message.',
  'out-of-order': 'The owner link refused a step out of order.',
  'spawner-unavailable': 'The runtime holds no spawner key.',
  'not-certified': 'The runtime holds no trust root.',
  'already-certified': 'The runtime already holds a trust root.',
  'certificate-mismatch': 'The certificate does not certify this runtime for this owner.',
  'instance-mismatch': 'The runtime answered with another instance key.',
  'binding-mismatch': 'The runtime binding differs from the selected runtime start.',
  'bad-runtime-proof': 'The runtime did not prove the transcript.',
  'bad-proof': 'The initiator did not prove the transcript.',
};

/** An owner-link refusal: a `KeyringError` with code `link-refused` and the failed check as `reason`. */
export class LinkRefusedError extends KeyringError {
  readonly reason: TLinkRefusalReason;

  constructor(reason: TLinkRefusalReason) {
    super('link-refused', LINK_REFUSAL_MESSAGES[reason]);
    this.name = 'LinkRefusedError';
    this.reason = reason;
  }
}
