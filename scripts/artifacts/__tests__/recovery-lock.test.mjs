import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { hostname } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { makeTemp } from '../../harness/__tests__/make-temp.mjs';
import { recoverGeneration } from '../recovery.mjs';
import { GENERATION_DIRECTORY, withArtifactLock } from '../writer-lock.mjs';

const boundary = vi.hoisted(() => ({ afterRead: undefined, beforeRemove: undefined }));
vi.mock('node:fs', async (original) => {
  const actual = await original();
  return {
    ...actual,
    readFileSync: (...args) => {
      const contents = actual.readFileSync(...args);
      boundary.afterRead?.(args[0]);
      return contents;
    },
    rmSync: (...args) => {
      boundary.beforeRemove?.(args[0]);
      return actual.rmSync(...args);
    },
  };
});
afterEach(() => {
  boundary.afterRead = undefined;
  boundary.beforeRemove = undefined;
});

function interruptedWriter() {
  const root = realpathSync(makeTemp('robota-recovery-lock-'));
  const lock = path.join(root, GENERATION_DIRECTORY, 'writer.lock');
  mkdirSync(lock, { recursive: true });
  const child = spawnSync(process.execPath, ['--eval', 'process.exit(0)']);
  expect(child.status).toBe(0);
  const record = JSON.stringify({ pid: child.pid, host: hostname() });
  writeFileSync(path.join(lock, 'owner.json'), record);
  return { root, lock, record };
}

it('claims before reading the old owner so another recovery cannot admit a writer underneath it', async () => {
  const { root, lock } = interruptedWriter();
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  let nestedError;
  let writerEntered = false;
  let writer;
  boundary.afterRead = (file) => {
    if (file !== path.join(lock, 'owner.json')) return;
    boundary.afterRead = undefined;
    try {
      recoverGeneration(root);
    } catch (error) {
      nestedError = error;
    }
    writer = withArtifactLock(root, async () => {
      writerEntered = true;
      await pending;
    }).catch((error) => error);
  };
  try {
    expect(recoverGeneration(root)).toEqual({ action: 'released-interrupted-stage' });
    // Before the fix, nested recovery admits this writer and outer recovery deletes its live lock.
    if (writerEntered)
      expect(existsSync(lock), 'the new live writer must retain its lock').toBe(true);
    expect(writerEntered).toBe(false);
    expect(nestedError?.message).toMatch(/recovery.*required/i);
    expect(await writer).toHaveProperty(
      'message',
      expect.stringContaining('writer lock unavailable'),
    );
    await expect(withArtifactLock(root, async () => 'next writer')).resolves.toBe('next writer');
  } finally {
    release();
    await writer;
  }
});

it('detaches the claimed lock before recursive cleanup so cleanup cannot target a newly admitted writer', async () => {
  const { root, lock } = interruptedWriter();
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  let writer;
  let writerEntered = false;
  let removedPath;
  boundary.beforeRemove = (file) => {
    boundary.beforeRemove = undefined;
    removedPath = file;
    writer = withArtifactLock(root, async () => {
      writerEntered = true;
      await pending;
    }).catch((error) => error);
  };
  try {
    expect(recoverGeneration(root)).toEqual({ action: 'released-interrupted-stage' });
    expect(writerEntered).toBe(true);
    expect(removedPath).not.toBe(lock);
    expect(existsSync(removedPath)).toBe(false);
    expect(JSON.parse(readFileSync(path.join(lock, 'owner.json'), 'utf8')).pid).toBe(process.pid);
  } finally {
    release();
    await writer;
  }
});

