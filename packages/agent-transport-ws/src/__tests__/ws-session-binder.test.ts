/**
 * #3189: with a session binder, each WebSocket connection is bound to a session of its own. One
 * connection's switch — and every event after it — stays on that connection, and the binding is
 * released when the connection closes. Without a binder every connection shares the attached session.
 */

import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WsTransport } from '../ws-transport-configurable.js';

import type { IWsTransportConfig } from '../ws-transport-config.js';
import type {
  IInteractiveSession,
  ISessionBinder,
  ISessionBinding,
  ISessionDirectory,
  TSessionBindingRole,
} from '@robota-sdk/agent-interface-session';
import type { IProtocolSession, TServerMessage } from '@robota-sdk/agent-transport';

type TListener = (...args: unknown[]) => void;

interface IEmittingSession extends IInteractiveSession {
  emit(event: string, payload?: unknown): void;
  listenerCount(): number;
}

function emittingSession(label: string): IEmittingSession {
  const listeners = new Map<string, Set<TListener>>();
  const session = createTestInteractiveSession({
    getMessages: () => [{ role: 'user', content: label }] as never,
    getExecutionWorkspaceSnapshot: () => ({ entries: [] }) as never,
    on: ((event: string, handler: TListener) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    }) as IInteractiveSession['on'],
    off: ((event: string, handler: TListener) => {
      listeners.get(event)?.delete(handler);
    }) as IInteractiveSession['off'],
  });
  return Object.assign(session, {
    emit: (event: string, payload?: unknown) =>
      listeners.get(event)?.forEach((handler) => handler(payload)),
    listenerCount: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  });
}

interface IFakeBinding extends ISessionBinding<IProtocolSession> {
  readonly session: IEmittingSession;
  readonly role: TSessionBindingRole;
  readonly release: ReturnType<typeof vi.fn>;
  /** Listeners on the session when `release` ran: the handler must have unsubscribed first. */
  listenersAtRelease?: number;
}

/** A binder like the host's: its own session per connection, and a switch that moves only that one. */
function fakeBinder(overrides: Partial<ISessionDirectory> = {}): {
  binder: ISessionBinder<IProtocolSession>;
  bindings: IFakeBinding[];
} {
  const bindings: IFakeBinding[] = [];
  const binder: ISessionBinder<IProtocolSession> = {
    bind: (role) => {
      const session = emittingSession(`connection-${bindings.length + 1}`);
      const directory: ISessionDirectory = {
        listSessions: () => ({ currentSessionId: 's', sessions: [], unreadableSessionIds: [] }),
        switchSession: async (sessionId) => session.emit('session_switched', { sessionId }),
        newSession: async () => session.emit('session_switched', { sessionId: 'new' }),
        ...overrides,
      };
      const binding: IFakeBinding = {
        session,
        directory,
        role,
        release: vi.fn(() => {
          binding.listenersAtRelease = session.listenerCount();
        }),
      };
      bindings.push(binding);
      return binding;
    },
  };
  return { binder, bindings };
}

const started: WsTransport[] = [];
afterEach(async () => {
  while (started.length) await started.pop()!.stop();
});

async function startTransport(
  config: IWsTransportConfig,
  attached: IProtocolSession = emittingSession('attached'),
): Promise<WsTransport> {
  const transport = new WsTransport({
    port: 17760,
    maxRetries: 30,
    open: true,
    openReason: 'session-binder regression test',
    ...config,
  });
  transport.attach(attached);
  await transport.start();
  started.push(transport);
  return transport;
}

interface IClient {
  ws: WebSocket;
  received: TServerMessage[];
  send(message: object): void;
  close(): Promise<void>;
}

