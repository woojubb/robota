import {
  deriveReconnectRendezvous,
  deriveReconnectSeed,
  generatePairingSecret,
  importPublicKey,
  toPairingUrl,
} from '@robota-sdk/agent-remote-pairing';
import { WsSignalingClient, WebRtcTransport } from '@robota-sdk/agent-transport-webrtc';
import { SessionResumeBridge } from '@robota-sdk/agent-transport-protocol';

import { hasTurnServer } from './ice-config.js';

import type { IHostIdentity } from './host-identity.js';
import type { ITrustedDeviceRecord, ITrustedDeviceStore } from './trusted-device-store.js';
import type { IPairingResult } from '@robota-sdk/agent-remote-pairing';
import type {
  IHostReconnectConfig,
  IIceServer,
  ISignalingClient,
} from '@robota-sdk/agent-transport-webrtc';
import type { TransportRegistry } from '@robota-sdk/agent-transport';
import type { TRemoteControlStatus } from '@robota-sdk/agent-framework';
import type {
  IConfigurableTransport,
  IInteractiveSession,
} from '@robota-sdk/agent-interface-transport';

/**
 * Composition-root controller for `/remote-control` (REMOTE-008 Step 4).
 *
 * The command is a declarative trigger; ALL transport construction lives HERE (the composition root owns
 * settings, the transport registry, and the live session). On enable it mints a pairing secret + rendezvous,
 * builds a `WsSignalingClient` against the configured relay and a pairing-gated `WebRtcTransport`, registers
 * and starts it, and returns a QR + link the operator shares with the device. The `getStatus` view is read
 * by the command through the injected `ICommandHostAdapters.remoteControl` adapter over this same instance's
 * mutable state (the adapter is created before any transport exists).
 *
 * Fail-closed: no relay configured ⇒ do nothing (never a silent default to a public relay); a `werift`-absent
 * or start failure ⇒ report the error and stay off.
 */

export interface IRemoteControlControllerDeps {
  /** The full transport registry (needs `register`, so not the view). */
  registry: TransportRegistry;
  /** Signaling relay URL (`transports.webrtc.options.relayUrl`), or undefined when unconfigured. */
  readRelayUrl: () => string | undefined;
  /** Client base URL for the pairing link (`transports.webrtc.options.clientUrl`); unset ⇒ enable fails closed (REMOTE-009 D5). */
  readClientUrl: () => string | undefined;
  /** REMOTE-010: validated user-supplied ICE (STUN/TURN) servers (`transports.webrtc.options.iceServers`), or
   *  undefined when absent. THROWS on a malformed config (fail-closed) — surfaced as an enable error. */
  readIceServers?: () => readonly IIceServer[] | undefined;
  /** REMOTE-010: `transports.webrtc.options.forceTurn` — restrict ICE to relay candidates (requires a TURN server). */
  readForceTurn?: () => boolean;
  /** The live interactive session to expose on pairing accept, or undefined before one is ready. */
  getSession: () => IInteractiveSession | undefined;
  /** Render a scannable QR for the given text (async). */
  renderQr: (text: string) => Promise<string>;
  /** Surface an async failure (e.g. a `werift`-absent `start()` failure) to the operator. */
  reportError?: (message: string) => void;
  /** REMOTE-012 E3: the host trusted-device store (device public keys). Absent → first-pair only, no TOFU reconnect. */
  trustedDeviceStore?: ITrustedDeviceStore;
  /** REMOTE-012 E3: load-or-create the host identity keypair (async). Absent → first-pair only, no TOFU reconnect. */
  loadHostIdentity?: () => Promise<IHostIdentity>;
  /** Construction seams (default to the real implementations; overridden in unit tests). */
  createSignaling?: (url: string, rendezvous: string) => ISignalingClient;
  createTransport?: (
    signaling: ISignalingClient,
    secret: string,
    hooks: {
      onPaired: (result?: IPairingResult) => void;
      onPairingFailed: () => void;
      onDropped?: () => void;
    },
    ice: { iceServers?: readonly IIceServer[]; forceTurn?: boolean },
    reconnect?: IHostReconnectConfig,
    resumeBridge?: SessionResumeBridge,
  ) => IConfigurableTransport<IInteractiveSession>;
  /** REMOTE-013 E4: build the session-scoped resume bridge (default: real `SessionResumeBridge`). */
  createResumeBridge?: (session: IInteractiveSession) => SessionResumeBridge;
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

export class RemoteControlController {
  private status: TRemoteControlStatus = { state: 'off' };
  private transport?: IConfigurableTransport<IInteractiveSession>;
  private signaling?: ISignalingClient;
  // REMOTE-013 E4 reconnect state (session-scoped, spans channel drops).
  private bridge?: SessionResumeBridge;
  private pairedDeviceId?: string;
  private relayUrl?: string;
  private iceConfig: { iceServers?: readonly IIceServer[]; forceTurn?: boolean } = {};
  private reconnectConfig?: IHostReconnectConfig;
  /** Active reconnect transports (the 2-room window) + their timers, torn down on reconnect/ceiling. */
  private reconnectPeers: IConfigurableTransport<IInteractiveSession>[] = [];
  private reconnectSignalings: ISignalingClient[] = [];
  private cancelReconnectRound?: () => void;
  private cancelReconnectCeiling?: () => void;

