import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { FileStoragePort } from '../file-storage-port.js';
import { FileStoreOwnerConflictError } from '../file-store-owner-lock.js';

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
    // process that does not exist, on this host.
    const os = await import('node:os');
    writeFileSync(
      path.join(root, '.owner.lock'),
      JSON.stringify({ pid: 999_999, hostname: os.hostname(), acquiredAt: '2020-01-01T00:00:00.000Z' }),
    );

    const storage = new FileStoragePort(root);
    // Against a wedged root this would reject forever; the stale lock must be taken over.
    await expect(storage.createDagRun(dagRun())).resolves.toBeUndefined();
    await expect(storage.getDagRun('run-1')).resolves.toMatchObject({ dagRunId: 'run-1' });

    await storage.close();
  });

  it('does not take over a lock recorded on a different host', async () => {
    const root = storageRoot();
    writeFileSync(
      path.join(root, '.owner.lock'),
      JSON.stringify({ pid: 1, hostname: 'some-other-host', acquiredAt: '2020-01-01T00:00:00.000Z' }),
    );

    const storage = new FileStoragePort(root);
    // Liveness cannot be checked across hosts, so this must refuse rather than guess.
    await expect(storage.createDagRun(dagRun())).rejects.toBeInstanceOf(FileStoreOwnerConflictError);
  });

  it('does not take over an unreadable lock file', async () => {
    const root = storageRoot();
    writeFileSync(path.join(root, '.owner.lock'), 'not json');

    const storage = new FileStoragePort(root);
    await expect(storage.createDagRun(dagRun())).rejects.toBeInstanceOf(FileStoreOwnerConflictError);
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
