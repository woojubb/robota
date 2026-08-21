/**
 * SEC-011 (issue #1865): rotating the user root key, and what happens to what it signed.
 *
 * ## Rotation is two different problems wearing one word
 *
 * **Hygiene.** The key is fine; the user is replacing it on a schedule, or moving it to better
 * storage. Continuity is wanted: the devices already enrolled should keep working while they are
 * re-certified. That is what this module does.
 *
 * **Compromise.** Someone else has the key. Continuity is exactly what must NOT be preserved — and
 * this mechanism cannot provide it, because an attacker holding the old private key can sign the
 * very same statement naming a root of their choosing. A rotation chain rooted in the old key is
 * worthless the moment the old key is the thing that failed.
 *
 * **So a compromised root is not rotated. It is abandoned.** The user generates a new root, gets a
 * new `userId`, and re-enrols every device out of band — the old identity is not repaired, it is
 * left behind, and every verifier that learns the new root learns it the way it learned the first
 * one. This module deliberately offers no path that looks like it handles that case, because a
 * function named `rotate` that silently did the wrong thing under compromise would be worse than
 * none at all.
 *
 * ## Why BOTH roots sign
 *
 * The old root signs because it is the only thing that can say "this succeeds me" — a statement
 * signed by the new key alone is an assertion by a stranger.
 *
 * The new root signs because otherwise anyone holding the old key could name a public key they do
 * NOT hold as the successor, and every verifier would then move to an identity nobody can issue
 * certificates for. The user would be locked out by a statement that verified perfectly. Requiring
 * the successor to countersign is what makes "the named key exists and consents" checkable.
 *
 * ## The overlap window is bounded, and it is not optional
 *
 * `previousValidUntil` is a claim, inside the signature. Without a bound the old root would be
 * acceptable forever and the rotation would have changed nothing; with an unsigned bound anyone on
 * the path could extend it. A verifier past that moment refuses certificates from the old root even
 * though the rotation statement itself still verifies — the statement stays true, the permission it
 * granted has run out.
 */

import { ab, toBase64Url } from './crypto-primitives.js';
import { exportPublicKey } from './device-identity.js';

const SIGN_PARAMS = { name: 'ECDSA', hash: 'SHA-256' } as const;
const webcrypto = globalThis.crypto;
const encoder = new TextEncoder();

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** Everything a rotation binds, before either root signs it. */
export interface IRootRotationClaims {
  /** The root being retired. */
  readonly previousUserId: string;
  /** The root taking over. */
  readonly nextUserId: string;
  /** base64url SPKI of the successor, so a verifier needs nothing else to start trusting it. */
  readonly nextRootPublicKey: string;
  readonly rotatedAt: number;
  /**
   * Certificates signed by the PREVIOUS root stay acceptable until this moment.
   *
   * A bound, not a courtesy. Unbounded overlap means the rotation changed nothing, and the whole
   * point of re-certifying devices is that there is a deadline to do it by.
   */
  readonly previousValidUntil: number;
}

export interface IRootRotation extends IRootRotationClaims {
  /** base64url ECDSA signature by the PREVIOUS root — "this key succeeds me". */
  readonly previousSignature: string;
  /** base64url ECDSA signature by the NEXT root — "I exist, and I accept". */
  readonly nextSignature: string;
}

/** The bytes both signatures cover — every claim, in a fixed order, versioned. */
function rotationBytes(claims: IRootRotationClaims): Uint8Array {
  return encoder.encode(
    JSON.stringify([
      'robota.user-root-rotation.v1',
      claims.previousUserId,
      claims.nextUserId,
      claims.nextRootPublicKey,
      claims.rotatedAt,
      claims.previousValidUntil,
    ]),
  );
}

export interface IIssueRotationOptions {
  readonly previousUserId: string;
  readonly nextUserId: string;
  readonly previousRootPrivateKey: CryptoKey;
  readonly nextRootKeyPair: CryptoKeyPair;
  readonly rotatedAt: number;
  readonly previousValidUntil: number;
}

/**
 * Sign a rotation with both roots.
 *
 * Takes the successor's KEY PAIR rather than its private key alone, because the public half is what
 * goes into the claims — and a caller that supplied them separately could sign over one key while
 * countersigning with another, producing a statement that verifies and names the wrong successor.
 */
