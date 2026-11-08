import { describe, expect, it, vi } from 'vitest';

import { WsMeshRelayClient } from '../ws-mesh-relay-client.js';
import type { IWebSocketLike } from '../ws-signaling-client.js';

const WS_CONNECTING = 0;
const WS_OPEN = 1;
const TOPIC = 't'.repeat(43);

function createFakeSocket(): IWebSocketLike & {
  readonly sent: Record<string, unknown>[];
  readyState: number;
  emit(event: 'open' | 'message' | 'error' | 'close', arg?: unknown): void;
} {
  const sent: Record<string, unknown>[] = [];
  const listeners: Record<string, ((arg: unknown) => void)[]> = {};
  return {
    sent,
    readyState: WS_CONNECTING,
    send(data: string): void {
      sent.push(JSON.parse(data) as Record<string, unknown>);
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

describe('WsMeshRelayClient', () => {
  it('declares presence first on open, then flushes messages queued before it', () => {
    const socket = createFakeSocket();
    const client = new WsMeshRelayClient({ url: 'ws://x', createSocket: () => socket });
    client.send(TOPIC, { hello: 1 });
    client.declarePresence([TOPIC]);
    expect(socket.sent).toEqual([]);

    socket.readyState = WS_OPEN;
    socket.emit('open');

    expect(socket.sent).toEqual([
      { type: 'presence', topics: [TOPIC] },
      { type: 'message', topic: TOPIC, data: { hello: 1 } },
    ]);
  });

  it('routes delivered messages and absences, and reports relay refusals and an unrequested close', () => {
    const socket = createFakeSocket();
    const onError = vi.fn();
    const client = new WsMeshRelayClient({ url: 'ws://x', createSocket: () => socket, onError });
    const messages: unknown[] = [];
    const absent: string[] = [];
    client.onMessage((topic, data) => messages.push([topic, data]));
    client.onAbsent((topic) => absent.push(topic));

    socket.emit('message', JSON.stringify({ type: 'message', topic: TOPIC, data: 'x' }));
    socket.emit('message', JSON.stringify({ type: 'absent', topic: TOPIC }));
    socket.emit('message', 'not json');
    socket.emit('message', JSON.stringify({ type: 'error', reason: 'rate-limited' }));
    socket.emit('close');

    expect(messages).toEqual([[TOPIC, 'x']]);
    expect(absent).toEqual([TOPIC]);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(String(onError.mock.calls[0]?.[0])).toMatch(/rate-limited/);
  });

  it('an intentional close is not an error, and nothing is sent after it', () => {
    const socket = createFakeSocket();
    const onError = vi.fn();
    const client = new WsMeshRelayClient({ url: 'ws://x', createSocket: () => socket, onError });
    socket.readyState = WS_OPEN;
    client.close();
    socket.emit('close');
    client.send(TOPIC, 'late');
    expect(onError).not.toHaveBeenCalled();
    expect(socket.sent).toEqual([]);
  });

  it('bounds what it queues while the relay is unreachable', () => {
    const socket = createFakeSocket();
    const onError = vi.fn();
    const client = new WsMeshRelayClient({ url: 'ws://x', createSocket: () => socket, onError });
    for (let i = 0; i < 300; i += 1) client.send(TOPIC, i);
    expect(onError).toHaveBeenCalled();
    socket.readyState = WS_OPEN;
    socket.emit('open');
    expect(socket.sent.length).toBe(256);
  });
});
