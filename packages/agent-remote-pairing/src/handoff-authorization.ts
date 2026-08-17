/**
 * SEC-011 (#1812): the grant that authorizes ONE hand-off, to ONE destination, over ONE channel.
 *
 * ## Why a certificate is not enough
 *
 * `user-identity.ts` answers "is this device my user's". That is necessary and nowhere near
 * sufficient: it says nothing about WHICH transfer, to WHICH destination, over WHICH channel, or
 * WHEN. A same-user proof reused for a second transfer is exactly the failure the issue names —
 * *"authentication and authorization decisions are bound to the exact hand-off/session and cannot be
 * reused for another transfer"*.
 *
 * So every binding lives INSIDE the signature. Each one closes an attack that is otherwise open:
 *
 * | Field | Without it |
 * | --- | --- |
 * | `userId` | A different user's device passes |
 * | `sourceDeviceId` / `destinationDeviceId` | The grant is replayable toward a third device |
 * | `handoffId` + `sessionId` | One authorization moves a different session |
 * | `nonce` | A recorded grant replays |
 * | `channelFingerprint` | The grant is presented over a substituted channel |
 * | `expiresAt` | A stolen grant is valid forever |
 *
 * A signature over a subset would leave the omitted field attacker-editable while the signature
 * still verified, which reads as a valid authorization — the worst shape available.
 *
 * ## Signaling is a rendezvous, not an authority
 *
 * The grant is minted by the source and verified by the destination end to end. A signaling server
 * that reads every byte still cannot authorize a transfer or read session content: it holds no
 * private key, and every field it could tamper with is signed.
 */

import { ab } from './crypto-primitives.js';

const SIGN_PARAMS = { name: 'ECDSA', hash: 'SHA-256' } as const;

const webcrypto = globalThis.crypto;
const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** Everything the grant binds, before it is signed. */
export interface IHandoffGrantClaims {
  readonly userId: string;
  readonly sourceDeviceId: string;
  readonly destinationDeviceId: string;
  /** The specific transfer. A second hand-off gets a second id and therefore a second grant. */
  readonly handoffId: string;
  /** The session being moved. */
  readonly sessionId: string;
  /** Single-use, minted per attempt. */
  readonly nonce: string;
  /** The DTLS fingerprint of the channel this grant may be presented over. */
  readonly channelFingerprint: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export interface IHandoffGrant extends IHandoffGrantClaims {
  /** base64url ECDSA signature by the SOURCE device's private key over every claim above. */
  readonly signature: string;
}

/** The bytes a grant signature covers — every claim, in a fixed order, versioned. */
function grantBytes(claims: IHandoffGrantClaims): Uint8Array {
  return encoder.encode(
    JSON.stringify([
      'robota.handoff-grant.v1',
      claims.userId,
      claims.sourceDeviceId,
      claims.destinationDeviceId,
      claims.handoffId,
      claims.sessionId,
      claims.nonce,
      claims.channelFingerprint,
      claims.issuedAt,
      claims.expiresAt,
    ]),
  );
}

/** Mint a grant for exactly one transfer. */
export async function issueHandoffGrant(
  claims: IHandoffGrantClaims,
  sourcePrivateKey: CryptoKey,
): Promise<IHandoffGrant> {
  const signature = await webcrypto.subtle.sign(
    SIGN_PARAMS,
    sourcePrivateKey,
    ab(grantBytes(claims)),
  );
  return { ...claims, signature: toBase64Url(new Uint8Array(signature)) };
}

/**
 * Why a grant was refused. Closed vocabulary — a caller must not be able to soften one of these into
 * a pass, and the destination reports which one so a genuine misconfiguration is diagnosable.
 */
export type TGrantRejection =
  | 'signature-invalid'
  | 'user-mismatch'
  | 'wrong-destination'
  | 'wrong-audience'
  | 'channel-substituted'
  | 'expired'
  | 'not-yet-valid'
  | 'nonce-replayed';

export interface IHandoffAuthorization {
  readonly authorized: boolean;
  /** Deliberately NOT reusable as a same-local-environment trust: SEC-010's levels are separate. */
  readonly trust?: 'same-user-different-host';
  readonly rejection?: TGrantRejection;
}

export interface IVerifyGrantOptions {
  /** The SOURCE device's public key, taken from its user-signed certificate — never from the grant. */
  readonly sourcePublicKey: CryptoKey;
  readonly expectedUserId: string;
  /** This device. A grant addressed elsewhere is refused even if everything else checks out. */
  readonly expectedDestinationDeviceId: string;
  readonly expectedHandoffId: string;
  readonly expectedSessionId: string;
  /** The fingerprint of the channel the grant actually arrived over. */
  readonly observedChannelFingerprint: string;
  readonly now: number;
  /** Nonces already consumed on this device. A repeat is a replay. */
  readonly seenNonces?: ReadonlySet<string>;
}

/**
 * Verify a grant against THIS destination, THIS transfer, and THIS channel.
 *
 * The signature is checked first, for the same reason as in `user-identity.ts`: every later
 * comparison must be about fields the source actually signed, not about attacker-supplied values
 * that merely travelled alongside a signature.
 */
export async function verifyHandoffGrant(
  grant: IHandoffGrant,
  options: IVerifyGrantOptions,
): Promise<IHandoffAuthorization> {
  const { signature, ...claims } = grant;
  const signatureOk = await webcrypto.subtle.verify(
    SIGN_PARAMS,
    options.sourcePublicKey,
    ab(fromBase64Url(signature)),
    ab(grantBytes(claims)),
  );
  if (!signatureOk) return { authorized: false, rejection: 'signature-invalid' };

  if (claims.userId !== options.expectedUserId) {
    return { authorized: false, rejection: 'user-mismatch' };
  }
  if (claims.destinationDeviceId !== options.expectedDestinationDeviceId) {
    return { authorized: false, rejection: 'wrong-destination' };
  }
  if (
    claims.handoffId !== options.expectedHandoffId ||
    claims.sessionId !== options.expectedSessionId
  ) {
    return { authorized: false, rejection: 'wrong-audience' };
  }
  if (claims.channelFingerprint !== options.observedChannelFingerprint) {
    return { authorized: false, rejection: 'channel-substituted' };
  }
  if (options.now < claims.issuedAt) return { authorized: false, rejection: 'not-yet-valid' };
  if (options.now >= claims.expiresAt) return { authorized: false, rejection: 'expired' };
  if (options.seenNonces?.has(claims.nonce) === true) {
    return { authorized: false, rejection: 'nonce-replayed' };
  }

  return { authorized: true, trust: 'same-user-different-host' };
}
