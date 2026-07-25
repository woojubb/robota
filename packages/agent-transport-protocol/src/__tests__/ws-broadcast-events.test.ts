/**
 * CMD-004 Phase 2 Stage E — broadcast session events over the WS transport.
 *
 * The spec's final carriers: `session_renamed` and `history_cleared` are BROADCAST session events —
 * every attached surface (including co-driving ones) receives them, so titles update and transcripts
 * refresh everywhere. Unlike `ui_intent` (requester-routed), these are never filtered by driver id.
 *
 * Red-first evidence: against pre-Stage-E code neither event is forwarded by
 * `subscribeSessionEvents` at all — a co-driving surface's title/transcript went stale.
 */

import { describe, expect, it, vi } from 'vitest';

import { createWsHandler } from '../ws-handler.js';

import type { TServerMessage } from '../ws-protocol.js';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-transport';

type TEmittingSession = IInteractiveSession & {
  _emit: (event: string, ...args: unknown[]) => void;
};

function createMockSession(): TEmittingSession {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    }),
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(handler);
    }),
    _emit: (event: string, ...args: unknown[]) => {
      listeners.get(event)?.forEach((h) => h(...args));
    },
  } as unknown as TEmittingSession;
}

/** Two real WS handlers (surfaces) over ONE session — the co-driving topology. */
function setupTwoSurfaces(): {
  session: TEmittingSession;
  sentA: TServerMessage[];
  sentB: TServerMessage[];
} {
  const session = createMockSession();
  const sentA: TServerMessage[] = [];
  const sentB: TServerMessage[] = [];
  createWsHandler({ session, send: (m) => sentA.push(m), driverId: 'device-A' });
  createWsHandler({ session, send: (m) => sentB.push(m), driverId: 'device-B' });
  return { session, sentA, sentB };
}

describe('CMD-004 Stage E — session_renamed / history_cleared broadcast to EVERY surface', () => {
  it('session_renamed reaches both attached surfaces (titles update everywhere)', () => {
    const { session, sentA, sentB } = setupTwoSurfaces();

    session._emit('session_renamed', { name: 'Renamed Everywhere' });

    const expected = { type: 'session_renamed', event: { name: 'Renamed Everywhere' } };
    expect(sentA).toEqual([expected]);
    expect(sentB).toEqual([expected]);
  });

  it('history_cleared reaches both attached surfaces (transcripts refresh everywhere)', () => {
    const { session, sentA, sentB } = setupTwoSurfaces();

    session._emit('history_cleared');

    expect(sentA).toEqual([{ type: 'history_cleared' }]);
    expect(sentB).toEqual([{ type: 'history_cleared' }]);
  });
});