it('retains a crashed recoverer record and requires quiescent claim cleanup before explicit retry', async () => {
  const { root, lock, record } = interruptedWriter();
  const moduleUrl = new URL('../recovery.mjs', import.meta.url).href;
  const child = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
    import fs from 'node:fs';
    import path from 'node:path';
    import { syncBuiltinESMExports } from 'node:module';
    const read = fs.readFileSync;
    fs.readFileSync = (...args) => {
      if (args[0] === path.join(process.argv[2], 'owner.json')) process.exit(23);
      return read(...args);
    };
    syncBuiltinESMExports();
    const { recoverGeneration } = await import(${JSON.stringify(moduleUrl)});
    recoverGeneration(process.argv[1]);
  `,
      root,
      lock,
    ],
    { encoding: 'utf8' },
  );
  expect(child.status, child.stderr).toBe(23);
  const claim = path.join(lock, 'recovery.lock');
  const claimRecord = readFileSync(path.join(claim, 'owner.json'), 'utf8');
  expect(JSON.parse(claimRecord)).toMatchObject({ pid: child.pid, host: hostname() });
  expect(() => recoverGeneration(root)).toThrow(
    /recovery required.*stop all writers and recoverers/,
  );
  expect(readFileSync(path.join(claim, 'owner.json'), 'utf8')).toBe(claimRecord);
  expect(readFileSync(path.join(lock, 'owner.json'), 'utf8')).toBe(record);
  await expect(withArtifactLock(root, async () => {})).rejects.toThrow(/writer lock unavailable/);
  // Both fixture processes have exited and no writer/recoverer is running: manual, quiescent repair.
  rmSync(claim, { recursive: true });
  expect(recoverGeneration(root)).toEqual({ action: 'released-interrupted-stage' });
});

it('refuses an incomplete recovery claim without reading or removing the old writer record', () => {
  const { root, lock, record } = interruptedWriter();
  const claim = path.join(lock, 'recovery.lock');
  mkdirSync(claim);
  const ownerRead = vi.fn();
  boundary.afterRead = ownerRead;
  expect(() => recoverGeneration(root)).toThrow(
    /recovery required.*stop all writers and recoverers/,
  );
  expect(ownerRead).not.toHaveBeenCalled();
  boundary.afterRead = undefined;
  expect(existsSync(claim)).toBe(true);
  expect(readFileSync(path.join(lock, 'owner.json'), 'utf8')).toBe(record);
});

it('preserves a live writer and its output when recovery is refused', async () => {
  const root = realpathSync(makeTemp('robota-recovery-live-'));
  const lock = path.join(root, GENERATION_DIRECTORY, 'writer.lock');
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const writer = withArtifactLock(root, async () => {
    await pending;
  });
  try {
    const record = readFileSync(path.join(lock, 'owner.json'), 'utf8');
    writeFileSync(path.join(root, 'original.txt'), 'unchanged');
    expect(() => recoverGeneration(root)).toThrow(/still running; recovery refused/);
    expect(readFileSync(path.join(lock, 'owner.json'), 'utf8')).toBe(record);
    expect(readFileSync(path.join(root, 'original.txt'), 'utf8')).toBe('unchanged');
    expect(existsSync(path.join(lock, 'recovery.lock/owner.json'))).toBe(true);
  } finally {
    release();
    await writer;
  }
});

it('retains the claimed writer, journal and output when reconciliation fails', () => {
  const { root, lock, record } = interruptedWriter();
  const journal = path.join(path.dirname(lock), 'transaction.json');
  const transaction = JSON.stringify({ version: 2, id: 'invalid' });
  writeFileSync(journal, transaction);
  writeFileSync(path.join(root, 'original.txt'), 'unchanged');
  expect(() => recoverGeneration(root)).toThrow(/invalid recovery transaction; files retained/);
  expect(readFileSync(journal, 'utf8')).toBe(transaction);
  expect(readFileSync(path.join(lock, 'owner.json'), 'utf8')).toBe(record);
  expect(readFileSync(path.join(root, 'original.txt'), 'utf8')).toBe('unchanged');
  expect(existsSync(path.join(lock, 'recovery.lock/owner.json'))).toBe(true);
});

it('refuses a lost claim when the owner-read boundary returns a record from a replaced writer lock', async () => {
  const { root, lock } = interruptedWriter();
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  let writer;
  boundary.afterRead = (file) => {
    if (file !== path.join(lock, 'owner.json')) return;
    boundary.afterRead = undefined;
    // A live writer's finally can remove its lock while a recovery is checking its owner.
    // Model that replacement at the fs boundary, returning the earlier record to recovery.
    rmSync(lock, { recursive: true });
    writer = withArtifactLock(root, async () => {
      await pending;
    }).catch((error) => error);
  };
  try {
    expect(() => recoverGeneration(root)).toThrow(/recovery claim.*recovery required/);
    expect(JSON.parse(readFileSync(path.join(lock, 'owner.json'), 'utf8')).pid).toBe(process.pid);
  } finally {
    release();
    await writer;
  }
});
