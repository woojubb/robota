import { fork, spawn, type ChildProcess } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  readdirSync,
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
  DEFAULT_LOCK_LEASE_TIMEOUT_MS,
  FileStoreOwnerConflictError,
  FileStoreOwnerLock,
  resolveOwnerLockTiming,
} from '../file-store-owner-lock.js';

import type { IDagRun } from '@robota-sdk/dag-core';

const dirs: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const dir of dirs.splice(0)) {
    try {
      chmodSync(dir, 0o700);
    } catch {
      // already removed
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

function storageRoot(): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'dag-owner-lock-')));
  dirs.push(dir);
  return dir;
}

interface IEpochFile {
  token: string;
  pid: number;
  hostname: string;
  acquiredAt: string;
  refreshedAt: number;
  leaseTimeoutMs: number;
  released: boolean;
}

function epochFile(root: string, epoch: number): string {
  return path.join(root, `.owner.${String(epoch)}`);
}

function writeEpoch(root: string, epoch: number, overrides: Partial<IEpochFile> = {}): void {
  const record: IEpochFile = {
    token: `planted-${String(epoch)}`,
    pid: process.pid,
    hostname: os.hostname(),
    acquiredAt: new Date().toISOString(),
    refreshedAt: Date.now(),
    leaseTimeoutMs: DEFAULT_LOCK_LEASE_TIMEOUT_MS,
    released: false,
    ...overrides,
  };
  writeFileSync(epochFile(root, epoch), JSON.stringify(record));
}

function readEpoch(root: string, epoch: number): IEpochFile {
  return JSON.parse(readFileSync(epochFile(root, epoch), 'utf8')) as IEpochFile;
}

function epochsOnDisk(root: string): string[] {
  return readdirSync(root)
    .filter((name) => name.startsWith('.owner'))
    .sort();
}

/** Lets a fake-timer test await one heartbeat renewal's real fs I/O. */
function withRefreshSignal(options: Omit<IFileStoragePortOwnerLockOptions, 'afterRefresh'>): {
  options: IFileStoragePortOwnerLockOptions;
  nextRefresh: () => Promise<void>;
} {
  let resolveCurrent: () => void = () => {};
  let current = new Promise<void>((resolve) => {
    resolveCurrent = resolve;
  });
  return {
    options: {
      ...options,
      afterRefresh: () => {
        const resolve = resolveCurrent;
        current = new Promise<void>((next) => {
          resolveCurrent = next;
        });
        resolve();
      },
    },
    nextRefresh: () => current,
  };
}

