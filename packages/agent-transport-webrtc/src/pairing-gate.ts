/**
 * Pairing gate for the WebRTC data channel (REMOTE-008 Stage B4-2b; extended for REMOTE-012 Stage E3 TOFU
 * reconnect).
 *
 * The data channel is **phase-separated**: pre-accept it carries ONLY pairing/reconnect frames, post-accept
 * ONLY session messages. A single eager `onMessage` subscription (werift drops inbound frames received before
 * a subscription exists) feeds {@link PairingGate.onInbound}, which SWITCHES routing on accept — it never
 * defers the subscription. Until accept, the session bridge (`createWsHandler`) is not even built, so nothing
 * a peer sends can reach the live session.
 *
 * Two admission modes (E3), decided by the client's FIRST frame:
 * - **first-pair** (`pair-nonce`): the B3 directional-HMAC handshake, then — when E3 `reconnect` config is
 *   present — a mutual identity-key **enrollment** exchange (each side sends its ECDSA public key over the
 *   just-confirmed channel; the host pins the device key) before the session is exposed;
 * - **reconnect** (`rc-hello`): the mutual {@link startHostReconnect} handshake against the pinned device +
 *   host identity keys — no re-pair, exposes the session only on mutual accept.
 *
 * Fail-closed: a non-admission frame pre-accept is DROPPED; the handshake `result` is the ONLY accept signal;
 * on reject/timeout the channel is closed and no session bridge is ever created; a post-close frame is ignored.
 *
 * When no E3 `reconnect` config is supplied the gate is **exactly** the B4 first-pair-only gate (eager host
 * `pair-nonce`, no enrollment, no reconnect) — preserving existing behavior.
 */

import { createWsHandler } from '@robota-sdk/agent-transport-protocol';
import {
  deriveIdentityId,
  importPublicKey,
  startHostReconnect,
  startPairingHandshake,
  type IPairingResult,
  type TPairingFrame,
  type TPairingRole,
  type TReconnectFrame,
} from '@robota-sdk/agent-remote-pairing';

import type { IInteractiveSession } from '@robota-sdk/agent-interface-transport';

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

/** A gate-level identity-exchange frame (first-pair enrollment, post-B3-accept). */
interface IEnrollFrame {
  readonly t: 'enroll-key';
  readonly spki: string;
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
  /** REMOTE-008: fired once admission accepts + the session is exposed. Carries the first-pair result (E4). */
  readonly onAccept?: (result?: IPairingResult) => void;
  /** REMOTE-008: fired once admission rejects/times out + the channel closes (host lifecycle → teardown). */
  readonly onReject?: () => void;
  /** REMOTE-012 E3: host reconnect/enrollment config. Absent → B4 first-pair-only behavior (unchanged). */
  readonly reconnect?: IHostReconnectConfig;
  /** Injection seams (default to the real implementations). */
  readonly startHandshake?: typeof startPairingHandshake;
  readonly createHandler?: typeof createWsHandler;
}

/** True when a parsed value is a B3 pairing frame (`{ t: 'pair-nonce' | 'pair-confirm', … }`). */
function isPairingFrame(value: unknown): value is TPairingFrame {
  if (typeof value !== 'object' || value === null) return false;
  const t = (value as { t?: unknown }).t;
  return t === 'pair-nonce' || t === 'pair-confirm';
}

/** True when a parsed value is a reconnect frame the host consumes (`rc-hello` / `rc-device`). */
function isReconnectFrame(value: unknown): value is TReconnectFrame {
  if (typeof value !== 'object' || value === null) return false;
  const t = (value as { t?: unknown }).t;
  return t === 'rc-hello' || t === 'rc-device';
}

function isEnrollFrame(value: unknown): value is IEnrollFrame {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { t?: unknown }).t === 'enroll-key' &&
    typeof (value as { spki?: unknown }).spki === 'string'
  );
}

type TGateState =
  | 'awaiting-mode'
  | 'pairing'
  | 'enrolling'
  | 'reconnecting'
  | 'accepted'
  | 'closed';

export class PairingGate {
  private state: TGateState;
  /** Session message router — built ONLY on accept (nothing reaches the session before). */
  private onSessionMessage?: (data: string) => void;
  private handlerCleanup?: () => void;
  private pairingController?: ReturnType<typeof startPairingHandshake>;
  private reconnectController?: ReturnType<typeof startHostReconnect>;
  /** The first-pair result, held so it can be surfaced on accept (E4 uses its sessionKey). */
  private pendingResult?: IPairingResult;

  constructor(private readonly options: IPairingGateOptions) {
    if (options.reconnect) {
      // E3 mode: stay reactive — the client's first frame selects first-pair vs reconnect.
      this.state = 'awaiting-mode';
    } else {
      // Legacy B4 mode: eagerly start the first-pair handshake (host sends pair-nonce immediately).
      this.state = 'pairing';
      this.startFirstPair();
    }
  }

