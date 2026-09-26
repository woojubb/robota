/**
 * #3189 step 3b: an attached client reads a workspace entry's detail, stops a waiting self-paced
 * loop, and follows status changes another client made.
 */

import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';
import { describe, expect, it, vi } from 'vitest';

import { isObserverMessageType as isObserverMessageTypeFromClient } from '../client.js';
import { isObserverMessageType } from '../index.js';
import { createOutboundDelivery } from '../outbound-delivery.js';
import { createSessionMessageHandler } from '../session-message-handler.js';

import type { TClientMessage, TServerMessage } from '../wire-messages.js';
import type { IExecutionDetailPage } from '@robota-sdk/agent-interface-execution';
import type {
  IInteractiveSession,
  ISessionStatusSnapshot,
} from '@robota-sdk/agent-interface-session';

type TListener = (...args: unknown[]) => void;

const page: IExecutionDetailPage = {
  entryId: 'main',
  cursor: { offset: 20 },
  nextCursor: { offset: 40 },
  records: [{ id: 'main:20:0', kind: 'message', text: 'hello' }],
};

function createSession(overrides: Partial<IInteractiveSession> = {}): IInteractiveSession & {
  emit: (event: string, ...args: unknown[]) => void;
} {
  const listeners = new Map<string, Set<TListener>>();
  const session = createTestInteractiveSession({
    readExecutionWorkspaceDetail: vi.fn().mockResolvedValue(page),
    stopWaitingSelfPacedLoop: vi.fn().mockResolvedValue({ kind: 'stopped', loopId: 'loop-a' }),
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
    emit: (event: string, ...args: unknown[]) => {
      listeners.get(event)?.forEach((handler) => handler(...args));
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

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('read-execution-detail', () => {
  it('answers with the page the session read, under the request id', async () => {
    const session = createSession();
    const client = attach(session);
    client.send({
      type: 'read-execution-detail',
      requestId: 'detail-1',
      entryId: 'main',
      cursor: { offset: 20 },
    });
    await flush();
    expect(session.readExecutionWorkspaceDetail).toHaveBeenCalledExactlyOnceWith('main', {
      offset: 20,
    });
    expect(client.sent).toEqual([{ type: 'execution_detail', requestId: 'detail-1', page }]);
  });

  it('answers with an error reply when the session cannot read the entry', async () => {
    const session = createSession({
      readExecutionWorkspaceDetail: vi.fn().mockRejectedValue(new Error('Unknown entry: gone')),
    });
    const client = attach(session);
    client.send({ type: 'read-execution-detail', requestId: 'detail-2', entryId: 'gone' });
    await flush();
    expect(client.sent).toEqual([
      { type: 'execution_detail_error', requestId: 'detail-2', message: 'Unknown entry: gone' },
    ]);
  });
});

describe('stop-waiting-loop', () => {
  it('answers with the outcome the session reports', async () => {
    const session = createSession();
    const client = attach(session);
    client.send({ type: 'stop-waiting-loop', requestId: 'loop-1' });
    await flush();
    expect(session.stopWaitingSelfPacedLoop).toHaveBeenCalledOnce();
    expect(client.sent).toEqual([
      {
        type: 'waiting_loop_stop',
        requestId: 'loop-1',
        outcome: { kind: 'stopped', loopId: 'loop-a' },
      },
    ]);
  });

  it('reports a session that throws as a failed stop', async () => {
    const session = createSession({
      stopWaitingSelfPacedLoop: vi.fn().mockRejectedValue(new Error('store unavailable')),
    });
    const client = attach(session);
    client.send({ type: 'stop-waiting-loop', requestId: 'loop-2' });
    await flush();
    expect(client.sent).toEqual([
      {
        type: 'waiting_loop_stop',
        requestId: 'loop-2',
        outcome: { kind: 'failed', message: 'store unavailable' },
      },
    ]);
  });
});

describe('observers', () => {
  it('may read an entry detail but may not stop a loop', async () => {
    const session = createSession();
    const observer = attach(session, 'observe');
    observer.send({ type: 'read-execution-detail', requestId: 'detail-3', entryId: 'main' });
    observer.send({ type: 'stop-waiting-loop', requestId: 'loop-3' });
    await flush();
    expect(session.stopWaitingSelfPacedLoop).not.toHaveBeenCalled();
    expect(observer.sent).toEqual([
      { type: 'protocol_error', message: 'Not permitted for an observer: stop-waiting-loop' },
      { type: 'execution_detail', requestId: 'detail-3', page },
    ]);
  });

  it('share one allowlist between the host and both package entries', () => {
    expect(isObserverMessageTypeFromClient).toBe(isObserverMessageType);
    expect(isObserverMessageType('read-execution-detail')).toBe(true);
    expect(isObserverMessageType('get-status')).toBe(true);
    expect(isObserverMessageType('stop-waiting-loop')).toBe(false);
    expect(isObserverMessageType('get-prompts')).toBe(false);
    expect(isObserverMessageType('submit')).toBe(false);
    expect(isObserverMessageType('not-a-message')).toBe(false);
  });
});

describe('status_changed', () => {
  it('pushes the new status to every attached client as session_status', () => {
    const session = createSession();
    const drive = attach(session);
    const observer = attach(session, 'observe');
    const status: ISessionStatusSnapshot = {
      ...session.getStatusSnapshot(),
      permissionMode: 'plan',
    };
    session.emit('status_changed', status);
    expect(drive.sent).toEqual([{ type: 'session_status', status }]);
    expect(observer.sent).toEqual([{ type: 'session_status', status }]);
  });
});
