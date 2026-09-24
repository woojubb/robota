import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import os, { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { FileStoragePort, FileStoragePortClosedError } from '../file-storage-port.js';
import type { IFileStoragePortOwnerLockOptions } from '../file-storage-port.js';
import {
  computeSelfExpiryMs,
  DEFAULT_LOCK_LEASE_TIMEOUT_MS,
  FileStoreOwnerConflictError,
  FileStoreOwnerLock,
} from '../file-store-owner-lock.js';

import type { IDagRun } from '@robota-sdk/dag-core';

/**
 * ISSUE-2875 — a storage root has exactly one live file-adapter owner (package SPEC), but nothing
 * enforced it. Two `FileStoragePort` instances over the same root each hydrate their own in-memory
 * working set and write whole-collection snapshots, so a second live instance silently loses the
 * first instance's updates instead of failing.
 *
 * Before this change, every case in the first `describe` below failed: two instances over one root
 * both opened successfully, and the second instance's write clobbered the first's on disk.
 */
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function storageRoot(): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'dag-owner-lock-')));
  dirs.push(dir);
  return dir;
}

/**
 * A real fake-timer-driven heartbeat still runs its refresh over REAL fs/promises I/O, so advancing
 * fake time only fires the `setInterval` callback — it does not itself wait for that callback's real
 * I/O to finish. `afterRefresh` (a deterministic test hook `FileStoragePort` forwards to the lock) is
 * what lets a test await one full refresh cycle's actual completion instead of guessing how many
 * event-loop turns real I/O needs.
 */
function withRefreshSignal(
  options: Omit<IFileStoragePortOwnerLockOptions, 'afterRefresh'>,
): { options: IFileStoragePortOwnerLockOptions; nextRefresh: () => Promise<void> } {
  let resolveCurrent: () => void = () => {};
  let current = new Promise<void>((resolve) => {
    resolveCurrent = resolve;
  });
  return {
    options: {
      ...options,
      afterRefresh: () => {
        const resolve = resolveCurrent;
        current = new Promise<void>((nextResolve) => {
          resolveCurrent = nextResolve;
        });
        resolve();
      },
    },
    nextRefresh: () => current,
  };
}

function dagRun(overrides: Partial<IDagRun> = {}): IDagRun {
  return {
    dagRunId: 'run-1',
    dagId: 'd',
    dagVersion: 1,
    status: 'running',
    startedAt: '2026-08-03T00:00:00.000Z',
    ...overrides,
  } as IDagRun;
}

