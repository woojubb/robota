import { describe, expect, it, vi } from 'vitest';

import {
  createRtcSignalingClient,
  type IBrowserWebSocketLike,
  type ISignalMessage,
} from '../rtc-signaling.js';

/**
 * REMOTE-009 Step 1 — the browser signaling client over a FAKE native WebSocket: join on open, buffer
 * signals produced before open, round-trip relay `signal` frames, and surface errors (no silent degrade).
 */

class FakeSocket implements IBrowserWebSocketLike {
  sent: string[] = [];
  readyState = 0; // CONNECTING
  onopen: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.onclose?.({});
  }
  /** Simulate the socket opening. */
  open(): void {
    this.readyState = 1; // OPEN
    this.onopen?.({});
  }
  /** Simulate an inbound relay frame. */
  deliver(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

function setup() {
  const socket = new FakeSocket();
  const onError = vi.fn();
  const onReady = vi.fn();
  const client = createRtcSignalingClient({
    url: 'wss://relay.test',
    rendezvous: 'rv-1',
    onError,
    onReady,
    createSocket: () => socket,
  });
  return { socket, onError, onReady, client };
}

describe('createRtcSignalingClient (REMOTE-009)', () => {
  it('joins the rendezvous on open', () => {
    const { socket } = setup();
    socket.open();
    expect(JSON.parse(socket.sent[0]!)).toEqual({ type: 'join', rendezvous: 'rv-1' });
  });

  it('buffers a signal produced before open, then flushes it on open (after join)', () => {
    const { socket, client } = setup();
    client.send({ kind: 'answer', data: { sdp: 'x' } });
    expect(socket.sent).toHaveLength(0); // buffered, not sent while CONNECTING
    socket.open();
    // First frame is the join, then the buffered answer signal.
    expect(JSON.parse(socket.sent[0]!).type).toBe('join');
    expect(JSON.parse(socket.sent[1]!)).toEqual({
      type: 'signal',
      kind: 'answer',
      data: { sdp: 'x' },
    });
  });

  it('sends a signal immediately when already open', () => {
    const { socket, client } = setup();
    socket.open();
    client.send({ kind: 'ice', data: { candidate: 'c' } });
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({
      type: 'signal',
      kind: 'ice',
      data: { candidate: 'c' },
    });
  });

  it('fires onReady on the joined frame and delivers inbound signals to subscribers', () => {
    const { socket, onReady, client } = setup();
    const seen: ISignalMessage[] = [];
    client.onSignal((m) => seen.push(m));
    socket.open();
    socket.deliver({ type: 'joined', rendezvous: 'rv-1' });
    expect(onReady).toHaveBeenCalledTimes(1);
    socket.deliver({ type: 'signal', kind: 'offer', data: { sdp: 'o' } });
    expect(seen).toEqual([{ kind: 'offer', data: { sdp: 'o' } }]);
  });

  it('ignores a signal frame with an unknown kind', () => {
    const { socket, client } = setup();
    const seen: ISignalMessage[] = [];
    client.onSignal((m) => seen.push(m));
    socket.open();
    socket.deliver({ type: 'signal', kind: 'bogus', data: {} });
    expect(seen).toHaveLength(0);
  });

  it('surfaces a relay error frame via onError (no silent degrade)', () => {
    const { socket, onError } = setup();
    socket.open();
    socket.deliver({ type: 'error', reason: 'rendezvous full' });
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/rendezvous full/) }),
    );
  });

  it('a close before joined is an error; an intentional close() is not', () => {
    const { socket, onError, client } = setup();
    socket.open();
    // close before a joined frame → error
    socket.onclose?.({});
    expect(onError).toHaveBeenCalledTimes(1);

    const b = setup();
    b.socket.open();
    b.socket.deliver({ type: 'joined', rendezvous: 'rv-1' });
    b.client.close(); // intentional → no error
    expect(b.onError).not.toHaveBeenCalled();
  });

  it('does not send after close()', () => {
    const { socket, client } = setup();
    socket.open();
    const before = socket.sent.length;
    client.close();
    client.send({ kind: 'ice', data: {} });
    expect(socket.sent.length).toBe(before);
  });
});
