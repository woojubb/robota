import {
  deriveReconnectRendezvous,
  deriveReconnectSeed,
  generatePairingSecret,
  importPublicKey,
  toPairingUrl,
} from '@robota-sdk/agent-remote-pairing';
import { WsSignalingClient } from '@robota-sdk/agent-transport-webrtc';

import { defaultCreateResumeBridge, defaultCreateTransport } from './default-transport-factory.js';
import type { TUsageReporters } from './default-transport-factory.js';
import type { IProtocolSession, SessionResumeBridge } from '@robota-sdk/agent-transport';

import { hasTurnServer } from './ice-config.js';

import type { IHostIdentity } from './host-identity.js';
import type { ITrustedDeviceRecord, ITrustedDeviceStore } from './trusted-device-store.js';
import type { IPairingResult } from '@robota-sdk/agent-remote-pairing';
import type {
  IHostReconnectConfig,
  IIceServer,
  ISignalingClient,
} from '@robota-sdk/agent-transport-webrtc';
import { ConnectionAuthority } from '@robota-sdk/agent-interface-session-mobility';

import type { TRemoteControlStatus } from '@robota-sdk/agent-framework';
import type { IOperatorApprover } from '@robota-sdk/agent-interface-session-mobility';
import type { IConnectionApproval } from '@robota-sdk/agent-transport-webrtc';
import type { IConfigurableTransport } from '@robota-sdk/agent-interface-transport';
import type { ICliRuntimeContext } from '../product/runtime-context.js';
import type { IIdentityContext } from '@robota-sdk/agent-remote-pairing';

export type TRemoteControlPeer = IConfigurableTransport<IProtocolSession>;

/** Host-owned registry effects; reconnect candidates never enter the registry. */
export interface IRemoteControlTransportHost {
  registerInitial(peer: TRemoteControlPeer, session: IProtocolSession): void;
  promoteWinner(peer: TRemoteControlPeer, session: IProtocolSession): void;
}

/** Composition-root controller for pairing-gated `/remote-control` lifecycle and reconnect state. */

export interface IRemoteControlControllerDeps {
  readonly productRuntime: ICliRuntimeContext;
  /** The two registry effects remote control needs from its host. */
  host: IRemoteControlTransportHost;
  /** Signaling relay URL (`transports.webrtc.options.relayUrl`), or undefined when unconfigured. */
  readRelayUrl: () => string | undefined;
  /** Client base URL for the pairing link (`transports.webrtc.options.clientUrl`); unset ⇒ enable fails closed (REMOTE-009 D5). */
  readClientUrl: () => string | undefined;
  /** REMOTE-010: validated user-supplied ICE (STUN/TURN) servers (`transports.webrtc.options.iceServers`), or
   *  undefined when absent. THROWS on a malformed config (fail-closed) — surfaced as an enable error. */
  readIceServers?: () => readonly IIceServer[] | undefined;
  /** REMOTE-010: `transports.webrtc.options.forceTurn` — restrict ICE to relay candidates (requires a TURN server). */
  readForceTurn?: () => boolean;
  /** The live protocol session to expose on pairing accept, or undefined before one is ready. */
  getSession: () => IProtocolSession | undefined;
  /** Render a scannable QR for the given text (async). */
  renderQr: (text: string) => Promise<string>;
  /** Surface an async failure (e.g. a `start()` failure because the WebRTC implementation is unavailable) to the operator. */
  reportError?: (message: string) => void;
  /** REMOTE-012 E3: the host trusted-device store (device public keys). Absent → first-pair only, no TOFU reconnect. */
  trustedDeviceStore?: ITrustedDeviceStore;
  /** REMOTE-012 E3: load-or-create the host identity keypair (async). Absent → first-pair only, no TOFU reconnect. */
  loadHostIdentity?: () => Promise<IHostIdentity>;
  /** Where the host identity key is kept, for `/remote-control status`; `undefined` until first chosen. */
  describeKeyStorage?: () => string | undefined;
  /**
   * The operator who allows each connection to drive this session. Absent → every connection is
   * refused: a paired device drives only with the operator's yes, never by default.
   */
  operatorApprover?: IOperatorApprover;
  /** Construction seams (default to the real implementations; overridden in unit tests). */
  createSignaling?: (url: string, rendezvous: string) => ISignalingClient;
  /** Test seam for the asynchronous reconnect-room derivation. */
  deriveReconnectRendezvous?: (seed: string, counter: number) => Promise<string>;
  createTransport?: (
    cryptoContext: IIdentityContext,
    signaling: ISignalingClient,
    secret: string,
    hooks: {
      onPaired: (result?: IPairingResult) => void;
      onPairingFailed: () => void;
      onDropped?: () => void;
      connectionApproval: IConnectionApproval;
    },
    ice: { iceServers?: readonly IIceServer[]; forceTurn?: boolean },
    reconnect?: IHostReconnectConfig,
    resumeBridge?: SessionResumeBridge,
    localPeer?: import('@robota-sdk/agent-transport-webrtc').ILocalPeerProof,
    usageReporters?: TUsageReporters,
  ) => TRemoteControlPeer;
  /** REMOTE-013 E4: build the session-scoped resume bridge (default: real `SessionResumeBridge`). */
  createResumeBridge?: (session: IProtocolSession) => SessionResumeBridge;
  /** Host-owned usage reporters shared by every admitted transport surface. */
  usageReporters?: TUsageReporters;
  /** REMOTE-013 E4: relay URL for reconnect signaling (defaults to `readRelayUrl`). */
  now?: () => number;
  /** REMOTE-013 E4: schedule a deferred callback (default `setTimeout`); tests inject a controllable fake. */
  schedule?: (callback: () => void, delayMs: number) => () => void;
}