async function connect(transport: WsTransport): Promise<IClient> {
  const ws = new WebSocket(`ws://127.0.0.1:${transport.boundPort}`);
  const received: TServerMessage[] = [];
  ws.on('message', (data) => received.push(JSON.parse(String(data)) as TServerMessage));
  await new Promise<void>((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  // The connection's initial frames arrive before anything the test does.
  await vi.waitFor(() => expect(received.some((m) => m.type === 'messages')).toBe(true));
  return {
    ws,
    received,
    send: (message) => ws.send(JSON.stringify(message)),
    close: async () => {
      const closed = new Promise<void>((resolve) => ws.once('close', () => resolve()));
      ws.close();
      await closed;
    },
  };
}

const ofType = <T extends TServerMessage['type']>(
  client: IClient,
  type: T,
): Array<Extract<TServerMessage, { type: T }>> =>
  client.received.filter((m): m is Extract<TServerMessage, { type: T }> => m.type === type);

/** Frames already in flight have landed: a round trip on the same socket answers after them. */
async function settle(client: IClient, requestId: string): Promise<void> {
  client.send({ type: 'list-sessions', requestId });
  await vi.waitFor(() =>
    expect(client.received.some((m) => 'requestId' in m && m.requestId === requestId)).toBe(true),
  );
}

describe('WsTransport session binder (#3189)', () => {
  it('binds each connection to its own session and keeps a switch on the connection that made it', async () => {
    const { binder, bindings } = fakeBinder();
    const transport = await startTransport({ sessionBinder: binder });
    const a = await connect(transport);
    const b = await connect(transport);

    expect(bindings.map((binding) => binding.role)).toEqual(['drive', 'drive']);
    expect(ofType(a, 'messages')[0]?.messages).toEqual([{ role: 'user', content: 'connection-1' }]);
    expect(ofType(b, 'messages')[0]?.messages).toEqual([{ role: 'user', content: 'connection-2' }]);

    a.send({ type: 'switch-session', sessionId: 'session-2', requestId: 'switch-1' });
    await vi.waitFor(() =>
      expect(ofType(a, 'session_switched')).toEqual([
        { type: 'session_switched', event: { sessionId: 'session-2' } },
      ]),
    );
    bindings[0]!.session.emit('text_delta', 'only for a');
    await vi.waitFor(() =>
      expect(ofType(a, 'text_delta')).toEqual([{ type: 'text_delta', delta: 'only for a' }]),
    );

    await settle(b, 'b-settled');
    expect(ofType(b, 'session_switched')).toEqual([]);
    expect(ofType(b, 'text_delta')).toEqual([]);

    await a.close();
    await b.close();
  });

  it('releases the binding when its connection closes, after the handler unsubscribed', async () => {
    const { binder, bindings } = fakeBinder();
    const transport = await startTransport({ sessionBinder: binder });
    const a = await connect(transport);
    const b = await connect(transport);

    await a.close();
    await vi.waitFor(() => expect(bindings[0]!.release).toHaveBeenCalledTimes(1));
    expect(bindings[0]!.listenersAtRelease).toBe(0);
    expect(bindings[1]!.release).not.toHaveBeenCalled();

    await b.close();
    await vi.waitFor(() => expect(bindings[1]!.release).toHaveBeenCalledTimes(1));
  });

  it('answers a refusal from the binding directory with session_change_failed and the requestId', async () => {
    const { binder } = fakeBinder({
      switchSession: async () => {
        throw Object.assign(new Error('Answer the pending prompt first.'), {
          name: 'SessionChangeRefusal',
          code: 'prompt_pending',
        });
      },
    });
    const transport = await startTransport({ sessionBinder: binder });
    const a = await connect(transport);

    a.send({ type: 'switch-session', sessionId: 'session-2', requestId: 'switch-1' });
    await vi.waitFor(() =>
      expect(ofType(a, 'session_change_failed')).toEqual([
        {
          type: 'session_change_failed',
          code: 'prompt_pending',
          message: 'Answer the pending prompt first.',
          requestId: 'switch-1',
        },
      ]),
    );
    await a.close();
  });

  it('closes the connection before any session data when the host will not bind it', async () => {
    const binder: ISessionBinder<IProtocolSession> = {
      bind: () => {
        throw new Error('host is stopping');
      },
    };
    const transport = await startTransport({ sessionBinder: binder });
    const ws = new WebSocket(`ws://127.0.0.1:${transport.boundPort}`);
    const received: string[] = [];
    ws.on('message', (data) => received.push(String(data)));
    const code = await new Promise<number>((resolve) => ws.once('close', resolve));
    expect(code).toBe(1013);
    expect(received).toEqual([]);
  });

  it('without a binder, every connection shares the attached session and hears its switch', async () => {
    const attached = emittingSession('attached');
    const transport = await startTransport({}, attached);
    const a = await connect(transport);
    const b = await connect(transport);

    expect(ofType(a, 'messages')[0]?.messages).toEqual([{ role: 'user', content: 'attached' }]);
    attached.emit('session_switched', { sessionId: 'session-2' });
    for (const client of [a, b]) {
      await vi.waitFor(() =>
        expect(ofType(client, 'session_switched')).toEqual([
          { type: 'session_switched', event: { sessionId: 'session-2' } },
        ]),
      );
    }
    // No directory either: a switch is answered, not dropped.
    a.send({ type: 'switch-session', sessionId: 'session-3', requestId: 'switch-1' });
    await vi.waitFor(() =>
      expect(ofType(a, 'session_change_failed')).toEqual([
        {
          type: 'session_change_failed',
          code: 'not_available',
          message: 'Sessions cannot be switched on this host.',
          requestId: 'switch-1',
        },
      ]),
    );
    await a.close();
    await b.close();
  });
});
