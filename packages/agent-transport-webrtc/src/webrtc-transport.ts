import { createWsHandler } from '@robota-sdk/agent-transport-protocol';
import type {
  IConfigurableTransport,
  IInteractiveSession,
} from '@robota-sdk/agent-interface-transport';
import type { RTCDataChannel, RTCPeerConnection } from 'werift';

import { loadWerift } from './werift-loader.js';
import type { ISignalingClient } from './signaling.js';

/** Construction options for {@link WebRtcTransport}. The signaling client is injected (Stage A: no settings). */
export interface IWebRtcTransportOptions {
  /** Signaling port used to exchange SDP/ICE with the remote peer by rendezvous id. */
  readonly signaling: ISignalingClient;
  /** Optional ICE servers (STUN/TURN). Omitted → host-candidate/loopback only. */
  readonly iceServers?: readonly { urls: string }[];
}

/**
 * WebRTC P2P transport (REMOTE-001/002): carries an `IInteractiveSession` over an `RTCDataChannel` using the
 * SAME transport-neutral session bridge as the WebSocket transport (`createWsHandler` from
 * `@robota-sdk/agent-transport-protocol`). The host is the offerer: it creates the data channel + offer, and on
 * data-channel open wires the handler. **Stage A: `defaultEnabled: false`, no pairing/auth** — the signaling
 * client is injected and can be an in-memory loopback for tests.
 */
export class WebRtcTransport implements IConfigurableTransport<IInteractiveSession> {
  public readonly name = 'webrtc';
  public readonly defaultEnabled = false;
  public readonly optionsSchema = {} as const;

  private session?: IInteractiveSession;
  private peer?: RTCPeerConnection;
  private unsubscribeSignal?: () => void;
  private cleanupHandler?: () => void;

  public constructor(private readonly options: IWebRtcTransportOptions) {}

  public validateOptions(): boolean {
    return true;
  }

  public attach(session: IInteractiveSession): void {
    this.session = session;
  }

  public async start(): Promise<void> {
    const session = this.session;
    if (!session) throw new Error('WebRtcTransport: attach() must be called before start()');

    const { RTCPeerConnection } = loadWerift();
    const peer = new RTCPeerConnection(
      this.options.iceServers ? { iceServers: [...this.options.iceServers] } : undefined,
    );
    this.peer = peer;
    const signaling = this.options.signaling;

    peer.onIceCandidate.subscribe((candidate) => {
      if (candidate) signaling.send({ kind: 'ice', data: candidate.toJSON() });
    });

    // Serialize signal processing so `setRemoteDescription(answer)` always completes before any subsequent
    // `addIceCandidate` (werift does not buffer trickle candidates that arrive before the remote description).
    let signalChain: Promise<void> = Promise.resolve();
    this.unsubscribeSignal = signaling.onSignal((message) => {
      signalChain = signalChain.then(async () => {
        if (message.kind === 'answer') {
          await peer.setRemoteDescription(
            message.data as Parameters<typeof peer.setRemoteDescription>[0],
          );
        } else if (message.kind === 'ice') {
          await peer.addIceCandidate(message.data as Parameters<typeof peer.addIceCandidate>[0]);
        }
      });
    });

    const channel = peer.createDataChannel('robota-session');
    this.wireChannel(channel, session);

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    signaling.send({ kind: 'offer', data: peer.localDescription });
  }

  private wireChannel(channel: RTCDataChannel, session: IInteractiveSession): void {
    // Subscribe `onMessage` and build the handler **eagerly at channel creation** — NOT inside the `open`
    // event. werift does not buffer inbound messages that arrive before a subscription exists, and the remote
    // (answerer) can open its end and send its first `TClientMessage` before the host's `open` fires, so a
    // deferred subscription drops that first message. `channel.send` runs under try/catch because werift buffers
    // sends while the channel is still `connecting` (a `TServerMessage` reply is often produced at that point)
    // and only throws once the channel is `closing`/`closed` — that terminal case is the only one we drop,
    // matching WebSocket semantics where a send after close cannot carry the frame.
    const { onMessage, cleanup } = createWsHandler({
      session,
      send: (serverMessage) => {
        try {
          channel.send(JSON.stringify(serverMessage));
        } catch {
          // Channel is closing/closed — the peer is gone; the frame cannot be delivered.
        }
      },
    });
    this.cleanupHandler = cleanup;
    channel.onMessage.subscribe((data) => {
      onMessage(typeof data === 'string' ? data : data.toString());
    });
  }

  public async stop(): Promise<void> {
    this.cleanupHandler?.();
    this.unsubscribeSignal?.();
    this.cleanupHandler = undefined;
    this.unsubscribeSignal = undefined;
    if (this.peer) {
      await this.peer.close();
      this.peer = undefined;
    }
  }
}