/**
 * REMOTE-013 E4 host reconnect-window ceiling. Kept UNDER the relay's half-open TTL (60s,
 * `DEFAULT_RENDEZVOUS_TTL_MS`) so the host's lone presence at a reconnect room is not evicted mid-window; a
 * returning device must reconnect within this window or the session is freed (the operator re-pairs via QR).
 */
const RECONNECT_WINDOW_MS = 50_000;
const ACTIVATION_CANCELLED = 'Remote control activation was cancelled.';

export class RemoteControlController {
  private status: TRemoteControlStatus = { state: 'off' };
  private transport?: TRemoteControlPeer;
  private signaling?: ISignalingClient;
  // REMOTE-013 E4 reconnect state (session-scoped, spans channel drops).
  private bridge?: SessionResumeBridge;
  private pairedDeviceId?: string;
  private relayUrl?: string;
  private iceConfig: { iceServers?: readonly IIceServer[]; forceTurn?: boolean } = {};
  private reconnectConfig?: IHostReconnectConfig;
  /** Active reconnect transports (the 2-room window) + their timers, torn down on reconnect/ceiling. */
  private reconnectPeers: TRemoteControlPeer[] = [];
  private reconnectSignalings: ISignalingClient[] = [];
  private reconnectGeneration = 0;
  private cancelReconnectRound?: () => void;
  private cancelReconnectCeiling?: () => void;
  private activation?: AbortController;
  private pendingEnable?: Promise<string>;
  private stopping?: Promise<void>;
  private revokedDevices = new Set<string>();

  constructor(private readonly deps: IRemoteControlControllerDeps) {}

  getStatus(): TRemoteControlStatus {
    return this.status;
  }

  /** Where the host identity key is kept, or `undefined` while no backend has been chosen yet. */
  describeKeyStorage(): string | undefined {
    return this.deps.describeKeyStorage?.();
  }

  /**
   * Every connection a transport admits — a first pair or a trusted device coming back — drives the
   * session, and `drive` needs the operator's yes for each connection. One authority per connection,
   * so an earlier yes never carries over.
   */
  /** The operator of this session, as asked on this machine's terminal; undefined when nobody can be. */
  get operatorApprover(): IOperatorApprover | undefined {
    return this.deps.operatorApprover;
  }

