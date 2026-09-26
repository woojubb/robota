/**
 * #3189: what a client that renders the whole session (the TUI) needs over the wire, beside the
 * streamed turn — the full history, the context window as it changes, a signal that the history
 * changed, and where each turn came from.
 */

import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';
import { describe, expect, it, vi } from 'vitest';

import { createOutboundDelivery } from '../outbound-delivery.js';
import { createSessionMessageHandler } from '../session-message-handler.js';

import type { TClientMessage, TServerMessage } from '../wire-messages.js';
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
): { sent: TServerMessage[]; send: (message: TClientMessage) => void } {
  const sent: TServerMessage[] = [];
  const { onMessage } = createSessionMessageHandler({
    session,
    role,
    deliver: createOutboundDelivery((message) => sent.push(message), vi.fn()),
  });
  return { sent, send: (message) => onMessage(JSON.stringify(message)) };
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
        entries: [
          { id: 'm1', timestamp: '2026-09-26T01:02:03.004Z', category: 'chat', type: 'user' },
        ],
      },
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