describe('a storage root has exactly one live file-adapter owner (ISSUE-2875)', () => {
  it('a second live instance over the same root fails before touching any collection file', async () => {
    const root = storageRoot();
    const a = new FileStoragePort(root);
    await a.createDagRun(dagRun());

    const b = new FileStoragePort(root);
    await expect(b.getDagRun('run-1')).rejects.toBeInstanceOf(FileStoreOwnerConflictError);

    // The demonstrated defect: without enforcement, `b`'s write would silently win and `run-1`
    // — created by `a`, the still-live owner — would be gone from what a fresh reader sees.
    await expect(a.getDagRun('run-1')).resolves.toMatchObject({ dagRunId: 'run-1' });

    await a.close();
  });

  it('never reaches a read or write on the conflicting instance', async () => {
    // The conflict must be raised BEFORE hydration or any file touch, not discovered by a write
    // racing another write. A rejected first call must also mean no dag-runs.json state was read.
    const root = storageRoot();
    const a = new FileStoragePort(root);
    await a.createDagRun(dagRun());

    const b = new FileStoragePort(root);
    await expect(b.listDagRuns()).rejects.toBeInstanceOf(FileStoreOwnerConflictError);
    // `b` never got far enough to observe `a`'s run, so a caller cannot mistake the rejection for
    // "this root has no runs".
    await expect(b.listDagRuns()).rejects.toBeInstanceOf(FileStoreOwnerConflictError);

    await a.close();
  });

  it('a second owner can open once the first closes', async () => {
    const root = storageRoot();
    const a = new FileStoragePort(root);
    await a.createDagRun(dagRun());

    const b = new FileStoragePort(root);
    await expect(b.getDagRun('run-1')).rejects.toBeInstanceOf(FileStoreOwnerConflictError);

    await a.close();

    await expect(b.getDagRun('run-1')).resolves.toMatchObject({ dagRunId: 'run-1' });
    await b.createDagRun(dagRun({ dagRunId: 'run-2' }));
    expect((await b.listDagRuns()).map((run) => run.dagRunId).sort()).toEqual(['run-1', 'run-2']);

    await b.close();
  });

  it('close() is final — a later operation on the same instance is refused, not silently reacquired', async () => {
    const root = storageRoot();
    const a = new FileStoragePort(root);
    await a.createDagRun(dagRun());
    await a.close();

    // `close()` is a deliberate shutdown, not a reset: it must not transparently reacquire on the
    // next call. A caller that wants to use the root again opens a NEW instance (see the "a second
    // owner can open once the first closes" case above).
    await expect(a.getDagRun('run-1')).rejects.toBeInstanceOf(FileStoragePortClosedError);
    // Calling close() again is still safe (idempotent), and a fresh instance is unaffected.
    await a.close();
    const b = new FileStoragePort(root);
    await expect(b.getDagRun('run-1')).resolves.toMatchObject({ dagRunId: 'run-1' });
    await b.close();
  });

  it('a lock left by a dead process on this host is taken over instead of wedging the root forever', async () => {
    const root = storageRoot();
    // A pid that is (overwhelmingly likely to be) unused: write a lock file claiming ownership by a
    // process that does not exist, on this host. Its lease is fresh (just renewed) — the same-host
    // dead-pid fast path must still take it over without waiting out the lease timeout.
    writeFileSync(
      path.join(root, '.owner.lock'),
      JSON.stringify({
        pid: 999_999,
        hostname: os.hostname(),
        token: 'dead-owner',
        acquiredAt: '2020-01-01T00:00:00.000Z',
        refreshedAt: Date.now(),
      }),
    );

    const storage = new FileStoragePort(root);
    // Against a wedged root this would reject forever; the stale lock must be taken over.
    await expect(storage.createDagRun(dagRun())).resolves.toBeUndefined();
    await expect(storage.getDagRun('run-1')).resolves.toMatchObject({ dagRunId: 'run-1' });

    await storage.close();
  });

  it('does not take over a lock recorded on a different host while its lease is fresh', async () => {
    const root = storageRoot();
    writeFileSync(
      path.join(root, '.owner.lock'),
      JSON.stringify({
        pid: 1,
        hostname: 'some-other-host',
        token: 'other-host-owner',
        acquiredAt: new Date().toISOString(),
        refreshedAt: Date.now(),
      }),
    );

    const storage = new FileStoragePort(root);
    // Liveness cannot be checked across hosts, so a fresh lease must refuse rather than guess.
    await expect(storage.createDagRun(dagRun())).rejects.toBeInstanceOf(FileStoreOwnerConflictError);
  });

  it('does not take over a young unreadable lock file', async () => {
    const root = storageRoot();
    writeFileSync(path.join(root, '.owner.lock'), 'not json');

    const storage = new FileStoragePort(root);
    await expect(storage.createDagRun(dagRun())).rejects.toBeInstanceOf(FileStoreOwnerConflictError);
  });

  it('takes over an unreadable lock file once it is older than the lease timeout', async () => {
    const root = storageRoot();
    const lockPath = path.join(root, '.owner.lock');
    writeFileSync(lockPath, 'not json');
    // Backdate its mtime past the lease timeout — creation is atomic now, so an unreadable file in
    // practice means something else put it there, or a genuinely dead owner's write was interrupted
    // before this change; either way, age is the only signal available to reclaim it.
    const old = new Date(Date.now() - DEFAULT_LOCK_LEASE_TIMEOUT_MS - 1_000);
    utimesSync(lockPath, old, old);

    const storage = new FileStoragePort(root);
    await expect(storage.createDagRun(dagRun())).resolves.toBeUndefined();
    await storage.close();
  });
});

/**
 * ISSUE-2875 follow-up — staleness by same-host pid liveness alone left two gaps: a container
 * recreated after `docker stop`/a crash gets a new hostname every time and Node never runs `exit`
 * handlers on SIGTERM/SIGKILL, so the new container saw an "other-host" lock and was refused forever;
 * and a reused pid on the same host could make a dead owner's lock look live forever. A heartbeat
 * lease fixes both: staleness is decided by how long ago the lock was last renewed, regardless of
 * host or pid, with the same-host dead-pid check kept only as a fast path for immediate takeover.
 *
 * These use fake timers so the lease timeout is exercised without a real wait.
 */
