import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import {
  SESSION_STILL_CLOSING_MESSAGE,
  SessionAuthorshipRefusedError,
} from '@robota-sdk/agent-framework';
import { SessionClaimedError } from '@robota-sdk/agent-session';

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
    if (mock.built.length === 1) return mock.session;
    const next = mock.next.shift();
    // A construction that throws, as one does for an id a session here still holds.
    if (next instanceof Error) throw next;
    // A construction that restores from its own read, as one over a store that seals does.
    if (typeof next === 'function') return (next as (built: unknown) => unknown)(options);
    return next;
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
import { createEditorFileSlot } from '../../product/editor-file-slot.js';

import type { TInteractiveSessionOptions } from '@robota-sdk/agent-framework';

/** A built session as the slot sees it: it names itself once initialized and can be shut down. */
function fakeSession(sessionId: string, busy = false) {
  return {
    shutdown: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    off: vi.fn(),
    executeCommand: vi.fn(mock.executeCommand),
    whenInitialized: vi.fn().mockResolvedValue(undefined),
    getStatusSnapshot: () => ({ sessionId }),
    getSession: () => ({ getSessionId: () => sessionId }),
    isExecuting: () => busy,
    getPendingPrompt: () => null,
    getPendingCount: () => 0,
    listBackgroundTasks: () => [],
  };
}

/** A project session store holding these records (`cwd` defaults to the served folder). */
function storeWith(
  ...records: {
    id: string;
    cwd?: string;
    goal?: unknown;
    sessionLoops?: unknown[];
    backgroundTasks?: unknown[];
    /** Whose a store that seals says the record is; absent from a plain store. */
    authorship?: 'verified' | 'unverified';
  }[]
) {
  return {
    // `load` answers for an id the listing does not show — which is how a sealed session shows up.
    load: (id: string) => (id === 'sealed-1' ? { status: 'locked' } : { status: 'missing' }),
    list: () =>
      records.map(({ authorship, ...record }) => ({
        id: record.id,
        outcome: {
          status: 'valid',
          record: {
            cwd: '/workspace',
            updatedAt: '2026-10-18T00:00:00.000Z',
            messages: [],
            ...record,
          },
          ...(authorship !== undefined ? { authorship } : {}),
        },
      })),
  };
}

