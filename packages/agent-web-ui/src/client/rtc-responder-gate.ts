/**
 * Responder-side pairing gate for the browser remote client (REMOTE-009 Stage D) — the client dual of the
 * host `PairingGate`. The browser is the WebRTC ANSWERER ≡ pairing RESPONDER. It phase-separates the data
 * channel: pre-accept it carries ONLY pairing frames (routed to `startPairingHandshake({role:'responder'})`;
 * any non-pairing frame is DROPPED), and only after the handshake accepts does it deliver `TServerMessage`s to
 * the UI and allow `send(TClientMessage)`. Fail-closed: on reject/timeout it closes the channel and delivers
 * nothing.
 *
 * Kept standalone (not inlined in `createRtcSessionClient`) so the routing/fail-closed logic is unit-testable
 * with a stub channel + real `agent-remote-pairing`, exactly like the host `PairingGate`. The Node responder in
 * `agent-transport-webrtc/src/__tests__/pairing-e2e.test.ts` is the algorithm oracle.
 */

import { startPairingHandshake, type TPairingFrame } from '@robota-sdk/agent-remote-pairing';

import type { TServerMessage, TClientMessage } from '@robota-sdk/agent-transport-protocol';

/** The minimal data-channel surface the gate drives (a native `RTCDataChannel` satisfies it). */
export interface IResponderChannel {
  send(data: string): void;
  close(): void;
}

export interface IResponderGateOptions {
  readonly channel: IResponderChannel;
  readonly secret: string;
  readonly localFingerprint: string;
  readonly remoteFingerprint: string;
  readonly timeoutMs?: number;
  /** Deliver a session server message to the UI (only ever called post-accept). */
  readonly onMessage: (msg: TServerMessage) => void;
  /** Pairing accepted — the session is now co-driveable. */
  readonly onAccept?: () => void;
  /** Pairing rejected/timed out — the channel is closed, nothing exposed. */
  readonly onReject?: () => void;
  /** Injection seam (defaults to the real handshake) — for tests. */
  readonly startHandshake?: typeof startPairingHandshake;
}

function isPairingFrame(value: unknown): value is TPairingFrame {
  if (typeof value !== 'object' || value === null) return false;
  const t = (value as { t?: unknown }).t;
  return t === 'pair-nonce' || t === 'pair-confirm';
}

type TGateState = 'pairing' | 'accepted' | 'closed';

export class ResponderGate {
  private state: TGateState = 'pairing';
  private readonly controller: ReturnType<typeof startPairingHandshake>;

  constructor(private readonly options: IResponderGateOptions) {
    const start = options.startHandshake ?? startPairingHandshake;
    this.controller = start({
      secret: options.secret,
      role: 'responder',
      localFingerprint: options.localFingerprint,
      remoteFingerprint: options.remoteFingerprint,
      send: (frame) => this.safeSend(JSON.stringify(frame)),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    });
    this.controller.result.then(
      () => this.accept(),
      () => this.rejectAndClose(),
    );
  }

  /** Route one inbound channel frame (pre-accept: pairing → handshake, else drop; post-accept: session). */
  onInbound(data: string): void {
    if (this.state === 'closed') return;
    if (this.state === 'accepted') {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        return;
      }
      this.options.onMessage(parsed as TServerMessage);
      return;
    }
    // pairing phase — only pairing frames pass; anything else is dropped (fail-closed).
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    if (isPairingFrame(parsed)) this.controller.onFrame(parsed);
  }

  /** Send a client message to the host — only after pairing accepts (no-op before/after). */
  send(msg: TClientMessage): void {
    if (this.state !== 'accepted') return;
    this.safeSend(JSON.stringify(msg));
  }

  /** Tear down: mark closed and close the channel. Idempotent. */
  close(): void {
    if (this.state === 'closed') return;
    this.state = 'closed';
    this.safeClose();
  }

  private accept(): void {
    if (this.state !== 'pairing') return;
    this.state = 'accepted';
    this.options.onAccept?.();
  }

  private rejectAndClose(): void {
    if (this.state === 'closed') return;
    this.state = 'closed';
    this.safeClose();
    this.options.onReject?.();
  }

  private safeSend(data: string): void {
    try {
      this.options.channel.send(data);
    } catch {
      // channel closing/closed
    }
  }

  private safeClose(): void {
    try {
      this.options.channel.close();
    } catch {
      // already closed
    }
  }
}
