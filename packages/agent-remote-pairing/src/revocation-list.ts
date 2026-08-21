/**
 * SEC-011 (issue #1865): how a revocation REACHES the machine doing the checking.
 *
 * `verifyDeviceCertificate` already accepts `revokedDeviceIds` and refuses a listed device with an
 * intact signature. What was undecided is where that list comes from — and the item names this as
 * the substantive open design question, correctly, because the naive answers all fail the same way.
 *
 * ## The failure that shapes the design
 *
 * A revocation is the one security statement whose ABSENCE is the attack. A certificate that never
 * arrives simply does not authenticate; a revocation that never arrives silently authorizes a device
 * the user retired. So an attacker who can influence distribution does not need to forge anything —
 * they withhold, or they replay yesterday's list.
 *
 * That rules out two shapes immediately:
 *
 *   an UNSIGNED list          anyone on the path edits it, and removing an entry is the whole attack
 *   a signed list with NO expiry   self-authenticating and still replayable: last week's list is
 *                             genuinely signed, and it does not mention the device revoked since
 *
 * ## What this is instead
 *
 * A list signed by the USER ROOT — the same key that signs device certificates, so any machine that
 * can verify a certificate can already verify a list, and distribution needs no trusted channel. It
 * can travel over the signaling server, on the data channel, in a file, or by hand.
 *
 * And it carries `expiresAt`. A verifier holding a list past that point does not fall back to "no
 * revocations": it refuses, because a stale list is indistinguishable from a withheld one, and the
 * safe reading of "I cannot tell whether this device was retired" is not "it was not".
 *
 * `issuedAt` is monotonic per user, so a verifier that has seen a newer list refuses an older one
 * even while both are unexpired. Without that, an attacker who captured any past list could roll a
 * verifier backwards to a moment before the revocation they care about.
 *
 * ## What this module does NOT do
 *
 * It does not fetch, cache, or schedule. Where a list is stored and how often it is refreshed are
 * deployment decisions, and a primitive that also fetched would need a transport — which is how a
 * crypto module ends up with a network dependency and an untestable path.
 */

import { ab, toBase64Url } from './crypto-primitives.js';

const SIGN_PARAMS = { name: 'ECDSA', hash: 'SHA-256' } as const;
const webcrypto = globalThis.crypto;
const encoder = new TextEncoder();

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** Everything a revocation list binds, before it is signed. */
export interface IRevocationListClaims {
  /** Whose devices these are. A list for another root is another person's. */
  readonly userId: string;
  /**
   * The retired device ids. An EMPTY list is a real statement — "nothing is revoked as of now" — and
   * is exactly why the list is issued on a schedule rather than only when something is revoked. A
   * user who has revoked nothing still needs a fresh list, or every verifier is permanently stale.
   */
  readonly revokedDeviceIds: readonly string[];
  /** Monotonic per user. A verifier that has seen a newer list refuses an older one. */
  readonly issuedAt: number;
  /** Past this, a holder must refuse rather than read the list as "no revocations". */
  readonly expiresAt: number;
}

export interface IRevocationList extends IRevocationListClaims {
  /** base64url ECDSA signature by the USER ROOT private key over every claim above. */
  readonly signature: string;
}

/** The bytes a list signature covers — every claim, in a fixed order, versioned. */
function listBytes(claims: IRevocationListClaims): Uint8Array {
  return encoder.encode(
    JSON.stringify([
      'robota.device-revocation-list.v1',
      claims.userId,
      // Sorted, so two lists with the same members produce the same bytes whatever order they were
      // assembled in. Without this a re-issue with a reordered array is a different signature over
      // an identical statement, and a verifier comparing bytes would call them different lists.
      [...claims.revokedDeviceIds].sort(),
      claims.issuedAt,
      claims.expiresAt,
    ]),
  );
}

/** Sign a revocation list for this user. */
export async function issueRevocationList(
  claims: IRevocationListClaims,
  rootPrivateKey: CryptoKey,
): Promise<IRevocationList> {
  const signature = await webcrypto.subtle.sign(SIGN_PARAMS, rootPrivateKey, ab(listBytes(claims)));
  return { ...claims, signature: toBase64Url(new Uint8Array(signature)) };
}

/**
 * Why a list was not accepted. Closed vocabulary, so a caller cannot soften one into a pass.
 *
 * `stale` and `superseded` are separate because they call for different operator responses: the
 * first says nobody has issued a list recently enough, the second says this specific list is behind
 * one this machine already holds — which is what a rollback attempt looks like.
 */
export type TRevocationRejection = 'signature-invalid' | 'user-mismatch' | 'stale' | 'superseded';

export interface IRevocationVerdict {
  readonly usable: boolean;
  /** The ids to pass to `verifyDeviceCertificate`. Present ONLY when usable. */
  readonly revokedDeviceIds?: readonly string[];
  readonly rejection?: TRevocationRejection;
}

export interface IVerifyRevocationListOptions {
  readonly rootPublicKey: CryptoKey;
  readonly expectedUserId: string;
  readonly now: number;
  /**
   * `issuedAt` of the newest list this machine has already accepted, if any.
   *
   * Supplied rather than remembered here for the same reason nothing is fetched here: where a
   * machine keeps its high-water mark is a deployment decision. Absent means "this is the first",
   * which is correct on a fresh machine and is NOT a way to bypass the check — a caller that
   * discards its mark is choosing to accept a rollback, and that choice is visible at the call site.
   */
  readonly newestAcceptedAt?: number;
}

/**
 * Verify a revocation list against this user and this moment.
 *
 * The signature is checked FIRST, for the same reason as everywhere else in this package: every
 * later comparison must be about fields the root actually signed, not about attacker-supplied values
 * that merely travelled alongside a signature.
 */
export async function verifyRevocationList(
  list: IRevocationList,
  options: IVerifyRevocationListOptions,
): Promise<IRevocationVerdict> {
  const { signature, ...claims } = list;
  const signatureOk = await webcrypto.subtle.verify(
    SIGN_PARAMS,
    options.rootPublicKey,
    ab(fromBase64Url(signature)),
    ab(listBytes(claims)),
  );
  if (!signatureOk) return { usable: false, rejection: 'signature-invalid' };

  if (claims.userId !== options.expectedUserId)
    return { usable: false, rejection: 'user-mismatch' };
  if (options.now >= claims.expiresAt) return { usable: false, rejection: 'stale' };
  if (options.newestAcceptedAt !== undefined && claims.issuedAt < options.newestAcceptedAt) {
    return { usable: false, rejection: 'superseded' };
  }
  return { usable: true, revokedDeviceIds: claims.revokedDeviceIds };
}

/**
 * What a verifier should do when it has no usable list: refuse, and say why.
 *
 * Stated as a function rather than left to each call site, because the tempting shape at a call site
 * is `revokedDeviceIds: list?.revokedDeviceIds ?? []` — which reads as a safe default and is the
 * exact fail-OPEN this module exists to prevent. An empty array means "nothing is revoked", and an
 * absent list does not say that.
 */
export function revocationUnavailable(rejection: TRevocationRejection): string {
  return (
    `no usable device revocation list (${rejection}). Refusing rather than proceeding: an absent ` +
    'or stale list is indistinguishable from one an attacker withheld, and reading it as ' +
    '"nothing is revoked" is how a retired device keeps working.'
  );
}