  private approvalFor(lifetime: AbortSignal): IConnectionApproval {
    const revokedDevices = this.revokedDevices;
    return {
      approve: async ({ deviceId, signal }) => {
        if (lifetime.aborted || (deviceId !== undefined && revokedDevices.has(deviceId)))
          return false;
        const active = AbortSignal.any([lifetime, signal]);
        const authority = new ConnectionAuthority(
          {
            ...(deviceId !== undefined ? { deviceId } : {}),
            // A browser device proves no locality, so it is treated as another machine.
            locality: 'another-host',
            capabilities: ['drive'],
          },
          this.deps.operatorApprover,
        );
        const decision = await authority.authorize('drive', { signal: active });
        if (
          !decision.allowed ||
          active.aborted ||
          (deviceId !== undefined && revokedDevices.has(deviceId))
        )
          return false;
        this.pairedDeviceId = deviceId;
        return true;
      },
    };
  }

  /** Enable remote control and return a shareable QR + link (or a fail-closed notice). Idempotent-ish: a
   *  second enable while already awaiting pairing re-reports the current link. */
  enable(): Promise<string> {
    if (this.pendingEnable) return this.pendingEnable;
    if (this.transport && this.status.state === 'paired') {
      return Promise.resolve('Remote control is already connected.');
    }
    if (this.cancelReconnectCeiling) return Promise.resolve('Remote control is reconnecting.');
    const activation = this.activation ?? new AbortController();
    if (!this.activation) this.revokedDevices = new Set();
    this.activation = activation;
    const pending = this.activate(activation.signal)
      .catch((error: unknown) => {
        if (activation.signal.aborted) return ACTIVATION_CANCELLED;
        if (this.activation === activation) void this.teardown('off');
        throw error;
      })
      .finally(() => {
        if (this.pendingEnable === pending) this.pendingEnable = undefined;
      });
    this.pendingEnable = pending;
    return pending;
  }

