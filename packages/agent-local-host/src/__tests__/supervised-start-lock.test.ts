import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ensurePrivateDirectory, readRegisteredProcessStartTime } from '../supervised-control-carrier.js';
import { acquireSupervisedDaemonStartLock, removeSupervisedDaemonStartLock } from '../supervised-start-lock.js';

const HINT = 'test-product daemon clear-start-lock';
const REMOVAL = `If no daemon start is running, remove it with: ${HINT}`;

let scratch: string;
let workspace: string;
let root: string;

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'start-lock-')));
  workspace = join(scratch, 'workspace');
  root = join(scratch, 'supervised');
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const lockFile = (forWorkspace: string = workspace): string =>
  join(root, `.daemon-${createHash('sha256').update(forWorkspace).digest('hex').slice(0, 16)}.lock`);

/** A lock file as a start that has since ended, or a pid another process now holds, leaves it. */
function leaveLock(content: string): void {
  ensurePrivateDirectory(root);
  writeFileSync(lockFile(), content, { mode: 0o600 });
}

describe('daemon start lock', () => {
  it('excludes a second start in the workspace until the first releases its lock', async () => {
    const first = await acquireSupervisedDaemonStartLock(workspace, root, { removalHint: HINT });
    expect(readdirSync(root)).toEqual([expect.stringMatching(/^\.daemon-[0-9a-f]{16}\.lock$/u)]);
    let acquired = false;
    const second = acquireSupervisedDaemonStartLock(workspace, root, { removalHint: HINT, timeoutMs: 10_000, pollMs: 20 })
      .then((release) => { acquired = true; return release; });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(acquired).toBe(false);
    first();
    const release = await second;
    expect(existsSync(lockFile())).toBe(true);
    release();
    expect(existsSync(lockFile())).toBe(false);
  });

  it('keeps one lock per workspace', async () => {
    const other = join(scratch, 'other-workspace');
    const first = await acquireSupervisedDaemonStartLock(workspace, root, { removalHint: HINT });
    const second = await acquireSupervisedDaemonStartLock(other, root, { removalHint: HINT, timeoutMs: 200, pollMs: 20 });
    expect(readdirSync(root).sort()).toEqual([basename(lockFile()), basename(lockFile(other))].sort());
    first();
    expect(existsSync(lockFile())).toBe(false);
    expect(existsSync(lockFile(other))).toBe(true);
    second();
    expect(existsSync(lockFile(other))).toBe(false);
  });

  it('never removes a lock left by a start that is gone: the start refuses and quotes the hint it was given', async () => {
    const gone = spawnSync(process.execPath, ['-e', '']).pid;
    leaveLock(`${gone} Mon Jan  1 00:00:00 2024`);
    await expect(acquireSupervisedDaemonStartLock(workspace, root, { removalHint: HINT })).rejects.toThrow(new Error(
      `A daemon start lock left by process ${gone}, which is no longer running, remains at ${lockFile()}. ${REMOVAL}`,
    ));
    expect(existsSync(lockFile())).toBe(true);
  });

  it('counts a lock whose pid another process now holds as gone: the start refuses, the removal clears it', async () => {
    // This pid is alive, but it is not the process that took the lock.
    leaveLock(`${process.pid} Mon Jan  1 00:00:00 2024`);
    await expect(acquireSupervisedDaemonStartLock(workspace, root, { removalHint: HINT })).rejects.toThrow(new Error(
      `A daemon start lock left by process ${process.pid}, which is no longer running, remains at ${lockFile()}. ${REMOVAL}`,
    ));
    expect(removeSupervisedDaemonStartLock(workspace, root)).toEqual({ outcome: 'removed' });
    expect(existsSync(lockFile())).toBe(false);
  });

  it('gives up on a lock held by a live start after its wait, quoting the hint it was given', async () => {
    leaveLock(`${process.pid} ${readRegisteredProcessStartTime(process.pid)}`);
    await expect(acquireSupervisedDaemonStartLock(workspace, root, { removalHint: HINT, timeoutMs: 200, pollMs: 20 })).rejects.toThrow(new Error(
      `Another daemon start is still running in ${workspace}, or its lock remains at ${lockFile()}. ${REMOVAL}`,
    ));
    expect(existsSync(lockFile())).toBe(true);
  });

  it('keeps a lock whose start is still running when asked to remove it', () => {
    leaveLock(`${process.pid} ${readRegisteredProcessStartTime(process.pid)}`);
    expect(removeSupervisedDaemonStartLock(workspace, root)).toEqual({ outcome: 'held', pid: process.pid });
    expect(existsSync(lockFile())).toBe(true);
  });

  it('reports nothing to remove without a supervised directory or without a lock', () => {
    expect(removeSupervisedDaemonStartLock(workspace, root)).toEqual({ outcome: 'none' });
    ensurePrivateDirectory(root);
    expect(removeSupervisedDaemonStartLock(workspace, root)).toEqual({ outcome: 'none' });
  });
});
