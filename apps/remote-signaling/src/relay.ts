/**
 * Content-blind signaling relay (REMOTE-002 Stage A, Step 3).
 *
 * Two NAT'd WebRTC peers exchange SDP offers/answers + ICE candidates through this relay to establish a direct
 * P2P `RTCDataChannel`. The relay is a **dumb rendezvous**: it pairs at most two peers by an opaque rendezvous
 * id and forwards **only** `offer`/`answer`/`ice` frames verbatim between them. It NEVER inspects the `data`
 * payload, NEVER forwards a non-signaling frame, and holds **no session state** — only transient per-rendezvous
 * membership that is dropped when a peer disconnects. Auth/trust is deliberately absent in Stage A (added in
 * Stage B); this module carries a rate-limit seam (`onJoinAttempt`) that is a no-op until then.
 *
 * The relay logic is intentionally decoupled from `ws` (via {@link ISignalingPeer}) so it is unit-testable with
 * in-memory fake peers — no server, no network (TC-04).
 */

/** The kinds of signaling frame the relay will forward. Anything else is rejected, never relayed. */
export type TSignalKind = 'offer' | 'answer' | 'ice';

const SIGNAL_KINDS: ReadonlySet<string> = new Set<TSignalKind>(['offer', 'answer', 'ice']);

/** At most two peers may share a rendezvous (the host and one remote). */
export const MAX_PEERS_PER_RENDEZVOUS = 2;

/** A connected peer, abstracted over the concrete transport (a `ws` socket in production, a fake in tests). */
export interface ISignalingPeer {
  /** Stable per-connection id (relay-assigned). */
  readonly id: string;
  /** Deliver a raw JSON frame to this peer. */
  send(raw: string): void;
  /** Force-close this peer's connection. */
  close(): void;
}

/** Inbound control/signal frames the relay accepts. `join` establishes the rendezvous; `signal` is relayed. */
export type TInboundFrame =
  | { readonly type: 'join'; readonly rendezvous: string }
  | { readonly type: 'signal'; readonly kind: TSignalKind; readonly data: unknown };

/** Optional hooks. `onJoinAttempt` is the Stage-B rate-limit/auth seam — return false to reject a join. */
export interface ISignalingRelayHooks {
  onJoinAttempt?(rendezvous: string, peerId: string): boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Routes signaling frames between the (≤2) peers sharing a rendezvous id. Pure in-memory; no persistence.
 */
export class SignalingRelay {
  private readonly rooms = new Map<string, Set<ISignalingPeer>>();
  private readonly peerRendezvous = new Map<string, string>();

  public constructor(private readonly hooks: ISignalingRelayHooks = {}) {}

  /** Handle one raw inbound frame from `peer`. Only `signal` frames are ever forwarded, and only to the peer's counterpart. */
  public handleFrame(peer: ISignalingPeer, raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.reject(peer, 'invalid-json');
      return;
    }
    if (!isRecord(parsed) || typeof parsed.type !== 'string') {
      this.reject(peer, 'malformed-frame');
      return;
    }

    if (parsed.type === 'join' && typeof parsed.rendezvous === 'string') {
      this.join(peer, parsed.rendezvous);
      return;
    }
    if (
      parsed.type === 'signal' &&
      typeof parsed.kind === 'string' &&
      SIGNAL_KINDS.has(parsed.kind)
    ) {
      this.relay(peer, parsed.kind as TSignalKind, parsed.data);
      return;
    }
    // Any other frame — including a `signal` with an unknown kind or a payload masquerading as session
    // content — is rejected and NEVER forwarded to the counterpart.
    this.reject(peer, 'unsupported-frame');
  }

  private join(peer: ISignalingPeer, rendezvous: string): void {
    if (rendezvous.length === 0) {
      this.reject(peer, 'empty-rendezvous');
      return;
    }
    if (this.hooks.onJoinAttempt && !this.hooks.onJoinAttempt(rendezvous, peer.id)) {
      this.reject(peer, 'join-rejected');
      return;
    }
    let room = this.rooms.get(rendezvous);
    if (!room) {
      room = new Set<ISignalingPeer>();
      this.rooms.set(rendezvous, room);
    }
    if (!room.has(peer) && room.size >= MAX_PEERS_PER_RENDEZVOUS) {
      this.reject(peer, 'rendezvous-full');
      return;
    }
    // Re-joining moves the peer; drop it from any prior rendezvous first (no cross-room leakage).
    const prior = this.peerRendezvous.get(peer.id);
    if (prior && prior !== rendezvous) this.leaveRoom(peer, prior);
    room.add(peer);
    this.peerRendezvous.set(peer.id, rendezvous);
    peer.send(JSON.stringify({ type: 'joined', rendezvous }));
  }

  private relay(peer: ISignalingPeer, kind: TSignalKind, data: unknown): void {
    const rendezvous = this.peerRendezvous.get(peer.id);
    if (!rendezvous) {
      this.reject(peer, 'not-joined');
      return;
    }
    const room = this.rooms.get(rendezvous);
    if (!room) return;
    // Forward the opaque signal verbatim to the counterpart(s) only — never echo back to the sender.
    const frame = JSON.stringify({ type: 'signal', kind, data });
    for (const other of room) {
      if (other !== peer) other.send(frame);
    }
  }

  private reject(peer: ISignalingPeer, reason: string): void {
    peer.send(JSON.stringify({ type: 'error', reason }));
  }

  /** Drop a peer from its rendezvous (on disconnect). Empty rooms are deleted — no lingering session state. */
  public remove(peer: ISignalingPeer): void {
    const rendezvous = this.peerRendezvous.get(peer.id);
    if (rendezvous) this.leaveRoom(peer, rendezvous);
    this.peerRendezvous.delete(peer.id);
  }

  private leaveRoom(peer: ISignalingPeer, rendezvous: string): void {
    const room = this.rooms.get(rendezvous);
    if (!room) return;
    room.delete(peer);
    if (room.size === 0) this.rooms.delete(rendezvous);
  }

  /** Diagnostics only: current rendezvous count (holds no session content). */
  public get rendezvousCount(): number {
    return this.rooms.size;
  }
}
