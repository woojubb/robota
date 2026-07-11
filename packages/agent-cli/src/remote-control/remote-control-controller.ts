import { generatePairingSecret, toPairingUrl } from '@robota-sdk/agent-remote-pairing';
import { WsSignalingClient, WebRtcTransport } from '@robota-sdk/agent-transport-webrtc';

import type { ISignalingClient } from '@robota-sdk/agent-transport-webrtc';
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

/** Fallback client base when none is configured — a custom scheme a future browser client registers. */
const DEFAULT_CLIENT_URL = 'robota-remote://pair';

export interface IRemoteControlControllerDeps {
  /** The full transport registry (needs `register`, so not the view). */
  registry: TransportRegistry;
  /** Signaling relay URL (`transports.webrtc.options.relayUrl`), or undefined when unconfigured. */
  readRelayUrl: () => string | undefined;
  /** Client base URL for the pairing link (`transports.webrtc.options.clientUrl`); defaults to a placeholder. */
  readClientUrl: () => string | undefined;
  /** The live interactive session to expose on pairing accept, or undefined before one is ready. */
  getSession: () => IInteractiveSession | undefined;
  /** Render a scannable QR for the given text (async). */
  renderQr: (text: string) => Promise<string>;
  /** Construction seams (default to the real implementations; overridden in unit tests). */
  createSignaling?: (url: string, rendezvous: string) => ISignalingClient;
  createTransport?: (
    signaling: ISignalingClient,
    secret: string,
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

    const pairing = generatePairingSecret();
    const signaling = (this.deps.createSignaling ?? defaultCreateSignaling)(
      relayUrl,
      pairing.rendezvous,
    );
    const transport = (this.deps.createTransport ?? defaultCreateTransport)(
      signaling,
      pairing.secret,
    );

    this.deps.registry.register(transport);
    transport.attach(session);
    // Start out-of-band: the registry's startAll won't pick up a defaultEnabled:false transport, and there is
    // no start-one method. A werift-absent / start failure fails closed (report + stay off).
    void transport.start().catch((error: unknown) => {
      this.status = { state: 'off' };
      this.transport = undefined;
      this.signaling = undefined;
      void this.safeClose(signaling);
      throw error instanceof Error ? error : new Error(String(error));
    });

    this.transport = transport;
    this.signaling = signaling;
    const clientUrl = this.deps.readClientUrl() ?? DEFAULT_CLIENT_URL;
    const pairingUrl = toPairingUrl(clientUrl, pairing);
    this.status = { state: 'awaiting-pairing', pairingUrl };
    return this.renderPairingMessage(pairingUrl);
  }

  /** Stop remote control and tear down the transport + signaling. */
  async stop(): Promise<string> {
    if (!this.transport) return 'Remote control is not running.';
    const transport = this.transport;
    const signaling = this.signaling;
    this.transport = undefined;
    this.signaling = undefined;
    this.status = { state: 'off' };
    await transport.stop().catch(() => undefined);
    await this.safeClose(signaling);
    return 'Remote control stopped.';
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
): IConfigurableTransport<IInteractiveSession> {
  return new WebRtcTransport({ signaling, secret });
}