async function tick(signal: { nextRefresh: () => Promise<void> }, ms: number): Promise<void> {
  const refreshed = signal.nextRefresh();
  await vi.advanceTimersByTimeAsync(ms);
  await refreshed;
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

describe('lease timing validation', () => {
  it('rejects a refresh interval that is not comfortably below the lease timeout', () => {
    expect(() => resolveOwnerLockTiming({ refreshIntervalMs: 400, leaseTimeoutMs: 1_000 })).toThrow(
      RangeError,
    );
    expect(
      () => new FileStoragePort(storageRoot(), { refreshIntervalMs: 400, leaseTimeoutMs: 1_000 }),
    ).toThrow(RangeError);
  });

  it('rejects a self-expiry that leaves less than two refresh intervals before the lease timeout', () => {
    expect(() =>
      resolveOwnerLockTiming({ refreshIntervalMs: 100, leaseTimeoutMs: 1_000, selfExpiryMs: 900 }),
    ).toThrow(RangeError);
    expect(resolveOwnerLockTiming({ refreshIntervalMs: 100, leaseTimeoutMs: 1_000 })).toEqual({
      refreshIntervalMs: 100,
      leaseTimeoutMs: 1_000,
      selfExpiryMs: 800,
    });
  });
});

describe('a storage root has exactly one live file-adapter owner', () => {
  it('refuses a second live instance before it touches any collection file, naming the holder', async () => {
    const root = storageRoot();
    const a = new FileStoragePort(root);
    await a.createDagRun(dagRun());

    const b = new FileStoragePort(root);
    const refusal = await b.listDagRuns().catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(FileStoreOwnerConflictError);
    const conflict = refusal as FileStoreOwnerConflictError;
    expect(conflict.ownerPid).toBe(process.pid);
    expect(conflict.ownerHostname).toBe(os.hostname());
    expect(conflict.message).toContain(`pid ${String(process.pid)}`);
    expect(conflict.message).toContain(os.hostname());
    expect(conflict.message).toContain(readEpoch(root, 1).acquiredAt);

    await expect(a.getDagRun('run-1')).resolves.toMatchObject({ dagRunId: 'run-1' });
    await a.close();
  });

  it('a new instance opens once the first closes, under a new epoch', async () => {
    const root = storageRoot();
    const a = new FileStoragePort(root);
    await a.createDagRun(dagRun());
    const b = new FileStoragePort(root);
    await expect(b.getDagRun('run-1')).rejects.toBeInstanceOf(FileStoreOwnerConflictError);

    await a.close();
    expect(readEpoch(root, 1).released).toBe(true);

    await expect(b.getDagRun('run-1')).resolves.toMatchObject({ dagRunId: 'run-1' });
    expect(readEpoch(root, 2).released).toBe(false);
    await b.close();
  });

  it('keeps at most the two newest epoch files across many reopen cycles', async () => {
    const root = storageRoot();
    for (let cycle = 0; cycle < 5; cycle += 1) {
      const storage = new FileStoragePort(root);
      await storage.listDagRuns();
      await storage.close();
    }
    expect(epochsOnDisk(root)).toEqual(['.owner.4', '.owner.5']);
  });

  it('close() is final — a later operation is refused, not silently reacquired', async () => {
    const root = storageRoot();
    const a = new FileStoragePort(root);
    await a.createDagRun(dagRun());
    await a.close();

    await expect(a.getDagRun('run-1')).rejects.toBeInstanceOf(FileStoragePortClosedError);
    await a.close();
    const b = new FileStoragePort(root);
    await expect(b.getDagRun('run-1')).resolves.toMatchObject({ dagRunId: 'run-1' });
    await b.close();
  });

  it('close() lets writes already queued before it complete', async () => {
    const root = storageRoot();
    const a = new FileStoragePort(root);
    await a.getDagRun('warm');
    const w1 = a.createDagRun(dagRun({ dagRunId: 'run-1' }));
    const w2 = a.createDagRun(dagRun({ dagRunId: 'run-2' }));
    await a.close();

    await expect(w1).resolves.toBeUndefined();
    await expect(w2).resolves.toBeUndefined();
    const b = new FileStoragePort(root);
    expect((await b.listDagRuns()).map((run) => run.dagRunId).sort()).toEqual(['run-1', 'run-2']);
    await b.close();
  });
});

describe('a crashed or departed owner never wedges the root', () => {
  it('takes over an epoch held by a dead process on this host immediately', async () => {
    const root = storageRoot();
    writeEpoch(root, 1, { pid: 999_999 });

    const storage = new FileStoragePort(root);
    await expect(storage.createDagRun(dagRun())).resolves.toBeUndefined();
    expect(epochsOnDisk(root)).toContain('.owner.2');
    await storage.close();
  });

  it('takes over an epoch on another host once its lease is older than the lease timeout', async () => {
    const root = storageRoot();
    writeEpoch(root, 1, {
      pid: 1,
      hostname: 'some-other-host',
      refreshedAt: Date.now() - DEFAULT_LOCK_LEASE_TIMEOUT_MS - 1,
    });

    const storage = new FileStoragePort(root);
    await expect(storage.createDagRun(dagRun())).resolves.toBeUndefined();
    await storage.close();
  });

  it('refuses an epoch on another host whose lease is fresh', async () => {
    const root = storageRoot();
    writeEpoch(root, 1, { pid: 1, hostname: 'some-other-host' });

    const storage = new FileStoragePort(root);
    await expect(storage.createDagRun(dagRun())).rejects.toBeInstanceOf(
      FileStoreOwnerConflictError,
    );
    expect(epochsOnDisk(root)).toEqual(['.owner.1']);
  });

  it("judges staleness by the holder's recorded lease, not the opener's shorter one", async () => {
    const root = storageRoot();
    writeEpoch(root, 1, { pid: 1, hostname: 'some-other-host', refreshedAt: Date.now() - 2_000 });

    const storage = new FileStoragePort(root, { refreshIntervalMs: 100, leaseTimeoutMs: 1_000 });
    await expect(storage.createDagRun(dagRun())).rejects.toBeInstanceOf(
      FileStoreOwnerConflictError,
    );
  });

  it('takes over a released epoch immediately, even from another host with a fresh lease', async () => {
    const root = storageRoot();
    writeEpoch(root, 1, { pid: 1, hostname: 'some-other-host', released: true });

    const storage = new FileStoragePort(root);
    await expect(storage.createDagRun(dagRun())).resolves.toBeUndefined();
    await storage.close();
  });

  it('refuses a young unreadable epoch file and takes over an old one', async () => {
    const root = storageRoot();
    writeFileSync(epochFile(root, 1), 'not json');
    const first = new FileStoragePort(root);
    await expect(first.createDagRun(dagRun())).rejects.toBeInstanceOf(FileStoreOwnerConflictError);

    const old = new Date(Date.now() - DEFAULT_LOCK_LEASE_TIMEOUT_MS - 1_000);
    utimesSync(epochFile(root, 1), old, old);
    const second = new FileStoragePort(root);
    await expect(second.createDagRun(dagRun())).resolves.toBeUndefined();
    await second.close();
  });
});

describe('losing ownership is detected and permanent', () => {
  it('a displaced owner (a higher epoch exists) refuses every later operation', async () => {
    const root = storageRoot();
    const a = new FileStoragePort(root);
    await a.createDagRun(dagRun());

    writeEpoch(root, 2, { token: 'new-owner' });

    await expect(a.getDagRun('run-1')).rejects.toBeInstanceOf(FileStoreOwnerConflictError);
    await expect(a.createDagRun(dagRun({ dagRunId: 'run-2' }))).rejects.toThrow(
      /restart or open a new instance/,
    );
    await a.close();
    expect(readEpoch(root, 2)).toMatchObject({ token: 'new-owner', released: false });
  });

  it('the heartbeat notices displacement without any storage operation', async () => {
    vi.useFakeTimers();
    const root = storageRoot();
    const lost: string[] = [];
    const signal = withRefreshSignal({ refreshIntervalMs: 1_000, leaseTimeoutMs: 5_000 });
    const lock = await FileStoreOwnerLock.acquire(root, {
      ...signal.options,
      onOwnershipLost: (reason) => lost.push(reason),
    });

    writeEpoch(root, 2, { token: 'new-owner' });
    await tick(signal, 1_000);

    expect(lost).toHaveLength(1);
    expect(lost[0]).toContain('epoch 2');
    expect(readEpoch(root, 2)).toMatchObject({ token: 'new-owner', released: false });
    await lock.release();
  });

  it.skipIf(process.getuid?.() === 0)(
    'an owner whose renewals keep failing self-expires before its lease could look stale',
    async () => {
      vi.useFakeTimers();
      const root = storageRoot();
      const refreshIntervalMs = 1_000;
      const leaseTimeoutMs = 10_000;
      const lost: number[] = [];
      const signal = withRefreshSignal({ refreshIntervalMs, leaseTimeoutMs });
      const acquiredAt = Date.now();
      const lock = await FileStoreOwnerLock.acquire(root, {
        ...signal.options,
        onOwnershipLost: () => lost.push(Date.now()),
      });

      chmodSync(root, 0o500);
      try {
        while (lost.length === 0) await tick(signal, refreshIntervalMs);
      } finally {
        chmodSync(root, 0o700);
      }

      const { selfExpiryMs } = resolveOwnerLockTiming({ refreshIntervalMs, leaseTimeoutMs });
      expect(lost[0]! - acquiredAt).toBeGreaterThan(selfExpiryMs);
      expect(lost[0]! - readEpoch(root, 1).refreshedAt).toBeLessThan(leaseTimeoutMs);
      expect(await lock.verifyOwnership()).toBe(false);
      await lock.release();
    },
  );

  it('a healthy owner keeps renewing, so an opener stays refused well past the lease timeout', async () => {
    vi.useFakeTimers();
    const root = storageRoot();
    const refreshIntervalMs = 1_000;
    const leaseTimeoutMs = 5_000;
    const signal = withRefreshSignal({ refreshIntervalMs, leaseTimeoutMs });
    const a = new FileStoragePort(root, signal.options);
    await a.createDagRun(dagRun());

    for (let elapsed = 0; elapsed < leaseTimeoutMs * 4; elapsed += refreshIntervalMs) {
      await tick(signal, refreshIntervalMs);
      await expect(a.getDagRun('run-1')).resolves.toMatchObject({ dagRunId: 'run-1' });
    }

    const b = new FileStoragePort(root, { refreshIntervalMs, leaseTimeoutMs });
    await expect(b.getDagRun('run-1')).rejects.toBeInstanceOf(FileStoreOwnerConflictError);
    await a.close();
  });
});

describe('a displaced instance cannot disturb the owner that replaced it', () => {
  it('a late release() or exit cleanup leaves the new owner holding the root', async () => {
    const root = storageRoot();
    const timing = { refreshIntervalMs: 60_000, leaseTimeoutMs: 180_000 };
    const stalled = await FileStoreOwnerLock.acquire(root, timing);
    // Stand-in for `stalled` not renewing for longer than the lease.
    writeEpoch(root, 1, {
      ...readEpoch(root, 1),
      refreshedAt: Date.now() - timing.leaseTimeoutMs - 1,
    });

    const successor = await FileStoreOwnerLock.acquire(root, timing);
    stalled.releaseOnExitSync();
    await stalled.release();

    expect(readEpoch(root, 2).released).toBe(false);
    expect(await successor.verifyOwnership()).toBe(true);
    expect(await stalled.verifyOwnership()).toBe(false);
    await expect(FileStoreOwnerLock.acquire(root, timing)).rejects.toBeInstanceOf(
      FileStoreOwnerConflictError,
    );
    await successor.release();
  });

  it('a live owner renewing on a short interval never loses to concurrent openers', async () => {
    const root = storageRoot();
    const timing = { refreshIntervalMs: 25, leaseTimeoutMs: 500 };
    let lostReason: string | undefined;
    const owner = await FileStoreOwnerLock.acquire(root, {
      ...timing,
      onOwnershipLost: (reason) => {
        lostReason = reason;
      },
    });

    let stolen = 0;
    const deadline = Date.now() + 1_000;
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        while (Date.now() < deadline) {
          const contender = await FileStoreOwnerLock.acquire(root, timing).catch(() => undefined);
          if (contender) {
            stolen += 1;
            await contender.release();
          }
        }
      }),
    );

    expect(stolen).toBe(0);
    expect(lostReason).toBeUndefined();
    expect(await owner.verifyOwnership()).toBe(true);
    await owner.release();
  });
});