function setup(
  sessionOptions: Partial<TInteractiveSessionOptions> = {},
  extra: Partial<Parameters<typeof runAcpMode>[0]> = {},
) {
  mock.session = { ...fakeSession('started-1'), shutdown: mock.shutdown };
  mock.next = [];
  mock.built = [];
  mock.attach.mockClear();
  mock.shutdown.mockClear();
  mock.stop.mockClear();
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
      ...extra,
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
    const signal = new AbortController().signal;
    await expect(executeCommand('/help', signal)).resolves.toBe('Commands: /help');
    expect(mock.executeCommand).toHaveBeenCalledWith('help', '', 'remote', 'owner', 'local', {
      signal,
    });
  });

  it("fills the session's editor file slot with what the transport hands over", async () => {
    mock.start.mockResolvedValue(undefined);
    mock.waitForClose.mockResolvedValue(undefined);
    const editorFiles = createEditorFileSlot();
    await setup({}, { editorFiles }).run();

    const hand = mock.options!['onEditorFileAccess'] as (access: unknown) => void;
    const access = { readTextFile: async () => 'BUFFER' };
    hand(access);
    expect(editorFiles.current()).toBe(access);
    hand(undefined);
    expect(editorFiles.current()).toBeUndefined();
  });

  it('asks the transport for no editor file system when the session has no slot for it', async () => {
    mock.start.mockResolvedValue(undefined);
    mock.waitForClose.mockResolvedValue(undefined);
    await setup().run();
    expect(mock.options).not.toHaveProperty('onEditorFileAccess');
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

  /** Serve until `close()`; the load runs while the transport is up, as an editor's does. */
  async function serving(sessionOptions: Partial<TInteractiveSessionOptions>) {
    let close!: () => void;
    mock.start.mockResolvedValue(undefined);
    mock.waitForClose.mockReturnValue(new Promise<void>((resolve) => (close = resolve)));
    const { run } = setup(sessionOptions);
    const running = run();
    await vi.waitFor(() => expect(mock.options).toHaveProperty('loadSession'));
    const slot = mock.attach.mock.calls[0]![0] as {
      current: unknown;
      executeCommand: (...args: unknown[]) => unknown;
    };
    return {
      load: mock.options!['loadSession'] as TLoad,
      slot,
      stop: async () => {
        close();
        await running;
      },
    };
  }

  it('loads only a session of this folder, replaces the served one, and shuts each down once', async () => {
    const served = await serving({
      sessionStore: storeWith(
        { id: 'stored-1' },
        { id: 'elsewhere-1', cwd: '/elsewhere' },
      ) as never,
      sessionName: 'launch',
    });
    const loaded = fakeSession('stored-1');
    mock.next = [loaded];

    await expect(served.load('unknown')).resolves.toEqual({
      loaded: false,
      message: 'No session unknown in this workspace.',
    });
    await expect(served.load('elsewhere-1')).resolves.toMatchObject({ loaded: false });
    expect(mock.built).toHaveLength(1);

    await expect(served.load('stored-1')).resolves.toEqual({ loaded: true });
    // Exactly the stored session: the launch's name does not carry over.
    expect(mock.built[1]).toMatchObject({ resumeSessionId: 'stored-1', sessionName: undefined });
    expect(served.slot.current).toBe(loaded);
    expect(mock.shutdown).toHaveBeenCalledOnce();
    // Commands now reach the loaded session.
    await served.slot.executeCommand('help', '');
    expect(loaded.executeCommand).toHaveBeenCalled();
    // Loading the served one again builds nothing.
    await expect(served.load('stored-1')).resolves.toEqual({ loaded: true });
    expect(mock.built).toHaveLength(2);

    await served.stop();
    expect(loaded.shutdown).toHaveBeenCalledOnce();
    expect(mock.shutdown).toHaveBeenCalledOnce();
  });

  // #3679 step 3e: the session the editor left still holds its record while it shuts down.
  it('tells the editor to try again while a session of that id is still closing here', async () => {
    const served = await serving({ sessionStore: storeWith({ id: 'stored-1' }) as never });
    const stillClosing = { loaded: false, message: SESSION_STILL_CLOSING_MESSAGE };

    mock.next = [new SessionClaimedError('stored-1', 'claimed') as never];
    await expect(served.load('stored-1')).resolves.toEqual(stillClosing);
    const failing = {
      ...fakeSession('stored-1'),
      whenInitialized: vi.fn().mockRejectedValue(new SessionClaimedError('stored-1', 'claimed')),
    };
    mock.next = [failing];
    await expect(served.load('stored-1')).resolves.toEqual(stillClosing);

    expect(failing.shutdown).toHaveBeenCalledOnce();
    expect(served.slot.current).toBe(mock.session);
    await served.stop();
  });

  it('says a sealed session whose keys are locked is locked, not that it does not exist', async () => {
    const served = await serving({ sessionStore: storeWith({ id: 'stored-1' }) as never });

    await expect(served.load('sealed-1')).resolves.toEqual({
      loaded: false,
      message: 'Session sealed-1 is sealed and locked; unlock to open it.',
    });
    await expect(served.load('unknown')).resolves.toEqual({
      loaded: false,
      message: 'No session unknown in this workspace.',
    });
    expect(mock.built).toHaveLength(1);
    await served.stop();
  });

  it('reads the store once to decide a load, and still refuses a record this build cannot read', async () => {
    const store = storeWith({ id: 'stored-1' });
    const list = vi.fn(() => [
      ...store.list(),
      {
        id: 'damaged-1',
        outcome: { status: 'corrupt', issues: [], cwd: '/workspace' },
      },
    ]);
    const load = vi.fn(store.load);
    const served = await serving({ sessionStore: { list, load } as never });

    await expect(served.load('damaged-1')).resolves.toEqual({
      loaded: false,
      message: 'Session damaged-1 was saved in a form this version cannot read.',
    });
    expect(list).toHaveBeenCalledOnce();
    expect(load).not.toHaveBeenCalled();
    list.mockClear();
    mock.next = [fakeSession('stored-1')];

    await expect(served.load('stored-1')).resolves.toEqual({ loaded: true });
    expect(list).toHaveBeenCalledOnce();
    expect(load).not.toHaveBeenCalled();
    await served.stop();
  });

  it('waits for the served session to start before deciding', async () => {
    let started!: () => void;
    const served = await serving({ sessionStore: storeWith({ id: 'stored-1' }) as never });
    const initial = mock.session as ReturnType<typeof fakeSession>;
    initial.whenInitialized.mockReturnValue(new Promise<void>((resolve) => (started = resolve)));
    let ready = false;
    initial.getStatusSnapshot = () => {
      if (!ready) throw new Error('InteractiveSession not initialized.');
      return { sessionId: 'started-1' };
    };
    mock.next = [fakeSession('stored-1')];
    const loading = served.load('stored-1');
    ready = true;
    started();
    await expect(loading).resolves.toEqual({ loaded: true });
    await served.stop();
  });

  it('refuses while the served session has work in progress, and keeps it', async () => {
    const served = await serving({ sessionStore: storeWith({ id: 'stored-1' }) as never });
    Object.assign(mock.session!, fakeSession('started-1', true), { shutdown: mock.shutdown });
    await expect(served.load('stored-1')).resolves.toMatchObject({
      loaded: false,
      message: expect.stringContaining('work in progress'),
    });
    expect(mock.built).toHaveLength(1);
    expect(mock.shutdown).not.toHaveBeenCalled();
    await served.stop();
  });

  // #3679 step 3e: an editor cannot yet be asked whether a record nobody vouched for is the owner's.
  it('refuses a record not verified as the owner’s, with the session’s own reason, building nothing', async () => {
    const served = await serving({
      sessionStore: storeWith(
        { id: 'planted-1', authorship: 'unverified' },
        { id: 'mine-1', authorship: 'verified' },
      ) as never,
    });
    mock.next = [fakeSession('mine-1')];

    await expect(served.load('planted-1')).resolves.toEqual({
      loaded: false,
      message: new SessionAuthorshipRefusedError('planted-1', 'unverified').message,
    });
    expect(mock.built).toHaveLength(1);
    await expect(served.load('mine-1')).resolves.toEqual({ loaded: true });
    await served.stop();
  });

  it('judges work that would run on its own on the record the session restores from, not the listing', async () => {
    const served = await serving({ sessionStore: storeWith({ id: 'swapped-1' }) as never });
    const restoredFrom = {
      id: 'swapped-1',
      cwd: '/workspace',
      createdAt: '2026-10-18T00:00:00.000Z',
      updatedAt: '2026-10-18T00:00:00.000Z',
      messages: [],
      goal: { status: 'active' },
    };
    // The file changed between the listing and the claim's own read: the claim reads an active goal.
    mock.next = [
      (options: { checkRestoredRecord?: (record: unknown) => void }) => {
        options.checkRestoredRecord?.(restoredFrom);
        return fakeSession('swapped-1');
      },
    ] as never;

    await expect(served.load('swapped-1')).resolves.toEqual({
      loaded: false,
      message:
        'Session swapped-1 has a goal, loop or schedule that would run on its own; resume it in ' +
        'the terminal to stop that first.',
    });
    expect(served.slot.current).toBe(mock.session);
    await served.stop();
  });

  it('refuses a stored session that would run a goal or loop on its own', async () => {
    const served = await serving({
      sessionStore: storeWith(
        { id: 'goal-1', goal: { status: 'active' } },
        {
          id: 'loop-1',
          sessionLoops: [{ phase: 'waiting', expiresAt: '2999-01-01T00:00:00.000Z' }],
        },
        {
          id: 'done-1',
          goal: { status: 'satisfied' },
          sessionLoops: [{ phase: 'stopped', expiresAt: '2999-01-01T00:00:00.000Z' }],
        },
      ) as never,
    });
    mock.next = [fakeSession('done-1')];
    await expect(served.load('goal-1')).resolves.toMatchObject({ loaded: false });
    await expect(served.load('loop-1')).resolves.toMatchObject({ loaded: false });
    await expect(served.load('done-1')).resolves.toEqual({ loaded: true });
    await served.stop();
  });

  /** A stored scheduled background task as `/loop 10m ...` or `/schedule` leaves it. */
  function scheduledTask(
    overrides: { status?: string; metadata?: Record<string, unknown> } = {},
  ): Record<string, unknown> {
    return {
      id: 'task-1',
      kind: 'scheduled',
      label: 'check the build',
      status: 'sleeping',
      mode: 'background',
      parentSessionId: 'parent-1',
      depth: 0,
      cwd: '/workspace',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      unread: false,
      nextFireAt: '2999-01-01T00:00:00.000Z',
      schedule: { cronExpression: '*/10 * * * *', agentInstruction: 'check the build' },
      ...overrides,
    };
  }
  const liveLoop = { sessionLoop: true, sessionLoopExpiresAt: '2999-01-01T00:00:00.000Z' };

  it('refuses a stored session whose fixed-interval loop or schedule would wake on its own', async () => {
    const served = await serving({
      sessionStore: storeWith(
        { id: 'interval-loop', backgroundTasks: [scheduledTask({ metadata: liveLoop })] },
        { id: 'scheduled-wake', backgroundTasks: [scheduledTask()] },
      ) as never,
    });
    mock.next = [fakeSession('interval-loop'), fakeSession('scheduled-wake')];
    await expect(served.load('interval-loop')).resolves.toMatchObject({
      loaded: false,
      message: expect.stringContaining('would run on its own'),
    });
    await expect(served.load('scheduled-wake')).resolves.toMatchObject({ loaded: false });
    expect(mock.built).toHaveLength(1);
    expect(mock.shutdown).not.toHaveBeenCalled();
    await served.stop();
  });

  it('loads a stored session whose scheduled work restore would not fire', async () => {
    const served = await serving({
      sessionStore: storeWith(
        {
          id: 'expired-loop',
          backgroundTasks: [
            scheduledTask({
              metadata: { sessionLoop: true, sessionLoopExpiresAt: '2000-01-01T00:00:00.000Z' },
            }),
          ],
        },
        { id: 'finished-wake', backgroundTasks: [scheduledTask({ status: 'completed' })] },
        {
          id: 'cancelled-loop',
          backgroundTasks: [scheduledTask({ status: 'cancelled', metadata: liveLoop })],
        },
        { id: 'paused-wake', backgroundTasks: [scheduledTask({ status: 'paused' })] },
      ) as never,
    });
    mock.next = [
      fakeSession('expired-loop'),
      fakeSession('finished-wake'),
      fakeSession('cancelled-loop'),
      fakeSession('paused-wake'),
    ];
    for (const id of ['expired-loop', 'finished-wake', 'cancelled-loop', 'paused-wake']) {
      await expect(served.load(id)).resolves.toEqual({ loaded: true });
    }
    await served.stop();
  });

  it('loads a stored session whose loop the host disabled, as restore would not re-arm it', async () => {
    const served = await serving({
      disableSessionLoops: true,
      sessionStore: storeWith(
        { id: 'interval-loop', backgroundTasks: [scheduledTask({ metadata: liveLoop })] },
        { id: 'scheduled-wake', backgroundTasks: [scheduledTask()] },
      ) as never,
    });
    mock.next = [fakeSession('interval-loop'), fakeSession('scheduled-wake')];
    await expect(served.load('interval-loop')).resolves.toEqual({ loaded: true });
    // Disabling loops does not stop a plain `/schedule` wake.
    await expect(served.load('scheduled-wake')).resolves.toMatchObject({ loaded: false });
    await served.stop();
  });

  it('keeps the served session when the stored one fails to start', async () => {
    const served = await serving({ sessionStore: storeWith({ id: 'stored-1' }) as never });
    const broken = fakeSession('stored-1');
    broken.whenInitialized.mockRejectedValue(new Error('record unreadable'));
    mock.next = [broken];
    await expect(served.load('stored-1')).rejects.toThrow('record unreadable');
    expect(served.slot.current).toBe(mock.session);
    expect(broken.shutdown).toHaveBeenCalledOnce();
    await served.stop();
    expect(mock.shutdown).toHaveBeenCalledOnce();
  });

  it('shuts a session that finishes loading after the editor left, and the served one', async () => {
    const served = await serving({ sessionStore: storeWith({ id: 'stored-1' }) as never });
    let started!: () => void;
    const late = fakeSession('stored-1');
    late.whenInitialized.mockReturnValue(new Promise<void>((resolve) => (started = resolve)));
    mock.next = [late];
    const loading = served.load('stored-1');
    await vi.waitFor(() => expect(mock.built).toHaveLength(2));
    // The editor leaves while the stored session is still starting.
    const stopping = served.stop();
    await vi.waitFor(() => expect(mock.stop).toHaveBeenCalled());
    started();
    await expect(loading).resolves.toMatchObject({ loaded: false });
    await stopping;
    expect(late.shutdown).toHaveBeenCalledOnce();
    expect(mock.shutdown).toHaveBeenCalledOnce();
    expect(served.slot.current).toBe(mock.session);
  });
});
