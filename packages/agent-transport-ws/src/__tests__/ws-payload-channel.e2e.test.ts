import { randomBytes } from 'node:crypto';

import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';
import { decodeChannelFrame, encodeBinaryFrame } from '@robota-sdk/agent-transport-protocol';
import { WebSocket } from 'ws';
import { describe, it, expect, afterEach, vi } from 'vitest';

import { WsTransport } from '../ws-transport-configurable.js';

import type { IBinaryFrame } from '@robota-sdk/agent-interface-transport';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';
import type { TServerMessage } from '@robota-sdk/agent-transport-protocol';

/**
 * TRANS-001 functional / user-execution test.
 *
 * One WebSocket connection carries THREE things at once: the existing text-agent protocol
 * (`text_delta` …), opaque binary frames the transport never interprets, and a consumer-declared
 * custom event. The receiver must reassemble the bytes byte-identically and in order, while the
 * text-delta profile keeps working unchanged.
 */

type TListener = (...args: unknown[]) => void;

/** Minimal session double with a REAL emitter, so `text_delta` genuinely flows over the wire. */
function emittingSession(): IInteractiveSession & { emit: (event: string, arg: unknown) => void } {
  const listeners = new Map<string, Set<TListener>>();
  // ARCH-012: the conformant double plus a real emitter. The hand-rolled partial this replaces was
  // `as unknown as IInteractiveSession` over nine members — a cast that let the double omit the rest,
  // including the ones the contract now requires, so this suite ran against a session shape no
  // implementation could actually have.
  const session = createTestInteractiveSession({
    // A spy, because a case below asserts on its calls. The double's default is a real no-op, which
    // is the right default and the wrong thing to assert against.
    submit: vi.fn().mockResolvedValue(undefined),
    getExecutionWorkspaceSnapshot: vi.fn().mockReturnValue({ entries: [] }),
    getContextState: vi.fn().mockReturnValue({ usedPercentage: 0, usedTokens: 0, maxTokens: 1 }),
    on: ((event: string, fn: TListener) => {
      const set = listeners.get(event) ?? new Set<TListener>();
      set.add(fn);
      listeners.set(event, set);
    }) as IInteractiveSession['on'],
    off: ((event: string, fn: TListener) => {
      listeners.get(event)?.delete(fn);
    }) as IInteractiveSession['off'],
  });
  return Object.assign(session, {
    emit: (event: string, arg: unknown) => {
      for (const fn of listeners.get(event) ?? []) fn(arg);
    },
  });
}

const started: WsTransport[] = [];
const clients: WebSocket[] = [];
afterEach(async () => {
  while (clients.length) clients.pop()!.close();
  while (started.length) await started.pop()!.stop();
});

/**
 * Connect and attach the message listener BEFORE the socket opens — the server sends its
 * handshake frames (`messages`, `execution_workspace_event`) the instant the connection lands, so a
 * listener attached after `open` would race them.
 */
async function connect(
  port: number,
  onMessage: (data: Buffer, isBinary: boolean) => void,
): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  ws.binaryType = 'nodebuffer';
  clients.push(ws);
  ws.on('message', onMessage);
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', reject);
  });
  return ws;
}

