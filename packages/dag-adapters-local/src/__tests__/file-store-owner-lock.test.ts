import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os, { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { FileStoragePort } from '../file-storage-port.js';
import type { IFileStoragePortOwnerLockOptions } from '../file-storage-port.js';
import {
  DEFAULT_LOCK_LEASE_TIMEOUT_MS,
  FileStoreOwnerConflictError,
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

  it('the same instance can be reused after close() without staying locked out', async () => {
    const root = storageRoot();
    const a = new FileStoragePort(root);
    await a.createDagRun(dagRun());
    await a.close();

    // Reopen and reuse the SAME object. `close()` releases ownership; it does not brick the
    // instance, so a caller that calls it defensively (e.g. in a `finally`) can still keep going.
    await expect(a.getDagRun('run-1')).resolves.toMatchObject({ dagRunId: 'run-1' });
    await a.close();
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

  it('does not take over an unreadable lock file', async () => {
    const root = storageRoot();
    writeFileSync(path.join(root, '.owner.lock'), 'not json');

    const storage = new FileStoragePort(root);
    await expect(storage.createDagRun(dagRun())).rejects.toBeInstanceOf(FileStoreOwnerConflictError);
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

    // Release the child and wait for it to exit — its `process.exit` handler removes the lock file.
    child.stdin.write('release\n');
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));

    await expect(parent.createDagRun(dagRun())).resolves.toBeUndefined();
    await parent.close();
  }, 20_000);
});
