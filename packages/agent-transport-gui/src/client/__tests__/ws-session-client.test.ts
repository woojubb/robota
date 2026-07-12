/**
 * Regression tests for WEBUI-002: a malformed server frame must not throw inside
 * the WebSocket onmessage handler (which would freeze the UI) — it is surfaced as
 * a protocol_error via the normal callback path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createWsSessionClient } from '../ws-session-client';
import type { TServerMessage } from '../ws-session-client';

interface IFakeSocket {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send: (data: string) => void;
  close: () => void;
}

let lastSocket: IFakeSocket | null = null;

class FakeWebSocket {
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  send = vi.fn();
  close = vi.fn();
  constructor() {
    lastSocket = this as unknown as IFakeSocket;
  }
}

describe('createWsSessionClient (WEBUI-002)', () => {
  beforeEach(() => {
    lastSocket = null;
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
  });
  afterEach(() => {
    delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket;
  });

  it('surfaces a malformed frame as protocol_error instead of throwing', () => {
    const messages: TServerMessage[] = [];
    const client = createWsSessionClient('ws://localhost:7070', {
      onMessage: (m) => messages.push(m),
      onStatusChange: () => {},
    });
    client.connect();
    expect(lastSocket).not.toBeNull();

    // A non-JSON frame must not throw.
    expect(() => lastSocket!.onmessage?.({ data: 'not json {{' })).not.toThrow();
    expect(messages).toEqual([
      { type: 'protocol_error', message: 'Malformed message from server (invalid JSON)' },
    ]);
  });

  it('passes a well-formed frame through to onMessage', () => {
    const messages: TServerMessage[] = [];
    const client = createWsSessionClient('ws://localhost:7070', {
      onMessage: (m) => messages.push(m),
      onStatusChange: () => {},
    });
    client.connect();
    lastSocket!.onmessage?.({ data: JSON.stringify({ type: 'thinking', isThinking: true }) });
    expect(messages).toEqual([{ type: 'thinking', isThinking: true }]);
  });

  it('schedules a reconnect after an unintentional close (WEBUI-001)', () => {
    vi.useFakeTimers();
    try {
      const client = createWsSessionClient('ws://localhost:7070', {
        onMessage: () => {},
        onStatusChange: () => {},
      });
      client.connect();
      const first = lastSocket;
      expect(first).not.toBeNull();
      // Server drops the connection unexpectedly.
      first!.onclose?.({});
      // A new socket is created after the reconnect delay.
      vi.advanceTimersByTime(2000);
      expect(lastSocket).not.toBe(first);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not reconnect after an intentional disconnect (WEBUI-001)', () => {
    vi.useFakeTimers();
    try {
      const client = createWsSessionClient('ws://localhost:7070', {
        onMessage: () => {},
        onStatusChange: () => {},
      });
      client.connect();
      const first = lastSocket;
      client.disconnect();
      first!.onclose?.({});
      vi.advanceTimersByTime(5000);
      expect(lastSocket).toBe(first);
    } finally {
      vi.useRealTimers();
    }
  });
});