describe('the owner lock is a heartbeat lease, not a one-shot claim (ISSUE-2875 follow-up)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a stale-by-age lock on a DIFFERENT host is taken over even though liveness cannot be checked', async () => {
    const root = storageRoot();
    const now = Date.now();
    writeFileSync(
      path.join(root, '.owner.lock'),
      JSON.stringify({
        pid: 1,
        hostname: 'some-other-host',
        token: 'other-host-owner',
        acquiredAt: new Date(now - DEFAULT_LOCK_LEASE_TIMEOUT_MS - 1).toISOString(),
        // Last renewed just past the lease timeout: this host cannot check that pid's liveness at
        // all, but the lease itself proves the owner stopped renewing.
        refreshedAt: now - DEFAULT_LOCK_LEASE_TIMEOUT_MS - 1,
      }),
    );

    const storage = new FileStoragePort(root);
    await expect(storage.createDagRun(dagRun())).resolves.toBeUndefined();
    await storage.close();
  });

  it('a live owner keeps renewing its lease, so a second opener stays refused across the lease timeout', async () => {
    vi.useFakeTimers();
    const root = storageRoot();
    const refreshIntervalMs = 1_000;
    const leaseTimeoutMs = 5_000;
    const signal = withRefreshSignal({ refreshIntervalMs, leaseTimeoutMs });
    const a = new FileStoragePort(root, signal.options);
    await a.createDagRun(dagRun());

    // Advance well past the lease timeout, in refresh-sized steps, awaiting each real refresh cycle's
    // actual completion so the heartbeat has genuinely renewed the lease by the time this returns.
    for (let elapsed = 0; elapsed < leaseTimeoutMs * 3; elapsed += refreshIntervalMs) {
      const refreshed = signal.nextRefresh();
      await vi.advanceTimersByTimeAsync(refreshIntervalMs);
      await refreshed;
    }

    const b = new FileStoragePort(root, { refreshIntervalMs, leaseTimeoutMs });
    // Against a one-shot lock (or a broken heartbeat) this would now succeed — `a`'s lease would look
    // stale by age even though `a` is still live.
    await expect(b.getDagRun('run-1')).rejects.toBeInstanceOf(FileStoreOwnerConflictError);
    await expect(a.getDagRun('run-1')).resolves.toMatchObject({ dagRunId: 'run-1' });

    await a.close();
  });

  it('an owner whose lease was taken over refuses further writes instead of continuing as a second owner', async () => {
    vi.useFakeTimers();
    const root = storageRoot();
    const refreshIntervalMs = 1_000;
    const signal = withRefreshSignal({ refreshIntervalMs, leaseTimeoutMs: 5_000 });
    const a = new FileStoragePort(root, signal.options);
    await a.createDagRun(dagRun());

    // Simulate another owner taking the root over while `a` is stalled (e.g. a long GC pause) —
    // written directly, standing in for a real second owner's atomic takeover.
    writeFileSync(
      path.join(root, '.owner.lock'),
      JSON.stringify({
        pid: process.pid,
        hostname: os.hostname(),
        token: 'a-different-acquisition',
        acquiredAt: new Date().toISOString(),
        refreshedAt: Date.now(),
      }),
    );

    // `a`'s next heartbeat tick must notice the lock no longer names its own acquisition — wait for
    // that refresh cycle's actual completion, not just for the timer callback to have fired.
    const refreshed = signal.nextRefresh();
    await vi.advanceTimersByTimeAsync(refreshIntervalMs);
    await refreshed;

    await expect(a.getDagRun('run-1')).rejects.toBeInstanceOf(FileStoreOwnerConflictError);
    await expect(a.createDagRun(dagRun({ dagRunId: 'run-2' }))).rejects.toBeInstanceOf(
      FileStoreOwnerConflictError,
    );

    // The lock file itself must be untouched by `a` from here — it belongs to the new owner now.
    await a.close();
  });
});

