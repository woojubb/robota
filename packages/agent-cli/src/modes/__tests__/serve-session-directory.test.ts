/**
 * #3189 — the served runtime's session directory: what it lists, when it refuses to change the
 * current session, and that a switch or a new session goes through the host's slot.
 */

import { describe, expect, it, vi } from 'vitest';

import { createServeSessionDirectory } from '../serve-session-directory.js';

import type {
  IServeSessionDirectoryHost,
  TServeDirectorySession,
} from '../serve-session-directory.js';
import type {
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
  ISessionListEntry,
} from '@robota-sdk/agent-interface-session';

type IBackgroundTaskState = ReturnType<TServeDirectorySession['listBackgroundTasks']>[number];

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

interface IFakeSession extends TServeDirectorySession {
  readonly id: string;
  executing: boolean;
  activity: 'working' | 'needs-input' | 'idle' | undefined;
  queued: string | null;
  tasks: Pick<IBackgroundTaskState, 'id' | 'status'>[];
  shutdown: ReturnType<typeof vi.fn>;
}

function fakeSession(id: string, init: () => Promise<void> = async () => undefined): IFakeSession {
  const session: IFakeSession = {
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
    shutdown: vi.fn(async () => undefined),
  };
  return session;
}

function hostFor(
  current: IFakeSession,
  store: ReturnType<typeof storeOf>,
  build: (resumeSessionId: string | undefined) => IFakeSession = (resumeSessionId) =>
    fakeSession(resumeSessionId ?? 'fresh'),
): IServeSessionDirectoryHost<IFakeSession> & {
  slot: { current: IFakeSession; replace: ReturnType<typeof vi.fn> };
  buildSession: ReturnType<typeof vi.fn>;
} {
  const slot = {
    current,
    replace: vi.fn(async (next: IFakeSession) => {
      slot.current = next;
    }),
  };
  return { slot, store, cwd: CWD, buildSession: vi.fn(build) };
}