  /**
   * Route one inbound channel frame. Pre-accept: admission frames → the active controller, everything else
   * DROPPED. Post-accept: session messages → the session bridge. Post-close: ignored.
   */
  onInbound(data: string): void {
    if (this.state === 'closed') return;
    if (this.state === 'accepted') {
      this.onSessionMessage?.(data);
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return; // undecodable pre-accept frame → drop
    }

    if (this.state === 'awaiting-mode') {
      // First frame selects the mode (E3).
      if (isReconnectFrame(parsed) && parsed.t === 'rc-hello') {
        this.state = 'reconnecting';
        this.startReconnect();
        this.reconnectController?.onFrame(parsed);
      } else if (isPairingFrame(parsed) && parsed.t === 'pair-nonce') {
        this.state = 'pairing';
        this.startFirstPair();
        this.pairingController?.onFrame(parsed);
      }
      // anything else pre-mode → drop
      return;
    }

    if (this.state === 'pairing') {
      if (isPairingFrame(parsed)) this.pairingController?.onFrame(parsed);
      return;
    }

    if (this.state === 'reconnecting') {
      if (isReconnectFrame(parsed)) this.reconnectController?.onFrame(parsed);
      return;
    }

    if (this.state === 'enrolling') {
      // Awaiting the peer's identity public key to pin, then expose the session.
      if (isEnrollFrame(parsed)) this.completeEnrollment(parsed.spki);
      return;
    }
  }

  /** Tear down: cleanup the session bridge (if built) and mark closed. Idempotent. */
  cleanup(): void {
    this.state = 'closed';
    this.handlerCleanup?.();
    this.handlerCleanup = undefined;
    this.onSessionMessage = undefined;
  }

  private startFirstPair(): void {
    const start = this.options.startHandshake ?? startPairingHandshake;
    const controller = start({
      secret: this.options.secret,
      role: this.options.role,
      localFingerprint: this.options.localFingerprint,
      remoteFingerprint: this.options.remoteFingerprint,
      send: (frame) => this.safeSend(JSON.stringify(frame)),
      ...(this.options.timeoutMs !== undefined ? { timeoutMs: this.options.timeoutMs } : {}),
    });
    this.pairingController = controller;
    controller.result.then(
      (result) => this.onFirstPairAccepted(result),
      () => this.rejectAndClose(),
    );
  }

  private startReconnect(): void {
    const cfg = this.options.reconnect;
    if (!cfg) {
      this.rejectAndClose();
      return;
    }
    const controller = startHostReconnect({
      hostIdentityId: cfg.hostIdentityId,
      localFingerprint: this.options.localFingerprint,
      remoteFingerprint: this.options.remoteFingerprint,
      hostPrivateKey: cfg.hostPrivateKey,
      resolveDevicePublicKey: cfg.resolveDevicePublicKey,
      send: (frame) => this.safeSend(JSON.stringify(frame)),
      ...(this.options.timeoutMs !== undefined ? { timeoutMs: this.options.timeoutMs } : {}),
    });
    this.reconnectController = controller;
    controller.result.then(
      () => this.accept(),
      () => this.rejectAndClose(),
    );
  }

  /** B3 handshake accepted. Without E3: expose immediately. With E3: run first-pair enrollment first. */
  private onFirstPairAccepted(result: IPairingResult): void {
    if (this.state !== 'pairing') return;
    this.pendingResult = result;
    const cfg = this.options.reconnect;
    if (!cfg) {
      this.accept(result);
      return;
    }
    // E3 enrollment: advertise the host public key; the peer's `enroll-key` completes it (then expose).
    this.state = 'enrolling';
    this.safeSend(
      JSON.stringify({ t: 'enroll-key', spki: cfg.hostPublicSpki } satisfies IEnrollFrame),
    );
  }

  private completeEnrollment(deviceSpki: string): void {
    if (this.state !== 'enrolling') return;
    const cfg = this.options.reconnect;
    if (!cfg) {
      this.rejectAndClose();
      return;
    }
    void (async (): Promise<void> => {
      try {
        // Validate the SPKI parses as a public key before pinning (fail closed on garbage).
        await importPublicKey(deviceSpki);
        const deviceId = await deriveIdentityId(deviceSpki);
        if (this.state !== 'enrolling') return;
        cfg.onEnroll(deviceId, deviceSpki);
        this.accept(this.pendingResult);
      } catch {
        this.rejectAndClose();
      }
    })();
  }

  private accept(result?: IPairingResult): void {
    if (this.state === 'closed' || this.state === 'accepted') return;
    const create = this.options.createHandler ?? createWsHandler;
    const { onMessage, cleanup } = create({
      session: this.options.session,
      send: (serverMessage) => this.safeSend(JSON.stringify(serverMessage)),
    });
    this.onSessionMessage = onMessage;
    this.handlerCleanup = cleanup;
    this.state = 'accepted';
    this.options.onAccept?.(result);
  }

  private rejectAndClose(): void {
    if (this.state === 'closed') return;
    this.state = 'closed';
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