/**
 * ISSUE-2875 follow-up 2 — an owner must stop acting before anyone else may consider its lease stale.
 * A refresh that keeps FAILING (an unwritable directory, a stalled event loop) never once observes
 * someone else's token in the lock file — the read-mismatch check the previous fix added only fires
 * once ANOTHER owner has actually taken over — so without this, the instance would keep persisting
 * right up to (and briefly past) the lease timeout: a lost-update window against whoever takes over
 * once the lease genuinely lapses.
 *
 * `checkSelfExpiry()` tracks this instance's own last SUCCESSFUL renewal and self-poisons once that is
 * older than `selfExpiryMs`, which is kept strictly below `leaseTimeoutMs` by
 * `computeSelfExpiryMs` (two whole heartbeats of margin) — so this instance always stops itself before
 * the lease it is failing to renew could legitimately be taken by someone else.
 */
describe('an owner stops acting before its lease could legitimately be taken over (ISSUE-2875 follow-up 2)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // Running as root bypasses the directory permission bits this test revokes, so `chmod 0o500` would
  // not actually block the heartbeat's writes and the test could not exercise anything.
  it.skipIf(process.getuid?.() === 0)(
    'failing heartbeat writes trigger self-expiry before the lease timeout elapses',
    async () => {
      vi.useFakeTimers();
      const root = storageRoot();
      const refreshIntervalMs = 1_000;
      const leaseTimeoutMs = 10_000;
      const selfExpiryMs = computeSelfExpiryMs(refreshIntervalMs, leaseTimeoutMs);
      // The formula itself is exercised elsewhere; this only needs the chosen timing to actually
      // prove the property below (self-expiry strictly before the lease timeout, with room to spare).
      expect(selfExpiryMs).toBeLessThan(leaseTimeoutMs);

      const signal = withRefreshSignal({ refreshIntervalMs, leaseTimeoutMs });
      const a = new FileStoragePort(root, signal.options);
      await a.createDagRun(dagRun());

      // Make the storage root AND its `runs` subdirectory unwritable — the lock file lives directly
      // under the root, but run/task data lives under `runs/`, and `chmod` is not recursive — so every
      // heartbeat rewrite AND every data persist fails (EACCES) without touching the lock file's
      // identity, simulating a wedged filesystem / lost permissions rather than a takeover.
      chmodSync(root, 0o500);
      chmodSync(path.join(root, 'runs'), 0o500);
      try {
        // The tick on which `age >= selfExpiryMs` first holds — the one where `checkSelfExpiry()`
        // fires and stops the heartbeat. Looping any further would hang: no interval is left to
        // resolve the next `nextRefresh()` promise, since self-expiry (like a takeover) stops it.
        const selfExpiryTick = Math.ceil(selfExpiryMs / refreshIntervalMs);
        const elapsedAtSelfExpiry = selfExpiryTick * refreshIntervalMs;
        expect(elapsedAtSelfExpiry).toBeLessThan(leaseTimeoutMs); // the property this test proves

        for (let tick = 0; tick < selfExpiryTick; tick += 1) {
          const refreshed = signal.nextRefresh();
          await vi.advanceTimersByTimeAsync(refreshIntervalMs);
          await refreshed;
        }

        // Nobody else ever took the root over, so a READ recovers immediately — the lock file still
        // names `a`'s own acquisition (ISSUE-2875 follow-up 3 below). Self-expiry stopping the
        // instance is not the same claim as "the disk is broken forever"; it is "this instance cannot
        // currently PROVE it still safely owns the root", and a read needs no proof beyond that.
        await expect(a.getDagRun('run-1')).resolves.toMatchObject({ dagRunId: 'run-1' });
        // A WRITE, in contrast, still genuinely fails: the directory really is unwritable, and
        // recovering ownership does not paper over that — self-expiry did not let the instance's
        // stopped heartbeat quietly get replaced by a write that succeeds anyway through some other
        // path. (A real persist failure separately and permanently poisons run/task state on this
        // instance — see `file-execution-commit-durability.test.ts` — so this test does not go on to
        // assert a full recovery through the SAME instance once permissions are restored.)
        await expect(a.createDagRun(dagRun({ dagRunId: 'run-2' }))).rejects.toThrow();
      } finally {
        // Restore permissions so `afterEach`'s `rmSync` can remove the directory tree.
        chmodSync(path.join(root, 'runs'), 0o700);
        chmodSync(root, 0o700);
      }
    },
  );

  it('a healthy owner with succeeding heartbeats never self-poisons', async () => {
    vi.useFakeTimers();
    const root = storageRoot();
    const refreshIntervalMs = 1_000;
    const leaseTimeoutMs = 5_000;
    const signal = withRefreshSignal({ refreshIntervalMs, leaseTimeoutMs });
    const a = new FileStoragePort(root, signal.options);
    await a.createDagRun(dagRun());

    // Run for several multiples of the lease timeout — far past any self-expiry threshold — with
    // every heartbeat succeeding, and confirm the instance keeps working the whole time.
    for (let elapsed = 0; elapsed < leaseTimeoutMs * 5; elapsed += refreshIntervalMs) {
      const refreshed = signal.nextRefresh();
      await vi.advanceTimersByTimeAsync(refreshIntervalMs);
      await refreshed;
      await expect(a.getDagRun('run-1')).resolves.toMatchObject({ dagRunId: 'run-1' });
    }

    await a.close();
  });
});

