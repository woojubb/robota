/**
 * Browser signaling client (REMOTE-009 Stage D) — the browser peer's `ISignalingClient` over the **native**
 * `WebSocket`, talking to the `@robota-sdk/remote-signaling` relay. It is the browser counterpart of the Node
 * host's `WsSignalingClient` (which imports `ws` + uses the node `.on()` API and cannot run in a browser).
 *
 * The relay is content-blind: this client only ever emits `join` + `signal` frames and only ever consumes
 * `joined` / `signal` / `error` frames. Signals produced before the socket opens are buffered and flushed on
 * open (the browser answerer may produce an ICE candidate before the socket connects). A relay `error` frame, a
 * socket error, or a close-before-join is surfaced through an explicit `onError` — never a silent degrade.
 *
 * The signaling contract types are defined LOCALLY (not imported from `agent-transport-webrtc`, which is
 * node/werift-only) so the browser package takes no dependency on the node transport.
 */

/** The kinds of signal a peer exchanges through the relay (SDP offers/answers + ICE candidates). */
export type TSignalKind = 'offer' | 'answer' | 'ice';

/** An opaque signaling message relayed by rendezvous id. `data` is an SDP description or an ICE candidate. */
export interface ISignalMessage {
  readonly kind: TSignalKind;
  readonly data: unknown;
}

/** Port a WebRTC peer uses to reach its counterpart at a rendezvous id. */
export interface ISignalingClient {
  send(message: ISignalMessage): void;
  onSignal(handler: (message: ISignalMessage) => void): () => void;
  close(): void;
}

/** The subset of the native `WebSocket` surface the client uses — so tests inject a fake without a socket. */
export interface IBrowserWebSocketLike {
  send(data: string): void;
  close(): void;
  readonly readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
}

export interface IRtcSignalingOptions {
  /** Relay URL, e.g. `wss://relay.example`. */
  readonly url: string;
  /** Rendezvous id to join (from the pairing URL fragment). */
  readonly rendezvous: string;
  /** Relay `error` frame / socket error / close-before-join — the caller must know (no silent degrade). */
  readonly onError?: (error: Error) => void;
  /** Fired once the relay confirms the `join` (`joined` frame). */
  readonly onReady?: () => void;
  /** Injectable socket factory (defaults to the global `WebSocket`) — for tests. */
  readonly createSocket?: (url: string) => IBrowserWebSocketLike;
}

const SIGNAL_KINDS: ReadonlySet<string> = new Set<TSignalKind>(['offer', 'answer', 'ice']);
const WS_OPEN = 1;

function defaultCreateSocket(url: string): IBrowserWebSocketLike {
  return new WebSocket(url) as unknown as IBrowserWebSocketLike;
}

export function createRtcSignalingClient(options: IRtcSignalingOptions): ISignalingClient {
  const socket = (options.createSocket ?? defaultCreateSocket)(options.url);
  const handlers: ((message: ISignalMessage) => void)[] = [];
  const outbox: ISignalMessage[] = [];
  let joined = false;
  let closed = false;

  const fail = (error: Error): void => options.onError?.(error);

  const writeSignal = (message: ISignalMessage): void =>
    socket.send(JSON.stringify({ type: 'signal', kind: message.kind, data: message.data }));

  socket.onopen = (): void => {
    socket.send(JSON.stringify({ type: 'join', rendezvous: options.rendezvous }));
    for (const message of outbox) writeSignal(message);
    outbox.length = 0;
  };

  socket.onmessage = (event): void => {
    let frame: unknown;
    try {
      frame = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
    } catch {
      return; // the relay only emits JSON
    }
    if (typeof frame !== 'object' || frame === null) return;
    const record = frame as Record<string, unknown>;
    if (record.type === 'joined') {
      joined = true;
      options.onReady?.();
      return;
    }
    if (record.type === 'error') {
      fail(new Error(`signaling relay rejected the connection: ${String(record.reason)}`));
      return;
    }
    if (
      record.type === 'signal' &&
      typeof record.kind === 'string' &&
      SIGNAL_KINDS.has(record.kind)
    ) {
      const message: ISignalMessage = { kind: record.kind as TSignalKind, data: record.data };
      for (const handler of handlers) handler(message);
    }
  };

  socket.onerror = (err): void => fail(err instanceof Error ? err : new Error(String(err)));

  socket.onclose = (): void => {
    if (closed) return; // an intentional close() is not an error
    if (!joined) fail(new Error('signaling socket closed before the rendezvous was joined'));
  };

  return {
    send(message: ISignalMessage): void {
      if (closed) return;
      if (socket.readyState === WS_OPEN) writeSignal(message);
      else outbox.push(message);
    },
    onSignal(handler: (message: ISignalMessage) => void): () => void {
      handlers.push(handler);
      return () => {
        const index = handlers.indexOf(handler);
        if (index >= 0) handlers.splice(index, 1);
      };
    },
    close(): void {
      closed = true;
      handlers.length = 0;
      outbox.length = 0;
      socket.close();
    },
  };
}
