/**
 * #3189: what a client that renders the whole session (the TUI) needs over the wire, beside the
 * streamed turn — the full history, the context window as it changes, a signal that the history
 * changed, and where each turn came from.
 */

import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';
import { describe, expect, it, vi } from 'vitest';

import { createOutboundDelivery } from '../outbound-delivery.js';
import { createSessionMessageHandler } from '../session-message-handler.js';
import { HISTORY_PAGE_MAX_BYTES } from '../session-query-messages.js';

import type { IWireHistoryEntry, TClientMessage, TServerMessage } from '../wire-messages.js';
import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';

type TListener = (...args: unknown[]) => void;
type TEmittingSession = IInteractiveSession & { emit: (event: string, payload?: unknown) => void };

const RECORDED_AT = new Date('2026-09-26T01:02:03.004Z');

function createSession(overrides: Partial<IInteractiveSession> = {}): TEmittingSession {
  const listeners = new Map<string, Set<TListener>>();
  const session = createTestInteractiveSession({
    on: ((event: string, handler: TListener) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    }) as IInteractiveSession['on'],
    off: ((event: string, handler: TListener) => {
      listeners.get(event)?.delete(handler);
    }) as IInteractiveSession['off'],
    ...overrides,
  });
  return Object.assign(session, {
    emit: (event: string, payload?: unknown) => {
      listeners.get(event)?.forEach((handler) => handler(payload));
    },
  });
}

function attach(
  session: IInteractiveSession,
  role: 'drive' | 'observe' = 'drive',
): { sent: TServerMessage[]; send: (message: TClientMessage) => void; leave: () => void } {
  const sent: TServerMessage[] = [];
  const { onMessage, cleanup } = createSessionMessageHandler({
    session,
    role,
    deliver: createOutboundDelivery((message) => sent.push(message), vi.fn()),
  });
  return { sent, send: (message) => onMessage(JSON.stringify(message)), leave: cleanup };
}

type THistoryFrame = Extract<TServerMessage, { type: 'history' }>;

function lastHistory(sent: readonly TServerMessage[]): THistoryFrame {
  const frame = sent.at(-1);
  if (frame?.type !== 'history') throw new Error(`expected a history frame, got ${frame?.type}`);
  return frame;
}

/** Entries of about `bytes` serialized bytes each. */
function historyOf(count: number, bytes: number): IHistoryEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `e${index}`,
    timestamp: RECORDED_AT,
    category: 'chat',
    type: 'assistant',
    data: { role: 'assistant', content: 'x'.repeat(bytes) },
  }));
}

/** Read the whole history the way a client does: the next page only after the previous one. */
function readAll(client: ReturnType<typeof attach>): {
  pages: THistoryFrame[];
  entries: IWireHistoryEntry[];
} {
  const pages: THistoryFrame[] = [];
  const entries: IWireHistoryEntry[] = [];
  client.send({ type: 'get-history' });
  for (;;) {
    const page = lastHistory(client.sent);
    pages.push(page);
    entries.push(...page.entries);
    const next = page.startIndex + page.entries.length;
    if (next >= page.total) return { pages, entries };
    client.send({ type: 'get-history', fromIndex: next });
  }
}

describe('get-history (#3189)', () => {
  it('answers with the full history, each timestamp an ISO 8601 string', () => {
    const session = createSession({
      getFullHistory: () => [
        {
          id: 'm1',
          timestamp: RECORDED_AT,
          category: 'chat',
          type: 'user',
          data: { role: 'user', content: 'hi' },
        },
        { id: 'e1', timestamp: RECORDED_AT, category: 'event', type: 'skill-activation' },
      ],
    });
    const client = attach(session);

    client.send({ type: 'get-history' });

    expect(client.sent).toEqual([
      {
        type: 'history',
        startIndex: 0,
        total: 2,
        entries: [
          {
            id: 'm1',
            timestamp: '2026-09-26T01:02:03.004Z',
            category: 'chat',
            type: 'user',
            data: { role: 'user', content: 'hi' },
          },
          {
            id: 'e1',
            timestamp: '2026-09-26T01:02:03.004Z',
            category: 'event',
            type: 'skill-activation',
          },
        ],
      },
    ]);
  });

  it('carries a resumed entry, whose timestamp came back from JSON as a string, unchanged', () => {
    const resumed = JSON.parse(
      JSON.stringify([{ id: 'm1', timestamp: RECORDED_AT, category: 'chat', type: 'user' }]),
    ) as ReturnType<IInteractiveSession['getFullHistory']>;
    const client = attach(createSession({ getFullHistory: () => resumed }));

    client.send({ type: 'get-history' });

    expect(client.sent).toEqual([
      {
        type: 'history',
        startIndex: 0,
        total: 1,
        entries: [
          { id: 'm1', timestamp: '2026-09-26T01:02:03.004Z', category: 'chat', type: 'user' },
        ],
      },
    ]);
  });

  it('is a read, so an observer may send it', () => {
    const session = createSession({
      getFullHistory: () => [{ id: 'm1', timestamp: RECORDED_AT, category: 'chat', type: 'user' }],
    });
    const observer = attach(session, 'observe');

    observer.send({ type: 'get-history' });

    expect(observer.sent).toEqual([
      {
        type: 'history',
        startIndex: 0,
        total: 1,
        entries: [
          { id: 'm1', timestamp: '2026-09-26T01:02:03.004Z', category: 'chat', type: 'user' },
        ],
      },
    ]);
  });

  it('sends a long history in pages under the page budget, which read back to the whole of it', () => {
    const history = historyOf(40, 20_000);
    const client = attach(createSession({ getFullHistory: () => history }));

    const { pages, entries } = readAll(client);

    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) {
      expect(new TextEncoder().encode(JSON.stringify(page.entries)).byteLength).toBeLessThanOrEqual(
        HISTORY_PAGE_MAX_BYTES,
      );
      expect(page.total).toBe(40);
    }
    expect(entries.map((entry) => entry.id)).toEqual(history.map((entry) => entry.id));
  });

  it('sends an entry larger than the page budget alone, so a reader still moves forward', () => {
    const history = [...historyOf(1, 10), ...historyOf(1, HISTORY_PAGE_MAX_BYTES + 1)];
    history[1] = { ...history[1]!, id: 'big' };
    const client = attach(createSession({ getFullHistory: () => history }));

    const { pages } = readAll(client);

    expect(pages.map((page) => page.entries.map((entry) => entry.id))).toEqual([['e0'], ['big']]);
  });

  it('answers from the index asked, and says where the history ends when that is past it', () => {
    const history = historyOf(3, 10);
    const client = attach(createSession({ getFullHistory: () => history }));

    client.send({ type: 'get-history', fromIndex: 2 });
    expect(lastHistory(client.sent)).toMatchObject({ startIndex: 2, total: 3 });
    expect(lastHistory(client.sent).entries.map((entry) => entry.id)).toEqual(['e2']);

    // A client that knows more than the session holds learns it from `total`, and reads again.
    client.send({ type: 'get-history', fromIndex: 7 });
    expect(lastHistory(client.sent)).toEqual({
      type: 'history',
      startIndex: 3,
      total: 3,
      entries: [],
    });
  });
});

