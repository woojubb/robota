/**
 * Production `ISignalingClient` over a WebSocket connection to the `@robota-sdk/remote-signaling` relay
 * (REMOTE-004 Stage B2). This is the **Node host-side** client (the browser remote client, Stage D, implements
 * `ISignalingClient` on the native `WebSocket`).
 *
 * On open it `join`s the rendezvous and flushes any signals produced before the socket opened (the offer is
 * created in `WebRtcTransport.start()`, which can run before the socket connects — buffering avoids dropping it).
 * Relay `error` frames, socket errors, and a close-before-join are surfaced through an explicit `onError`
 * callback — **never a silent degrade** (no-fallback, mirroring `loadReplayProvider`/`loadWerift`). The relay is
 * content-blind: this client only ever emits `join` + `signal` frames and only ever consumes `joined` / `signal`
 * / `error` frames.
 */
import WebSocket from 'ws';

import type { ISignalingClient, ISignalMessage, TSignalKind } from './signaling.js';

/** A minimal WebSocket-like surface — so tests can inject a fake without a real socket. */
export interface IWebSocketLike {
  send(data: string): void;
  close(): void;
  readyState: number;
  on(event: 'open' | 'message' | 'error' | 'close', handler: (arg: unknown) => void): void;
}

export interface IWsSignalingClientOptions {
  /** Relay URL, e.g. `ws://127.0.0.1:1234`. */
  readonly url: string;
  /** Rendezvous id to join. */
  readonly rendezvous: string;
  /**
   * Explicit error sink. Called on a relay `error` frame, a socket error, or a close-before-join — the signaling
   * channel cannot function and the caller must know (no silent degrade).
   */
  readonly onError?: (error: Error) => void;
  /** Called once the relay confirms the rendezvous `join` (the `joined` frame). */
  readonly onReady?: () => void;
  /** Injectable socket factory (defaults to a real `ws` WebSocket) — for tests. */
  readonly createSocket?: (url: string) => IWebSocketLike;
}

const SIGNAL_KINDS: ReadonlySet<string> = new Set<TSignalKind>(['offer', 'answer', 'ice']);
const WS_OPEN = 1;

function defaultCreateSocket(url: string): IWebSocketLike {
  return new WebSocket(url) as unknown as IWebSocketLike;
}

export class WsSignalingClient implements ISignalingClient {
  private readonly socket: IWebSocketLike;
  private readonly handlers: ((message: ISignalMessage) => void)[] = [];
  private readonly outbox: ISignalMessage[] = [];
  private joined = false;
  private closed = false;

  public constructor(private readonly options: IWsSignalingClientOptions) {
    const factory = options.createSocket ?? defaultCreateSocket;
    this.socket = factory(options.url);
    this.socket.on('open', () => this.handleOpen());
    this.socket.on('message', (data) => this.handleMessage(data));
    this.socket.on('error', (err) =>
      this.fail(err instanceof Error ? err : new Error(String(err))),
    );
    this.socket.on('close', () => this.handleClose());
  }

  private handleOpen(): void {
    this.socket.send(JSON.stringify({ type: 'join', rendezvous: this.options.rendezvous }));
    // Flush any signals produced before the socket opened (e.g. the offer from WebRtcTransport.start()).
    for (const message of this.outbox) this.writeSignal(message);
    this.outbox.length = 0;
  }

  private handleMessage(data: unknown): void {
    let frame: unknown;
    try {
      frame = JSON.parse(typeof data === 'string' ? data : String(data));
    } catch {
      return; // a non-JSON frame from the relay is ignored (the relay only emits JSON)
    }
    if (typeof frame !== 'object' || frame === null) return;
    const record = frame as Record<string, unknown>;
    if (record.type === 'joined') {
      this.joined = true;
      this.options.onReady?.();
      return;
    }
    if (record.type === 'error') {
      this.fail(new Error(`signaling relay rejected the connection: ${String(record.reason)}`));
      return;
    }
    if (
      record.type === 'signal' &&
      typeof record.kind === 'string' &&
      SIGNAL_KINDS.has(record.kind)
    ) {
      const message: ISignalMessage = { kind: record.kind as TSignalKind, data: record.data };
      for (const handler of this.handlers) handler(message);
    }
  }

  private handleClose(): void {
    if (this.closed) return; // an intentional close() is not an error
    if (!this.joined) {
      this.fail(new Error('signaling socket closed before the rendezvous was joined'));
    }
  }

  private fail(error: Error): void {
    this.options.onError?.(error);
  }

  private writeSignal(message: ISignalMessage): void {
    this.socket.send(JSON.stringify({ type: 'signal', kind: message.kind, data: message.data }));
  }

  public send(message: ISignalMessage): void {
    if (this.closed) return;
    if (this.socket.readyState === WS_OPEN) {
      this.writeSignal(message);
    } else {
      this.outbox.push(message); // buffer until open (see handleOpen)
    }
  }

  public onSignal(handler: (message: ISignalMessage) => void): () => void {
    this.handlers.push(handler);
    return () => {
      const index = this.handlers.indexOf(handler);
      if (index >= 0) this.handlers.splice(index, 1);
    };
  }

  public close(): void {
    this.closed = true;
    this.handlers.length = 0;
    this.outbox.length = 0;
    this.socket.close();
  }
}
