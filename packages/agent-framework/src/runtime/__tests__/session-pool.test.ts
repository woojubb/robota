/**
 * #3189 — the session pool: one instance per session id, a binding per client that moves alone,
 * idle sessions closed after a grace, busy ones kept, and a cap that never closes the primary.
 */

import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isSessionBusy, SessionPool } from '../session-pool.js';

import type {
  IInteractiveSession,
  IInteractiveSessionEvents,
  ISessionLoopState,
} from '@robota-sdk/agent-interface-session';
import type { ISessionPoolOptions } from '../session-pool.js';

interface IPoolTestSession extends IInteractiveSession {
  readonly id: string;
  whenInitialized(): Promise<void>;
}

interface IDeferred {
  promise: Promise<void>;
  resolve(): void;
  reject(error: unknown): void;
}

function deferred(): IDeferred {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function poolSession(id: string, ready: Promise<void> = Promise.resolve()): IPoolTestSession {
  const session = createTestInteractiveSession({
    getSession: () => ({ getSessionId: () => id }),
    shutdown: vi.fn(async () => undefined),
  });
  return Object.assign(session, { id, whenInitialized: () => ready });
}

/** Let every pending promise continuation run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

const GRACE_MS = 1000;

function createPool(overrides: Partial<ISessionPoolOptions<IPoolTestSession>> = {}): {
  pool: SessionPool<IPoolTestSession>;
  primary: IPoolTestSession;
  built: Map<string, IPoolTestSession[]>;
  build: ReturnType<typeof vi.fn>;
} {
  const primary = poolSession('primary');
  const built = new Map<string, IPoolTestSession[]>();
  let fresh = 0;
  const build = vi.fn((resumeSessionId?: string) => {
    const id = resumeSessionId ?? `fresh-${(fresh += 1)}`;
    const session = poolSession(id);
    built.set(id, [...(built.get(id) ?? []), session]);
    return session;
  });
  const pool = new SessionPool<IPoolTestSession>({
    primary,
    build,
    idleGraceMs: GRACE_MS,
    isBusy: () => false,
    ...overrides,
  });
  return { pool, primary, built, build };
}

describe('SessionPool (#3189)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts every binding on the primary and counts its clients and drivers', () => {
    const { pool, primary } = createPool();
    const driver = pool.bind('drive');
    const observer = pool.bind('observe');

    expect(driver.slot.current).toBe(primary);
    expect(pool.listLive()).toEqual([
      { sessionId: 'primary', session: primary, clients: 2, drivers: 1 },
    ]);
    expect(driver.isLastDriver()).toBe(true);
    expect(observer.isLastDriver()).toBe(false);

    driver.release();
    driver.release();
    expect(pool.listLive()[0]).toMatchObject({ clients: 1, drivers: 0 });
    expect(driver.isLastDriver()).toBe(false);
  });

  it('moves one binding without moving or shutting down anyone else', async () => {
    const { pool, primary } = createPool();
    const moving = pool.bind('drive');
    const staying = pool.bind('drive');
    const movingSwitched = vi.fn<IInteractiveSessionEvents['session_switched']>();
    const stayingSwitched = vi.fn<IInteractiveSessionEvents['session_switched']>();
    moving.slot.on('session_switched', movingSwitched);
    staying.slot.on('session_switched', stayingSwitched);

    const lease = await pool.acquire('s-2');
    moving.moveTo(lease);

    expect(moving.slot.current).toBe(lease.session);
    expect(staying.slot.current).toBe(primary);
    expect(movingSwitched).toHaveBeenCalledWith({ sessionId: 's-2' });
    expect(stayingSwitched).not.toHaveBeenCalled();
    expect(primary.shutdown).not.toHaveBeenCalled();
    expect(pool.listLive().map(({ sessionId, clients }) => [sessionId, clients])).toEqual([
      ['primary', 1],
      ['s-2', 1],
    ]);
    expect(() => moving.moveTo(lease)).toThrow(/already used/);
  });

  it('builds one instance per session id when acquires race, and reuses it after', async () => {
    const gate = deferred();
    const build = vi.fn((id?: string) => poolSession(id ?? 'fresh', gate.promise));
    const { pool } = createPool({ build });

    const first = pool.acquire('s-2');
    const second = pool.acquire('s-2');
    await flush();
    gate.resolve();
    const [a, b] = await Promise.all([first, second]);
    const c = await pool.acquire('s-2');

    expect(build).toHaveBeenCalledTimes(1);
    expect(b.session).toBe(a.session);
    expect(c.session).toBe(a.session);
    expect(pool.listLive().filter((row) => row.sessionId === 's-2')).toHaveLength(1);
  });

  it('reuses the primary when a client asks for its id', async () => {
    const { pool, primary, build } = createPool();

    const lease = await pool.acquire('primary');

    expect(lease.session).toBe(primary);
    expect(build).not.toHaveBeenCalled();
  });

  it('shuts a session nobody is on down once the grace passes with nothing running in it', async () => {
    const { pool, built } = createPool();
    const client = pool.bind('drive');
    client.moveTo(await pool.acquire('s-2'));
    client.moveTo(await pool.acquire('s-3'));
    const s2 = built.get('s-2')![0]!;
    const s3 = built.get('s-3')![0]!;

    vi.advanceTimersByTime(GRACE_MS - 1);
    expect(s2.shutdown).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(s2.shutdown).toHaveBeenCalledTimes(1);
    expect(s3.shutdown).not.toHaveBeenCalled();
    expect(pool.listLive().map((row) => row.sessionId)).toEqual(['primary', 's-3']);
  });

  it('keeps a busy session nobody is on until its work ends', async () => {
    const busy = new Set<string>(['s-2']);
    const { pool, built } = createPool({ isBusy: (session) => busy.has(session.id) });
    const client = pool.bind('drive');
    client.moveTo(await pool.acquire('s-2'));
    client.moveTo(await pool.acquire('s-3'));
    const s2 = built.get('s-2')![0]!;

    vi.advanceTimersByTime(GRACE_MS * 3);
    expect(s2.shutdown).not.toHaveBeenCalled();

    busy.delete('s-2');
    vi.advanceTimersByTime(GRACE_MS);
    expect(s2.shutdown).toHaveBeenCalledTimes(1);
  });

  it('keeps a session a client comes back to within the grace', async () => {
    const { pool, built, build } = createPool();
    const client = pool.bind('drive');
    client.moveTo(await pool.acquire('s-2'));
    client.moveTo(await pool.acquire('s-3'));

    vi.advanceTimersByTime(GRACE_MS / 2);
    client.moveTo(await pool.acquire('s-2'));
    vi.advanceTimersByTime(GRACE_MS * 2);

    expect(build).toHaveBeenCalledTimes(2);
    expect(built.get('s-2')![0]!.shutdown).not.toHaveBeenCalled();
  });

  it('never shuts the primary down for being idle', async () => {
    const { pool, primary } = createPool();
    const client = pool.bind('drive');
    client.release();

    vi.advanceTimersByTime(GRACE_MS * 10);

    expect(primary.shutdown).not.toHaveBeenCalled();
    await expect(pool.acquire('primary')).resolves.toMatchObject({ session: primary });
  });

  it('keeps an executing session past the grace under the default busy rule', async () => {
    let executing = true;
    const primary = poolSession('primary');
    const worker = Object.assign(
      createTestInteractiveSession({
        getSession: () => ({ getSessionId: () => 's-2' }),
        isExecuting: () => executing,
        shutdown: vi.fn(async () => undefined),
      }),
      { id: 's-2', whenInitialized: () => Promise.resolve() },
    );
    const pool = new SessionPool<IPoolTestSession>({
      primary,
      build: () => worker,
      idleGraceMs: GRACE_MS,
    });
    const client = pool.bind('drive');
    client.moveTo(await pool.acquire('s-2'));
    client.release();

    vi.advanceTimersByTime(GRACE_MS * 2);
    expect(worker.shutdown).not.toHaveBeenCalled();
    executing = false;
    vi.advanceTimersByTime(GRACE_MS);
    expect(worker.shutdown).toHaveBeenCalledTimes(1);
  });

  it('closes the oldest idle session nobody is on to make room, never the primary', async () => {
    const { pool, primary, built } = createPool({ maxLive: 3 });
    (await pool.acquire('s-2')).cancel();
    (await pool.acquire('s-3')).cancel();

    const lease = await pool.acquire('s-4');

    expect(lease.session.id).toBe('s-4');
    expect(built.get('s-2')![0]!.shutdown).toHaveBeenCalledTimes(1);
    expect(built.get('s-3')![0]!.shutdown).not.toHaveBeenCalled();
    expect(primary.shutdown).not.toHaveBeenCalled();
    expect(pool.listLive().map((row) => row.sessionId)).toEqual(['primary', 's-3', 's-4']);
  });

  it('refuses with limit when every live session is the primary, bound, held or busy', async () => {
    const busy = new Set<string>();
    const { pool, primary, built } = createPool({
      maxLive: 2,
      isBusy: (session) => busy.has(session.id),
    });
    const client = pool.bind('drive');
    client.moveTo(await pool.acquire('s-2'));

    await expect(pool.acquire('s-3')).rejects.toMatchObject({
      name: 'SessionChangeRefusal',
      code: 'limit',
    });

    busy.add('s-2');
    client.release();
    await expect(pool.acquire('s-3')).rejects.toMatchObject({ code: 'limit' });

    busy.delete('s-2');
    const held = await pool.acquire('s-3');
    expect(built.get('s-2')![0]!.shutdown).toHaveBeenCalledTimes(1);
    await expect(pool.acquire('s-4')).rejects.toMatchObject({ code: 'limit' });

    held.cancel();
    await expect(pool.acquire('s-4')).resolves.toMatchObject({ session: { id: 's-4' } });
    expect(primary.shutdown).not.toHaveBeenCalled();
  });

  it('counts a session still starting against the cap', async () => {
    const gate = deferred();
    const { pool } = createPool({
      maxLive: 2,
      build: (id?: string) => poolSession(id ?? 'fresh', gate.promise),
    });

    const starting = pool.acquire('s-2');
    await flush();

    await expect(pool.acquire('s-3')).rejects.toMatchObject({ code: 'limit' });
    gate.resolve();
    await expect(starting).resolves.toMatchObject({ session: { id: 's-2' } });
  });

  it('waits for an instance still closing before starting that session again', async () => {
    const closing = deferred();
    const { pool, built, build } = createPool({
      shutdown: vi.fn(() => closing.promise),
    });
    (await pool.acquire('s-2')).cancel();
    vi.advanceTimersByTime(GRACE_MS);
    const first = built.get('s-2')![0]!;

    let reopened: IPoolTestSession | undefined;
    const again = pool.acquire('s-2').then((lease) => {
      reopened = lease.session;
    });
    await flush();
    expect(build).toHaveBeenCalledTimes(1);
    expect(reopened).toBeUndefined();

    closing.resolve();
    await again;
    expect(build).toHaveBeenCalledTimes(2);
    expect(reopened).toBe(built.get('s-2')![1]);
    expect(reopened).not.toBe(first);
  });

  it('shuts a session that fails to start down and refuses with start_failed', async () => {
    const broken = Object.assign(poolSession('s-2'), {
      whenInitialized: () => Promise.reject(new Error('no provider')),
    });
    const { pool } = createPool({ build: () => broken });

    const first = pool.acquire('s-2');
    const joined = pool.acquire('s-2');

    await expect(first).rejects.toMatchObject({
      name: 'SessionChangeRefusal',
      code: 'start_failed',
      message: 'The session could not be started: no provider',
    });
    await expect(joined).rejects.toMatchObject({ code: 'start_failed' });
    expect(broken.shutdown).toHaveBeenCalledTimes(1);
    expect(pool.listLive().map((row) => row.sessionId)).toEqual(['primary']);
  });

  it('refuses with start_failed when the session cannot even be built', async () => {
    const { pool } = createPool({
      build: () => {
        throw new Error('bad recipe');
      },
    });

    await expect(pool.acquire()).rejects.toMatchObject({
      code: 'start_failed',
      message: 'The session could not be started: bad recipe',
    });
  });

  it('shutdownAll closes every session in parallel, the primary and one still starting included', async () => {
    const gate = deferred();
    const pending = deferred();
    const shutdown = vi.fn((_session: IPoolTestSession, _message: string) => pending.promise);
    const starting = poolSession('s-3', gate.promise);
    const { pool, primary } = createPool({
      shutdown,
      build: (id?: string) => (id === 's-3' ? starting : poolSession(id ?? 'fresh')),
    });
    const s2 = (await pool.acquire('s-2')).session;
    const inFlight = pool.acquire('s-3');
    await flush();

    const drained = pool.shutdownAll('bye');
    expect(pool.shutdownAll()).toBe(drained);
    expect(shutdown.mock.calls.map(([session]) => session)).toEqual([primary, s2, starting]);
    expect(shutdown).toHaveBeenCalledWith(primary, 'bye');

    let done = false;
    void drained.then(() => {
      done = true;
    });
    await flush();
    expect(done).toBe(false);
    pending.resolve();
    await drained;

    gate.resolve();
    await expect(inFlight).rejects.toMatchObject({ code: 'stopping' });
    await expect(pool.acquire('s-2')).rejects.toMatchObject({ code: 'stopping' });
    expect(shutdown).toHaveBeenCalledTimes(3);
  });
});

describe('isSessionBusy (#3189)', () => {
  const now = Date.parse('2026-09-26T00:00:00.000Z');
  const loop = (phase: ISessionLoopState['phase'], expiresAt: string): ISessionLoopState => ({
    loopId: 'l-1',
    instruction: 'check',
    createdAt: '2026-09-25T00:00:00.000Z',
    expiresAt,
    revision: 1,
    generation: 1,
    phase,
    fallbackUsed: false,
  });
  const session = (
    overrides: Partial<IInteractiveSession> & {
      getLocalActivityStatus?: () => 'working' | 'needs-input' | 'idle' | undefined;
      listSelfPacedLoops?: () => readonly ISessionLoopState[];
    } = {},
  ) => Object.assign(createTestInteractiveSession(overrides), overrides);
  const task = (status: string) => ({ status }) as never;

  it('is idle when nothing runs, waits or is queued', () => {
    expect(isSessionBusy(session(), now)).toBe(false);
    expect(
      isSessionBusy(
        session({ listBackgroundTasks: () => [task('completed'), task('cancelled')] }),
        now,
      ),
    ).toBe(false);
    expect(
      isSessionBusy(
        session({
          listSelfPacedLoops: () => [
            loop('stopped', '2026-10-01T00:00:00.000Z'),
            loop('waiting', '2026-09-25T12:00:00.000Z'),
          ],
        }),
        now,
      ),
    ).toBe(false);
  });

  it('is busy while a turn runs, a prompt waits, messages queue, a task lives or a loop waits', () => {
    expect(isSessionBusy(session({ isExecuting: () => true }), now)).toBe(true);
    expect(isSessionBusy(session({ getLocalActivityStatus: () => 'needs-input' }), now)).toBe(true);
    expect(isSessionBusy(session({ getPendingPrompt: () => 'next' }), now)).toBe(true);
    expect(isSessionBusy(session({ getPendingCount: () => 1 }), now)).toBe(true);
    expect(isSessionBusy(session({ listBackgroundTasks: () => [task('running')] }), now)).toBe(
      true,
    );
    expect(
      isSessionBusy(
        session({ listSelfPacedLoops: () => [loop('waiting', '2026-10-01T00:00:00.000Z')] }),
        now,
      ),
    ).toBe(true);
  });
});
