/**
 * The read-only observer listener `--serve --observer-port` opens beside the driver listener, over
 * real loopback sockets: the transport registry the CLI builds, a session double that records what
 * reaches it, no model and no provider. It admits only its own token, grants `observe` and nothing
 * more, is no `/transport` entry, and binds exactly the port it was given.
 */
import { request } from 'node:http';
import { createServer, type Server } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';

import {
  cleanupTestProductRuntimes,
  createTestProductRuntime,
} from '../../__tests__/helpers/product-runtime.js';
import { createCliUsageTransportRegistry } from '../../usage/usage-transport-registry.js';

import type {
  IInteractiveSession,
  IInteractiveSessionStore,
} from '@robota-sdk/agent-interface/session';

const OBSERVER_TOKEN = 'o'.repeat(40);
const WRONG_TOKEN = 'w'.repeat(40);
const FRAME_TIMEOUT_MS = 5_000;

type TFrame = { readonly type: string; readonly [key: string]: unknown };

interface IClient {
  readonly socket: WebSocket;
  /** Every frame received so far, in order. */
  readonly frames: TFrame[];
  /** The close the server ended the connection with. */
  readonly closed: Promise<{ readonly code: number; readonly reason: string }>;
}

const sockets: WebSocket[] = [];
const blockers: Server[] = [];
const registries: Array<{ stopAll(): Promise<unknown> }> = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await Promise.all(registries.splice(0).map((registry) => registry.stopAll()));
  await Promise.all(
    blockers.splice(0).map((blocker) => new Promise<void>((done) => blocker.close(() => done()))),
  );
  vi.unstubAllEnvs();
  cleanupTestProductRuntimes();
});

/** Several loopback ports free right now and different from each other. */
function freePorts(count: number): Promise<number[]> {
  const probes = Array.from({ length: count }, () => createServer());
  return Promise.all(
    probes.map(
      (probe) =>
        new Promise<number>((resolve, reject) => {
          probe.once('error', reject);
          probe.listen(0, '127.0.0.1', () => {
            const address = probe.address();
            resolve(typeof address === 'object' && address !== null ? address.port : 0);
          });
        }),
    ),
  ).then(async (ports) => {
    await Promise.all(
      probes.map((probe) => new Promise<void>((done) => probe.close(() => done()))),
    );
    return ports;
  });
}

/** Whether this process can bind the port now, which is whether no listener holds it. */
function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}

/** A port whose next neighbour is free too, so a listener that walks to it can be told from one that does not. */
async function portWithFreeNeighbour(): Promise<number> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const [port] = await freePorts(1);
    if (port !== undefined && (await canListen(port + 1))) return port;
  }
  throw new Error('No loopback port with a free neighbour was found.');
}