export async function issueRootRotation(options: IIssueRotationOptions): Promise<IRootRotation> {
  const claims: IRootRotationClaims = {
    previousUserId: options.previousUserId,
    nextUserId: options.nextUserId,
    nextRootPublicKey: await exportPublicKey(options.nextRootKeyPair.publicKey),
    rotatedAt: options.rotatedAt,
    previousValidUntil: options.previousValidUntil,
  };
  const bytes = ab(rotationBytes(claims));
  const [previousSignature, nextSignature] = await Promise.all([
    webcrypto.subtle.sign(SIGN_PARAMS, options.previousRootPrivateKey, bytes),
    webcrypto.subtle.sign(SIGN_PARAMS, options.nextRootKeyPair.privateKey, bytes),
  ]);
  return {
    ...claims,
    previousSignature: toBase64Url(new Uint8Array(previousSignature)),
    nextSignature: toBase64Url(new Uint8Array(nextSignature)),
  };
}

/**
 * Why a rotation was not accepted. Closed vocabulary, so a caller cannot soften one into a pass.
 *
 * The two signature rejections are separate because they mean different things: the first says the
 * retiring root did not authorise this, the second says the named successor did not countersign —
 * which is the lock-out attempt, and an operator needs to be able to tell them apart.
 */
export type TRotationRejection =
  | 'previous-signature-invalid'
  | 'next-signature-invalid'
  | 'wrong-previous-root'
  | 'not-yet-valid'
  | 'overlap-inverted';

export interface IRotationVerdict {
  readonly accepted: boolean;
  /** The successor to start trusting. Present ONLY when accepted. */
  readonly nextUserId?: string;
  readonly nextRootPublicKey?: string;
  /** Until when certificates from the previous root remain acceptable. Present ONLY when accepted. */
  readonly previousValidUntil?: number;
  readonly rejection?: TRotationRejection;
}

export interface IVerifyRotationOptions {
  /** The root this verifier trusts TODAY. A rotation away from any other root is not its business. */
  readonly previousRootPublicKey: CryptoKey;
  readonly expectedPreviousUserId: string;
  readonly now: number;
}

/**
 * Verify a rotation against the root this machine currently trusts.
 *
 * Both signatures are checked FIRST, for the reason this package checks signatures first everywhere:
 * every later comparison must be about fields that were actually signed.
 */
export async function verifyRootRotation(
  rotation: IRootRotation,
  options: IVerifyRotationOptions,
): Promise<IRotationVerdict> {
  const { previousSignature, nextSignature, ...claims } = rotation;
  const bytes = ab(rotationBytes(claims));

  const previousOk = await webcrypto.subtle.verify(
    SIGN_PARAMS,
    options.previousRootPublicKey,
    ab(fromBase64Url(previousSignature)),
    bytes,
  );
  if (!previousOk) return { accepted: false, rejection: 'previous-signature-invalid' };

  // The successor's key comes from the claims the PREVIOUS root just signed, never from anywhere
  // else — which is what makes the countersignature a check rather than a formality.
  const nextRootPublicKey = await webcrypto.subtle.importKey(
    'spki',
    ab(fromBase64Url(claims.nextRootPublicKey)),
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify'],
  );
  const nextOk = await webcrypto.subtle.verify(
    SIGN_PARAMS,
    nextRootPublicKey,
    ab(fromBase64Url(nextSignature)),
    bytes,
  );
  if (!nextOk) return { accepted: false, rejection: 'next-signature-invalid' };

  if (claims.previousUserId !== options.expectedPreviousUserId) {
    return { accepted: false, rejection: 'wrong-previous-root' };
  }
  if (options.now < claims.rotatedAt) return { accepted: false, rejection: 'not-yet-valid' };
  if (claims.previousValidUntil < claims.rotatedAt) {
    // An overlap that ends before it begins is not a tight window, it is a malformed statement — and
    // reading it as "no overlap" would silently invalidate every enrolled device at a moment the
    // signer may not have intended.
    return { accepted: false, rejection: 'overlap-inverted' };
  }
  return {
    accepted: true,
    nextUserId: claims.nextUserId,
    nextRootPublicKey: claims.nextRootPublicKey,
    previousValidUntil: claims.previousValidUntil,
  };
}

/**
 * Is a certificate from the PREVIOUS root still acceptable at `now`?
 *
 * A function rather than a comparison at each call site, because the tempting spelling is
 * `now < rotation.previousValidUntil` against the raw statement — which reads the bound off an
 * unverified object. This takes the VERDICT, so the only way to ask is to have verified first.
 */
export function previousRootStillAccepted(verdict: IRotationVerdict, now: number): boolean {
  return verdict.accepted && verdict.previousValidUntil !== undefined
    ? now < verdict.previousValidUntil
    : false;
}
