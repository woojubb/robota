/**
 * {@link IMeshRelay} over a WebSocket to the self-hosted signaling relay's `presence` / `message`
 * frames.
 *
 * Frames sent before the socket opens are queued and flushed after the presence declaration, so a
 * message is never sent from a connection the relay does not yet consider present. A refusal from the
 * relay, a socket error, or a close the caller did not ask for goes to `onError` — never a silent
 * degrade.
 */
import WebSocket from 'ws';

import type { IMeshRelay } from './mesh-relay.js';
import type { IWebSocketLike } from './ws-signaling-client.js';

export interface IWsMeshRelayClientOptions {
  /** Relay URL, e.g. `wss://relay.example`. */
  readonly url: string;
  readonly onError?: (error: Error) => void;
  /** Called each time the relay confirms a presence declaration. */
  readonly onPresent?: () => void;
  /** Injectable socket factory (defaults to a real `ws` WebSocket) — for tests. */
  readonly createSocket?: (url: string) => IWebSocketLike;
}

const WS_OPEN = 1;
/** Messages queued before the socket opens; a connection attempt has a handful. */
const MAX_OUTBOX = 256;

export class WsMeshRelayClient implements IMeshRelay {
  private readonly socket: IWebSocketLike;
  private readonly messages = new Set<(topic: string, data: unknown) => void>();
  private readonly absents = new Set<(topic: string) => void>();
  private readonly outbox: string[] = [];
  private topics: readonly string[] | undefined;
  private closed = false;

  public constructor(private readonly options: IWsMeshRelayClientOptions) {
    const factory =
      options.createSocket ?? ((url: string) => new WebSocket(url) as unknown as IWebSocketLike);
    this.socket = factory(options.url);
    this.socket.on('open', () => this.flush());
    this.socket.on('message', (data) => this.receive(data));
    this.socket.on('error', (error) =>
      this.options.onError?.(error instanceof Error ? error : new Error(String(error))),
    );
    this.socket.on('close', () => {
      if (!this.closed) this.options.onError?.(new Error('signaling relay connection closed'));
    });
  }

  private flush(): void {
    if (this.topics !== undefined) this.write({ type: 'presence', topics: this.topics });
    for (const raw of this.outbox.splice(0)) this.socket.send(raw);
  }

  private write(frame: unknown): void {
    this.socket.send(JSON.stringify(frame));
  }

  private receive(data: unknown): void {
    let frame: unknown;
    try {
      frame = JSON.parse(typeof data === 'string' ? data : String(data));
    } catch {
      return; // the relay only emits JSON
    }
    if (typeof frame !== 'object' || frame === null) return;
    const record = frame as Record<string, unknown>;
    if (record.type === 'message' && typeof record.topic === 'string') {
      for (const handler of this.messages) handler(record.topic, record.data);
    } else if (record.type === 'absent' && typeof record.topic === 'string') {
      for (const handler of this.absents) handler(record.topic);
    } else if (record.type === 'present') {
      this.options.onPresent?.();
    } else if (record.type === 'error') {
      this.options.onError?.(
        new Error(`signaling relay refused a frame: ${String(record.reason)}`),
      );
    }
  }

  public declarePresence(topics: readonly string[]): void {
    if (this.closed) return;
    this.topics = [...topics];
    if (this.socket.readyState === WS_OPEN) this.write({ type: 'presence', topics: this.topics });
  }

  public send(topic: string, data: unknown): void {
    if (this.closed) return;
    const raw = JSON.stringify({ type: 'message', topic, data });
    if (this.socket.readyState === WS_OPEN) {
      this.socket.send(raw);
    } else if (this.outbox.length < MAX_OUTBOX) {
      this.outbox.push(raw);
    } else {
      this.options.onError?.(new Error('signaling relay is not reachable; message dropped'));
    }
  }

  public onMessage(handler: (topic: string, data: unknown) => void): () => void {
    this.messages.add(handler);
    return () => this.messages.delete(handler);
  }

  public onAbsent(handler: (topic: string) => void): () => void {
    this.absents.add(handler);
    return () => this.absents.delete(handler);
  }

  public close(): void {
    this.closed = true;
    this.messages.clear();
    this.absents.clear();
    this.outbox.length = 0;
    this.socket.close();
  }
}
