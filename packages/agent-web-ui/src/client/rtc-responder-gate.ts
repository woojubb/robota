/**
 * Responder-side pairing gate for the browser remote client (REMOTE-009 Stage D; extended for REMOTE-012
 * Stage E3 TOFU reconnect) — the client dual of the host `PairingGate`. The browser is the WebRTC ANSWERER ≡
 * pairing RESPONDER. It phase-separates the data channel: pre-accept it carries ONLY pairing/reconnect frames
 * (non-admission frames are DROPPED); only after accept does it deliver `TServerMessage`s to the UI and allow
 * `send(TClientMessage)`. Fail-closed: on reject/timeout it closes the channel and delivers nothing.
 *
 * Two admission modes (E3), decided by whether a credential exists for this host:
 * - **first-pair** (default): the B3 handshake, then — when `deviceIdentity` is present — an identity-key
 *   **enrollment** exchange (pin the host's advertised key; send the device's public key) before the session
 *   is exposed;
 * - **reconnect** (`deviceIdentity.reconnect` present): the client initiates {@link startDeviceReconnect},
 *   verifies the host against the pinned host key (rogue-host → fail closed), and only then exposes the session.
 *
 * Without `deviceIdentity` the gate is exactly the REMOTE-009 first-pair-only gate.
 */

import {
  importPublicKey,
  startDeviceReconnect,
  startPairingHandshake,
  type IPairingResult,
  type TPairingFrame,
  type TReconnectFrame,
} from '@robota-sdk/agent-remote-pairing';

import type { TServerMessage, TClientMessage } from '@robota-sdk/agent-transport-protocol';

/** The minimal data-channel surface the gate drives (a native `RTCDataChannel` satisfies it). */
export interface IResponderChannel {
  send(data: string): void;
  close(): void;
}

/** E3 device identity config. When present, first-pair enrolls; when `reconnect` is set, the client reconnects. */
export interface IDeviceIdentityConfig {
  readonly deviceKeyPair: CryptoKeyPair;
  /** `SHA-256(device SPKI)` — sent in the clear on reconnect / used to enroll. */
  readonly deviceId: string;
  /** base64url device public SPKI — advertised to the host at first-pair enrollment. */
  readonly devicePublicSpki: string;
  /** First-pair: pin the host's advertised public key + the pairing `sessionKey` (persist the credential + E4 reconnect seed). */
  readonly onEnrollHost: (hostPublicSpki: string, sessionKey?: string) => void;
  /** Reconnect (client-initiated) config — present only when a credential for this host already exists. */
  readonly reconnect?: {
    readonly hostIdentityId: string;
    readonly pinnedHostPublicKey: CryptoKey;
  };
}

export interface IResponderGateOptions {
  readonly channel: IResponderChannel;
  readonly secret: string;
  readonly localFingerprint: string;
  readonly remoteFingerprint: string;
  readonly timeoutMs?: number;
  /** Deliver a session server message to the UI (only ever called post-accept). */
  readonly onMessage: (msg: TServerMessage) => void;
  /** Pairing/reconnect accepted — the session is now co-driveable. */
  readonly onAccept?: () => void;
  /** Pairing/reconnect rejected/timed out — the channel is closed, nothing exposed. */
  readonly onReject?: () => void;
  /** REMOTE-012 E3: device identity config. Absent → REMOTE-009 first-pair-only behavior (unchanged). */
  readonly deviceIdentity?: IDeviceIdentityConfig;
  /** Injection seams (default to the real handshakes) — for tests. */
  readonly startHandshake?: typeof startPairingHandshake;
  readonly startReconnect?: typeof startDeviceReconnect;
}

function isPairingFrame(value: unknown): value is TPairingFrame {
  if (typeof value !== 'object' || value === null) return false;
  const t = (value as { t?: unknown }).t;
  return t === 'pair-nonce' || t === 'pair-confirm';
}

function isReconnectFrame(value: unknown): value is TReconnectFrame {
  if (typeof value !== 'object' || value === null) return false;
  return (value as { t?: unknown }).t === 'rc-host';
}

function isEnrollFrame(value: unknown): value is { t: 'enroll-key'; spki: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { t?: unknown }).t === 'enroll-key' &&
    typeof (value as { spki?: unknown }).spki === 'string'
  );
}