describe('ownership across processes', () => {
  it('a child process holding the root blocks the parent until it closes', async () => {
    const root = storageRoot();
    const helperPath = fileURLToPath(
      new URL('./fixtures/hold-file-store-owner-lock.mjs', import.meta.url),
    );
    const child = spawn(process.execPath, ['--import', 'tsx/esm', helperPath, root], {
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    await new Promise<void>((resolve, reject) => {
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

    const parent = new FileStoragePort(root);
    await expect(parent.createDagRun(dagRun())).rejects.toBeInstanceOf(FileStoreOwnerConflictError);

    child.stdin.write('release\n');
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));

    await expect(parent.createDagRun(dagRun())).resolves.toBeUndefined();
    await parent.close();
  }, 20_000);

  it('racing processes produce exactly one winner every round', async () => {
    const racers = 5;
    const rounds = 100;
    const racerPath = fileURLToPath(
      new URL('./fixtures/race-file-store-owner-lock.mjs', import.meta.url),
    );
    const children: ChildProcess[] = [];
    const next = (child: ChildProcess, type: string): Promise<{ won?: boolean; error?: string }> =>
      new Promise((resolve) => {
        const onMessage = (message: { type: string; won?: boolean; error?: string }): void => {
          if (message.type !== type) return;
          child.off('message', onMessage);
          resolve(message);
        };
        child.on('message', onMessage);
      });
    try {
      for (let i = 0; i < racers; i += 1) {
        const child = fork(racerPath, [], { execArgv: ['--import', 'tsx/esm'] });
        children.push(child);
        await next(child, 'ready');
      }
      const winnersPerRound: number[] = [];
      const unexpectedErrors: string[] = [];
      for (let round = 0; round < rounds; round += 1) {
        const root = storageRoot();
        const mode = round % 4;
        if (mode === 1) writeEpoch(root, 1, { pid: 999_999 });
        if (mode === 2) writeEpoch(root, 3, { hostname: 'other-host', refreshedAt: 0 });
        if (mode === 3) writeEpoch(root, 7, { hostname: 'other-host', released: true });

        const startAt = Date.now() + 20;
        const results = await Promise.all(
          children.map((child) => {
            const result = next(child, 'result');
            child.send({ type: 'go', root, startAt });
            return result;
          }),
        );
        winnersPerRound.push(results.filter((result) => result.won).length);
        for (const result of results) {
          if (!result.won && result.error !== 'FileStoreOwnerConflictError') {
            unexpectedErrors.push(String(result.error));
          }
        }
        await Promise.all(
          children.map((child) => {
            const released = next(child, 'released');
            child.send({ type: 'release' });
            return released;
          }),
        );
      }
      expect(unexpectedErrors).toEqual([]);
      expect(winnersPerRound.filter((winners) => winners !== 1)).toEqual([]);
    } finally {
      for (const child of children) child.kill();
    }
  }, 60_000);
});