/** Resolve once `predicate` holds, or reject at the deadline (no arbitrary sleeps). */
async function until(predicate: () => boolean, label: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('WsTransport payload-agnostic channels (TRANS-001 e2e)', () => {
  it('carries interleaved text deltas, opaque binary frames, and a custom event on one connection', async () => {
    const transport = new WsTransport({
      port: 17840,
      maxRetries: 40,
      open: true,
      openReason: 'SEC-008: this case is about payload channels, not admission',
    });
    const channel = transport.registerChannel<{ manifest: { name: string; size: number } }>({
      name: 'file',
      events: ['manifest'],
      binary: true,
    });
    const session = emittingSession();
    transport.attach(session);
    await transport.start();
    started.push(transport);

    // Receiver side: split text (agent protocol) from binary (payload-agnostic carrier).
    const serverMessages: TServerMessage[] = [];
    const received: IBinaryFrame[] = [];
    const customEvents: { name: string; size: number }[] = [];
    await connect(transport.boundPort!, (data, isBinary) => {
      if (!isBinary) {
        serverMessages.push(JSON.parse(data.toString('utf8')) as TServerMessage);
        return;
      }
      const decoded = decodeChannelFrame(new Uint8Array(data));
      if (!decoded.ok) throw new Error(decoded.error);
      if (decoded.frame.kind === 'binary') received.push(decoded.frame);
      else customEvents.push(decoded.frame.payload as { name: string; size: number });
    });

    // A payload the transport must NOT understand: random bytes, invalid UTF-8, JSON-hostile.
    const blob = randomBytes(64 * 1024);
    const CHUNK = 4096;

    channel.sendEvent('manifest', { name: 'payload.bin', size: blob.byteLength });
    for (let offset = 0; offset < blob.byteLength; offset += CHUNK) {
      channel.sendBinary(new Uint8Array(blob.subarray(offset, offset + CHUNK)));
      // Interleave the text-agent profile on the SAME connection.
      session.emit('text_delta', `chunk@${offset} `);
    }

    const expectedChunks = Math.ceil(blob.byteLength / CHUNK);
    await until(() => received.length === expectedChunks, 'all binary chunks');
    await until(
      () => serverMessages.filter((m) => m.type === 'text_delta').length === expectedChunks,
      'all text deltas',
    );

    // 1. Custom (consumer-declared) event arrived.
    expect(customEvents).toEqual([{ name: 'payload.bin', size: blob.byteLength }]);

    // 2. Frames arrived in order (WS preserves per-connection frame order) and seq is monotonic.
    expect(received.map((f) => f.seq)).toEqual(
      Array.from({ length: expectedChunks }, (_, i) => i + 1), // seq 0 was the manifest event
    );

    // 3. Byte-identical reassembly.
    const reassembled = Buffer.concat(received.map((f) => Buffer.from(f.payload)));
    expect(reassembled.byteLength).toBe(blob.byteLength);
    expect(reassembled.equals(blob)).toBe(true);

    // 4. The text-agent profile is untouched: the connect handshake + every delta came through.
    expect(serverMessages[0]?.type).toBe('messages');
    expect(serverMessages.filter((m) => m.type === 'text_delta')).toHaveLength(expectedChunks);
  });

  it('reassembles an opaque upload sent by the client, byte-identically and in order', async () => {
    const transport = new WsTransport({
      port: 17860,
      maxRetries: 40,
      open: true,
      openReason: 'SEC-008: this case is about payload channels, not admission',
    });
    const channel = transport.registerChannel({ name: 'upload', events: [], binary: true });
    transport.attach(emittingSession());
    await transport.start();
    started.push(transport);

    const inbound: IBinaryFrame[] = [];
    channel.onBinary((frame) => inbound.push(frame));

    const ws = await connect(transport.boundPort!, () => {});
    const blob = randomBytes(20_000);
    const CHUNK = 3000;
    const expectedChunks = Math.ceil(blob.byteLength / CHUNK);
    for (let offset = 0, seq = 0; offset < blob.byteLength; offset += CHUNK, seq += 1) {
      ws.send(
        encodeBinaryFrame({
          kind: 'binary',
          channel: 'upload',
          seq,
          payload: new Uint8Array(blob.subarray(offset, offset + CHUNK)),
        }),
        { binary: true },
      );
    }

    await until(() => inbound.length === expectedChunks, 'all uploaded chunks');
    expect(inbound.map((f) => f.seq)).toEqual(Array.from({ length: expectedChunks }, (_, i) => i));
    const reassembled = Buffer.concat(inbound.map((f) => Buffer.from(f.payload)));
    expect(reassembled.equals(blob)).toBe(true);
  });

  it('answers an unroutable inbound frame with a protocol_error instead of dropping it', async () => {
    const transport = new WsTransport({
      port: 17880,
      maxRetries: 40,
      open: true,
      openReason: 'SEC-008: this case is about payload channels, not admission',
    });
    transport.attach(emittingSession());
    await transport.start();
    started.push(transport);

    const errors: TServerMessage[] = [];
    const ws = await connect(transport.boundPort!, (data, isBinary) => {
      if (isBinary) return;
      const msg = JSON.parse(data.toString('utf8')) as TServerMessage;
      if (msg.type === 'protocol_error') errors.push(msg);
    });

    ws.send(
      encodeBinaryFrame({
        kind: 'binary',
        channel: 'never-registered',
        seq: 0,
        payload: Uint8Array.from([1, 2, 3]),
      }),
      { binary: true },
    );

    await until(() => errors.length === 1, 'a protocol_error for the unknown channel');
    expect((errors[0] as { message: string }).message).toMatch(/never-registered/);
  });

  it('keeps the text-agent profile working when no channel is registered at all', async () => {
    const transport = new WsTransport({
      port: 17900,
      maxRetries: 40,
      open: true,
      openReason: 'SEC-008: this case is about payload channels, not admission',
    });
    const session = emittingSession();
    transport.attach(session);
    await transport.start();
    started.push(transport);

    const messages: TServerMessage[] = [];
    const ws = await connect(transport.boundPort!, (data, isBinary) => {
      if (!isBinary) messages.push(JSON.parse(data.toString('utf8')) as TServerMessage);
    });

    ws.send(JSON.stringify({ type: 'submit', prompt: 'hello' }));
    await until(
      () => (session.submit as ReturnType<typeof vi.fn>).mock.calls.length === 1,
      'submit',
    );
    session.emit('text_delta', 'hi');
    await until(() => messages.some((m) => m.type === 'text_delta'), 'a text delta');

    expect(messages[0]?.type).toBe('messages');
  });
});
