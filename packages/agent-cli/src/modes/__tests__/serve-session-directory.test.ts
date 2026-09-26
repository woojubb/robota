/**
 * #3189 — the served runtime's session directory: what each client's view lists, when a client may
 * not leave its session, and that a switch or a new session moves that client alone.
 */

import { SessionPool } from '@robota-sdk/agent-framework';
import { isSessionChangeRefusal } from '@robota-sdk/agent-interface-session';
import { describe, expect, it, vi } from 'vitest';

import { createServeSessionDirectory } from '../serve-session-directory.js';

import type { TServeDirectorySession } from '../serve-session-directory.js';
import type { SessionSlot } from '@robota-sdk/agent-framework';
import type {
  IInteractiveSession,
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
  ISessionListEntry,
  TSessionChangeRefusalCode,
} from '@robota-sdk/agent-interface-session';

type IBackgroundTaskState = ReturnType<IInteractiveSession['listBackgroundTasks']>[number];

const CWD = '/work/project';

function record(id: string, updatedAt: string, cwd = CWD): IInteractiveSessionRecord {
  return {
    id,
    cwd,
    createdAt: updatedAt,
    updatedAt,
    messages: [
      {
        id: `${id}-m`,
        role: 'assistant',
        content: `reply in ${id}`,
        state: 'complete',
        timestamp: new Date(updatedAt),
      },
    ],
  } as IInteractiveSessionRecord;
}

function storeOf(
  entries: ISessionListEntry[],
): IInteractiveSessionStore & { entries: ISessionListEntry[] } {
  return {
    entries,
    save: (saved) => {
      entries.push({ id: saved.id, outcome: { status: 'valid', record: saved } });
    },
    load: (id) => entries.find((entry) => entry.id === id)?.outcome ?? { status: 'missing' },
    list: () => entries,
    delete: () => undefined,
  };
}

const STORED = (): ReturnType<typeof storeOf> =>
  storeOf([
    { id: 'a', outcome: { status: 'valid', record: record('a', '2026-09-01T00:00:00Z') } },
    { id: 'b', outcome: { status: 'valid', record: record('b', '2026-09-02T00:00:00Z') } },
  ]);

interface IFakeState {
  readonly id: string;
  executing: boolean;
  activity: 'working' | 'needs-input' | 'idle' | undefined;
  queued: string | null;
  tasks: Pick<IBackgroundTaskState, 'id' | 'status'>[];
  shutdown: ReturnType<typeof vi.fn>;
}

/** The members the pool and the directory read, typed as the session the pool holds. */
type TFakeSession = IInteractiveSession & TServeDirectorySession & IFakeState;

function fakeSession(id: string, init: () => Promise<void> = async () => undefined): TFakeSession {
  const session = {
    id,
    executing: false,
    activity: 'idle',
    queued: null,
    tasks: [],
    isExecuting: () => session.executing,
    getPendingPrompt: () => session.queued,
    getPendingCount: () => (session.queued === null ? 0 : 1),
    listBackgroundTasks: () => session.tasks as IBackgroundTaskState[],
    getSession: () => ({ getSessionId: () => id }),
    getLocalActivityStatus: () => session.activity,
    whenInitialized: init,
    on: () => undefined,
    off: () => undefined,
    shutdown: vi.fn(async () => undefined),
  } as unknown as TFakeSession;
  return session;
}

function served(
  primary: TFakeSession,
  store: ReturnType<typeof storeOf>,
  build: (resumeSessionId: string | undefined) => TFakeSession = (resumeSessionId) =>
    fakeSession(resumeSessionId ?? 'fresh'),
  options: { maxLive?: number; stopping?: () => boolean } = {},
) {
  const buildSession = vi.fn(build);
  const pool = new SessionPool<TFakeSession>({
    primary,
    build: buildSession,
    ...(options.maxLive !== undefined ? { maxLive: options.maxLive } : {}),
  });
  const directory = createServeSessionDirectory<TFakeSession, SessionSlot<TFakeSession>>();
  directory.attach({
    pool,
    primary,
    store,
    cwd: CWD,
    ...(options.stopping !== undefined ? { isStopping: options.stopping } : {}),
  });
  return { pool, directory, buildSession };
}

async function refusalOf(change: Promise<void>): Promise<TSessionChangeRefusalCode> {
  const error = await change.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!isSessionChangeRefusal(error)) throw new Error(`expected a refusal, got ${String(error)}`);
  return error.code;
}

