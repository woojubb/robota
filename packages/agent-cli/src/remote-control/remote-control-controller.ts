import {
  generatePairingSecret,
  importPublicKey,
  toPairingUrl,
} from '@robota-sdk/agent-remote-pairing';
import { WsSignalingClient, WebRtcTransport } from '@robota-sdk/agent-transport-webrtc';

import { hasTurnServer } from './ice-config.js';

import type { IHostIdentity } from './host-identity.js';
import type { ITrustedDeviceRecord, ITrustedDeviceStore } from './trusted-device-store.js';
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
    hooks: { onPaired: () => void; onPairingFailed: () => void },
    ice: { iceServers?: readonly IIceServer[]; forceTurn?: boolean },
    reconnect?: IHostReconnectConfig,
  ) => IConfigurableTransport<IInteractiveSession>;
}

export class RemoteControlController {
  private status: TRemoteControlStatus = { state: 'off' };
  private transport?: IConfigurableTransport<IInteractiveSession>;
  private signaling?: ISignalingClient;

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

    const pairing = generatePairingSecret();
    const signaling = (this.deps.createSignaling ?? defaultCreateSignaling)(
      relayUrl,
      pairing.rendezvous,
    );
    const transport = (this.deps.createTransport ?? defaultCreateTransport)(
      signaling,
      pairing.secret,
      {
        // Pairing accepted → the paired device is now driving the session (host lifecycle status).
        onPaired: () => {
          if (this.transport === transport) this.status = { state: 'paired' };
        },
        // Pairing rejected/timed out → tear down (channel already closed by the gate) so nothing leaks and
        // the status stops advertising "waiting to pair".
        onPairingFailed: () => {
          if (this.transport === transport) void this.teardown('off');
        },
      },
      { ...(iceServers ? { iceServers } : {}), forceTurn },
      reconnect,
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
        });
      },
    };
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
    if (transport) await transport.stop().catch(() => undefined);
    await this.safeClose(signaling);
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

function defaultCreateTransport(
  signaling: ISignalingClient,
  secret: string,
  hooks: { onPaired: () => void; onPairingFailed: () => void },
  ice: { iceServers?: readonly IIceServer[]; forceTurn?: boolean },
  reconnect?: IHostReconnectConfig,
): IConfigurableTransport<IInteractiveSession> {
  return new WebRtcTransport({
    signaling,
    secret,
    onPaired: hooks.onPaired,
    onPairingFailed: hooks.onPairingFailed,
    ...(ice.iceServers ? { iceServers: ice.iceServers } : {}),
    ...(ice.forceTurn ? { forceTurn: ice.forceTurn } : {}),
    ...(reconnect ? { reconnect } : {}),
  });
}