/**
 * ISSUE-2875 follow-up 3 — losing the lock is not necessarily permanent. Self-expiry in particular can
 * be a false alarm: writes were failing, then started succeeding again, and NOBODY ever actually took
 * the root over. Staying poisoned forever in that case would be its own availability bug. `tryRecover`
 * (run automatically on the next operation after a loss) resumes as the same owner if the lock file
 * still names this exact acquisition, or reacquires fresh if the root is now free/stale — and stays
 * refused only when a live, DIFFERENT token actually holds it.
 */
describe('losing the lock is recoverable unless someone else now holds it (ISSUE-2875 follow-up 3)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.skipIf(process.getuid?.() === 0)(
    'a self-expired owner whose lock is untouched recovers and reflects on-disk state',
    async () => {
      vi.useFakeTimers();
      const root = storageRoot();
      const refreshIntervalMs = 1_000;
      const leaseTimeoutMs = 10_000;
      const selfExpiryMs = computeSelfExpiryMs(refreshIntervalMs, leaseTimeoutMs);
      const signal = withRefreshSignal({ refreshIntervalMs, leaseTimeoutMs });
      const a = new FileStoragePort(root, signal.options);
      await a.createDagRun(dagRun());

      chmodSync(root, 0o500);
      try {
        const selfExpiryTick = Math.ceil(selfExpiryMs / refreshIntervalMs);
        for (let tick = 0; tick < selfExpiryTick; tick += 1) {
          const refreshed = signal.nextRefresh();
          await vi.advanceTimersByTimeAsync(refreshIntervalMs);
          await refreshed;
        }
      } finally {
        chmodSync(root, 0o700); // writes work again; the lock file still names `a`'s own acquisition
      }

      // While `a` was poisoned, disk changed underneath it — standing in for whatever else might have
      // written during the outage even though, in this case, nothing else ever took ownership.
      // Recovery must re-read disk rather than trust `a`'s (possibly stale) in-memory maps.
      const dagRunsPath = path.join(root, 'runs', 'dag-runs.json');
      const onDisk = JSON.parse(readFileSync(dagRunsPath, 'utf8')) as unknown[];
      writeFileSync(dagRunsPath, JSON.stringify([...onDisk, dagRun({ dagRunId: 'run-2' })]));

      // The next operation recovers automatically — same token, nobody else ever took over — and
      // sees the updated disk state.
      const listed = await a.listDagRuns();
      expect(listed.map((run) => run.dagRunId).sort()).toEqual(['run-1', 'run-2']);

      await a.close();
    },
  );

  it('an owner whose lock was taken over by a live, different owner stays refused even on retry', async () => {
    vi.useFakeTimers();
    const root = storageRoot();
    const refreshIntervalMs = 1_000;
    const signal = withRefreshSignal({ refreshIntervalMs, leaseTimeoutMs: 5_000 });
    const a = new FileStoragePort(root, signal.options);
    await a.createDagRun(dagRun());

    // A different, live acquisition now holds the root (same pid/host — `isProcessAlive` sees this
    // process itself — but a different token, so `a` must recognize it is not the one it names).
    writeFileSync(
      path.join(root, '.owner.lock'),
      JSON.stringify({
        pid: process.pid,
        hostname: os.hostname(),
        token: 'a-different-acquisition',
        acquiredAt: new Date().toISOString(),
        refreshedAt: Date.now(),
      }),
    );

    const refreshed = signal.nextRefresh();
    await vi.advanceTimersByTimeAsync(refreshIntervalMs);
    await refreshed;

    await expect(a.getDagRun('run-1')).rejects.toBeInstanceOf(FileStoreOwnerConflictError);
    // Retrying does not help: recovery runs again on every attempt, but a live, different token still
    // holds the root, so it stays refused rather than ever silently becoming a second owner.
    await expect(a.getDagRun('run-1')).rejects.toBeInstanceOf(FileStoreOwnerConflictError);
  });
});