describe('serve session directory (#3189)', () => {
  it("lists this workspace's sessions newest first, which are live, and the unreadable ids", () => {
    const store = storeOf([
      { id: 'old', outcome: { status: 'valid', record: record('old', '2026-09-01T00:00:00Z') } },
      { id: 'new', outcome: { status: 'valid', record: record('new', '2026-09-20T00:00:00Z') } },
      {
        id: 'elsewhere',
        outcome: { status: 'valid', record: record('elsewhere', '2026-09-25T00:00:00Z', '/other') },
      },
      { id: 'broken', outcome: { status: 'corrupt', issues: [] } },
    ]);
    const { directory } = served(fakeSession('new'), store);
    directory.bind('drive');

    const listing = directory.listSessions();

    // A caller with no binding is on the primary session.
    expect(listing.currentSessionId).toBe('new');
    expect(listing.sessions.map((row) => row.id)).toEqual(['new', 'old']);
    expect(listing.sessions[0]).toMatchObject({ cwd: CWD, messageCount: 1, live: true, clients: 1 });
    expect(listing.sessions[1]).toMatchObject({ live: false, clients: 0 });
    expect(listing.unreadableSessionIds).toEqual(['broken']);
  });

  it('moves only the client that switched, and each view says which session is its own', async () => {
    const { directory, buildSession } = served(fakeSession('a'), STORED());
    const mover = directory.bind('drive');
    const stayer = directory.bind('drive');

    await mover.directory.switchSession('b');

    expect(buildSession).toHaveBeenCalledWith('b');
    expect(mover.session.current.id).toBe('b');
    expect(stayer.session.current.id).toBe('a');
    const moved = mover.directory.listSessions();
    const stayed = stayer.directory.listSessions();
    expect(moved.currentSessionId).toBe('b');
    expect(stayed.currentSessionId).toBe('a');
    for (const listing of [moved, stayed]) {
      expect(listing.sessions).toEqual([
        expect.objectContaining({ id: 'b', live: true, clients: 1 }),
        expect.objectContaining({ id: 'a', live: true, clients: 1 }),
      ]);
    }
  });

  it('shares the live instance when a second client switches to a session already open', async () => {
    const { directory, buildSession } = served(fakeSession('a'), STORED());
    const first = directory.bind('drive');
    const second = directory.bind('observe');

    await first.directory.switchSession('b');
    await second.directory.switchSession('b');

    expect(buildSession).toHaveBeenCalledTimes(1);
    expect(second.session.current).toBe(first.session.current);
    expect(first.directory.listSessions().sessions[0]).toMatchObject({ id: 'b', clients: 2 });
  });

  it('starts a new session that is saved before it becomes the client’s own', async () => {
    const store = storeOf([
      { id: 'a', outcome: { status: 'valid', record: record('a', '2026-09-01T00:00:00Z') } },
    ]);
    const { directory, buildSession } = served(fakeSession('a'), store, () =>
      fakeSession('fresh', async () => {
        store.save(record('fresh', '2026-09-26T00:00:00Z'));
      }),
    );
    const binding = directory.bind('drive');

    await binding.directory.newSession();

    expect(buildSession).toHaveBeenCalledWith(undefined);
    expect(binding.session.current.id).toBe('fresh');
    expect(binding.directory.listSessions().sessions.map((row) => row.id)).toEqual(['fresh', 'a']);
  });

  it('treats switching to the client’s own session as nothing to do', async () => {
    const { directory, buildSession } = served(fakeSession('a'), STORED());
    const binding = directory.bind('drive');
    binding.session.current.activity = 'needs-input';

    await binding.directory.switchSession('a');

    expect(buildSession).not.toHaveBeenCalled();
  });

  it('refuses an unknown or unreadable session with its code', async () => {
    const store = storeOf([
      { id: 'a', outcome: { status: 'valid', record: record('a', '2026-09-01T00:00:00Z') } },
      { id: 'broken', outcome: { status: 'unsupported', schemaVersion: 99 } },
      {
        id: 'elsewhere',
        outcome: { status: 'valid', record: record('elsewhere', '2026-09-02T00:00:00Z', '/other') },
      },
    ]);
    const { directory, buildSession } = served(fakeSession('a'), store);
    const { directory: view } = directory.bind('drive');

    await expect(view.switchSession('nope')).rejects.toThrow('No session nope in this workspace.');
    expect(await refusalOf(view.switchSession('nope'))).toBe('unknown_session');
    expect(await refusalOf(view.switchSession('elsewhere'))).toBe('unknown_session');
    expect(await refusalOf(view.switchSession('broken'))).toBe('unreadable');
    expect(buildSession).not.toHaveBeenCalled();
  });

  it.each([
    [
      'a turn is running',
      (s: TFakeSession) => {
        s.executing = true;
      },
    ],
    [
      'input is queued',
      (s: TFakeSession) => {
        s.queued = 'next message';
      },
    ],
    [
      'a background task is live',
      (s: TFakeSession) => {
        s.tasks = [{ id: 't', status: 'running' }];
      },
    ],
  ])('lets a client leave while %s, and keeps that session running', async (_label, arrange) => {
    const store = STORED();
    const left = fakeSession('b');
    arrange(left);
    const { directory } = served(fakeSession('a'), store, (resumeSessionId) =>
      resumeSessionId === 'b' ? left : fakeSession(resumeSessionId ?? 'fresh'),
    );
    const binding = directory.bind('drive');
    await binding.directory.switchSession('b');

    await binding.directory.switchSession('a');
    expect(binding.session.current.id).toBe('a');
    await binding.directory.newSession();
    expect(binding.session.current.id).toBe('fresh');

    expect(left.shutdown).not.toHaveBeenCalled();
    expect(binding.directory.listSessions().sessions).toContainEqual(
      expect.objectContaining({ id: 'b', live: true, clients: 0 }),
    );
  });

  it('refuses the last driver of a session with a prompt pending, and no one else', async () => {
    const { directory, buildSession } = served(fakeSession('a'), STORED());
    const driver = directory.bind('drive');
    const observer = directory.bind('observe');
    driver.session.current.activity = 'needs-input';

    expect(await refusalOf(driver.directory.switchSession('b'))).toBe('prompt_pending');
    expect(await refusalOf(driver.directory.newSession())).toBe('prompt_pending');
    expect(buildSession).not.toHaveBeenCalled();
    expect(driver.session.current.id).toBe('a');

    // An observer never answers the prompt, so its leaving strands nothing.
    await observer.directory.switchSession('b');
    expect(observer.session.current.id).toBe('b');

    // A second driver on the session can answer it, so the first may go.
    const second = directory.bind('drive');
    await driver.directory.switchSession('b');
    expect(driver.session.current.id).toBe('b');
    expect(second.session.current.id).toBe('a');
  });

  it('refuses every change once the runtime is stopping', async () => {
    let stopping = false;
    const { directory, buildSession } = served(fakeSession('a'), STORED(), undefined, {
      stopping: () => stopping,
    });
    const binding = directory.bind('drive');
    stopping = true;

    expect(await refusalOf(binding.directory.newSession())).toBe('stopping');
    expect(await refusalOf(binding.directory.switchSession('b'))).toBe('stopping');
    expect(buildSession).not.toHaveBeenCalled();
  });

  it("refuses a client's second change while its first is under way, not another client's", async () => {
    let release: () => void = () => undefined;
    const { directory, buildSession } = served(fakeSession('a'), STORED(), (resumeSessionId) =>
      resumeSessionId === undefined
        ? fakeSession(
            'fresh',
            () =>
              new Promise<void>((resolve) => {
                release = resolve;
              }),
          )
        : fakeSession(resumeSessionId),
    );
    const busy = directory.bind('drive');
    const other = directory.bind('drive');

    const first = busy.directory.newSession();
    expect(await refusalOf(busy.directory.switchSession('b'))).toBe('in_progress');
    await other.directory.switchSession('b');
    release();
    await first;

    expect(busy.session.current.id).toBe('fresh');
    expect(other.session.current.id).toBe('b');
    expect(buildSession).toHaveBeenCalledTimes(2);
  });

  it('keeps the client on its session when the next one fails to start, and discards the failed one', async () => {
    const failed = fakeSession('fresh', async () => {
      throw new Error('provider unavailable');
    });
    const { directory } = served(fakeSession('a'), storeOf([]), () => failed);
    const binding = directory.bind('drive');

    await expect(binding.directory.newSession()).rejects.toThrow(
      'The session could not be started: provider unavailable',
    );
    expect(await refusalOf(binding.directory.newSession())).toBe('start_failed');
    expect(failed.shutdown).toHaveBeenCalled();
    expect(binding.session.current.id).toBe('a');
  });

  it('refuses with limit when every live session has a client or work', async () => {
    const store = storeOf([
      { id: 'a', outcome: { status: 'valid', record: record('a', '2026-09-01T00:00:00Z') } },
      { id: 'b', outcome: { status: 'valid', record: record('b', '2026-09-02T00:00:00Z') } },
      { id: 'c', outcome: { status: 'valid', record: record('c', '2026-09-03T00:00:00Z') } },
    ]);
    const { directory } = served(fakeSession('a'), store, undefined, { maxLive: 2 });
    const onB = directory.bind('drive');
    await onB.directory.switchSession('b');
    const binding = directory.bind('drive');

    expect(await refusalOf(binding.directory.switchSession('c'))).toBe('limit');
    expect(binding.session.current.id).toBe('a');
  });

  it('says sessions are not available before the runtime attaches', () => {
    const directory = createServeSessionDirectory<TFakeSession>();
    expect(() => directory.listSessions()).toThrow('Sessions are not available yet.');
    expect(() => directory.bind('drive')).toThrow('Sessions are not available yet.');
  });

  it('refuses at the last moment when a prompt opened while the next session was starting', async () => {
    let finishInit: () => void = () => undefined;
    const next = fakeSession('b', () => new Promise<void>((resolve) => (finishInit = resolve)));
    const { directory, pool } = served(fakeSession('a'), STORED(), () => next);
    const cancelled = vi.fn();
    const acquire = pool.acquire.bind(pool);
    vi.spyOn(pool, 'acquire').mockImplementation(async (sessionId) => {
      const lease = await acquire(sessionId);
      return {
        session: lease.session,
        cancel: () => {
          cancelled();
          lease.cancel();
        },
      };
    });
    const binding = directory.bind('drive');

    const switching = binding.directory.switchSession('b');
    await Promise.resolve();
    binding.session.current.activity = 'needs-input'; // a prompt opened while `b` was starting
    finishInit();

    expect(await refusalOf(switching)).toBe('prompt_pending');
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(binding.session.current.id).toBe('a');
  });
});
