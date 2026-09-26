/**
 * #3189: the host hands its session directory to the WebSocket carrier once, and every connection can
 * list, start and switch the host's sessions through it.
 */

import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createWsTransport } from '../ws-transport.js';
import { WsTransport } from '../ws-transport-configurable.js';

import type { ISessionDirectory, ISessionListing } from '@robota-sdk/agent-interface-session';
import type { TServerMessage } from '@robota-sdk/agent-transport';

const listing: ISessionListing = {
  currentSessionId: 'session-1',
  sessions: [],
  unreadableSessionIds: [],
};

function createDirectory(): ISessionDirectory {
  return {
    listSessions: vi.fn(() => listing),
    switchSession: vi.fn(async () => undefined),
    newSession: vi.fn(async () => undefined),
  };
}

function mockSession(): ReturnType<typeof createTestInteractiveSession> {
  return Object.assign(createTestInteractiveSession(), {
    getMessages: vi.fn().mockReturnValue([]),
    getExecutionWorkspaceSnapshot: vi.fn().mockReturnValue({ entries: [] }),
    on: vi.fn(),
    off: vi.fn(),
  });
}

const started: WsTransport[] = [];
afterEach(async () => {
  while (started.length) await started.pop()!.stop();
});

describe('WsTransport session directory (#3189)', () => {
  it('lets every connection list and switch the host sessions', async () => {
    const directory = createDirectory();
    const transport = new WsTransport({
      port: 17720,
      maxRetries: 30,
      open: true,
      openReason: 'session-directory regression test',
      sessionDirectory: directory,
    });
    transport.attach(mockSession());
    await transport.start();
    started.push(transport);

    const ws = new WebSocket(`ws://127.0.0.1:${transport.boundPort}`);
    const received: TServerMessage[] = [];
    ws.on('message', (data) => received.push(JSON.parse(String(data)) as TServerMessage));
    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    ws.send(JSON.stringify({ type: 'list-sessions', requestId: 'r1' }));
    ws.send(JSON.stringify({ type: 'switch-session', sessionId: 'session-2' }));
    await vi.waitFor(() => expect(directory.switchSession).toHaveBeenCalledWith('session-2'));
    await vi.waitFor(() =>
      expect(received).toContainEqual({ type: 'sessions', requestId: 'r1', listing }),
    );

    const closed = new Promise<void>((resolve) => ws.once('close', () => resolve()));
    ws.close();
    await closed;
  });

  it('passes the directory through the adapter form as well', async () => {
    const directory = createDirectory();
    const sent: TServerMessage[] = [];
    const transport = createWsTransport({
      send: (message) => sent.push(message),
      sessionDirectory: directory,
    });
    transport.attach(mockSession());
    await transport.start();

    transport.onMessage?.(JSON.stringify({ type: 'list-sessions', requestId: 'r1' }));
    transport.onMessage?.(JSON.stringify({ type: 'new-session' }));

    expect(sent).toEqual([{ type: 'sessions', requestId: 'r1', listing }]);
    await vi.waitFor(() => expect(directory.newSession).toHaveBeenCalledTimes(1));
    await transport.stop();
  });
});
