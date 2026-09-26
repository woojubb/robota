/**
 * #3189: clients list the host's sessions, start a new one and switch to another over the wire. The
 * host owns the directory; the protocol correlates the listing and carries a refusal's code and reason.
 */

import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';
import { describe, expect, it, vi } from 'vitest';

import { createOutboundDelivery } from '../outbound-delivery.js';
import { createSessionMessageHandler } from '../session-message-handler.js';

import type { TClientMessage, TServerMessage } from '../wire-messages.js';
import type {
  ISessionDirectory,
  ISessionListing,
  TSessionChangeRefusalCode,
} from '@robota-sdk/agent-interface-session';

const listing: ISessionListing = {
  currentSessionId: 'session-1',
  sessions: [
    {
      id: 'session-1',
      cwd: '/repo',
      updatedAt: '2026-09-26T00:00:00.000Z',
      messageCount: 2,
      preview: 'hello',
    },
  ],
  unreadableSessionIds: ['session-broken'],
};

function createDirectory(overrides: Partial<ISessionDirectory> = {}): ISessionDirectory {
  return {
    listSessions: vi.fn(() => listing),
    switchSession: vi.fn(async () => undefined),
    newSession: vi.fn(async () => undefined),
    ...overrides,
  };
}

function attach(options: { directory?: ISessionDirectory; role?: 'drive' | 'observe' }): {
  sent: TServerMessage[];
  send: (message: TClientMessage) => void;
} {
  const sent: TServerMessage[] = [];
  const { onMessage } = createSessionMessageHandler({
    session: createTestInteractiveSession(),
    deliver: createOutboundDelivery((message) => sent.push(message), vi.fn()),
    ...(options.directory ? { sessionDirectory: options.directory } : {}),
    ...(options.role ? { role: options.role } : {}),
  });
  return { sent, send: (message) => onMessage(JSON.stringify(message)) };
}

/** The shape `SessionChangeRefusal` (agent-framework) has; this package cannot import the class. */
function refusal(code: TSessionChangeRefusalCode, message: string): Error {
  return Object.assign(new Error(message), { name: 'SessionChangeRefusal', code });
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('session directory messages (#3189)', () => {
  it('answers list-sessions with the host listing, correlated by requestId', () => {
    const client = attach({ directory: createDirectory() });
    client.send({ type: 'list-sessions', requestId: 'r1' });
    expect(client.sent).toEqual([{ type: 'sessions', requestId: 'r1', listing }]);
  });

  it('answers not_available when the host has no session directory', () => {
    const client = attach({});
    client.send({ type: 'list-sessions', requestId: 'r1' });
    expect(client.sent).toEqual([
      {
        type: 'sessions_error',
        requestId: 'r1',
        code: 'not_available',
        message: 'Session listing is not available on this host.',
      },
    ]);
  });

  it('answers list_failed with the reason when the listing throws', () => {
    const directory = createDirectory({
      listSessions: vi.fn(() => {
        throw new Error('session store unreadable');
      }),
    });
    const client = attach({ directory });
    client.send({ type: 'list-sessions', requestId: 'r1' });
    expect(client.sent).toEqual([
      {
        type: 'sessions_error',
        requestId: 'r1',
        code: 'list_failed',
        message: 'session store unreadable',
      },
    ]);
  });

  it('switches by id and answers nothing itself — session_switched from its session is the signal', async () => {
    const directory = createDirectory();
    const client = attach({ directory });
    client.send({ type: 'switch-session', sessionId: 'session-2', requestId: 'r2' });
    await flush();
    expect(directory.switchSession).toHaveBeenCalledExactlyOnceWith('session-2');
    expect(client.sent).toEqual([]);
  });

  it('delivers a declared refusal as session_change_failed with its code and the requestId', async () => {
    const directory = createDirectory({
      switchSession: vi.fn(async () => {
        throw refusal('prompt_pending', 'Answer the pending prompt first.');
      }),
    });
    const client = attach({ directory });
    client.send({ type: 'switch-session', sessionId: 'session-2', requestId: 'r2' });
    await flush();
    expect(client.sent).toEqual([
      {
        type: 'session_change_failed',
        code: 'prompt_pending',
        message: 'Answer the pending prompt first.',
        requestId: 'r2',
      },
    ]);
  });

  it('delivers any other error as code failed with its message, and omits an absent requestId', async () => {
    const directory = createDirectory({
      switchSession: vi.fn(async () => {
        throw new Error('disk full');
      }),
    });
    const client = attach({ directory });
    client.send({ type: 'switch-session', sessionId: 'session-2' });
    await flush();
    expect(client.sent).toEqual([
      { type: 'session_change_failed', code: 'failed', message: 'disk full' },
    ]);
  });

  it('starts a new session, and reports a refusal the same way', async () => {
    const directory = createDirectory();
    const client = attach({ directory });
    client.send({ type: 'new-session' });
    await flush();
    expect(directory.newSession).toHaveBeenCalledTimes(1);
    expect(client.sent).toEqual([]);

    vi.mocked(directory.newSession).mockRejectedValueOnce(
      refusal('limit', 'Four sessions are live already.'),
    );
    client.send({ type: 'new-session', requestId: 'r3' });
    await flush();
    expect(client.sent).toEqual([
      {
        type: 'session_change_failed',
        code: 'limit',
        message: 'Four sessions are live already.',
        requestId: 'r3',
      },
    ]);
  });

  it('answers not_available to a switch or new session on a host without a directory', () => {
    const client = attach({});
    client.send({ type: 'switch-session', sessionId: 'session-2', requestId: 'r4' });
    client.send({ type: 'new-session' });
    const message = 'Sessions cannot be switched on this host.';
    expect(client.sent).toEqual([
      { type: 'session_change_failed', code: 'not_available', message, requestId: 'r4' },
      { type: 'session_change_failed', code: 'not_available', message },
    ]);
  });

  it('lets an observer list sessions but never start or switch one', async () => {
    const directory = createDirectory();
    const observer = attach({ directory, role: 'observe' });
    observer.send({ type: 'list-sessions', requestId: 'r1' });
    observer.send({ type: 'switch-session', sessionId: 'session-2' });
    observer.send({ type: 'new-session' });
    await flush();
    expect(observer.sent).toEqual([
      { type: 'sessions', requestId: 'r1', listing },
      { type: 'protocol_error', message: 'Not permitted for an observer: switch-session' },
      { type: 'protocol_error', message: 'Not permitted for an observer: new-session' },
    ]);
    expect(directory.switchSession).not.toHaveBeenCalled();
    expect(directory.newSession).not.toHaveBeenCalled();
  });
});
