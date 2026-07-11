/**
 * Pairing gate for the WebRTC data channel (REMOTE-008 Stage B4-2b, Step 1 — the SECURITY milestone).
 *
 * The data channel is **phase-separated**: pre-accept it carries ONLY pairing frames, post-accept ONLY
 * session messages. A single eager `onMessage` subscription (werift drops inbound frames received before a
 * subscription exists) feeds {@link PairingGate.onInbound}, which SWITCHES routing on accept — it never
 * defers the subscription. Until the pairing handshake accepts, the session bridge (`createWsHandler`) is
 * not even built, so nothing a peer sends can reach the live session.
 *
 * Fail-closed invariants:
 * - a NON-pairing frame arriving pre-accept is DROPPED (never parsed as a session message);
 * - the handshake's `result` promise is the ONLY accept signal — on reject/timeout the channel is closed and
 *   no session bridge is ever created;
 * - a frame arriving after close is ignored.
 *
 * Channel binding (REMOTE-005): the gate is constructed with the local + remote DTLS fingerprints (from the
 * offer/answer SDP); werift independently verifies the advertised remote fingerprint against the negotiated
 * cert, so an honest peer and a relay observe different sorted-fingerprint pairs and the directional-HMAC
 * confirmation fails closed on a MITM relay.
 *
 * Kept as a standalone unit (not inlined in the transport) so the routing/fail-closed logic is unit-testable
 * with a stub channel + injected handshake, without a real peer connection.
 */

import { createWsHandler } from '@robota-sdk/agent-transport-protocol';
import {
  startPairingHandshake,
  type TPairingFrame,
  type TPairingRole,
} from '@robota-sdk/agent-remote-pairing';

import type { IInteractiveSession } from '@robota-sdk/agent-interface-transport';

/** The minimal data-channel surface the gate drives (a werift `RTCDataChannel` satisfies it). */
export interface IPairingChannel {
  send(data: string): void;
  close(): void;
}

export interface IPairingGateOptions {
  readonly channel: IPairingChannel;
  readonly session: IInteractiveSession;
  readonly secret: string;
  readonly role: TPairingRole;
  readonly localFingerprint: string;
  readonly remoteFingerprint: string;
  /** Handshake timeout (ms); fail closed on expiry. */
  readonly timeoutMs?: number;
  /** REMOTE-008: fired once the handshake accepts + the session is exposed (host lifecycle → status 'paired'). */
  readonly onAccept?: () => void;
  /** REMOTE-008: fired once the handshake rejects/times out + the channel closes (host lifecycle → teardown). */
  readonly onReject?: () => void;
  /** Injection seams (default to the real implementations). */
  readonly startHandshake?: typeof startPairingHandshake;
  readonly createHandler?: typeof createWsHandler;
}

/** True when a parsed value is a pairing frame (`{ t: 'pair-nonce' | 'pair-confirm', … }`). */
function isPairingFrame(value: unknown): value is TPairingFrame {
  if (typeof value !== 'object' || value === null) return false;
  const t = (value as { t?: unknown }).t;
  return t === 'pair-nonce' || t === 'pair-confirm';
}

type TGateState = 'pairing' | 'accepted' | 'closed';

export class PairingGate {
  private state: TGateState = 'pairing';
  /** Session message router — built ONLY on accept (nothing reaches the session before). */
  private onSessionMessage?: (data: string) => void;
  private handlerCleanup?: () => void;

  constructor(private readonly options: IPairingGateOptions) {
    const start = options.startHandshake ?? startPairingHandshake;
    const controller = start({
      secret: options.secret,
      role: options.role,
      localFingerprint: options.localFingerprint,
      remoteFingerprint: options.remoteFingerprint,
      // Serialize each handshake frame over the same channel the session will later use.
      send: (frame) => this.safeSend(JSON.stringify(frame)),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    });
    this.pairingController = controller;
    controller.result.then(
      () => this.accept(),
      () => this.rejectAndClose(),
    );
  }

  private readonly pairingController: ReturnType<typeof startPairingHandshake>;

  /**
   * Route one inbound channel frame. Pre-accept: pairing frames → the handshake, everything else DROPPED.
   * Post-accept: session messages → the session bridge. Post-close: ignored.
   */
  onInbound(data: string): void {
    if (this.state === 'closed') return;
    if (this.state === 'accepted') {
      this.onSessionMessage?.(data);
      return;
    }
    // state === 'pairing' — only pairing frames are allowed through; anything else is dropped (fail-closed).
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return; // undecodable pre-accept frame → drop
    }
    if (isPairingFrame(parsed)) this.pairingController.onFrame(parsed);
    // A well-formed but non-pairing frame pre-accept is a protocol violation → drop, never expose the session.
  }

  /** Tear down: cleanup the session bridge (if built) and mark closed. Idempotent. */
  cleanup(): void {
    this.state = 'closed';
    this.handlerCleanup?.();
    this.handlerCleanup = undefined;
    this.onSessionMessage = undefined;
  }

  private accept(): void {
    if (this.state !== 'pairing') return; // closed/settled in the meantime
    const create = this.options.createHandler ?? createWsHandler;
    const { onMessage, cleanup } = create({
      session: this.options.session,
      send: (serverMessage) => this.safeSend(JSON.stringify(serverMessage)),
    });
    this.onSessionMessage = onMessage;
    this.handlerCleanup = cleanup;
    this.state = 'accepted';
    this.options.onAccept?.();
  }

  private rejectAndClose(): void {
    if (this.state === 'closed') return;
    this.state = 'closed';
    // The handshake rejected (mismatch/timeout) — expose nothing and drop the channel.
    try {
      this.options.channel.close();
    } catch {
      // already closing/closed
    }
    this.options.onReject?.();
  }

  private safeSend(data: string): void {
    try {
      this.options.channel.send(data);
    } catch {
      // Channel is closing/closed — the peer is gone; the frame cannot be delivered (matches WS semantics).
    }
  }
}