  private async activate(signal: AbortSignal): Promise<string> {
    if (this.stopping) await whileActive(this.stopping, signal);
    if (signal.aborted) return ACTIVATION_CANCELLED;
    if (this.transport && this.status.state === 'awaiting-pairing') {
      return this.renderPairingMessage(this.status.pairingUrl, signal);
    }
    const relayUrl = this.deps.readRelayUrl();
    if (!relayUrl) {
      this.status = { state: 'no-relay' };
      return (
        'Remote control needs a signaling relay. Set `transports.webrtc.options.relayUrl` ' +
        `in ${this.deps.productRuntime.layout.userPaths.settings} (self-host with ` +
        '`@robota-sdk/remote-signaling`).'
      );
    }
    const session = this.deps.getSession();
    if (!session) return 'Remote control: no active session yet — try again in a moment.';

    // REMOTE-009 D5: a pairing link needs a hosted browser client. Fail closed BEFORE constructing/starting
    // the transport when `clientUrl` is unset — never mint a link that goes nowhere (no fabricated default).
    const clientUrl = this.deps.readClientUrl();
    if (!clientUrl) {
      return (
        'Remote control needs a browser client page. Set `transports.webrtc.options.clientUrl` ' +
        `in ${this.deps.productRuntime.layout.userPaths.settings} to your hosted browser page.`
      );
    }

    // REMOTE-010: user-supplied TURN/STUN. `readIceServers` throws on a malformed config → fail closed with the
    // error (don't construct/start). `forceTurn` requires a TURN server, else ICE yields zero candidates (silent
    // never-connect) — surface that as a config error too.
    let iceServers: readonly IIceServer[] | undefined;
    try {
      iceServers = this.deps.readIceServers?.();
    } catch (error) {
      return `Remote control: ${error instanceof Error ? error.message : String(error)}`;
    }
    const forceTurn = this.deps.readForceTurn?.() ?? false;
    if (forceTurn && !hasTurnServer(iceServers)) {
      return (
        'Remote control: `transports.webrtc.options.forceTurn` requires at least one TURN server in ' +
        '`iceServers` (a turn:/turns: url) — otherwise ICE gathers no candidates and never connects.'
      );
    }

    // REMOTE-012 E3: when a trusted-device store + host identity are configured, build the reconnect config so
    // the gate admits a pinned device without re-pairing (and enrolls new devices on first pair). A malformed
    // host-identity file throws → fail closed with the error (don't start with a broken trust anchor).
    let reconnect: IHostReconnectConfig | undefined;
    if (this.deps.trustedDeviceStore && this.deps.loadHostIdentity) {
      try {
        reconnect = await this.buildReconnectConfig(
          this.deps.trustedDeviceStore,
          this.deps.loadHostIdentity,
          signal,
        );
      } catch (error) {
        if (signal.aborted) return ACTIVATION_CANCELLED;
        return `Remote control: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    if (signal.aborted) return ACTIVATION_CANCELLED;

    // REMOTE-013 E4: retain the session bridge and inputs needed to re-arm reconnect signaling.
    this.relayUrl = relayUrl;
    this.iceConfig = { ...(iceServers ? { iceServers } : {}), forceTurn };
    this.reconnectConfig = reconnect;
    if (reconnect && !this.bridge) {
      const createBridge =
        this.deps.createResumeBridge ??
        ((current) => defaultCreateResumeBridge(current, this.deps.usageReporters));
      this.bridge = createBridge(session);
    }

    const pairing = generatePairingSecret();
    const pairingUrl = toPairingUrl(clientUrl, pairing);
    const signaling = (this.deps.createSignaling ?? defaultCreateSignaling)(
      relayUrl,
      pairing.rendezvous,
    );
    this.signaling = signaling;
    const transport = (this.deps.createTransport ?? defaultCreateTransport)(
      this.deps.productRuntime.cryptoContext,
      signaling,
      pairing.secret,
      {
        // Pairing accepted → the paired device drives the session. On FIRST pair, persist the reconnect
        // seed+counter (from the pairing sessionKey) so a future drop can rediscover + resume (E4).
        onPaired: (result) => {
          if (signal.aborted || this.transport !== transport) return;
          this.status = { state: 'paired' };
          if (result?.sessionKey && this.pairedDeviceId) {
            void this.persistReconnectSeed(this.pairedDeviceId, result.sessionKey, signal);
          }
        },
        onPairingFailed: () => {
          if (this.transport === transport) void this.teardown('off');
        },
        // E4: a PAIRED channel dropped → keep the session + bridge, run the reconnect loop.
        onDropped: () => {
          if (this.transport === transport) this.onDropped();
        },
        connectionApproval: this.approvalFor(signal),
      },
      this.iceConfig,
      reconnect,
      this.bridge,
      undefined,
      this.deps.usageReporters,
    );

    this.transport = transport;
    this.deps.host.registerInitial(transport, session);
    transport.attach(session);
    // Start out-of-band: the registry's startAll won't pick up a defaultEnabled:false transport, and there is
    // no start-one method. A start failure (WebRTC implementation unavailable, …) fails closed: reset to off + report to the operator.
    void transport.start().catch((error: unknown) => {
      if (signal.aborted || this.transport !== transport) return;
      this.deps.reportError?.(
        `Remote control failed to start: ${error instanceof Error ? error.message : String(error)}`,
      );
      void this.teardown('off');
    });

    this.status = { state: 'awaiting-pairing', pairingUrl };
    return this.renderPairingMessage(pairingUrl, signal);
  }

  /**
   * REMOTE-012 E3: build the gate's reconnect/enrollment config from the host identity + trusted-device store.
   * `resolveDevicePublicKey` imports a pinned SPKI (unknown/revoked → undefined → fail closed); `onEnroll`
   * pins a device's public key on first pair (preserving `createdAt`/`label` on a re-enroll, bumping `lastSeenAt`).
   */
  private async buildReconnectConfig(
    store: ITrustedDeviceStore,
    loadHostIdentity: () => Promise<IHostIdentity>,
    signal: AbortSignal,
  ): Promise<IHostReconnectConfig> {
    const identity = await whileActive(loadHostIdentity(), signal);
    const revokedDevices = this.revokedDevices;
    return {
      hostIdentityId: identity.hostIdentityId,
      hostPublicSpki: identity.publicKeySpki,
      hostPrivateKey: identity.keyPair.privateKey,
      resolveDevicePublicKey: async (deviceId) => {
        if (signal.aborted || revokedDevices.has(deviceId)) return undefined;
        const record = store.get(deviceId);
        if (!record) return undefined;
        const key = await importPublicKey(record.publicKey);
        return !signal.aborted &&
          !revokedDevices.has(deviceId) &&
          store.get(deviceId)?.publicKey === record.publicKey
          ? key
          : undefined;
      },
      onEnroll: (deviceId, deviceSpki) => {
        if (signal.aborted || revokedDevices.has(deviceId)) {
          throw new Error('Remote device enrollment is no longer authorized.');
        }
        const now = new Date().toISOString();
        const existing = store.get(deviceId);
        store.upsert({
          deviceId,
          publicKey: deviceSpki,
          label: existing?.label ?? 'remote device',
          createdAt: existing?.createdAt ?? now,
          lastSeenAt: now,
          ...(existing?.reconnectSeed ? { reconnectSeed: existing.reconnectSeed } : {}),
          ...(existing?.reconnectCounter !== undefined
            ? { reconnectCounter: existing.reconnectCounter }
            : {}),
        });
        // E4: remember which device is driving, so a drop knows whose reconnect rooms to re-arm.
        this.pairedDeviceId = deviceId;
        // REMOTE-014 E5: bind the paired device's id as the co-drive driver id for this remote surface, so its
        // submits/prompt-answers are server-attributed (never a client-forged id).
        this.bridge?.setDriverId(deviceId);
      },
    };
  }

  /** REMOTE-013 E4: persist the per-device reconnect seed (from the pairing sessionKey) + counter 0 on first pair. */
  private async persistReconnectSeed(
    deviceId: string,
    sessionKey: string,
    signal: AbortSignal,
  ): Promise<void> {
    const store = this.deps.trustedDeviceStore;
    const revokedDevices = this.revokedDevices;
    const existing = store?.get(deviceId);
    if (!store || !existing || existing.reconnectSeed) return; // already seeded, or no store
    const reconnectSeed = await deriveReconnectSeed(
      this.deps.productRuntime.cryptoContext,
      sessionKey,
    );
    if (signal.aborted || revokedDevices.has(deviceId)) return;
    const current = store.get(deviceId);
    if (!current || current.publicKey !== existing.publicKey || current.reconnectSeed) return;
    store.upsert({ ...current, reconnectSeed, reconnectCounter: 0 });
  }

  /**
   * REMOTE-013 E4: a PAIRED channel dropped. Keep the session + bridge; register the returning device's
   * reconnect rooms (the `{counter, counter+1}` window) and arm the reconnect-window ceiling. The client runs
   * its own backoff loop toward these rooms; a confirmed E3 reconnect resumes the same session.
   */
  private onDropped(): void {
    const store = this.deps.trustedDeviceStore;
    const record = this.pairedDeviceId ? store?.get(this.pairedDeviceId) : undefined;
    const session = this.deps.getSession();
    if (
      !record?.reconnectSeed ||
      !this.reconnectConfig ||
      !this.relayUrl ||
      !session ||
      !this.bridge
    ) {
      void this.teardown('off'); // cannot rediscover (no seed / no session) → free everything
      return;
    }
    // Drop the old peer transport (channel already closed) but KEEP the bridge (it is buffering the gap).
    const dropped = this.transport;
    this.transport = undefined;
    if (dropped) void dropped.stop().catch(() => undefined);
    void this.safeClose(this.signaling);
    this.signaling = undefined;

    const generation = ++this.reconnectGeneration;
    const counter = record.reconnectCounter ?? 0;
    const schedule = this.deps.schedule ?? defaultSchedule;
    this.cancelReconnectCeiling = schedule(() => this.giveUpReconnect(), RECONNECT_WINDOW_MS);
    // Register the 2-room window so a device that advanced its counter (lost final frame) still meets the host.
    void this.armReconnectRoom(record.reconnectSeed, counter, session, generation);
    void this.armReconnectRoom(record.reconnectSeed, counter + 1, session, generation);
  }

  /** Register one reconnect transport at `rendezvous(seed, counter)`, sharing the persistent bridge. */
  private async armReconnectRoom(
    seed: string,
    counter: number,
    session: IProtocolSession,
    generation: number,
  ): Promise<void> {
    const activation = this.activation;
    if (!this.reconnectConfig || !this.relayUrl || !this.bridge || !activation) return;
    const rendezvous = this.deps.deriveReconnectRendezvous
      ? await this.deps.deriveReconnectRendezvous(seed, counter)
      : await deriveReconnectRendezvous(this.deps.productRuntime.cryptoContext, seed, counter);
    if (generation !== this.reconnectGeneration || !this.bridge || activation.signal.aborted)
      return;
    const signaling = (this.deps.createSignaling ?? defaultCreateSignaling)(
      this.relayUrl,
      rendezvous,
    );
    // The reconnect room carries only rc-hello (E3 reconnect); the QR secret is unused but the gate requires one.
    const dummySecret = generatePairingSecret().secret;
    const peer = (this.deps.createTransport ?? defaultCreateTransport)(
      this.deps.productRuntime.cryptoContext,
      signaling,
      dummySecret,
      {
        onPaired: () => this.onReconnected(counter, peer, signaling, session, generation),
        onPairingFailed: () => undefined, // a wrong/absent device at this room is not fatal; the ceiling governs
        onDropped: () => {
          if (this.transport === peer) this.onDropped();
        },
        connectionApproval: this.approvalFor(activation.signal),
      },
      this.iceConfig,
      this.reconnectConfig,
      this.bridge,
      undefined,
      this.deps.usageReporters,
    );
    this.reconnectPeers.push(peer);
    this.reconnectSignalings.push(signaling);
    peer.attach(session);
    void peer.start().catch(() => undefined);
  }

  /** A returning device confirmed the E3 reconnect at `usedCounter`. Advance (resync), promote the winner, drop the rest. */
  private onReconnected(
    usedCounter: number,
    winner: TRemoteControlPeer,
    winnerSignaling: ISignalingClient,
    session: IProtocolSession,
    generation: number,
  ): void {
    if (this.transport || generation !== this.reconnectGeneration || !this.bridge) return;
    this.reconnectGeneration += 1; // invalidate a sibling room still deriving its rendezvous
    this.cancelReconnectCeiling?.();
    this.cancelReconnectCeiling = undefined;
    // Resync-on-success: the next room is the USED room + 1 (erases any ±1 drift).
    const store = this.deps.trustedDeviceStore;
    const record = this.pairedDeviceId ? store?.get(this.pairedDeviceId) : undefined;
    if (store && record) store.upsert({ ...record, reconnectCounter: usedCounter + 1 });
    // Tear down the losing rooms; promote the winner (its gate already re-attached the bridge on accept).
    for (let i = 0; i < this.reconnectPeers.length; i += 1) {
      const p = this.reconnectPeers[i];
      if (p === winner) continue;
      void p.stop().catch(() => undefined);
      void this.safeClose(this.reconnectSignalings[i]);
    }
    this.reconnectPeers = [];
    this.reconnectSignalings = [];
    this.deps.host.promoteWinner(winner, session); // #2043: the entry must name the live instance
    this.transport = winner;
    this.signaling = winnerSignaling;
    this.status = { state: 'paired' };
  }

  /** Reconnect window elapsed with no returning device → free the bridge + session presence (operator re-pairs). */
  private giveUpReconnect(): void {
    this.cancelReconnectCeiling = undefined;
    void this.teardown('off');
  }

  /** REMOTE-012 E3: list enrolled trusted devices (public data only). Empty when no store is configured. */
  listDevices(): ITrustedDeviceRecord[] {
    return this.deps.trustedDeviceStore?.list() ?? [];
  }

  /** REMOTE-012 E3: revoke a trusted device by id; it must re-pair. Returns false when unknown / no store. */
  revokeDevice(deviceId: string): boolean {
    const store = this.deps.trustedDeviceStore;
    if (!store) return false;
    this.revokedDevices.add(deviceId);
    let removed: boolean;
    try {
      removed = store.revoke(deviceId);
    } catch (error) {
      void this.teardown('off');
      throw error;
    }
    // An unidentified pending handshake may already be importing the revoked key.
    if (this.pairedDeviceId === deviceId || this.pairedDeviceId === undefined) {
      void this.teardown('off');
    }
    return removed;
  }

  /** Stop remote control and tear down the transport + signaling. */
  async stop(): Promise<string> {
    const wasRunning =
      this.pendingEnable ||
      this.transport ||
      this.bridge ||
      this.signaling ||
      this.cancelReconnectCeiling ||
      this.stopping;
    await this.teardown('off');
    if (!wasRunning) {
      return 'Remote control is not running.';
    }
    return 'Remote control stopped.';
  }

  /**
   * Tear down the active transport + signaling and set the next status. Shared by `stop` (user request) and
   * the pairing-failure hook (so a rejected/timed-out handshake never leaks the peer connection or signaling
   * socket and never leaves the status stuck at `awaiting-pairing`). Idempotent — a no-op when already off.
   */
  private teardown(next: 'off'): Promise<void> {
    this.activation?.abort();
    this.activation = undefined;
    this.pendingEnable = undefined;
    this.reconnectGeneration += 1;
    if (this.stopping) return this.stopping;
    const transport = this.transport;
    const signaling = this.signaling;
    this.transport = undefined;
    this.signaling = undefined;
    this.status = { state: next };
    // REMOTE-013 E4: cancel any in-flight reconnect + free the session-scoped bridge and its buffer.
    this.cancelReconnectCeiling?.();
    this.cancelReconnectCeiling = undefined;
    this.cancelReconnectRound?.();
    this.cancelReconnectRound = undefined;
    const reconnectPeers = this.reconnectPeers;
    const reconnectSignalings = this.reconnectSignalings;
    this.reconnectPeers = [];
    this.reconnectSignalings = [];
    this.pairedDeviceId = undefined;
    this.bridge?.dispose();
    this.bridge = undefined;
    const disconnected = [signaling, ...reconnectSignalings].map((s) => this.safeClose(s));
    const stopped = [transport, ...reconnectPeers].map((p) => p?.stop().catch(() => undefined));
    const stopping = Promise.all([...disconnected, ...stopped])
      .then(() => undefined)
      .finally(() => {
        if (this.stopping === stopping) this.stopping = undefined;
      });
    this.stopping = stopping;
    return stopping;
  }

  private async renderPairingMessage(pairingUrl: string, signal: AbortSignal): Promise<string> {
    let qr = '';
    try {
      qr = await whileActive(this.deps.renderQr(pairingUrl), signal);
    } catch {
      // QR rendering is best-effort — the link alone is sufficient to pair.
    }
    if (signal.aborted) return ACTIVATION_CANCELLED;
    const header = 'Remote control is on. Scan on your device to pair:';
    return qr ? `${header}\n\n${qr}\n${pairingUrl}` : `${header}\n\n${pairingUrl}`;
  }

  private async safeClose(signaling: ISignalingClient | undefined): Promise<void> {
    try {
      signaling?.close();
    } catch {
      // already closed
    }
  }
}

/** Withdraw an asynchronous activation without letting a late result restart it. */
function whileActive<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = (): void => reject(new Error(ACTIVATION_CANCELLED));
    signal.addEventListener('abort', abort, { once: true });
    void operation.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        if (signal.aborted) abort();
        else resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
    if (signal.aborted) abort();
  });
}

function defaultCreateSignaling(url: string, rendezvous: string): ISignalingClient {
  return new WsSignalingClient({ url, rendezvous });
}

function defaultSchedule(callback: () => void, delayMs: number): () => void {
  const timer = setTimeout(callback, delayMs);
  return () => clearTimeout(timer);
}
