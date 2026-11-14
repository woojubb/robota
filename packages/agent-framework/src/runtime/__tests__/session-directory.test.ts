/**
 * The served runtime's session directory: what each client's view lists, when a client may
 * not leave its session, and that a switch or a new session moves that client alone.
 */

import { createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readCurrentProcessIdentity, readProcessStartTime } from '@robota-sdk/agent-core/node';
import { leaveProcessMarker } from '@robota-sdk/agent-core/testing';
import { withHoldReadClaim } from '@robota-sdk/agent-interface/session/testing';
import { SessionAuthorshipRefusedError } from '../../interactive/session-authorship-gate.js';
import { SessionPool } from '../session-pool.js';
import {
  isSessionChangeRefusal,
  isSessionDeleteRefusal,
} from '@robota-sdk/agent-interface/session';
import { NodeSessionStore } from '@robota-sdk/agent-session/node';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createServeSessionDirectory } from '../session-directory.js';

import type { TServeDirectorySession } from '../session-directory.js';
import type { SessionSlot } from '../session-slot.js';
import type {
  IInteractiveSession,
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
  ISessionListEntry,
  TSessionChangeRefusalCode,
  TSessionDeleteRefusalCode,
} from '@robota-sdk/agent-interface/session';

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
  const store: Omit<IInteractiveSessionStore, 'claim' | 'lend' | 'hasWriter'> & {
    entries: ISessionListEntry[];
  } = {
    entries,
    save: (saved) => {
      const index = entries.findIndex((entry) => entry.id === saved.id);
      const entry = { id: saved.id, outcome: { status: 'valid' as const, record: saved } };
      if (index === -1) entries.push(entry);
      else entries[index] = entry;
    },
    load: (id) => entries.find((entry) => entry.id === id)?.outcome ?? { status: 'missing' },
    list: () => entries,
    delete: (id) => {
      const index = entries.findIndex((entry) => entry.id === id);
      if (index !== -1) entries.splice(index, 1);
    },
  };
  return withHoldReadClaim(store);
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
  store: IInteractiveSessionStore,
  build: (resumeSessionId: string | undefined) => TFakeSession = (resumeSessionId) =>
    fakeSession(resumeSessionId ?? 'fresh'),
  options: {
    maxLive?: number;
    stopping?: () => boolean;
    buildAccepted?: (id: string, digest: string, signal: AbortSignal) => TFakeSession;
  } = {},
) {
  const buildSession = vi.fn(build);
  const pool = new SessionPool<TFakeSession>({
    primary,
    build: buildSession,
    ...(options.buildAccepted !== undefined ? { buildAccepted: options.buildAccepted } : {}),
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

async function deleteRefusalOf(change: Promise<void>): Promise<TSessionDeleteRefusalCode> {
  const error = await change.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!isSessionDeleteRefusal(error))
    throw new Error(`expected a delete refusal, got ${String(error)}`);
  return error.code;
}

describe('serve session directory', () => {
  it('offers a safe local terminal remedy before asking about a sandbox snapshot', async () => {
    const digest = 'a'.repeat(64);
    const store = storeOf([{
      id: 'planted',
      outcome: { status: 'valid', record: { ...record('planted', '2026-09-02T00:00:00Z'), sandboxSnapshotId: 'snapshot' }, authorship: 'unverified', digest },
    }]);
    const { directory } = served(fakeSession('primary'), store);
    const binding = directory.bindOwner('drive');
    expect(await binding.ownerDirectory.question('planted')).toEqual({
      kind: 'refused',
      message: 'This session requires sandbox setup that cannot be cancelled while attached. Review it in a local interactive terminal with --resume and its session ID.',
    });
    binding.release();
  });

  it('cannot use a cancelled answer for a later question about the same bytes', async () => {
    const digest = 'a'.repeat(64);
    const store = storeOf([{
      id: 'planted',
      outcome: { status: 'valid', record: record('planted', '2026-09-02T00:00:00Z'), authorship: 'unverified', digest },
    }]);
    const buildAccepted = vi.fn((id: string) => fakeSession(id));
    const { directory } = served(fakeSession('primary'), store, undefined, { buildAccepted });
    const binding = directory.bindOwner('drive');
    const first = await binding.ownerDirectory.question('planted');
    binding.ownerDirectory.invalidate();
    const second = await binding.ownerDirectory.question('planted');
    if (first.kind !== 'accept' || second.kind !== 'accept') throw new Error('Expected questions');
    expect(first.questionId).not.toBe(second.questionId);
    await expect(binding.ownerDirectory.openAccepted('planted', digest, first.questionId, new AbortController().signal)).rejects.toThrow();
    expect(buildAccepted).not.toHaveBeenCalled();
    await binding.ownerDirectory.openAccepted('planted', digest, second.questionId, new AbortController().signal);
    expect(binding.session.current.getSession().getSessionId()).toBe('planted');
    binding.release();
  });
  it('accepts only the exact question for this owner binding, once', async () => {
    const digest = 'a'.repeat(64);
    const store = storeOf([{
      id: 'planted',
      outcome: { status: 'valid', record: record('planted', '2026-09-02T00:00:00Z'), authorship: 'unverified', digest },
    }]);
    const buildAccepted = vi.fn((id: string) => fakeSession(id));
    const { directory } = served(fakeSession('primary'), store, undefined, { buildAccepted });
    const binding = directory.bindOwner('drive');
    const signal = new AbortController().signal;

    const question = await binding.ownerDirectory.question('planted');
    expect(question).toMatchObject({ kind: 'accept', digest });
    if (question.kind !== 'accept') throw new Error('Expected owner question');
    expect(JSON.stringify(question)).not.toContain('reply in planted');
    const other = directory.bindOwner('drive');
    await expect(other.ownerDirectory.openAccepted('planted', digest, question.questionId, signal)).rejects.toThrow();
    other.release();
    await expect(binding.ownerDirectory.openAccepted('planted', 'b'.repeat(64), question.questionId, signal)).rejects.toThrow();
    expect(buildAccepted).not.toHaveBeenCalled();
    await binding.ownerDirectory.openAccepted('planted', digest, question.questionId, signal);
    expect(binding.session.current.getSession().getSessionId()).toBe('planted');
    await expect(binding.ownerDirectory.openAccepted('planted', digest, question.questionId, signal)).rejects.toThrow();
    binding.release();
  });

  it('invalidates a question when the owner binding ends', async () => {
    const digest = 'a'.repeat(64);
    const store = storeOf([{
      id: 'planted',
      outcome: { status: 'valid', record: record('planted', '2026-09-02T00:00:00Z'), authorship: 'unverified', digest },
    }]);
    const buildAccepted = vi.fn((id: string) => fakeSession(id));
    const { directory } = served(fakeSession('primary'), store, undefined, { buildAccepted });
    const binding = directory.bindOwner('drive');
    const question = await binding.ownerDirectory.question('planted');
    if (question.kind !== 'accept') throw new Error('Expected owner question');
    binding.release();

    await expect(binding.ownerDirectory.openAccepted('planted', digest, question.questionId, new AbortController().signal)).rejects.toThrow();
    expect(buildAccepted).not.toHaveBeenCalled();
  });
  it("lists this workspace's sessions newest first, which are live, and the unreadable ids", () => {
    const store = storeOf([
      { id: 'old', outcome: { status: 'valid', record: record('old', '2026-09-01T00:00:00Z') } },
      { id: 'new', outcome: { status: 'valid', record: record('new', '2026-09-20T00:00:00Z') } },
      {
        id: 'elsewhere',
        outcome: { status: 'valid', record: record('elsewhere', '2026-09-25T00:00:00Z', '/other') },
      },
      // This workspace's own unreadable record carries the peeked `cwd` that let it be
      // told apart from a legacy record of another folder in the same store.
      { id: 'broken', outcome: { status: 'corrupt', issues: [], cwd: CWD } },
    ]);
    const { directory } = served(fakeSession('new'), store);
    directory.bind('drive');

    const listing = directory.listSessions();

    // A caller with no binding is on the primary session.
    expect(listing.currentSessionId).toBe('new');
    expect(listing.sessions.map((row) => row.id)).toEqual(['new', 'old']);
    expect(listing.sessions[0]).toMatchObject({
      cwd: CWD,
      messageCount: 1,
      live: true,
      clients: 1,
    });
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
      { id: 'broken', outcome: { status: 'unsupported', schemaVersion: 99, cwd: CWD } },
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

  // No client can say yet that a record nobody vouched for is the owner's.
  describe('records a store that seals does not verify as the owner’s', () => {
    const unverified = (id: string, updatedAt: string): ISessionListEntry => ({
      id,
      outcome: { status: 'valid', record: record(id, updatedAt), authorship: 'unverified' },
    });
    const verified = (id: string, updatedAt: string): ISessionListEntry => ({
      id,
      outcome: { status: 'valid', record: record(id, updatedAt), authorship: 'verified' },
    });

    it('are refused from disk with the session’s own reason, and nothing is built', async () => {
      const store = storeOf([
        verified('mine', '2026-09-01T00:00:00Z'),
        unverified('planted', '2026-09-02T00:00:00Z'),
      ]);
      const { directory, buildSession } = served(fakeSession('mine'), store);
      const { directory: view } = directory.bind('drive');

      await expect(view.switchSession('planted')).rejects.toThrow(
        new SessionAuthorshipRefusedError('planted', 'unverified').message,
      );
      expect(await refusalOf(view.switchSession('planted'))).toBe('unverified');
      expect(buildSession).not.toHaveBeenCalled();
    });

    it('stay reachable while the pool runs them, as their claim holds them', async () => {
      const store = storeOf([
        verified('mine', '2026-09-01T00:00:00Z'),
        unverified('running', '2026-09-02T00:00:00Z'),
      ]);
      const { directory } = served(fakeSession('running'), store);
      const other = directory.bind('drive');
      await other.directory.switchSession('mine');
      const back = other.directory.switchSession('running');

      await expect(back).resolves.toBeUndefined();
      expect(other.session.current.id).toBe('running');
    });

    it('are listed after every verified one, whatever time they give, and carry their authorship', () => {
      const store = storeOf([
        verified('mine-old', '2026-09-01T00:00:00Z'),
        unverified('planted-future', '2999-01-01T00:00:00Z'),
        verified('mine-new', '2026-09-03T00:00:00Z'),
      ]);
      const { directory } = served(fakeSession('mine-new'), store);

      const listing = directory.listSessions();

      expect(listing.sessions.map((row) => [row.id, row.authorship])).toEqual([
        ['mine-new', 'verified'],
        ['mine-old', 'verified'],
        ['planted-future', 'unverified'],
      ]);
    });

    it('are never reused as an empty session, nor landed in when the current one is deleted', async () => {
      const empty = (entry: ISessionListEntry): ISessionListEntry =>
        entry.outcome.status === 'valid'
          ? {
              ...entry,
              outcome: { ...entry.outcome, record: { ...entry.outcome.record, messages: [] } },
            }
          : entry;
      const store = storeOf([
        verified('mine', '2026-09-01T00:00:00Z'),
        empty(unverified('planted-empty', '2026-09-02T00:00:00Z')),
      ]);
      const { directory, buildSession } = served(fakeSession('primary'), store);
      const binding = directory.bind('drive');

      await binding.directory.newSession();
      expect(buildSession).toHaveBeenLastCalledWith(undefined);

      await binding.directory.switchSession('mine');
      await binding.directory.deleteSession('mine');
      expect(buildSession).toHaveBeenLastCalledWith(undefined);
      expect(buildSession).not.toHaveBeenCalledWith('planted-empty');
    });
  });

  it('refuses a sealed session whose keys are locked by name, not as an unknown one', async () => {
    const base = STORED();
    const store = {
      ...base,
      load: (id: string) => (id === 'sealed' ? ({ status: 'locked' } as const) : base.load(id)),
    };
    const { directory, buildSession } = served(fakeSession('a'), store);
    const { directory: view } = directory.bind('drive');

    expect(await refusalOf(view.switchSession('sealed'))).toBe('unreadable');
    await expect(view.switchSession('sealed')).rejects.toThrow(
      'Session sealed is sealed and locked; unlock to open it.',
    );
    expect(await refusalOf(view.switchSession('nope'))).toBe('unknown_session');
    expect(buildSession).not.toHaveBeenCalled();
  });

  it('lists how many sessions are sealed and locked, and names the lock on rename and delete', async () => {
    const base = STORED();
    const store = {
      ...base,
      load: (id: string) => (id === 'sealed' ? ({ status: 'locked' } as const) : base.load(id)),
      scan: () => ({ entries: base.list(), locked: 2 }),
    };
    const { directory } = served(fakeSession('a'), store);
    const { directory: view } = directory.bind('drive');

    const listing = view.listSessions();
    expect(listing.lockedSessionCount).toBe(2);
    expect(listing.sessions.map((session) => session.id)).toEqual(['b', 'a']);
    await expect(view.renameSession('sealed', 'x')).rejects.toThrow(
      'Session sealed is sealed and locked; unlock to open it.',
    );
    await expect(view.deleteSession('sealed')).rejects.toThrow(
      'Session sealed is sealed and locked; unlock to open it.',
    );
    await expect(view.deleteSession('nope')).rejects.toThrow('No session nope in this workspace.');
  });

  it('counts every sealed session it cannot open, keys locked or not here, under the one key', () => {
    const base = STORED();
    const store = { ...base, scan: () => ({ entries: base.list(), locked: 1, noKeys: 2 }) };
    const { directory } = served(fakeSession('a'), store);

    const listing = directory.bind('drive').directory.listSessions();

    expect(listing.lockedSessionCount).toBe(3);
    // Why each does not open stays in this process: the listing gains no key for it.
    expect(Object.keys(listing).sort()).toEqual([
      'currentSessionId',
      'lockedSessionCount',
      'sessions',
      'unreadableSessionIds',
    ]);
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

  describe('reusing an empty session', () => {
    it('reuses an existing empty session instead of building another', async () => {
      const store = storeOf([
        { id: 'a', outcome: { status: 'valid', record: record('a', '2026-09-01T00:00:00Z') } },
        {
          id: 'empty',
          outcome: {
            status: 'valid',
            record: { ...record('empty', '2026-09-02T00:00:00Z'), messages: [] },
          },
        },
      ]);
      const { directory, buildSession } = served(fakeSession('a'), store);
      const binding = directory.bind('drive');

      await binding.directory.newSession();

      // The stored empty session is resumed (built once, from its own record) rather than a second,
      // unrelated empty session being created beside it.
      expect(buildSession).toHaveBeenCalledWith('empty');
      expect(binding.directory.listSessions().sessions.map((row) => row.id)).toEqual([
        'empty',
        'a',
      ]);
      expect(binding.session.current.id).toBe('empty');
    });

    it('skips an empty session another client is on, and builds fresh', async () => {
      const store = storeOf([
        {
          id: 'empty',
          outcome: {
            status: 'valid',
            record: { ...record('empty', '2026-09-02T00:00:00Z'), messages: [] },
          },
        },
      ]);
      const { directory, buildSession } = served(fakeSession('a'), store);
      const onEmpty = directory.bind('drive');
      await onEmpty.directory.switchSession('empty');
      const binding = directory.bind('drive');

      await binding.directory.newSession();

      expect(buildSession).toHaveBeenCalledWith(undefined);
      expect(binding.session.current.id).toBe('fresh');
    });

    it('builds fresh when every existing session already has messages', async () => {
      const { directory, buildSession } = served(fakeSession('a'), STORED());
      const binding = directory.bind('drive');

      await binding.directory.newSession();

      expect(buildSession).toHaveBeenCalledWith(undefined);
      expect(binding.session.current.id).toBe('fresh');
    });

    it('skips an empty session that is busy, even with no client left on it, and builds fresh', async () => {
      // A background task outlives the client that started it: switch onto the empty session, give
      // it a running task, then release — the pool keeps it live with zero clients, exactly the
      // "/clear then disconnect while a background task runs" scenario.
      const store = storeOf([
        {
          id: 'empty',
          outcome: {
            status: 'valid',
            record: { ...record('empty', '2026-09-02T00:00:00Z'), messages: [] },
          },
        },
      ]);
      const { directory, buildSession } = served(fakeSession('a'), store);
      const onEmpty = directory.bind('drive');
      await onEmpty.directory.switchSession('empty');
      onEmpty.session.current.tasks = [{ id: 't', status: 'running' }];
      onEmpty.release();

      const binding = directory.bind('drive');
      await binding.directory.newSession();

      expect(buildSession).toHaveBeenCalledWith(undefined);
      expect(binding.session.current.id).toBe('fresh');
    });
  });

  describe('renaming a session from the list', () => {
    it('persists the new name onto a stored session that is not current', async () => {
      const store = STORED();
      const { directory } = served(fakeSession('a'), store);
      const binding = directory.bind('drive');

      await binding.directory.renameSession('b', 'Renamed');

      const outcome = store.load('b');
      if (outcome.status !== 'valid') throw new Error('expected b to still be readable');
      expect(outcome.record.name).toBe('Renamed');
    });

    it('refuses to rename a session outside this workspace', async () => {
      const store = storeOf([
        {
          id: 'elsewhere',
          outcome: {
            status: 'valid',
            record: record('elsewhere', '2026-09-01T00:00:00Z', '/other'),
          },
        },
      ]);
      const { directory } = served(fakeSession('a'), store);
      const binding = directory.bind('drive');

      await expect(binding.directory.renameSession('elsewhere', 'x')).rejects.toThrow(
        'No session elsewhere in this workspace.',
      );
    });

    it('refuses to rename a session that is live, so its own next persist cannot undo the rename', async () => {
      const store = STORED();
      const { directory } = served(fakeSession('a'), store);
      const onB = directory.bind('drive');
      await onB.directory.switchSession('b');
      const binding = directory.bind('drive');

      await expect(binding.directory.renameSession('b', 'Renamed')).rejects.toThrow(
        /Session b is open now/,
      );
      const outcome = store.load('b');
      if (outcome.status !== 'valid') throw new Error('expected b to still be readable');
      expect(outcome.record.name).toBeUndefined();
    });

    it('refuses to rename the current session through this path too', async () => {
      const { directory } = served(fakeSession('a'), STORED());
      const binding = directory.bind('drive');

      await expect(binding.directory.renameSession('a', 'Renamed')).rejects.toThrow(
        /Session a is open now/,
      );
    });
  });

  describe('deleting a session from the list', () => {
    it('removes a stored session that is not live', async () => {
      const store = STORED();
      const { directory } = served(fakeSession('a'), store);
      const binding = directory.bind('drive');

      await binding.directory.deleteSession('b');

      expect(store.load('b')).toEqual({ status: 'missing' });
      expect(binding.session.current.id).toBe('a');
    });

    it('refuses to delete a session live on another client', async () => {
      const { directory } = served(fakeSession('a'), STORED());
      const onB = directory.bind('drive');
      await onB.directory.switchSession('b');
      const binding = directory.bind('drive');

      expect(await deleteRefusalOf(binding.directory.deleteSession('b'))).toBe('live_elsewhere');
    });

    it('refuses to delete a session that is running a turn', async () => {
      const { directory } = served(fakeSession('a'), STORED());
      const onB = directory.bind('drive');
      await onB.directory.switchSession('b');
      onB.session.current.executing = true;

      expect(await deleteRefusalOf(onB.directory.deleteSession('b'))).toBe('running');
    });

    it('refuses to delete a session with a live background task, even though nothing is "executing"', async () => {
      // The same completeness `SessionPool` itself uses (isSessionBusy): a background task counts
      // as work in progress even when the local activity status is idle and nothing is executing.
      const { directory } = served(fakeSession('a'), STORED());
      const onB = directory.bind('drive');
      await onB.directory.switchSession('b');
      onB.session.current.tasks = [{ id: 't', status: 'running' }];

      expect(await deleteRefusalOf(onB.directory.deleteSession('b'))).toBe('running');
    });

    it('refuses an unknown session', async () => {
      const { directory } = served(fakeSession('a'), STORED());
      const binding = directory.bind('drive');

      expect(await deleteRefusalOf(binding.directory.deleteSession('nope'))).toBe(
        'unknown_session',
      );
    });

    it('switches this binding to another session before deleting the current one', async () => {
      const { directory, buildSession } = served(fakeSession('a'), STORED());
      const binding = directory.bind('drive');
      await binding.directory.switchSession('b');

      await binding.directory.deleteSession('b');

      // 'a' is the primary — still live from the switch away, reused rather than rebuilt.
      expect(buildSession).toHaveBeenCalledTimes(1);
      expect(binding.session.current.id).toBe('a');
      expect(binding.directory.listSessions().sessions.map((row) => row.id)).toEqual(['a']);
    });

    it('starts a fresh session when the deleted current session was the only one', async () => {
      const store = storeOf([
        {
          id: 'only',
          outcome: { status: 'valid', record: record('only', '2026-09-01T00:00:00Z') },
        },
      ]);
      const { directory, buildSession } = served(fakeSession('primary'), store);
      const binding = directory.bind('drive');
      await binding.directory.switchSession('only');

      await binding.directory.deleteSession('only');

      expect(buildSession).toHaveBeenCalledWith(undefined);
      expect(binding.session.current.id).toBe('fresh');
      expect(store.entries.map((entry) => entry.id)).toEqual([]);
    });

    it('closes the session it deletes first, so its record is not written again from here', async () => {
      const b = fakeSession('b');
      const { directory } = served(fakeSession('a'), STORED(), () => b);
      const binding = directory.bind('drive');
      await binding.directory.switchSession('b');
      await binding.directory.switchSession('a');

      await binding.directory.deleteSession('b');

      expect(b.shutdown).toHaveBeenCalled();
    });

    it('refuses to delete the runtime’s first session, which stays open here', async () => {
      const { directory } = served(fakeSession('a'), STORED());
      const binding = directory.bind('drive');
      await binding.directory.switchSession('b');

      expect(await deleteRefusalOf(binding.directory.deleteSession('a'))).toBe('running');
    });

    it('says the runtime’s first session stays open until the runtime stops, not that it will close', async () => {
      const { directory } = served(fakeSession('a'), STORED());
      const binding = directory.bind('drive');
      await binding.directory.switchSession('b');

      const refusal = await binding.directory.deleteSession('a').then(
        () => undefined,
        (reason: unknown) => reason,
      );

      expect(refusal).toMatchObject({
        code: 'running',
        message:
          'This is the session this runtime started with. It stays open until the runtime stops; ' +
          'delete it after that.',
      });
    });

    it('refuses the runtime’s first session before it moves the client that is on it', async () => {
      const store = STORED();
      const { directory, buildSession } = served(fakeSession('a'), store);
      const binding = directory.bind('drive');

      expect(await deleteRefusalOf(binding.directory.deleteSession('a'))).toBe('running');

      expect(binding.session.current.id).toBe('a');
      expect(buildSession).not.toHaveBeenCalled();
      expect(store.entries.map((entry) => entry.id)).toContain('a');
    });

    describe('a session another writer holds', () => {
      const directories: string[] = [];
      afterEach(() => {
        for (const directory of directories.splice(0)) {
          rmSync(directory, { recursive: true, force: true });
        }
      });

      /** A real store over a temp directory, holding the stored sessions `a` and `b`. */
      function realStore(): { store: NodeSessionStore; claims: string } {
        const dir = realpathSync(mkdtempSync(join(tmpdir(), 'serve-directory-')));
        directories.push(dir);
        const store = new NodeSessionStore(dir, { sealing: 'plain' });
        store.save(record('a', '2026-09-01T00:00:00Z'));
        store.save(record('b', '2026-09-02T00:00:00Z'));
        return { store, claims: join(dir, 'claims') };
      }

      /** A live process other than this one: the one that started this test worker. */
      function anotherLiveProcess() {
        const { startTime: _ignored, ...here } = readCurrentProcessIdentity();
        const startTime = readProcessStartTime(process.ppid);
        return { ...here, pid: process.ppid, ...(startTime === undefined ? {} : { startTime }) };
      }

      async function refusalOfDelete(change: Promise<void>): Promise<unknown> {
        return change.then(
          () => undefined,
          (reason: unknown) => reason,
        );
      }

      it('is refused to rename and to delete with has_writer, naming the process that holds it', async () => {
        const { store, claims } = realStore();
        const holder = anotherLiveProcess();
        leaveProcessMarker(claims, 'b', holder);
        const { directory } = served(fakeSession('a'), store);
        const binding = directory.bind('drive');

        const rename = await binding.directory.renameSession('b', 'renamed').then(
          () => undefined,
          (reason: unknown) => reason,
        );
        expect(rename).toMatchObject({ name: 'SessionChangeRefusal', code: 'has_writer' });
        expect((rename as Error).message).toContain(`pid ${holder.pid}`);

        const deletion = await refusalOfDelete(binding.directory.deleteSession('b'));
        expect(deletion).toMatchObject({ name: 'SessionDeleteRefusal', code: 'has_writer' });
        expect((deletion as Error).message).toContain(`pid ${holder.pid}`);
        expect(store.load('b')).toMatchObject({ status: 'valid', record: { id: 'b' } });
      });

      it('tells a client to come back, not that another writer holds it, while a session of this process is still closing', async () => {
        const { store } = realStore();
        // A session of `b` in this process that has left the pool's live list but not yet let its
        // claim go: the one writer a client can simply wait out.
        const closing = store.claim('b');
        const { directory } = served(fakeSession('a'), store);
        const binding = directory.bind('drive');

        const rename = await binding.directory.renameSession('b', 'renamed').then(
          () => undefined,
          (reason: unknown) => reason,
        );
        expect(rename).toMatchObject({ name: 'SessionChangeRefusal', code: 'still_closing' });

        const deletion = await refusalOfDelete(binding.directory.deleteSession('b'));
        expect(deletion).toMatchObject({ name: 'SessionDeleteRefusal', code: 'running' });
        expect((deletion as Error).message).toBe((rename as Error).message);

        closing.release();
        await binding.directory.deleteSession('b');
        expect(store.load('b')).toEqual({ status: 'missing' });
      });

      it('names the child of a lent fork the same way, and lets go once the lease ends', async () => {
        const { store, claims } = realStore();
        const lease = store.lend('b');
        const { directory } = served(fakeSession('a'), store);
        const binding = directory.bind('drive');

        // The child has not taken the marker over yet: a subagent this process started holds it.
        const early = await binding.directory.renameSession('b', 'renamed').then(
          () => undefined,
          (reason: unknown) => reason,
        );
        expect(early).toMatchObject({ code: 'has_writer' });
        expect((early as Error).message).toContain('subagent this process started');

        // The child took it over: the refusal names its pid.
        const child = anotherLiveProcess();
        leaveProcessMarker(
          claims,
          'b',
          child,
          createHash('sha256').update(lease.nonce).digest('hex'),
        );
        const deletion = await refusalOfDelete(binding.directory.deleteSession('b'));
        expect(deletion).toMatchObject({ code: 'has_writer' });
        expect((deletion as Error).message).toContain(`pid ${child.pid}`);

        lease.end();
        await binding.directory.deleteSession('b');
        expect(store.load('b')).toEqual({ status: 'missing' });
      });
    });
  });
});