  constructor(private readonly deps: IRemoteControlControllerDeps) {}

  getStatus(): TRemoteControlStatus {
    return this.status;
  }

  /** Enable remote control and return a shareable QR + link (or a fail-closed notice). Idempotent-ish: a
   *  second enable while already awaiting pairing re-reports the current link. */
  async enable(): Promise<string> {
    if (this.transport && this.status.state === 'awaiting-pairing') {
      return this.renderPairingMessage(this.status.pairingUrl);
    }
    const relayUrl = this.deps.readRelayUrl();
    if (!relayUrl) {
      this.status = { state: 'no-relay' };
      return (
        'Remote control needs a signaling relay. Set `transports.webrtc.options.relayUrl` ' +
        'in ~/.robota/settings.json (self-host with `@robota-sdk/remote-signaling`).'
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
        'in ~/.robota/settings.json to your hosted Stage-D page (`@robota-sdk/agent-web-ui`).'
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
        );
      } catch (error) {
        return `Remote control: ${error instanceof Error ? error.message : String(error)}`;
      }
    }

    // REMOTE-013 E4: a session-scoped resume bridge (only when reconnect/E3 is active) that survives channel
    // drops. Retain the config needed to re-arm reconnect signaling later.
    this.relayUrl = relayUrl;
    this.iceConfig = { ...(iceServers ? { iceServers } : {}), forceTurn };
    this.reconnectConfig = reconnect;
    if (reconnect && !this.bridge) {
      this.bridge = (
        this.deps.createResumeBridge ?? ((s) => new SessionResumeBridge({ session: s }))
      )(session);
    }

    const pairing = generatePairingSecret();
    const signaling = (this.deps.createSignaling ?? defaultCreateSignaling)(
      relayUrl,
      pairing.rendezvous,
    );
    const transport = (this.deps.createTransport ?? defaultCreateTransport)(
      signaling,
      pairing.secret,
      {
        // Pairing accepted → the paired device drives the session. On FIRST pair, persist the reconnect
        // seed+counter (from the pairing sessionKey) so a future drop can rediscover + resume (E4).
        onPaired: (result) => {
          if (this.transport !== transport) return;
          this.status = { state: 'paired' };
          if (result?.sessionKey && this.pairedDeviceId) {
            void this.persistReconnectSeed(this.pairedDeviceId, result.sessionKey);
          }
        },
        onPairingFailed: () => {
          if (this.transport === transport) void this.teardown('off');
        },
        // E4: a PAIRED channel dropped → keep the session + bridge, run the reconnect loop.
        onDropped: () => {
          if (this.transport === transport) this.onDropped();
        },
      },
      this.iceConfig,
      reconnect,
      this.bridge,
    );

    this.deps.registry.register(transport);
    transport.attach(session);
    // Start out-of-band: the registry's startAll won't pick up a defaultEnabled:false transport, and there is
    // no start-one method. A werift-absent / start failure fails closed: reset to off + report to the operator.
    void transport.start().catch((error: unknown) => {
      if (this.transport === transport) void this.teardown('off');
      this.deps.reportError?.(
        `Remote control failed to start: ${error instanceof Error ? error.message : String(error)}`,
      );
    });

    this.transport = transport;
    this.signaling = signaling;
    const pairingUrl = toPairingUrl(clientUrl, pairing);
    this.status = { state: 'awaiting-pairing', pairingUrl };
    return this.renderPairingMessage(pairingUrl);
  }