describe('turn results on the wire (#3189)', () => {
  it.each(['complete', 'interrupted'] as const)(
    'sends %s without the session history, which only grows',
    (event) => {
      const session = createSession();
      const client = attach(session);
      const contextState = { usedTokens: 1, maxTokens: 10, usedPercentage: 10 };

      session.emit(event, {
        response: 'done',
        history: historyOf(50, 50_000),
        toolSummaries: [],
        contextState,
      });

      expect(client.sent).toEqual([
        { type: event, result: { response: 'done', toolSummaries: [], contextState } },
      ]);
    },
  );
});

describe('get-prompts (#3189)', () => {
  const permission = { id: 'p1', toolName: 'Bash', toolArgs: { command: 'ls' } };
  const ask = { id: 'a1', request: { kind: 'text', title: 'Name?' } };

  it('sends a client that attached later the prompts still open, as the frames that asked them', () => {
    const session = createSession();
    const first = attach(session);
    session.emit('permission_request', permission);
    session.emit('ask_request', ask);
    session.emit('prompt_resolved', { id: 'a1' });

    const later = attach(session);
    later.send({ type: 'get-prompts' });

    expect(first.sent.map((frame) => frame.type)).toEqual([
      'permission_request',
      'ask_request',
      'prompt_resolved',
    ]);
    expect(later.sent).toEqual([{ type: 'permission_request', event: permission }]);
  });

  it("forgets the previous session's prompts on a switch, and all of them once nobody can answer", () => {
    const session = createSession();
    const first = attach(session);
    session.emit('permission_request', permission);
    session.emit('session_switched', { sessionId: 'session-2' });
    first.send({ type: 'get-prompts' });
    expect(first.sent.at(-1)).toEqual({
      type: 'session_switched',
      event: { sessionId: 'session-2' },
    });

    session.emit('permission_request', { ...permission, id: 'p2' });
    first.leave();
    const next = attach(session);
    next.send({ type: 'get-prompts' });
    expect(next.sent).toEqual([]);
  });

  it('is not a read an observer may send: an observer never receives prompts', () => {
    const session = createSession();
    attach(session);
    session.emit('permission_request', permission);
    const observer = attach(session, 'observe');

    observer.send({ type: 'get-prompts' });

    expect(observer.sent).toEqual([
      { type: 'protocol_error', message: 'Not permitted for an observer: get-prompts' },
    ]);
  });
});

describe('pushed session state (#3189)', () => {
  it('delivers a context_update as the context frame get-context answers with', () => {
    const session = createSession();
    const client = attach(session);
    const state = { usedTokens: 900, maxTokens: 1000, usedPercentage: 90, remainingPercentage: 10 };

    session.emit('context_update', state);

    expect(client.sent).toEqual([{ type: 'context', state }]);
  });

  it.each(['compact', 'skill_activation', 'memory_event'])(
    'tells the client the history changed on %s, without sending the entries',
    (event) => {
      const session = createSession();
      const client = attach(session);

      session.emit(event, {});

      expect(client.sent).toEqual([{ type: 'history_changed' }]);
    },
  );

  it('delivers where a turn came from', () => {
    const session = createSession();
    const client = attach(session);

    session.emit('turn_source', 'agent-wakeup');

    expect(client.sent).toEqual([{ type: 'turn_source', source: 'agent-wakeup' }]);
  });

  it('pushes the same frames to an observer, which follows the session read-only', () => {
    const session = createSession();
    const observer = attach(session, 'observe');
    const state = { usedTokens: 1, maxTokens: 10, usedPercentage: 10, remainingPercentage: 90 };

    session.emit('context_update', state);
    session.emit('compact', {});
    session.emit('turn_source', 'user');

    expect(observer.sent).toEqual([
      { type: 'context', state },
      { type: 'history_changed' },
      { type: 'turn_source', source: 'user' },
    ]);
  });
});
