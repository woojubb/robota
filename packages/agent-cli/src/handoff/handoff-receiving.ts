/**
 * How this side takes a session pushed to it, whichever carrier brought it: the grant is checked
 * against the sender's device certificate as this side holds it, the operator here is asked through
 * the connection's authority, and the session is kept aside, verified and saved — never started.
 */

import {
  type ConnectionAuthority,
  type IFileFrameChannel,
  type IHandoffCommitAck,
  type IHandoffComposition,
  type TCredentialResolver,
  type TRecordPersister,
} from '@robota-sdk/agent-interface-session-mobility';

import { createHandoffConsent } from './handoff-consent.js';
import { checkHandoffGrant } from './handoff-grant.js';
import { receiveHandoff, type TReceiveHandoffOutcome } from './handoff-receive.js';

import type { IDeviceCertificate } from '@robota-sdk/agent-remote-pairing';

/** What this side knows of its identity when a hand-off arrives. */
export interface IHandoffReceiverIdentity {
  readonly userId: string;
  /** The certificate of `deviceId` as this side holds it, if it holds one. */
  certificateOf(deviceId: string): IDeviceCertificate | undefined;
}

export interface IHandoffReceiving {
  /** `~/.robota` of this side's `HOME`. */
  readonly root: string;
  readonly composition: IHandoffComposition;
  /** Read when a hand-off arrives; `undefined` when this device has no identity, which refuses it. */
  readonly identity: () => IHandoffReceiverIdentity | undefined;
  readonly resolveCredential: TCredentialResolver;
  readonly persist: TRecordPersister;
  /** This machine's name, as the operator here is asked. */
  readonly deviceLabel: string;
  readonly maxBytes?: number;
  readonly now?: () => number;
}

/** One pushed hand-off, as the carrier established it. */
export interface IHandoffArrival {
  readonly channel: IFileFrameChannel;
  /** What the carrier bound the connection to, as this side sees its own end. */
  readonly carrierBinding: string;
  /** This side, as the grant must name it. */
  readonly destinationId: string;
  /** The source, as the carrier established it. */
  readonly sourceId: string;
  /** The device whose certificate must have signed the grant. */
  readonly signerDeviceId: string;
  /** Names the sender's directory for what is kept aside. */
  readonly senderDirectory: string;
  /** The connection's authority; it asks the operator here about every hand-off. */
  readonly authority: ConnectionAuthority;
}

/**
 * A receiver for hand-offs. It remembers the transfers it saved and the grants it took, so the same
 * transfer pushed again is answered, not saved twice, and a grant is never taken twice.
 */
export function createHandoffReceiver(
  receiving: IHandoffReceiving,
): (arrival: IHandoffArrival) => Promise<TReceiveHandoffOutcome> {
  const committed = new Map<string, IHandoffCommitAck>();
  const seenNonces = new Set<string>();
  const now = receiving.now ?? Date.now;
  return async (arrival) => {
    const gone = new AbortController();
    const stopWatching = arrival.channel.onClose(() => gone.abort());
    const consent = createHandoffConsent({
      authority: arrival.authority,
      deviceLabel: receiving.deviceLabel,
      signal: gone.signal,
    });
    try {
      return await receiveHandoff({
        channel: arrival.channel,
        carrierBinding: arrival.carrierBinding,
        destinationId: arrival.destinationId,
        senderId: arrival.senderDirectory,
        verifyGrant: async (grant, manifest, channelFingerprint) => {
          const identity = receiving.identity();
          const sender = identity?.certificateOf(arrival.signerDeviceId);
          if (identity === undefined || sender === undefined) {
            return {
              admitted: false,
              trust: 'unproven',
              reason: 'this device holds no certificate for the sender; run `/devices` to check',
            };
          }
          return checkHandoffGrant(grant, {
            sender,
            sourceId: arrival.sourceId,
            userId: identity.userId,
            manifest,
            destinationId: arrival.destinationId,
            channelFingerprint,
            now: now(),
            seenNonces,
          });
        },
        consent,
        composition: receiving.composition,
        root: receiving.root,
        resolveCredential: receiving.resolveCredential,
        persist: receiving.persist,
        committed,
        ...(receiving.maxBytes !== undefined ? { maxBytes: receiving.maxBytes } : {}),
        now,
      });
    } finally {
      stopWatching();
    }
  };
}
