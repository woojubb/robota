/**
 * The contract a `PairingGate` is constructed with (REMOTE-008 / -012 / -013, SEC-010, SEC-011).
 *
 * Separated from the gate itself because they are different responsibilities: this file says what a
 * caller must supply, and `pairing-gate.ts` says what the machine does with it. Keeping them
 * together made one file that had to be read in full to answer either question.
 *
 * Re-exported from `pairing-gate.ts`, so every existing import keeps working — the split is a
 * reading change, not a migration.
 */

import type {
  IPairingResult,
  startPairingHandshake,
  TPairingRole,
} from '@robota-sdk/agent-remote-pairing';
import type {
  IProtocolSession,
  SessionResumeBridge,
  createWsHandler,
} from '@robota-sdk/agent-transport-protocol';

import type { startReconnectController } from './pairing-controllers.js';

import type { IHandoffGrantProof } from './handoff-grant-gate.js';
import type { ILocalPeerProof } from './local-peer-proof.js';

/** The minimal data-channel surface the gate drives (a werift `RTCDataChannel` satisfies it). */
export interface IPairingChannel {
  send(data: string): void;
  close(): void;
}

/** E3 host reconnect/enrollment config. When present, the gate runs reactive (first-frame) mode detection. */
export interface IHostReconnectConfig {
  readonly hostIdentityId: string;
  /** base64url SPKI advertised to a device at first-pair enrollment. */
  readonly hostPublicSpki: string;
  /** The host identity private key (signs reconnect challenges). */
  readonly hostPrivateKey: CryptoKey;
  /** Resolve a pinned device public key by id (undefined → unknown/revoked → fail closed). */
  readonly resolveDevicePublicKey: (deviceId: string) => Promise<CryptoKey | undefined>;
  /** Pin a device's public key on first-pair enrollment (deviceId, base64url SPKI). */
  readonly onEnroll: (deviceId: string, deviceSpki: string) => void;
}

export interface IPairingGateOptions {
  readonly channel: IPairingChannel;
  readonly session: IProtocolSession;
  readonly secret: string;
  readonly role: TPairingRole;
  readonly localFingerprint: string;
  readonly remoteFingerprint: string;
  /** Handshake timeout (ms); fail closed on expiry. */
  readonly timeoutMs?: number;
  /** REMOTE-008: fired once admission accepts + the session is exposed. Carries the first-pair result (E4). */
  readonly onAccept?: (result?: IPairingResult) => void;
  /** REMOTE-008: fired once admission rejects/times out + the channel closes (host lifecycle → teardown). */
  readonly onReject?: () => void;
  /** REMOTE-012 E3: host reconnect/enrollment config. Absent → B4 first-pair-only behavior (unchanged). */
  readonly reconnect?: IHostReconnectConfig;
  /**
   * REMOTE-013 E4: a session-scoped {@link SessionResumeBridge}. When set, the paired session flows through the
   * bridge (seq-stamped + buffered) instead of a fresh `createWsHandler`, so the session survives a channel
   * drop and can replay on reconnect. Accept ATTACHES the channel as the bridge's sink; cleanup DETACHES it
   * (never disposes — the bridge is owned by the transport across reconnects).
   */
  readonly resumeBridge?: SessionResumeBridge;
  /**
   * Post-accept session-frame delivery failure; owning transport performs drop cleanup.
   *
   * ARCH-030: was `TServerMessage['type'] | string`, which is just `string` — a union that reads as a
   * narrowing and is not one. Stated as what it is.
   */
  readonly onDeliveryError?: (error: Error, event: string) => void;
  /** SEC-010: require a rendezvous nonce before exposing the session. Absent → unchanged behavior. */
  readonly localPeer?: ILocalPeerProof;
  /**
   * SEC-011 (issue #1865): require a verified cross-device hand-off grant before exposing the
   * session. Absent → unchanged behavior.
   *
   * Independent of `localPeer` rather than exclusive with it, and demanded AFTER it when both are
   * set. They answer different questions — the rendezvous binds the environment, the grant binds the
   * transfer — and a hand-off between two sessions on ONE machine legitimately has both. Requiring
   * both is strictly more restrictive than requiring either, which is the safe direction.
   */
  readonly handoffGrant?: IHandoffGrantProof;
  /** Injection seams (default to the real implementations). */
  readonly startHandshake?: typeof startPairingHandshake;
  readonly createHandler?: typeof createWsHandler;
}
