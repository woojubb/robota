/**
 * #3189 — serve mode keeps its sessions in a pool: the directory is attached to it before the
 * transports start, a switched-to session is built with the runtime's own options, a switch moves
 * only the client that made it, what belongs to the run stays on the primary session, the supervised
 * status covers every live session, and stopping the runtime drains the pool.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createServeSessionDirectory } from '../serve-session-directory.js';

import type { IServeModeOptions } from '../serve-mode.js';
import type { InteractiveSession, SessionSlot } from '@robota-sdk/agent-framework';
import type { ISessionLoopState } from '@robota-sdk/agent-interface-session';

interface IFake {
  readonly id: string;
  activity: 'working' | 'needs-input' | 'idle' | undefined;
  loops: ISessionLoopState[];
  shutdown: ReturnType<typeof vi.fn>;
}

const built: Array<Record<string, unknown>> = [];
const sessions: IFake[] = [];

function fakeSession(id: string): IFake {
  const session = {
    id,
    activity: 'idle' as IFake['activity'],
    loops: [] as ISessionLoopState[],
    isExecuting: () => false,
    getPendingPrompt: () => null,
    getPendingCount: () => 0,
    listBackgroundTasks: () => [],
    getLocalActivityStatus: () => session.activity,
    listSelfPacedLoops: () => session.loops,
    getName: () => undefined,
    getSession: () => ({ getSessionId: () => id }),
    whenInitialized: async () => undefined,
    on: () => undefined,
    off: () => undefined,
    shutdown: vi.fn(async () => undefined),
  };
  sessions.push(session);
  return session;
}

vi.mock('@robota-sdk/agent-framework', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@robota-sdk/agent-framework')>();
  return {
    ...actual,
    buildRuntimeSession: (options: Record<string, unknown>) => {
      built.push(options);
      return fakeSession(String(options['resumeSessionId'] ?? 'fresh'));
    },
    startRuntimeHost: async (options: { bindTransports?: (slot: unknown) => void }) => {
      const slot = { current: fakeSession('initial') };
      options.bindTransports?.(slot);
      return {
        session: slot,
        // The host shuts its own session down; the pool takes the rest.
        shutdown: async () => {
          await slot.current.shutdown();
        },
        waitForCompletion: async () => [],
        waitForFailure: () => new Promise(() => undefined),
      };
    },
  };
});

interface ISupervisedCall {
  readonly onStop: () => void;
  readonly getActivity: () => string | undefined;
  readonly getNextLoopAt: () => string | undefined;
  readonly attachTarget: unknown;
  readonly proceed: () => void;
}
let supervised: ISupervisedCall | undefined;
const grantBind = vi.fn(async () => undefined);

vi.mock('../../session-inventory/supervised-session-control.js', () => ({
  ensureSupervisedAuditDirectory: () => '/audit',
  resolveSupervisedDirectory: () => '/supervised',
  takeSupervisedGrantHandoff: () => [],
  startSupervisedControl: async (
    _id: string,
    onStop: () => void,
    _root: string | undefined,
    getActivity: () => string | undefined,
    _getCwd: unknown,
    getNextLoopAt: () => string | undefined,
    ...rest: unknown[]
  ) => {
    await new Promise<void>((proceed) => {
      supervised = { onStop, getActivity, getNextLoopAt, attachTarget: rest[4], proceed };
    });
    return { close: async () => undefined };
  },
}));
vi.mock('../../external-events/tui-external-event-grants.js', () => ({
  createRebindableExternalEventGrants: () => ({
    bind: grantBind,
    close: async () => undefined,
    receive: vi.fn(),
    countRefusal: vi.fn(),
    adapter: { list: () => [], revoke: vi.fn() },
  }),
}));
vi.mock('../../external-events/external-event-http-host.js', () => ({
  createExternalEventHttpHost: () => ({ start: async () => undefined, stop: async () => undefined }),
}));
vi.mock('../../external-events/external-event-audit-ring.js', () => ({
  createExternalEventAuditRing: () => () => undefined,
}));

const { runServeMode } = await import('../serve-mode.js');

afterEach(() => {
  built.length = 0;
  sessions.length = 0;
  supervised = undefined;
  grantBind.mockClear();
});

function serveOptions(
  sessionDirectory: IServeModeOptions['sessionDirectory'],
  bindTransports = vi.fn(),
  overrides: { cwd?: string; args?: Record<string, unknown> } = {},
): IServeModeOptions {
  return {
    cwd: overrides.cwd ?? '/work/project',
    args: {
      forkSession: true,
      sessionName: 'launch-name',
      ...overrides.args,
    } as unknown as IServeModeOptions['args'],
    provider: {} as IServeModeOptions['provider'],
    sessionStore: {
      save: () => undefined,
      load: () => ({ status: 'missing' }),
      list: () => [
        {
          id: 'stored',
          outcome: {
            status: 'valid',
            record: {
              id: 'stored',
              cwd: overrides.cwd ?? '/work/project',
              createdAt: '2026-09-01T00:00:00Z',
              updatedAt: '2026-09-01T00:00:00Z',
              messages: [],
            },
          },
        },
      ],
      delete: () => undefined,
    } as unknown as IServeModeOptions['sessionStore'],
    backgroundTaskRunners: [],
    subagentRunnerFactory: (() =>
      undefined) as unknown as IServeModeOptions['subagentRunnerFactory'],
    commandModules: [],
    commandHostAdapters: {},
    transportRegistry: {} as IServeModeOptions['transportRegistry'],
    bindTransports,
    preset: {},
    resumeSessionId: 'launch-session',
    sessionDirectory,
  };
}

const byId = (id: string): IFake => {
  const found = sessions.find((session) => session.id === id);
  if (found === undefined) throw new Error(`no session ${id}`);
  return found;
};

describe('serve mode session pool wiring (#3189)', () => {
  it('attaches the directory before binding transports and moves only the client that switched', async () => {
    const directory = createServeSessionDirectory<InteractiveSession, SessionSlot<InteractiveSession>>();
    let listedAtBind: string | undefined;
    const bindTransports = vi.fn(() => {
      listedAtBind = directory.listSessions().currentSessionId;
    });
    const options = serveOptions(directory, bindTransports);
    const run = runServeMode(options);
    await vi.waitFor(() => expect(bindTransports).toHaveBeenCalled());

    expect(listedAtBind).toBe('initial');
    const client = directory.bind('drive');
    await client.directory.switchSession('stored');
    expect(client.directory.listSessions().currentSessionId).toBe('stored');
    // The runtime's own session, and every other client, stay where they were.
    expect(directory.listSessions().currentSessionId).toBe('initial');
    expect(directory.bind('drive').directory.listSessions().currentSessionId).toBe('initial');
    const switched = built.at(-1)!;
    expect(switched['resumeSessionId']).toBe('stored');
    // A switch opens exactly the stored session: the launch's fork and name do not carry over.
    expect(switched['forkSession']).toBeUndefined();
    expect(switched['sessionName']).toBeUndefined();
    expect(switched['cwd']).toBe('/work/project');

    await client.directory.newSession();
    expect(built.at(-1)!['resumeSessionId']).toBeUndefined();

    options.commandHostAdapters.process?.requestExit('other');
    await vi.waitFor(() =>
      expect(client.directory.newSession()).rejects.toThrow('This runtime is stopping.'),
    );
    await run;
    // Stopping drains the pool: every live session is shut down, not only the runtime's own.
    for (const id of ['initial', 'stored', 'fresh']) {
      expect(byId(id).shutdown).toHaveBeenCalled();
    }
  });

  it('keeps grants on the primary session and reports activity across every live session', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'serve-pool-'));
    const send = vi.fn();
    const originalSend = process.send;
    process.send = send as unknown as typeof process.send;
    try {
      const directory = createServeSessionDirectory<InteractiveSession, SessionSlot<InteractiveSession>>();
      const run = runServeMode(
        serveOptions(directory, vi.fn(), {
          cwd,
          args: {
            supervisedSessionId: '8bf9bc27-d773-4e88-b88f-f7a43e9eb1f4',
            supervisedExternalEventGrants: true,
          },
        }),
      );
      const settled = run.then(
        () => undefined,
        (error: unknown) => error,
      );
      await vi.waitFor(() => expect(supervised).toBeDefined());
      const control = supervised!;

      expect(grantBind).toHaveBeenCalledTimes(1);
      expect(grantBind).toHaveBeenCalledWith(byId('initial'));
      // An attached terminal binds as a WebSocket client does.
      expect(control.attachTarget).toEqual({ binder: directory });

      const client = directory.bind('drive');
      await client.directory.switchSession('stored');
      // The grants belong to the run: a client's switch leaves them where they were.
      expect(grantBind).toHaveBeenCalledTimes(1);

      expect(control.getActivity()).toBe('idle');
      byId('stored').activity = 'working';
      expect(control.getActivity()).toBe('working');
      byId('stored').activity = 'needs-input';
      byId('initial').activity = 'working';
      expect(control.getActivity()).toBe('needs-input');

      const soon = new Date(Date.now() + 60_000).toISOString();
      const later = new Date(Date.now() + 120_000).toISOString();
      const expires = new Date(Date.now() + 3_600_000).toISOString();
      byId('initial').loops = [
        { phase: 'waiting', nextAllowedAt: later, expiresAt: expires } as ISessionLoopState,
      ];
      byId('stored').loops = [
        { phase: 'waiting', nextAllowedAt: soon, expiresAt: expires } as ISessionLoopState,
      ];
      expect(control.getNextLoopAt()).toBe(soon);

      control.onStop();
      control.proceed();
      expect(await settled).toBeInstanceOf(Error);
      expect(byId('stored').shutdown).toHaveBeenCalled();
    } finally {
      process.send = originalSend;
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('builds each session it switches to with an edit checkpoint store of its own', async () => {
    const stores: object[] = [];
    const directory = createServeSessionDirectory<InteractiveSession, SessionSlot<InteractiveSession>>();
    const bindTransports = vi.fn();
    const options: IServeModeOptions = {
      ...serveOptions(directory, bindTransports),
      createEditCheckpointStore: () => {
        const store = {};
        stores.push(store);
        return store as never;
      },
    };
    const run = runServeMode(options);
    await vi.waitFor(() => expect(bindTransports).toHaveBeenCalled());

    const client = directory.bind('drive');
    await client.directory.switchSession('stored');
    await client.directory.newSession();

    const pooled = built.map((entry) => entry['editCheckpointStore']);
    expect(pooled).toHaveLength(2);
    // The served session's store was made first; each pooled session got a later, distinct one.
    expect(new Set([stores[0], ...pooled]).size).toBe(3);
    expect(pooled.every((store) => stores.includes(store as object))).toBe(true);

    options.commandHostAdapters.process?.requestExit('other');
    await run;
  });
});
