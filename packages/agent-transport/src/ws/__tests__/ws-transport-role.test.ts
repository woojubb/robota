/**
 * The host grants a listener's role and a connection may only lower it: `?role=observe` makes an
 * observer, a request for more or an unknown role is closed before any session data, and the
 * session binder is asked for the effective role.
 */

import { createTestInteractiveSession } from '@robota-sdk/agent-interface/session/testing';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createWsTransport } from '../ws-transport.js';
import { WsTransport } from '../ws-transport-configurable.js';

import type { IWsTransportConfig } from '../ws-transport-config.js';
import type {
  IInteractiveSession,
  ISessionBinder,
  ISessionBinding,
} from '@robota-sdk/agent-interface/session';
import type { IProtocolSession, TServerMessage } from '../../index';

function mockSession(): IInteractiveSession & { submit: ReturnType<typeof vi.fn> } {
  return Object.assign(createTestInteractiveSession(), {
    getMessages: vi.fn().mockReturnValue([{ role: 'user', content: 'hi' }]),
    getExecutionWorkspaceSnapshot: vi.fn().mockReturnValue({ entries: [] }),
    on: vi.fn(),
    off: vi.fn(),
    submit: vi.fn(),
  });
}

const started: WsTransport[] = [];
afterEach(async () => {
  while (started.length) await started.pop()!.stop();
});

async function startTransport(
  config: IWsTransportConfig,
  session: IProtocolSession = mockSession(),
): Promise<WsTransport> {
  const transport = new WsTransport({
    port: 17860,
    maxRetries: 30,
    open: true,
    openReason: 'surface-role regression test',
    ...config,
  });
  transport.attach(session);
  await transport.start();
  started.push(transport);
  return transport;
}

interface IClient {
  ws: WebSocket;
  received: TServerMessage[];
  closed: Promise<{ code: number; reason: string }>;
}

function open(transport: WsTransport, query = ''): IClient {
  const ws = new WebSocket(`ws://127.0.0.1:${transport.boundPort}/${query}`);
  const received: TServerMessage[] = [];
  ws.on('message', (data) => received.push(JSON.parse(String(data)) as TServerMessage));
  const closed = new Promise<{ code: number; reason: string }>((resolve) =>
    ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() })),
  );
  return { ws, received, closed };
}

async function connect(transport: WsTransport, query = ''): Promise<IClient> {
  const client = open(transport, query);
  await vi.waitFor(() => expect(client.received.some((m) => m.type === 'messages')).toBe(true));
  return client;
}

async function ask(client: IClient, message: object, type: string): Promise<TServerMessage> {
  const before = client.received.length;
  client.ws.send(JSON.stringify(message));
  await vi.waitFor(() =>
    expect(client.received.slice(before).some((m) => m.type === type)).toBe(true),
  );
  return client.received.slice(before).find((m) => m.type === type)!;
}

async function refused(transport: WsTransport, query: string, reason: string): Promise<void> {
  const client = open(transport, query);
  expect(await client.closed).toEqual({ code: 1008, reason });
  expect(client.received).toEqual([]);
}

describe('an observe listener', () => {
  it('answers an observer, serves reads and refuses a turn', async () => {
    const session = mockSession();
    const transport = await startTransport({ role: 'observe' }, session);
    const client = await connect(transport);

    expect(await ask(client, { type: 'get-surface-role' }, 'surface_role')).toMatchObject({
      role: 'observe',
    });
    await ask(client, { type: 'get-status' }, 'session_status');
    const refusal = await ask(client, { type: 'submit', prompt: 'hi' }, 'protocol_error');
    expect(refusal).toMatchObject({ message: 'Not permitted for an observer: submit' });
    expect(session.submit).not.toHaveBeenCalled();
    client.ws.close();
  });

  it('closes a connection asking for drive before any frame', async () => {
    const transport = await startTransport({ role: 'observe' });
    await refused(transport, '?role=drive', 'role-not-granted');
  });
});

describe('a default listener', () => {
  it('lets a connection ask to observe', async () => {
    const session = mockSession();
    const transport = await startTransport({}, session);
    const client = await connect(transport, '?role=observe');

    expect(await ask(client, { type: 'get-surface-role' }, 'surface_role')).toMatchObject({
      role: 'observe',
    });
    const refusal = await ask(client, { type: 'submit', prompt: 'hi' }, 'protocol_error');
    expect(refusal).toMatchObject({ message: 'Not permitted for an observer: submit' });
    expect(session.submit).not.toHaveBeenCalled();
    client.ws.close();
  });

  it('keeps drive when no role is asked', async () => {
    const transport = await startTransport({});
    const client = await connect(transport);
    expect(await ask(client, { type: 'get-surface-role' }, 'surface_role')).toMatchObject({
      role: 'drive',
    });
    client.ws.close();
  });

  it('closes an unknown or empty role before any frame', async () => {
    const transport = await startTransport({});
    await refused(transport, '?role=admin', 'unsupported-role');
    await refused(transport, '?role=', 'unsupported-role');
  });
});

describe('the session binder', () => {
  function recordingBinder(): {
    binder: ISessionBinder<IProtocolSession>;
    bindings: { role: string; release: ReturnType<typeof vi.fn> }[];
  } {
    const bindings: { role: string; release: ReturnType<typeof vi.fn> }[] = [];
    const binder: ISessionBinder<IProtocolSession> = {
      bind: (role) => {
        const release = vi.fn();
        bindings.push({ role, release });
        return {
          session: mockSession(),
          directory: {
            listSessions: () => ({ currentSessionId: 's', sessions: [], unreadableSessionIds: [] }),
            switchSession: async () => undefined,
            newSession: async () => undefined,
            renameSession: async () => undefined,
            deleteSession: async () => undefined,
          },
          release,
        } as ISessionBinding<IProtocolSession>;
      },
    };
    return { binder, bindings };
  }

  it('binds the effective role, never binds a refused request, and releases on close', async () => {
    const { binder, bindings } = recordingBinder();
    const transport = await startTransport({ sessionBinder: binder });

    const driver = await connect(transport);
    const observer = await connect(transport, '?role=observe');
    expect(bindings.map((b) => b.role)).toEqual(['drive', 'observe']);

    await refused(transport, '?role=admin', 'unsupported-role');
    expect(bindings).toHaveLength(2);

    const closed = new Promise<void>((resolve) => observer.ws.once('close', () => resolve()));
    observer.ws.close();
    await closed;
    await vi.waitFor(() => expect(bindings[1]!.release).toHaveBeenCalledTimes(1));
    expect(bindings[0]!.release).not.toHaveBeenCalled();
    driver.ws.close();
  });
});

describe('the simple adapter', () => {
  it('answers get-surface-role with the granted role', async () => {
    const sent: TServerMessage[] = [];
    const adapter = createWsTransport({ send: (m) => void sent.push(m), role: 'observe' });
    adapter.attach(mockSession());
    await adapter.start();

    adapter.onMessage!(JSON.stringify({ type: 'get-surface-role' }));
    await vi.waitFor(() =>
      expect(sent.find((m) => m.type === 'surface_role')).toMatchObject({ role: 'observe' }),
    );
    await adapter.stop();
  });
});
