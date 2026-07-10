import { describe, expect, it, vi } from 'vitest';

import { WsSignalingClient, type IWebSocketLike } from '../ws-signaling-client.js';
import type { ISignalMessage } from '../signaling.js';

/**
 * REMOTE-004 B2 — `WsSignalingClient` unit tests with an injected fake socket (no network). Cover pre-open
 * buffering + flush and explicit error surfacing (relay `error` frame, close-before-join).
 */

const WS_CONNECTING = 0;
const WS_OPEN = 1;

function createFakeSocket(): IWebSocketLike & {
  readonly sent: string[];
  readyState: number;
  emit(event: 'open' | 'message' | 'error' | 'close', arg?: unknown): void;
} {
  const sent: string[] = [];
  const listeners: Record<string, ((arg: unknown) => void)[]> = {};
  return {
    sent,
    readyState: WS_CONNECTING,
    send(data: string): void {
      sent.push(data);
    },
    close(): void {
      /* no-op for the fake */
    },
    on(event, handler): void {
      (listeners[event] ??= []).push(handler);
    },
    emit(event, arg): void {
      for (const h of listeners[event] ?? []) h(arg);
    },
  };
}

function parse(raw: string): Record<string, unknown> {
  return JSON.parse(raw) as Record<string, unknown>;
}

describe('WsSignalingClient (REMOTE-004 B2)', () => {
  it('TC-02: buffers signals produced before open and flushes them (after the join) on open', () => {
    const socket = createFakeSocket();
    const client = new WsSignalingClient({
      url: 'ws://x',
      rendezvous: 'r',
      createSocket: () => socket,
    });
    // send an offer before the socket opens
    const offer: ISignalMessage = { kind: 'offer', data: { sdp: 'v=0' } };
    client.send(offer);
    expect(socket.sent).toHaveLength(0); // buffered, nothing on the wire yet

    socket.readyState = WS_OPEN;
    socket.emit('open');

    // first frame is the join, then the flushed offer
    expect(parse(socket.sent[0]!)).toEqual({ type: 'join', rendezvous: 'r' });
    expect(parse(socket.sent[1]!)).toEqual({ type: 'signal', kind: 'offer', data: { sdp: 'v=0' } });
  });

  it('delivers inbound relay signals to onSignal handlers', () => {
    const socket = createFakeSocket();
    const client = new WsSignalingClient({
      url: 'ws://x',
      rendezvous: 'r',
      createSocket: () => socket,
    });
    const received: ISignalMessage[] = [];
    client.onSignal((m) => received.push(m));
    socket.emit('message', JSON.stringify({ type: 'signal', kind: 'answer', data: { sdp: 'a' } }));
    expect(received).toEqual([{ kind: 'answer', data: { sdp: 'a' } }]);
  });

  it('TC-02: surfaces a relay error frame via onError (no silent degrade)', () => {
    const socket = createFakeSocket();
    const onError = vi.fn();
    new WsSignalingClient({ url: 'ws://x', rendezvous: 'r', onError, createSocket: () => socket });
    socket.emit('message', JSON.stringify({ type: 'error', reason: 'rate-limited' }));
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0]![0] as Error).message).toMatch(/rate-limited/);
  });

  it('TC-02: surfaces a close-before-join as an explicit error', () => {
    const socket = createFakeSocket();
    const onError = vi.fn();
    new WsSignalingClient({ url: 'ws://x', rendezvous: 'r', onError, createSocket: () => socket });
    socket.emit('close');
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0]![0] as Error).message).toMatch(/closed before/);
  });

  it('does NOT treat an intentional close() as an error', () => {
    const socket = createFakeSocket();
    const onError = vi.fn();
    const client = new WsSignalingClient({
      url: 'ws://x',
      rendezvous: 'r',
      onError,
      createSocket: () => socket,
    });
    client.close();
    socket.emit('close');
    expect(onError).not.toHaveBeenCalled();
  });
});
