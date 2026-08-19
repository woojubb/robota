/**
 * What a caller CONFIGURES on the WebRTC host transport.
 *
 * Separated from the transport itself because "what may be set" and "what the transport does with
 * it" are different subjects, and `webrtc-transport.ts` had reached the anti-monolith limit where
 * the rule is to split rather than extend. Types only — no behaviour moved.
 */

import type { IHostReconnectConfig } from './pairing-gate.js';
import type { ILocalPeerProof } from './local-peer-proof.js';
import type { ISignalingClient } from './signaling.js';
import type { IWeriftModule } from './werift-loader.js';
import type { IPairingResult } from '@robota-sdk/agent-remote-pairing';
import type { SessionResumeBridge } from '@robota-sdk/agent-transport-protocol';

/**
 * A single ICE (STUN/TURN) server for the HOST (werift) transport (REMOTE-010). `urls` is a SINGLE string with a
 * `turn:`/`turns:`/`stun:`/`stuns:` scheme — werift's ICE gatherer (`parseIceServers`) consumes only a single-string
 * url and silently drops array `urls`, so the host reader (`agent-cli` `parseIceServers`) must narrow to this shape
 * and reject what werift would drop (fail-closed). (The browser peer uses the native DOM `RTCIceServer`, which does
 * support array urls / `turns:` — a separate, wider validator.) Kept a plain interface (no DOM dependency here).
 */
export interface IIceServer {
  readonly urls: string;
  readonly username?: string;
  readonly credential?: string;
}

/** Construction options for {@link WebRtcTransport}. The signaling client is injected (Stage A: no settings). */
export interface IWebRtcTransportOptions {
  /** Signaling port used to exchange SDP/ICE with the remote peer by rendezvous id. */
  readonly signaling: ISignalingClient;
  /** Optional ICE servers (STUN/TURN). Omitted → host-candidate/loopback only. */
  readonly iceServers?: readonly IIceServer[];
  /**
   * REMOTE-004 defense-in-depth: when true, restrict ICE to **relay (TURN) candidates only**, so
   * host/server-reflexive candidates — and the local-interface gathering that touches the (unreachable, but
   * belt-and-braces) `ip` code path — are never used. Requires a TURN server in `iceServers`. Mapped to werift's
   * `iceTransportPolicy: 'relay'` (REMOTE-010) — werift IGNORES a top-level `forceTurn`, so it must NOT be passed.
   */
  readonly forceTurn?: boolean;
  /**
   * REMOTE-008 pairing secret. When set, the data channel is **pairing-gated**: it carries only pairing frames
   * until the directional-HMAC handshake accepts (channel-bound to the DTLS fingerprints), and only THEN is the
   * session exposed — fail closed on mismatch/timeout. When omitted (Stage-A loopback / tests), the channel is
   * exposed immediately with no pairing (unchanged behavior).
   */
  readonly secret?: string;
  /**
   * SEC-008: run with NO pairing gate. Requires `openReason`.
   *
   * Omitting `secret` used to mean this implicitly, which is how a remote peer reached the session
   * because a field was left unset. It is still a legitimate mode — loopback, tests — but it is now
   * a thing the host says rather than a thing that happens.
   */
  readonly open?: boolean;
  /** SEC-008: why running with no pairing gate is correct here. Required when `open` is true. */
  readonly openReason?: string;
  /** REMOTE-008: fired when pairing accepts + the session is exposed (host lifecycle → status 'paired'). Carries the first-pair result (E4 uses its sessionKey). */
  readonly onPaired?: (result?: IPairingResult) => void;
  /** REMOTE-008: fired when pairing rejects/times out (host lifecycle → teardown; the channel is already closed). */
  readonly onPairingFailed?: () => void;
  /** REMOTE-012 E3: host reconnect/enrollment config. When set, the gate admits first-pair (with enrollment) OR a pinned-device reconnect. */
  readonly reconnect?: IHostReconnectConfig;
  /** SEC-010 (#1810): require a guarded-rendezvous nonce before the session is exposed. Absent → unchanged. */
  readonly localPeer?: ILocalPeerProof;
  /** REMOTE-013 E4: a session-scoped resume bridge (owned by the controller across reconnects). Passed to the gate so the paired session flows through it (seq/buffer) and survives channel drops. */
  readonly resumeBridge?: SessionResumeBridge;
  /** REMOTE-013 E4: fired when a PAIRED data channel drops (so the controller can run the reconnect loop). Not fired for a pre-accept failure (that is `onPairingFailed`). */
  readonly onDropped?: () => void;
  /** Observe an outbound session-event delivery failure before the carrier drops. */
  readonly onDeliveryError?: (error: Error, event: string) => void;
  /** Test seam: inject the werift module (defaults to the real lazy loader). */
  readonly loadWerift?: () => IWeriftModule;
}
