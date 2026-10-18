import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';

const mock = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  waitForClose: vi.fn(),
  attach: vi.fn(),
  shutdown: vi.fn(),
  executeCommand: vi.fn(),
  options: undefined as undefined | Record<string, unknown>,
  session: undefined as undefined | Record<string, unknown>,
  /** What each `buildRuntimeSession` call returns after the first; the first returns `session`. */
  next: [] as Record<string, unknown>[],
  built: [] as Record<string, unknown>[],
}));

vi.mock('@robota-sdk/agent-framework', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@robota-sdk/agent-framework')>()),
  buildRuntimeSession: (options: Record<string, unknown>) => {
    mock.built.push(options);
    return mock.built.length === 1 ? mock.session : mock.next.shift();
  },
}));
vi.mock('@robota-sdk/agent-transport-acp', () => ({
  createAcpTransport: (options: Record<string, unknown>) => {
    mock.options = options;
    return {
      attach: mock.attach,
      start: mock.start,
      stop: mock.stop,
      waitForClose: mock.waitForClose,
    };
  },
}));

import { runAcpMode } from '../acp-mode.js';

import type { TInteractiveSessionOptions } from '@robota-sdk/agent-framework';

/** A built session as the slot sees it: it names itself once initialized and can be shut down. */
function fakeSession(sessionId: string) {
  return {
    shutdown: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    off: vi.fn(),
    executeCommand: mock.executeCommand,
    whenInitialized: vi.fn().mockResolvedValue(undefined),
    getStatusSnapshot: () => ({ sessionId }),
    getSession: () => ({ getSessionId: () => sessionId }),
  };
}

/** A project session store holding `ids`, saved from this workspace. */
function storeWith(...ids: string[]) {
  return {
    list: () =>
      ids.map((id) => ({
        outcome: {
          status: 'valid',
          record: { id, cwd: '/workspace', updatedAt: '2026-10-18T00:00:00.000Z', messages: [] },
        },
      })),
  };
}

function setup(sessionOptions: Partial<TInteractiveSessionOptions> = {}) {
  mock.session = { ...fakeSession('started-1'), shutdown: mock.shutdown };
  mock.next = [];
  mock.built = [];
  mock.attach.mockClear();
  mock.shutdown.mockClear();
  mock.stop.mockResolvedValue(undefined);
  mock.shutdown.mockResolvedValue(undefined);
  const input = new PassThrough();
  const output = new PassThrough();
  const admitWorkspace = vi.fn(() => ({ admitted: true as const }));
  const run = () =>
    runAcpMode({
      productRuntime: createTestProductRuntime(),
      sessionOptions: sessionOptions as TInteractiveSessionOptions,
      version: '9.9.9',
      cwd: '/workspace',
      input,
      output,
      admitWorkspace,
    });
  return { input, output, admitWorkspace, run };
}

type TLoad = (sessionId: string) => Promise<{ loaded: boolean; message?: string }>;