type TGateState = 'pairing' | 'enrolling' | 'reconnecting' | 'accepted' | 'closed';

export class ResponderGate {
  private state: TGateState = 'pairing';
  private pairingController?: ReturnType<typeof startPairingHandshake>;
  private reconnectController?: ReturnType<typeof startDeviceReconnect>;
  /** REMOTE-013 E4: the first-pair result, held so its `sessionKey` seeds the reconnect credential on enroll. */
  private pendingResult?: IPairingResult;

  constructor(private readonly options: IResponderGateOptions) {
    if (options.deviceIdentity?.reconnect) {
      this.state = 'reconnecting';
      this.startReconnect(options.deviceIdentity, options.deviceIdentity.reconnect);
    } else {
      this.startFirstPair();
    }
  }

  /** Route one inbound channel frame. Pre-accept: admission frames → controller; else drop. Post-accept: session. */
  onInbound(data: string): void {
    if (this.state === 'closed') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    if (this.state === 'accepted') {
      this.options.onMessage(parsed as TServerMessage);
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
      if (isEnrollFrame(parsed)) this.completeEnrollment(parsed.spki);
      return;
    }
  }

  /** Send a client message to the host — only after accept (no-op before/after). */
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

  private startFirstPair(): void {
    const start = this.options.startHandshake ?? startPairingHandshake;
    this.state = 'pairing';
    this.pairingController = start({
      secret: this.options.secret,
      role: 'responder',
      localFingerprint: this.options.localFingerprint,
      remoteFingerprint: this.options.remoteFingerprint,
      send: (frame) => this.safeSend(JSON.stringify(frame)),
      ...(this.options.timeoutMs !== undefined ? { timeoutMs: this.options.timeoutMs } : {}),
    });
    this.pairingController.result.then(
      (result) => this.onFirstPairAccepted(result),
      () => this.rejectAndClose(),
    );
  }

  private startReconnect(
    identity: IDeviceIdentityConfig,
    pinned: NonNullable<IDeviceIdentityConfig['reconnect']>,
  ): void {
    const start = this.options.startReconnect ?? startDeviceReconnect;
    this.reconnectController = start({
      deviceId: identity.deviceId,
      hostIdentityId: pinned.hostIdentityId,
      localFingerprint: this.options.localFingerprint,
      remoteFingerprint: this.options.remoteFingerprint,
      devicePrivateKey: identity.deviceKeyPair.privateKey,
      pinnedHostPublicKey: pinned.pinnedHostPublicKey,
      send: (frame) => this.safeSend(JSON.stringify(frame)),
      ...(this.options.timeoutMs !== undefined ? { timeoutMs: this.options.timeoutMs } : {}),
    });
    this.reconnectController.result.then(
      () => this.accept(),
      () => this.rejectAndClose(),
    );
  }

  /** B3 handshake accepted. Without E3: expose. With E3: wait for the host's enroll-key, pin it, reply, expose. */
  private onFirstPairAccepted(result: IPairingResult): void {
    if (this.state !== 'pairing') return;
    this.pendingResult = result; // its sessionKey seeds the E4 reconnect credential
    if (!this.options.deviceIdentity) {
      this.accept();
      return;
    }
    this.state = 'enrolling';
    // The host advertises its identity key first (host sends enroll-key on its accept); we reply after pinning.
  }

  private completeEnrollment(hostSpki: string): void {
    if (this.state !== 'enrolling') return;
    const identity = this.options.deviceIdentity;
    if (!identity) {
      this.rejectAndClose();
      return;
    }
    void (async (): Promise<void> => {
      try {
        // Validate the host SPKI parses as a public key before pinning (fail closed on garbage).
        await importPublicKey(hostSpki);
        if (this.state !== 'enrolling') return;
        identity.onEnrollHost(hostSpki, this.pendingResult?.sessionKey);
        this.safeSend(JSON.stringify({ t: 'enroll-key', spki: identity.devicePublicSpki }));
        this.accept();
      } catch {
        this.rejectAndClose();
      }
    })();
  }

  private accept(): void {
    if (this.state === 'closed' || this.state === 'accepted') return;
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