  /**
   * REMOTE-012 E3: build the gate's reconnect/enrollment config from the host identity + trusted-device store.
   * `resolveDevicePublicKey` imports a pinned SPKI (unknown/revoked → undefined → fail closed); `onEnroll`
   * pins a device's public key on first pair (preserving `createdAt`/`label` on a re-enroll, bumping `lastSeenAt`).
   */
  private async buildReconnectConfig(
    store: ITrustedDeviceStore,
    loadHostIdentity: () => Promise<IHostIdentity>,
  ): Promise<IHostReconnectConfig> {
    const identity = await loadHostIdentity();
    return {
      hostIdentityId: identity.hostIdentityId,
      hostPublicSpki: identity.publicKeySpki,
      hostPrivateKey: identity.keyPair.privateKey,
      resolveDevicePublicKey: async (deviceId) => {
        const record = store.get(deviceId);
        return record ? importPublicKey(record.publicKey) : undefined;
      },
      onEnroll: (deviceId, deviceSpki) => {
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
  private async persistReconnectSeed(deviceId: string, sessionKey: string): Promise<void> {
    const store = this.deps.trustedDeviceStore;
    const existing = store?.get(deviceId);
    if (!store || !existing || existing.reconnectSeed) return; // already seeded, or no store
    const reconnectSeed = await deriveReconnectSeed(sessionKey);
    store.upsert({ ...existing, reconnectSeed, reconnectCounter: 0 });
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

    const counter = record.reconnectCounter ?? 0;
    const schedule = this.deps.schedule ?? defaultSchedule;
    this.cancelReconnectCeiling = schedule(() => this.giveUpReconnect(), RECONNECT_WINDOW_MS);
    // Register the 2-room window so a device that advanced its counter (lost final frame) still meets the host.
    void this.armReconnectRoom(record.reconnectSeed, counter, session);
    void this.armReconnectRoom(record.reconnectSeed, counter + 1, session);
  }

  /** Register one reconnect transport at `rendezvous(seed, counter)`, sharing the persistent bridge. */
  private async armReconnectRoom(
    seed: string,
    counter: number,
    session: IInteractiveSession,
  ): Promise<void> {
    if (!this.reconnectConfig || !this.relayUrl || !this.bridge) return;
    const rendezvous = await deriveReconnectRendezvous(seed, counter);
    const signaling = (this.deps.createSignaling ?? defaultCreateSignaling)(
      this.relayUrl,
      rendezvous,
    );
    // The reconnect room carries only rc-hello (E3 reconnect); the QR secret is unused but the gate requires one.
    const dummySecret = generatePairingSecret().secret;
    const peer = (this.deps.createTransport ?? defaultCreateTransport)(
      signaling,
      dummySecret,
      {
        onPaired: () => this.onReconnected(counter, peer, signaling),
        onPairingFailed: () => undefined, // a wrong/absent device at this room is not fatal; the ceiling governs
        onDropped: () => {
          if (this.transport === peer) this.onDropped();
        },
      },
      this.iceConfig,
      this.reconnectConfig,
      this.bridge,
    );
    this.reconnectPeers.push(peer);
    this.reconnectSignalings.push(signaling);
    this.deps.registry.register(peer);
    peer.attach(session);
    void peer.start().catch(() => undefined);
  }

  /** A returning device confirmed the E3 reconnect at `usedCounter`. Advance (resync), promote the winner, drop the rest. */
  private onReconnected(
    usedCounter: number,
    winner: IConfigurableTransport<IInteractiveSession>,
    winnerSignaling: ISignalingClient,
  ): void {
    if (this.transport) return; // already promoted a winner (first wins)
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
    return this.deps.trustedDeviceStore?.revoke(deviceId) ?? false;
  }

  /** Stop remote control and tear down the transport + signaling. */
  async stop(): Promise<string> {
    if (!this.transport) return 'Remote control is not running.';
    await this.teardown('off');
    return 'Remote control stopped.';
  }

  /**
   * Tear down the active transport + signaling and set the next status. Shared by `stop` (user request) and
   * the pairing-failure hook (so a rejected/timed-out handshake never leaks the peer connection or signaling
   * socket and never leaves the status stuck at `awaiting-pairing`). Idempotent — a no-op when already off.
   */
  private async teardown(next: 'off'): Promise<void> {
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
    if (transport) await transport.stop().catch(() => undefined);
    await this.safeClose(signaling);
    for (const p of reconnectPeers) await p.stop().catch(() => undefined);
    for (const s of reconnectSignalings) await this.safeClose(s);
  }

  private async renderPairingMessage(pairingUrl: string): Promise<string> {
    let qr = '';
    try {
      qr = await this.deps.renderQr(pairingUrl);
    } catch {
      // QR rendering is best-effort — the link alone is sufficient to pair.
    }
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

function defaultCreateSignaling(url: string, rendezvous: string): ISignalingClient {
  return new WsSignalingClient({ url, rendezvous });
}

function defaultSchedule(callback: () => void, delayMs: number): () => void {
  const timer = setTimeout(callback, delayMs);
  return () => clearTimeout(timer);
}

function defaultCreateTransport(
  signaling: ISignalingClient,
  secret: string,
  hooks: {
    onPaired: (result?: IPairingResult) => void;
    onPairingFailed: () => void;
    onDropped?: () => void;
  },
  ice: { iceServers?: readonly IIceServer[]; forceTurn?: boolean },
  reconnect?: IHostReconnectConfig,
  resumeBridge?: SessionResumeBridge,
): IConfigurableTransport<IInteractiveSession> {
  return new WebRtcTransport({
    signaling,
    secret,
    onPaired: hooks.onPaired,
    onPairingFailed: hooks.onPairingFailed,
    ...(hooks.onDropped ? { onDropped: hooks.onDropped } : {}),
    ...(ice.iceServers ? { iceServers: ice.iceServers } : {}),
    ...(ice.forceTurn ? { forceTurn: ice.forceTurn } : {}),
    ...(reconnect ? { reconnect } : {}),
    ...(resumeBridge ? { resumeBridge } : {}),
  });
}