describe('ACP mode', () => {
  it('serves one session on the given streams and tears down when the editor goes away', async () => {
    mock.start.mockResolvedValue(undefined);
    mock.waitForClose.mockResolvedValue(undefined);
    const { input, output, admitWorkspace, run } = setup();

    await expect(run()).resolves.toBeUndefined();

    // The transport serves a slot whose session is the one this process started.
    expect((mock.attach.mock.calls[0]![0] as { current: unknown }).current).toBe(mock.session);
    expect(mock.start).toHaveBeenCalledOnce();
    expect(mock.stop).toHaveBeenCalledOnce();
    expect(mock.shutdown).toHaveBeenCalledOnce();
    expect(mock.options).toMatchObject({
      input,
      output,
      cwd: '/workspace',
      admitWorkspace,
      agentInfo: { name: 'test-product', version: '9.9.9' },
    });
  });

  it('hands slash commands to the session as transport commands', async () => {
    mock.start.mockResolvedValue(undefined);
    mock.waitForClose.mockResolvedValue(undefined);
    mock.executeCommand.mockResolvedValue({ success: true, message: 'Commands: /help' });
    const { run } = setup();
    await run();

    const executeCommand = mock.options!['executeCommand'] as (
      t: string,
      s: AbortSignal,
    ) => Promise<string>;
    await expect(executeCommand('/help', new AbortController().signal)).resolves.toBe(
      'Commands: /help',
    );
    expect(mock.executeCommand).toHaveBeenCalledWith('help', '', 'remote', 'owner', 'local');
  });

  it('reports errors the editor does not receive on stderr, never stdout', async () => {
    mock.start.mockResolvedValue(undefined);
    mock.waitForClose.mockResolvedValue(undefined);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const { run } = setup();
    await run();
    (mock.options!['onDeliveryError'] as (e: Error, c: string) => void)(new Error('cause'), 'turn');
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('turn'));
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('cause'));
    stderr.mockRestore();
  });

  it('tears down on SIGTERM even if the transport has not finished starting', async () => {
    mock.start.mockImplementation(() => new Promise<void>(() => {}));
    mock.waitForClose.mockImplementation(() => new Promise<void>(() => {}));
    const { run } = setup();
    const previous = new Set(process.listeners('SIGTERM'));
    const running = run();
    await vi.waitFor(() => expect(mock.start).toHaveBeenCalled());
    const listener = process.listeners('SIGTERM').find((entry) => !previous.has(entry));
    expect(listener).toBeDefined();
    listener?.('SIGTERM');
    await expect(running).resolves.toBeUndefined();
    expect(mock.stop).toHaveBeenCalled();
    expect(mock.shutdown).toHaveBeenCalled();
    expect(new Set(process.listeners('SIGTERM'))).toEqual(previous);
  });

  it('still shuts the session down when the transport fails to stop', async () => {
    mock.start.mockResolvedValue(undefined);
    mock.waitForClose.mockResolvedValue(undefined);
    const { run } = setup();
    mock.stop.mockRejectedValue(new Error('stop failed'));
    mock.shutdown.mockClear();
    await expect(run()).rejects.toThrow('stop failed');
    expect(mock.shutdown).toHaveBeenCalledOnce();
  });

  it('offers no session loading when nothing is saved', async () => {
    mock.start.mockResolvedValue(undefined);
    mock.waitForClose.mockResolvedValue(undefined);
    const { run } = setup();
    await run();
    expect(mock.options).not.toHaveProperty('loadSession');
  });

  it('loads only a session this workspace can resume, and makes it the served one', async () => {
    mock.start.mockResolvedValue(undefined);
    mock.waitForClose.mockResolvedValue(undefined);
    const { run } = setup({ sessionStore: storeWith('stored-1') as never, sessionName: 'launch' });
    const loaded = fakeSession('stored-1');
    await run();
    const load = mock.options!['loadSession'] as TLoad;
    mock.next = [loaded];

    await expect(load('unknown')).resolves.toEqual({
      loaded: false,
      message: 'No session unknown in this workspace.',
    });
    expect(mock.built).toHaveLength(1);

    await expect(load('stored-1')).resolves.toEqual({ loaded: true });
    expect(mock.built[1]).toMatchObject({ resumeSessionId: 'stored-1', sessionName: undefined });
    const slot = mock.attach.mock.calls[0]![0] as { current: unknown };
    expect(slot.current).toBe(loaded);
    // The session it replaced is shut down; loading the served one again builds nothing.
    expect(mock.shutdown).toHaveBeenCalled();
    await expect(load('stored-1')).resolves.toEqual({ loaded: true });
    expect(mock.built).toHaveLength(2);
  });

  it('keeps the served session when the stored one fails to start', async () => {
    mock.start.mockResolvedValue(undefined);
    mock.waitForClose.mockResolvedValue(undefined);
    const { run } = setup({ sessionStore: storeWith('stored-1') as never });
    const broken = fakeSession('stored-1');
    broken.whenInitialized.mockRejectedValue(new Error('record unreadable'));
    await run();
    mock.next = [broken];
    await expect((mock.options!['loadSession'] as TLoad)('stored-1')).rejects.toThrow(
      'record unreadable',
    );
    expect((mock.attach.mock.calls[0]![0] as { current: unknown }).current).toBe(mock.session);
    expect(broken.shutdown).toHaveBeenCalled();
  });
});