/** The slice of a session the connection setup and the protocol handler read, recording what they call. */
function createSessionDouble() {
  type TListener = (...args: unknown[]) => void;
  const listeners = new Map<string, Set<TListener>>();
  const double = {
    on: vi.fn((event: string, listener: TListener) => {
      const registered = listeners.get(event) ?? new Set<TListener>();
      registered.add(listener);
      listeners.set(event, registered);
    }),
    off: vi.fn((event: string, listener: TListener) => {
      listeners.get(event)?.delete(listener);
    }),
    getActiveDriverId: vi.fn(() => null),
    getMessages: vi.fn(() => []),
    getExecutionWorkspaceSnapshot: vi.fn(() => ({
      sessionId: 'session-double',
      updatedAt: '2026-01-01T00:00:00.000Z',
      entries: [],
    })),
    getPendingPrompt: vi.fn(() => null),
    getPendingCount: vi.fn(() => 0),
    submit: vi.fn(async (_prompt: string) => undefined),
    executeCommand: vi.fn(async () => undefined),
    abort: vi.fn(),
    cancelQueue: vi.fn(),
  };
  return {
    session: double as unknown as IInteractiveSession,
    double,
    emit: (event: string, ...args: unknown[]): void => {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
    subscribedEvents: (): string[] => double.on.mock.calls.map(([event]) => event),
  };
}

/** The CLI's registry with the observer listener on, its session bound, nothing started yet. */
async function observerRuntime(observerPort?: number) {
  vi.stubEnv('PRODUCT_WS_TOKEN', undefined);
  const [driverPort, freeObserverPort] = await freePorts(2);
  const port = observerPort ?? freeObserverPort ?? 0;
  const runtime = createTestProductRuntime('test-product', {
    PRODUCT_WS_PORT: String(driverPort),
  });
  const wiring = createCliUsageTransportRegistry(
    runtime,
    {} as IInteractiveSessionStore,
    false,
    false,
    undefined,
    false,
    undefined,
    undefined,
    { port, token: OBSERVER_TOKEN },
  );
  const { observerTransport } = wiring;
  if (observerTransport === undefined) throw new Error('The observer transport was not built.');
  const sessionDouble = createSessionDouble();
  wiring.bindTransports(sessionDouble.session);
  registries.push(wiring.registry);
  return { ...wiring, observerTransport, observerPort: port, driverPort, ...sessionDouble };
}

/** Opens a socket and records its frames; resolves once the upgrade has happened. */
function connect(port: number, query = ''): Promise<IClient> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/${query}`);
  sockets.push(socket);
  const frames: TFrame[] = [];
  socket.on('message', (data) => frames.push(JSON.parse(String(data)) as TFrame));
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    socket.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
  });
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve({ socket, frames, closed }));
    socket.on('error', reject);
  });
}

function waitForFrame(client: IClient, matches: (frame: TFrame) => boolean): Promise<TFrame> {
  return new Promise((resolve, reject) => {
    const found = client.frames.find(matches);
    if (found !== undefined) {
      resolve(found);
      return;
    }
    const finish = (): void => {
      clearTimeout(timer);
      client.socket.off('message', onMessage);
    };
    const timer = setTimeout(() => {
      finish();
      reject(new Error(`No matching frame arrived; received ${JSON.stringify(client.frames)}`));
    }, FRAME_TIMEOUT_MS);
    const onMessage = (): void => {
      const hit = client.frames.find(matches);
      if (hit === undefined) return;
      finish();
      resolve(hit);
    };
    client.socket.on('message', onMessage);
  });
}

const ofType = (type: string) => (frame: TFrame) => frame.type === type;

function send(client: IClient, message: object): void {
  client.socket.send(JSON.stringify(message));
}

function plainGet(port: number): Promise<{ status: number | undefined; body: string }> {
  return new Promise((resolve, reject) => {
    const sent = request({ host: '127.0.0.1', port, path: '/' }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => (body += chunk));
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    sent.on('error', reject);
    sent.end();
  });
}

describe('the observer listener in the transport registry', () => {
  it('opens its own port beside the driver listener, and the registry starts and stops it', async () => {
    const { registry, wsTransport, observerTransport, observerPort, driverPort } =
      await observerRuntime();
    expect(observerTransport.boundPort).toBeUndefined();

    await registry.startAll();

    expect(wsTransport.boundPort).toBe(driverPort);
    expect(observerTransport.boundPort).toBe(observerPort);
    expect(await plainGet(observerPort)).toEqual({ status: 400, body: 'WebSocket endpoint' });
    expect(registry.getEnabled().map((transport) => transport.name)).toEqual(['ws', 'ws-observer']);

    await registry.stopAll();
    expect(observerTransport.boundPort).toBeUndefined();
    expect(await canListen(observerPort)).toBe(true);
  });

  it('is no `/transport` entry: it is neither listed nor switchable', async () => {
    const { registry } = await observerRuntime();

    expect(registry.getAll().map((entry) => entry.transport.name)).toEqual(['ws']);
    await expect(registry.setEnabled('ws-observer', false)).rejects.toMatchObject({
      code: 'not-configurable',
    });
  });

  it('is built only when asked for', async () => {
    vi.stubEnv('PRODUCT_WS_TOKEN', undefined);
    const wiring = createCliUsageTransportRegistry(
      createTestProductRuntime('test-product'),
      {} as IInteractiveSessionStore,
      false,
      false,
    );
    wiring.bindTransports(createSessionDouble().session);

    expect(wiring.observerTransport).toBeUndefined();
    expect(wiring.registry.getEnabled().map((transport) => transport.name)).toEqual(['ws']);
  });
});

describe('who the observer listener admits', () => {
  it.each([
    ['no token', ''],
    ['a wrong token', `?token=${WRONG_TOKEN}`],
  ])('closes %s before any frame', async (_name, query) => {
    const { registry, observerPort } = await observerRuntime();
    await registry.startAll();

    const client = await connect(observerPort, query);

    expect(await client.closed).toEqual({ code: 1008, reason: 'unauthorized' });
    expect(client.frames).toEqual([]);
  });

  it('refuses the driver listener token, which would let a driver watch without the observer token', async () => {
    const { registry, wsTransport, observerPort } = await observerRuntime();
    await registry.startAll();
    const driverToken = wsTransport.resolvedToken;
    expect(driverToken).toMatch(/\S{32,}/);

    const client = await connect(observerPort, `?token=${driverToken}`);

    expect(await client.closed).toEqual({ code: 1008, reason: 'unauthorized' });
    expect(client.frames).toEqual([]);
  });

  it('keeps the driver listener closed to the observer token', async () => {
    const { registry, driverPort } = await observerRuntime();
    await registry.startAll();

    const client = await connect(driverPort, `?token=${OBSERVER_TOKEN}`);

    expect(await client.closed).toEqual({ code: 1008, reason: 'unauthorized' });
    expect(client.frames).toEqual([]);
  });

  it('serves the session to a client with the right token, as an observer', async () => {
    const { registry, observerPort, emit, double, subscribedEvents } = await observerRuntime();
    await registry.startAll();

    const client = await connect(observerPort, `?token=${OBSERVER_TOKEN}`);
    await waitForFrame(client, ofType('messages'));
    await waitForFrame(client, ofType('execution_workspace_event'));
    expect(double.getMessages).toHaveBeenCalled();

    emit('text_delta', 'hello');
    expect(await waitForFrame(client, ofType('text_delta'))).toMatchObject({
      type: 'text_delta',
      delta: 'hello',
    });

    send(client, { type: 'get-surface-role' });
    expect(await waitForFrame(client, ofType('surface_role'))).toEqual({
      type: 'surface_role',
      role: 'observe',
    });
    // An observer never receives prompts, so a session with only observers attached fails a
    // prompt closed instead of parking it where nobody may answer.
    expect(subscribedEvents()).toContain('text_delta');
    expect(subscribedEvents()).not.toContain('permission_request');
    expect(subscribedEvents()).not.toContain('ask_request');
  });

  it('refuses a client that asks for the driver role, and accepts one that asks for less', async () => {
    const { registry, observerPort } = await observerRuntime();
    await registry.startAll();

    const driving = await connect(observerPort, `?token=${OBSERVER_TOKEN}&role=drive`);
    expect(await driving.closed).toEqual({ code: 1008, reason: 'role-not-granted' });
    expect(driving.frames).toEqual([]);

    const observing = await connect(observerPort, `?token=${OBSERVER_TOKEN}&role=observe`);
    await waitForFrame(observing, ofType('messages'));
    send(observing, { type: 'get-surface-role' });
    expect(await waitForFrame(observing, ofType('surface_role'))).toEqual({
      type: 'surface_role',
      role: 'observe',
    });
  });
});

describe('what an observer may not do', () => {
  it.each([
    ['submit', { type: 'submit', prompt: 'x' }, 'submit'],
    ['command', { type: 'command', name: 'help' }, 'executeCommand'],
    ['abort', { type: 'abort' }, 'abort'],
    ['cancel-queue', { type: 'cancel-queue' }, 'cancelQueue'],
  ] as const)(
    'answers %s with a protocol error and never reaches the session',
    async (type, message, method) => {
      const { registry, observerPort, double } = await observerRuntime();
      await registry.startAll();
      const client = await connect(observerPort, `?token=${OBSERVER_TOKEN}`);
      await waitForFrame(client, ofType('messages'));

      send(client, message);

      expect(await waitForFrame(client, ofType('protocol_error'))).toEqual({
        type: 'protocol_error',
        message: `Not permitted for an observer: ${type}`,
      });
      expect(double[method]).not.toHaveBeenCalled();
      expect(double.submit).not.toHaveBeenCalled();
    },
  );

  it('is told apart from a driver by the same message reaching the session on the driver listener', async () => {
    const { registry, wsTransport, driverPort, double } = await observerRuntime();
    await registry.startAll();
    const client = await connect(driverPort, `?token=${wsTransport.resolvedToken}`);
    await waitForFrame(client, ofType('messages'));

    send(client, { type: 'submit', prompt: 'x' });

    expect(await waitForFrame(client, ofType('pending'))).toMatchObject({ type: 'pending' });
    expect(double.submit).toHaveBeenCalledTimes(1);
    expect(double.submit.mock.calls[0]?.[0]).toBe('x');
  });
});

describe('the port the observer listener is given', () => {
  it('is the only one it tries: a busy port fails the start and the listener does not move', async () => {
    const observerPort = await portWithFreeNeighbour();
    const { registry, wsTransport, observerTransport, driverPort } =
      await observerRuntime(observerPort);
    const blocker = createServer();
    blockers.push(blocker);
    await new Promise<void>((resolve, reject) => {
      blocker.once('error', reject);
      blocker.listen(observerPort, '127.0.0.1', resolve);
    });

    const failure: unknown = await registry.startAll().then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).toMatchObject({ name: 'TransportStartupError', transportName: 'ws-observer' });
    expect((failure as { cause?: unknown }).cause).toMatchObject({ code: 'EADDRINUSE' });
    expect(observerTransport.boundPort).toBeUndefined();
    expect(await canListen(observerPort + 1)).toBe(true);
    // The driver listener opened first and is rolled back, so a failed start leaves nothing open.
    expect(wsTransport.boundPort).toBeUndefined();
    expect(await canListen(driverPort)).toBe(true);
  });
});

describe('stopping the runtime', () => {
  it('closes the connections and frees the ports of both listeners', async () => {
    const { registry, wsTransport, observerTransport, observerPort, driverPort } =
      await observerRuntime();
    await registry.startAll();
    const observer = await connect(observerPort, `?token=${OBSERVER_TOKEN}`);
    const driver = await connect(driverPort, `?token=${wsTransport.resolvedToken}`);
    await waitForFrame(observer, ofType('messages'));
    await waitForFrame(driver, ofType('messages'));

    expect(await registry.stopAll()).toEqual({ errors: [] });

    expect((await observer.closed).code).toBe(1001);
    expect((await driver.closed).code).toBe(1001);
    expect(observerTransport.boundPort).toBeUndefined();
    expect(wsTransport.boundPort).toBeUndefined();
    expect(await canListen(observerPort)).toBe(true);
    expect(await canListen(driverPort)).toBe(true);
  });
});
