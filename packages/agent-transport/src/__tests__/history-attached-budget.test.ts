/**
 * #3189: a history larger than an attached terminal's backpressure budget reaches that terminal
 * whole, over a real socket, without the connection being cut.
 *
 * The carrier here is wired as the supervised attach carrier is: every reply goes through
 * `createOutboundDelivery` measuring the socket's `writableLength` against
 * `ATTACHED_SURFACE_MAX_PENDING_BYTES`, and a failure destroys the socket. The client sends what an
 * attached terminal sends when it starts, all at once, and pages the history as it arrives.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ATTACHED_SURFACE_MAX_PENDING_BYTES,
  createOutboundDelivery,
} from '../outbound-delivery.js';
import { createSessionMessageHandler } from '../session-message-handler.js';

import type { TClientMessage, TServerMessage } from '../wire-messages.js';
import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';
import type { Server, Socket } from 'node:net';

type TListener = (...args: unknown[]) => void;

const ENTRY_BYTES = 20_000;
/** Half as much again as the budget, so one frame holding it all would trip it. */
const HISTORY_BYTES = ATTACHED_SURFACE_MAX_PENDING_BYTES * 1.5;

const STARTUP: readonly TClientMessage[] = [
  { type: 'get-history' },
  { type: 'get-context' },
  { type: 'get-commands' },
  { type: 'get-status' },
  { type: 'get-executing' },
  { type: 'get-pending' },
  { type: 'get-execution-workspace' },
];

function longHistory(): IHistoryEntry[] {
  return Array.from({ length: Math.ceil(HISTORY_BYTES / ENTRY_BYTES) }, (_, index) => ({
    id: `e${index}`,
    timestamp: new Date('2026-09-26T00:00:00.000Z'),
    category: 'chat',
    type: 'assistant',
    data: { role: 'assistant', content: 'x'.repeat(ENTRY_BYTES) },
  }));
}

function emittingSession(
  history: IHistoryEntry[],
): IInteractiveSession & { emit: (event: string, payload: unknown) => void } {
  const listeners = new Map<string, Set<TListener>>();
  const session = createTestInteractiveSession({
    getFullHistory: () => history,
    on: ((event: string, handler: TListener) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    }) as IInteractiveSession['on'],
    off: ((event: string, handler: TListener) => {
      listeners.get(event)?.delete(handler);
    }) as IInteractiveSession['off'],
  });
  return Object.assign(session, {
    emit: (event: string, payload: unknown) => {
      for (const handler of listeners.get(event) ?? []) handler(payload);
    },
  });
}

/** One connection's carrier, as the supervised attach carrier builds it. */
function serve(session: IInteractiveSession, socket: Socket, onCut: (error: Error) => void): void {
  const deliver = createOutboundDelivery(
    (message) => {
      socket.write(`${JSON.stringify(message)}\n`);
    },
    (error) => {
      onCut(error);
      socket.destroy();
    },
    () => socket.writableLength,
    ATTACHED_SURFACE_MAX_PENDING_BYTES,
  );
  const { onMessage, cleanup } = createSessionMessageHandler({ session, deliver });
  let buffered = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    buffered += chunk;
    // Every complete line of a chunk is handled in one pass, as the carrier's drain loop does.
    for (let end = buffered.indexOf('\n'); end !== -1; end = buffered.indexOf('\n')) {
      const line = buffered.slice(0, end);
      buffered = buffered.slice(end + 1);
      onMessage(line);
    }
  });
  socket.on('close', cleanup);
}

interface IClient {
  readonly frames: TServerMessage[];
  readonly closed: Promise<void>;
  send(message: TClientMessage): void;
  next(predicate: (frame: TServerMessage) => boolean): Promise<TServerMessage>;
  end(): void;
}

function connect(path: string): Promise<IClient> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    const frames: TServerMessage[] = [];
    const waiters: {
      predicate: (frame: TServerMessage) => boolean;
      found: (f: TServerMessage) => void;
      lost: (error: Error) => void;
    }[] = [];
    let buffered = '';
    let markClosed: () => void = () => undefined;
    const closed = new Promise<void>((done) => {
      markClosed = done;
    });
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      buffered += chunk;
      for (let end = buffered.indexOf('\n'); end !== -1; end = buffered.indexOf('\n')) {
        const frame = JSON.parse(buffered.slice(0, end)) as TServerMessage;
        buffered = buffered.slice(end + 1);
        frames.push(frame);
        for (const waiter of waiters.splice(0)) {
          if (waiter.predicate(frame)) waiter.found(frame);
          else waiters.push(waiter);
        }
      }
    });
    socket.on('close', () => {
      markClosed();
      for (const waiter of waiters.splice(0))
        waiter.lost(new Error('the host closed the connection'));
    });
    socket.on('error', reject);
    socket.on('connect', () =>
      resolve({
        frames,
        closed,
        send: (message) => socket.write(`${JSON.stringify(message)}\n`),
        next: (predicate) =>
          new Promise((found, lost) => {
            waiters.push({ predicate, found, lost });
          }),
        end: () => socket.end(),
      }),
    );
  });
}

function isHistory(frame: TServerMessage): frame is Extract<TServerMessage, { type: 'history' }> {
  return frame.type === 'history';
}

describe('a history larger than the attached-surface budget (#3189)', () => {
  let server: Server | undefined;
  let dir: string | undefined;

  afterEach(async () => {
    await new Promise<void>((done) => (server ? server.close(() => done()) : done()));
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('reaches an attached terminal whole, and the turn after it does not cut the terminal off', async () => {
    const history = longHistory();
    const session = emittingSession(history);
    const cuts: Error[] = [];
    dir = mkdtempSync(join(tmpdir(), 'rh-'));
    const path = join(dir, 's.sock');
    server = createServer((socket) => serve(session, socket, (error) => cuts.push(error)));
    await new Promise<void>((done) => server!.listen(path, done));
    const client = await connect(path);

    // What an attached terminal sends when it starts, in one burst.
    for (const message of STARTUP) client.send(message);
    const received: string[] = [];
    let page = (await client.next(isHistory)) as Extract<TServerMessage, { type: 'history' }>;
    for (;;) {
      received.push(...page.entries.map((entry) => entry.id));
      const next = page.startIndex + page.entries.length;
      if (next >= page.total) break;
      const arriving = client.next(isHistory);
      client.send({ type: 'get-history', fromIndex: next });
      page = (await arriving) as Extract<TServerMessage, { type: 'history' }>;
    }
    expect(received).toEqual(history.map((entry) => entry.id));

    // A turn ends: its result, then more frames at once, as the host sends them.
    const thinking = client.next((frame) => frame.type === 'thinking');
    session.emit('complete', {
      response: 'done',
      history,
      toolSummaries: [],
      contextState: { usedTokens: 1, maxTokens: 10, usedPercentage: 10 },
    });
    session.emit('thinking', false);
    await thinking;

    expect(cuts).toEqual([]);
    expect(client.frames.map((frame) => frame.type)).toEqual(
      expect.arrayContaining(['context', 'commands', 'session_status', 'pending', 'complete']),
    );
    client.end();
    await client.closed;
  }, 20_000);
});