describe('serve session directory (#3189)', () => {
  it("lists this workspace's sessions newest first, the current id, and unreadable ids", () => {
    const store = storeOf([
      { id: 'old', outcome: { status: 'valid', record: record('old', '2026-09-01T00:00:00Z') } },
      { id: 'new', outcome: { status: 'valid', record: record('new', '2026-09-20T00:00:00Z') } },
      {
        id: 'elsewhere',
        outcome: { status: 'valid', record: record('elsewhere', '2026-09-25T00:00:00Z', '/other') },
      },
      { id: 'broken', outcome: { status: 'corrupt', issues: [] } },
    ]);
    const directory = createServeSessionDirectory<IFakeSession>();
    directory.attach(hostFor(fakeSession('new'), store));

    const listing = directory.listSessions();

    expect(listing.currentSessionId).toBe('new');
    expect(listing.sessions.map((row) => row.id)).toEqual(['new', 'old']);
    expect(listing.sessions[0]).toMatchObject({ cwd: CWD, messageCount: 1 });
    expect(listing.unreadableSessionIds).toEqual(['broken']);
  });

  it('switches by resuming the stored session and replacing the current one', async () => {
    const store = storeOf([
      { id: 'a', outcome: { status: 'valid', record: record('a', '2026-09-01T00:00:00Z') } },
      { id: 'b', outcome: { status: 'valid', record: record('b', '2026-09-02T00:00:00Z') } },
    ]);
    const host = hostFor(fakeSession('a'), store);
    const directory = createServeSessionDirectory<IFakeSession>();
    directory.attach(host);

    await directory.switchSession('b');

    expect(host.buildSession).toHaveBeenCalledWith('b');
    expect(host.slot.replace).toHaveBeenCalledTimes(1);
    expect(host.slot.current.id).toBe('b');
  });

  it('starts a new session that is saved before it becomes current', async () => {
    const store = storeOf([
      { id: 'a', outcome: { status: 'valid', record: record('a', '2026-09-01T00:00:00Z') } },
    ]);
    const host = hostFor(fakeSession('a'), store, () =>
      fakeSession('fresh', async () => {
        store.save(record('fresh', '2026-09-26T00:00:00Z'));
      }),
    );
    const directory = createServeSessionDirectory<IFakeSession>();
    directory.attach(host);

    await directory.newSession();

    expect(host.buildSession).toHaveBeenCalledWith(undefined);
    expect(host.slot.current.id).toBe('fresh');
    expect(directory.listSessions().sessions.map((row) => row.id)).toEqual(['fresh', 'a']);
  });

  it('treats switching to the current session as nothing to do', async () => {
    const store = storeOf([
      { id: 'a', outcome: { status: 'valid', record: record('a', '2026-09-01T00:00:00Z') } },
    ]);
    const host = hostFor(fakeSession('a'), store);
    const directory = createServeSessionDirectory<IFakeSession>();
    directory.attach(host);

    await directory.switchSession('a');

    expect(host.buildSession).not.toHaveBeenCalled();
    expect(host.slot.replace).not.toHaveBeenCalled();
  });

  it('refuses an unknown or unreadable session', async () => {
    const store = storeOf([
      { id: 'a', outcome: { status: 'valid', record: record('a', '2026-09-01T00:00:00Z') } },
      { id: 'broken', outcome: { status: 'unsupported', schemaVersion: 99 } },
      {
        id: 'elsewhere',
        outcome: { status: 'valid', record: record('elsewhere', '2026-09-02T00:00:00Z', '/other') },
      },
    ]);
    const host = hostFor(fakeSession('a'), store);
    const directory = createServeSessionDirectory<IFakeSession>();
    directory.attach(host);

    await expect(directory.switchSession('nope')).rejects.toThrow(
      'No session nope in this workspace.',
    );
    await expect(directory.switchSession('elsewhere')).rejects.toThrow('in this workspace');
    await expect(directory.switchSession('broken')).rejects.toThrow('cannot read');
    expect(host.buildSession).not.toHaveBeenCalled();
  });

  it.each([
    [
      'a turn is running',
      (s: IFakeSession) => {
        s.executing = true;
      },
      'Stop the running turn first.',
    ],
    [
      'a prompt awaits an answer',
      (s: IFakeSession) => {
        s.activity = 'needs-input';
      },
      'pending prompt',
    ],
    [
      'input is queued',
      (s: IFakeSession) => {
        s.queued = 'next message';
      },
      'queued messages',
    ],
    [
      'a background task is live',
      (s: IFakeSession) => {
        s.tasks = [{ id: 't', status: 'running' }];
      },
      '1 background task(s) are still running',
    ],
  ])('refuses to leave the current session while %s', async (_label, arrange, reason) => {
    const store = storeOf([
      { id: 'a', outcome: { status: 'valid', record: record('a', '2026-09-01T00:00:00Z') } },
      { id: 'b', outcome: { status: 'valid', record: record('b', '2026-09-02T00:00:00Z') } },
    ]);
    const current = fakeSession('a');
    arrange(current);
    const host = hostFor(current, store);
    const directory = createServeSessionDirectory<IFakeSession>();
    directory.attach(host);

    await expect(directory.switchSession('b')).rejects.toThrow(reason);
    await expect(directory.newSession()).rejects.toThrow(reason);
    expect(host.buildSession).not.toHaveBeenCalled();
    expect(host.slot.current).toBe(current);
  });

  it('allows leaving when every background task has finished', async () => {
    const store = storeOf([
      { id: 'a', outcome: { status: 'valid', record: record('a', '2026-09-01T00:00:00Z') } },
    ]);
    const current = fakeSession('a');
    current.tasks = [
      { id: 't1', status: 'completed' },
      { id: 't2', status: 'cancelled' },
    ];
    const host = hostFor(current, store);
    const directory = createServeSessionDirectory<IFakeSession>();
    directory.attach(host);

    await directory.newSession();

    expect(host.slot.current.id).toBe('fresh');
  });

  it("refuses with the host's own reason when the runtime cannot switch at all", async () => {
    const store = storeOf([]);
    const host = {
      ...hostFor(fakeSession('a'), store),
      switchBlockedReason: () => 'This runtime is stopping.',
    };
    const directory = createServeSessionDirectory<IFakeSession>();
    directory.attach(host);

    await expect(directory.newSession()).rejects.toThrow('This runtime is stopping.');
    expect(host.buildSession).not.toHaveBeenCalled();
  });

  it('refuses a second change while one is under way', async () => {
    const store = storeOf([]);
    let release: () => void = () => undefined;
    const host = hostFor(fakeSession('a'), store, () =>
      fakeSession(
        'fresh',
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      ),
    );
    const directory = createServeSessionDirectory<IFakeSession>();
    directory.attach(host);

    const first = directory.newSession();
    await expect(directory.newSession()).rejects.toThrow('already under way');
    release();
    await first;
    expect(host.buildSession).toHaveBeenCalledTimes(1);
  });

  it('keeps the current session when the next one fails to start, and discards the failed one', async () => {
    const store = storeOf([]);
    const failed = fakeSession('fresh', async () => {
      throw new Error('provider unavailable');
    });
    const current = fakeSession('a');
    const host = hostFor(current, store, () => failed);
    const directory = createServeSessionDirectory<IFakeSession>();
    directory.attach(host);

    await expect(directory.newSession()).rejects.toThrow(
      'The session could not be started: provider unavailable',
    );
    expect(failed.shutdown).toHaveBeenCalledTimes(1);
    expect(host.slot.replace).not.toHaveBeenCalled();
    expect(host.slot.current).toBe(current);
  });

  it('says sessions are not available before the runtime attaches', () => {
    const directory = createServeSessionDirectory<IFakeSession>();
    expect(() => directory.listSessions()).toThrow('Sessions are not available yet.');
  });

  it("carries the run's state to the next session before it becomes current (#3189)", async () => {
    const store = storeOf([
      { id: 'a', outcome: { status: 'valid', record: record('a', '2026-09-01T00:00:00Z') } },
      { id: 'b', outcome: { status: 'valid', record: record('b', '2026-09-02T00:00:00Z') } },
    ]);
    const directory = createServeSessionDirectory<IFakeSession>();
    const host = hostFor(fakeSession('a'), store);
    const order: string[] = [];
    const adopt = vi.fn(async (next: IFakeSession) => {
      order.push(`adopt ${next.id}`);
    });
    host.slot.replace.mockImplementation(async (next: IFakeSession) => {
      order.push(`replace ${next.id}`);
      host.slot.current = next;
    });
    directory.attach({ ...host, adopt });

    await directory.switchSession('b');

    expect(order).toEqual(['adopt b', 'replace b']);
  });

  it('keeps the current session when the next one cannot take the run over', async () => {
    const store = storeOf([
      { id: 'a', outcome: { status: 'valid', record: record('a', '2026-09-01T00:00:00Z') } },
      { id: 'b', outcome: { status: 'valid', record: record('b', '2026-09-02T00:00:00Z') } },
    ]);
    const directory = createServeSessionDirectory<IFakeSession>();
    const next = fakeSession('b');
    const host = hostFor(fakeSession('a'), store, () => next);
    directory.attach({
      ...host,
      adopt: async () => {
        throw new Error('grant refused');
      },
    });

    await expect(directory.switchSession('b')).rejects.toThrow(/grant refused/);
    expect(host.slot.replace).not.toHaveBeenCalled();
    expect(host.slot.current.id).toBe('a');
    expect(next.shutdown).toHaveBeenCalled();
  });

  it('refuses at the last moment when work started while the next session was starting', async () => {
    const store = storeOf([
      { id: 'a', outcome: { status: 'valid', record: record('a', '2026-09-01T00:00:00Z') } },
      { id: 'b', outcome: { status: 'valid', record: record('b', '2026-09-02T00:00:00Z') } },
    ]);
    const current = fakeSession('a');
    let finishInit: () => void = () => undefined;
    const next = fakeSession('b', () => new Promise<void>((resolve) => (finishInit = resolve)));
    const directory = createServeSessionDirectory<IFakeSession>();
    const host = hostFor(current, store, () => next);
    directory.attach(host);

    const switching = directory.switchSession('b');
    await Promise.resolve();
    current.executing = true; // a client submitted while `b` was initializing
    finishInit();

    await expect(switching).rejects.toThrow('Stop the running turn first.');
    expect(host.slot.replace).not.toHaveBeenCalled();
    expect(next.shutdown).toHaveBeenCalled();
  });
});
