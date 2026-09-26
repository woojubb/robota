/**
 * The grant a hand-off is authorized by, as this product mints and checks it.
 *
 * The source signs one grant per transfer with its device key: the user, the two ends, the transfer,
 * the session, a nonce, and the channel. The receiver checks it against the device certificate it
 * already holds for the sender — never a key the grant brings — and against what it observes itself.
 *
 * The channel is named by the receiver: it sends a fresh value on the channel before the offer, and
 * the grant must name that value together with what the carrier already bound the connection to (the
 * DTLS fingerprint the receiver presented, between devices; the receiving session, on one host). A
 * grant lifted from one channel therefore names a value no other channel was given.
 */

import { randomBytes } from 'node:crypto';

import {
  IDENTITY_CLOCK_SKEW_MS,
  issueHandoffGrant,
  verifyHandoffGrant,
  type IDeviceCertificate,
  type IHandoffGrant,
} from '@robota-sdk/agent-remote-pairing';

import { importPublicKey } from '../devices/identity-keys.js';

import type {
  IHandoffManifest,
  IPeerAdmission,
} from '@robota-sdk/agent-interface-session-mobility';

/** How long a grant is good for once minted; it is presented at once, before anyone is asked. */
const GRANT_VALIDITY_MS = 60_000;
const PURPOSE = 'robota/handoff-channel/v1';

/** A fresh value for one channel. */
export function newChannelNonce(): string {
  return randomBytes(32).toString('base64url');
}

/** The channel a grant is bound to: what the carrier bound, and the receiver's value for this channel. */
export function handoffChannelFingerprint(carrierBinding: string, nonce: string): string {
  return JSON.stringify([PURPOSE, carrierBinding, nonce]);
}

/** Between devices: the DTLS fingerprint the receiving side presented on this connection. */
export function dtlsCarrierBinding(receiverFingerprint: string): string {
  return `dtls:${receiverFingerprint}`;
}

/** On one host: the receiving session, whose socket only this user can reach. */
export function localCarrierBinding(receiverSessionId: string): string {
  return `local:${receiverSessionId}`;
}

/** What the source signs with. */
export interface IHandoffSigner {
  readonly userId: string;
  readonly signPrivateKey: CryptoKey;
}

/** Mint the grant for exactly this manifest over exactly this channel. */
export function mintHandoffGrant(
  signer: IHandoffSigner,
  manifest: IHandoffManifest,
  channelFingerprint: string,
  now: number,
): Promise<IHandoffGrant> {
  return issueHandoffGrant(
    {
      userId: signer.userId,
      sourceDeviceId: manifest.sourceDeviceId,
      destinationDeviceId: manifest.destinationDeviceId,
      handoffId: manifest.handoffId,
      sessionId: manifest.sessionId,
      nonce: randomBytes(16).toString('base64url'),
      channelFingerprint,
      // Two machines' clocks disagree; the window is kept short and allows for that.
      issuedAt: now - IDENTITY_CLOCK_SKEW_MS,
      expiresAt: now + IDENTITY_CLOCK_SKEW_MS + GRANT_VALIDITY_MS,
    },
    signer.signPrivateKey,
  );
}

const GRANT_STRINGS = [
  'userId',
  'sourceDeviceId',
  'destinationDeviceId',
  'handoffId',
  'sessionId',
  'nonce',
  'channelFingerprint',
  'signature',
] as const;

function decodeGrant(value: unknown): IHandoffGrant | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const grant = value as Record<string, unknown>;
  for (const key of GRANT_STRINGS) {
    const field = grant[key];
    if (typeof field !== 'string' || field.length === 0 || field.length > 4096) return undefined;
  }
  if (typeof grant['issuedAt'] !== 'number' || typeof grant['expiresAt'] !== 'number') {
    return undefined;
  }
  return grant as unknown as IHandoffGrant;
}

export interface IHandoffGrantCheck {
  /** The sender's device certificate, as this side holds it. */
  readonly sender: IDeviceCertificate;
  /** The source as the carrier established it; the manifest and the grant must both name it. */
  readonly sourceId: string;
  /** This side's user. */
  readonly userId: string;
  readonly manifest: IHandoffManifest;
  /** This side, as the grant must name it. */
  readonly destinationId: string;
  readonly channelFingerprint: string;
  readonly now: number;
  /** Grant nonces this receiver has taken; a repeat is a replay. Added to on success. */
  readonly seenNonces: Set<string>;
}

/**
 * Check a presented grant for the channel gate. The key is the sender's certificate's; the transfer,
 * the ends and the channel are the ones this side observes.
 */
export async function checkHandoffGrant(
  presented: unknown,
  check: IHandoffGrantCheck,
): Promise<IPeerAdmission> {
  const grant = decodeGrant(presented);
  if (grant === undefined) {
    return { admitted: false, trust: 'unproven', reason: 'the grant is malformed' };
  }
  if (
    check.manifest.sourceDeviceId !== check.sourceId ||
    grant.sourceDeviceId !== check.manifest.sourceDeviceId
  ) {
    return { admitted: false, trust: 'unproven', reason: 'the grant names another source' };
  }
  const verdict = await verifyHandoffGrant(grant, {
    sourcePublicKey: await importPublicKey('ES256', check.sender.signKey),
    expectedUserId: check.userId,
    expectedDestinationDeviceId: check.destinationId,
    expectedHandoffId: check.manifest.handoffId,
    expectedSessionId: check.manifest.sessionId,
    observedChannelFingerprint: check.channelFingerprint,
    now: check.now,
    seenNonces: check.seenNonces,
  });
  if (!verdict.authorized) {
    return {
      admitted: false,
      trust: 'unproven',
      reason: `the grant was refused: ${verdict.rejection ?? 'unknown'}`,
    };
  }
  check.seenNonces.add(grant.nonce);
  return {
    admitted: true,
    trust: verdict.trust ?? 'same-user-different-host',
    origin: { sessionId: check.manifest.sourceDeviceId },
  };
}
