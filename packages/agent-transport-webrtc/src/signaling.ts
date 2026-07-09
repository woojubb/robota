/**
 * Signaling port (REMOTE-002). The WebRTC transport is decoupled from any concrete signaling server via this
 * port: it exchanges opaque SDP/ICE blobs by rendezvous id. The port carries **only** SDP offers/answers + ICE
 * candidates — never session content — so a signaling server (or the in-memory test pair) is content-blind.
 */

/** An opaque signaling message relayed by rendezvous id. `data` is an SDP description or an ICE candidate. */
export interface ISignalMessage {
  readonly kind: 'offer' | 'answer' | 'ice';
  /** Opaque payload (serialized SDP or ICE candidate). The signaling layer never inspects it. */
  readonly data: unknown;
}

/** Port a WebRTC peer uses to reach its counterpart at a rendezvous id. */
export interface ISignalingClient {
  /** Send a signal to the counterpart at the rendezvous. */
  send(message: ISignalMessage): void;
  /** Subscribe to signals from the counterpart. Returns an unsubscribe function. */
  onSignal(handler: (message: ISignalMessage) => void): () => void;
  /** Tear down the signaling channel. */
  close(): void;
}

/**
 * An in-process pair of {@link ISignalingClient}s wired directly to each other — for tests + loopback only
 * (no server, no network). Each side's `send` is delivered to the other side's handlers on a microtask.
 */
export function createInMemorySignalingPair(): [ISignalingClient, ISignalingClient] {
  const handlersA: ((m: ISignalMessage) => void)[] = [];
  const handlersB: ((m: ISignalMessage) => void)[] = [];
  let open = true;

  function make(
    ownHandlers: ((m: ISignalMessage) => void)[],
    peerHandlers: ((m: ISignalMessage) => void)[],
  ): ISignalingClient {
    return {
      send(message) {
        if (!open) return;
        queueMicrotask(() => {
          for (const h of peerHandlers) h(message);
        });
      },
      onSignal(handler) {
        ownHandlers.push(handler);
        return () => {
          const i = ownHandlers.indexOf(handler);
          if (i >= 0) ownHandlers.splice(i, 1);
        };
      },
      close() {
        open = false;
        ownHandlers.length = 0;
      },
    };
  }

  return [make(handlersA, handlersB), make(handlersB, handlersA)];
}
