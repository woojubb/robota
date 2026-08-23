import { describe, expect, it, vi } from 'vitest';

import { createOutboundDelivery } from '../outbound-delivery.js';
import { createWsHandler } from '../ws-handler.js';
import { PROTOCOL_SESSION_EVENT_CLASSIFICATION } from '../ws-session-events.js';

import type { TServerMessage } from '../ws-protocol.js';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';

type TEmittingSession = IInteractiveSession & {
  emitForTest: (event: string, payload: unknown) => void;
};

function createSession(): TEmittingSession {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  return {
    getActiveDriverId: () => null,
    on: vi.fn((event: string, handler: (payload: unknown) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    }),
    off: vi.fn((event: string, handler: (payload: unknown) => void) => {
      listeners.get(event)?.delete(handler);
    }),
    emitForTest: (event: string, payload: unknown) => {
      for (const handler of listeners.get(event) ?? []) handler(payload);
    },
  } as unknown as TEmittingSession;
}

describe('protocol session-event delivery policy (ARCH-020/ARCH-028)', () => {
  it('mechanically matches every surface classification to an actual subscription', () => {
    const session = createSession();
    const { cleanup } = createWsHandler({
      session,
      deliver: createOutboundDelivery(vi.fn(), vi.fn()),
    });
    const classifiedForSubscription = Object.entries(PROTOCOL_SESSION_EVENT_CLASSIFICATION)
      .filter(([, classification]) => classification !== 'non-surface')
      .map(([event]) => event)
      .sort();
    const onCalls = vi.mocked(session.on).mock.calls;
    expect(onCalls.map(([event]) => event).sort()).toEqual(classifiedForSubscription);

    cleanup();
    const offCalls = vi.mocked(session.off).mock.calls;
    expect(offCalls.map(([event]) => event).sort()).toEqual(classifiedForSubscription);
    for (const [event, handler] of onCalls) {
      expect(offCalls).toContainEqual([event, handler]);
    }
  });

  it('forwards plan, context refresh, and branch events as typed protocol frames', () => {
    const session = createSession();
    const sent: TServerMessage[] = [];
    createWsHandler({
      session,
      deliver: createOutboundDelivery((message) => sent.push(message), vi.fn()),
    });

    session.emitForTest('plan_event', { type: 'plan_created', plan: { id: 'plan-1' } });
    session.emitForTest('context_file_refreshed', { filePath: '/repo/AGENTS.md' });
    session.emitForTest('branch_event', {
      kind: 'branch_switched',
      checkpointId: 'turn-0002',
      branchId: 'branch-2',
    });

    expect(sent.map((message) => message.type)).toEqual([
      'plan_event',
      'context_file_refreshed',
      'branch_event',
    ]);
  });

  it('isolates a carrier send failure and reports its owning session event', () => {
    const session = createSession();
    const failures: Array<{ message: string; event: string }> = [];
    createWsHandler({
      session,
      deliver: createOutboundDelivery(
        () => {
          throw new Error('socket closed');
        },
        (error, event) => {
          failures.push({ message: error.message, event });
          throw new Error('diagnostic callback failed');
        },
      ),
    });

    expect(() =>
      session.emitForTest('branch_event', {
        kind: 'checkpoint_created',
        checkpointId: 'turn-0001',
        branchId: 'main',
      }),
    ).not.toThrow();
    expect(failures).toEqual([{ message: 'socket closed', event: 'branch_event' }]);
  });
});