describe('a storage root has exactly one live file-adapter owner, across processes (ISSUE-2875)', () => {
  it('a child process holding the root blocks the parent, and releases it on exit', async () => {
    const root = storageRoot();
    const helperPath = fileURLToPath(
      new URL('./fixtures/hold-file-store-owner-lock.mjs', import.meta.url),
    );

    // The child acquires the lock and prints "held" once it does, then waits for a line on stdin
    // before releasing it and exiting — modelling a second live process over the same root. Run
    // under `tsx/esm` so the helper can import the TypeScript source directly.
    const { spawn } = await import('node:child_process');
    const child = spawn(process.execPath, ['--import', 'tsx/esm', helperPath, root], {
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    const held = await new Promise<void>((resolve, reject) => {
      let buffered = '';
      child.stdout.on('data', (chunk: Buffer) => {
        buffered += chunk.toString();
        if (buffered.includes('held\n')) resolve();
      });
      child.once('error', reject);
      child.once('exit', (code) => {
        if (code !== 0) reject(new Error(`helper exited early with code ${String(code)}`));
      });
    });
    void held;

    const parent = new FileStoragePort(root);
    await expect(parent.createDagRun(dagRun())).rejects.toBeInstanceOf(FileStoreOwnerConflictError);

    // Release the child and wait for it to exit — the fixture calls `storage.close()` itself (an
    // explicit, orderly release) before exiting, rather than relying on the process `exit` handler.
    child.stdin.write('release\n');
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));

    await expect(parent.createDagRun(dagRun())).resolves.toBeUndefined();
    await parent.close();
  }, 20_000);
});

/**
 * ISSUE-2875 MUST-1 — a bare "judge stale, unlink, create" is NOT atomic across racing takers: A and
 * B can both judge the same lock stale, both `unlink` it (the second racing whichever the first has
 * already recreated), and both then `open(.., 'wx')` successfully, each believing it alone won.
 * Reproduced before the takeover guard existed: 3 concurrent `acquire()` calls against one stale lock,
 * run for 200 rounds, produced more than one winner in 2 of the 200 rounds. The guard makes "judge,
 * unlink, create" one critical section, so this must now be exactly one winner, every round.
 */
describe('stale-lock takeover is atomic under concurrency (ISSUE-2875 MUST-1)', () => {
  it('exactly one of several concurrent acquirers wins a stale lock, every round', async () => {
    const rounds = 200;
    const concurrency = 4;
    // Large enough that no heartbeat or self-expiry fires during a round; this test is about
    // takeover atomicity, not the lease timing.
    const lockOptions = { refreshIntervalMs: 60_000, leaseTimeoutMs: 120_000 };

    for (let round = 0; round < rounds; round += 1) {
      const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'dag-owner-lock-stress-')));
      try {
        // A lock that is unambiguously stale by every measure (dead pid, ancient lease), so every
        // racer immediately judges it stale and heads straight for the guarded takeover.
        writeFileSync(
          path.join(root, '.owner.lock'),
          JSON.stringify({
            pid: 999_999,
            hostname: os.hostname(),
            token: `stale-round-${String(round)}`,
            acquiredAt: new Date(0).toISOString(),
            refreshedAt: 0,
          }),
        );

        const results = await Promise.allSettled(
          Array.from({ length: concurrency }, () => FileStoreOwnerLock.acquire(root, lockOptions)),
        );
        const winners = results.filter(
          (result): result is PromiseFulfilledResult<FileStoreOwnerLock> => result.status === 'fulfilled',
        );
        expect(winners).toHaveLength(1);
        // Every loser must have failed with the typed conflict error, not crashed some other way.
        for (const result of results) {
          if (result.status === 'rejected') {
            expect(result.reason).toBeInstanceOf(FileStoreOwnerConflictError);
          }
        }

        await winners[0]?.value.release();
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  }, 30_000);
});
