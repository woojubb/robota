import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { PROCESS_OWNER_RECORD_NAME } from '@robota-sdk/agent-core/node';
import { goneProcessOwner, leaveProcessScopedDirectory } from '@robota-sdk/agent-core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  NodeToolResultSpillStore,
  sweepStaleToolResultSpillDirectories,
} from './tool-result-spill-store.js';

const parents: string[] = [];

function parent(): string {
  const path = mkdtempSync(join(tmpdir(), 'agent-spill-test-'));
  parents.push(path);
  return path;
}

/** The results a store directory holds, without the owner record every such directory carries. */
function spilled(directory: string): string[] {
  return readdirSync(directory).filter((name) => name !== PROCESS_OWNER_RECORD_NAME);
}

afterEach(() => {
  vi.useRealTimers();
  for (const path of parents.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('NodeToolResultSpillStore', () => {
  it('commits an opaque reference into owner-only storage and removes it at shutdown', async () => {
    const root = parent();
    const store = new NodeToolResultSpillStore({ parentDirectory: root });
    const secret = 'authorization=secret-value';

    const { reference } = await store.write(secret);
    expect(reference).toMatch(/^tool-result:[A-Za-z0-9_-]{22,64}$/u);
    expect(reference).not.toContain(secret);
    expect(await store.read(reference)).toBe(secret);

    const [directoryName] = readdirSync(root);
    expect(directoryName).toBeDefined();
    expect(directoryName).toMatch(/^agent-tool-results-[A-Za-z0-9_-]+$/u);
    const directory = join(root, directoryName!);
    const [fileName] = spilled(directory);
    expect(fileName).toBeDefined();
    expect(readFileSync(join(directory, fileName!), 'utf8')).toBe(secret);
    if (process.platform !== 'win32') {
      expect(statSync(directory).mode & 0o777).toBe(0o700);
      expect(statSync(join(directory, fileName!)).mode & 0o777).toBe(0o600);
    }

    await store.shutdown();
    expect(readdirSync(root)).toEqual([]);
  });

  it('rejects traversal, unknown references, and a swapped symlink without reading outside storage', async () => {
    const root = parent();
    const store = new NodeToolResultSpillStore({ parentDirectory: root });
    const { reference } = await store.write('contained');
    await expect(store.read('tool-result:../../outside')).rejects.toMatchObject({
      code: 'invalid-reference',
    });
    await expect(store.read('tool-result:aaaaaaaaaaaaaaaaaaaaaa')).rejects.toMatchObject({
      code: 'missing',
    });
    const directory = join(root, readdirSync(root)[0]!);
    const file = join(directory, spilled(directory)[0]!);
    const outside = join(root, 'outside.txt');
    writeFileSync(outside, 'outside-secret');
    unlinkSync(file);
    symlinkSync(outside, file);
    await expect(store.read(reference)).rejects.toMatchObject({ code: 'read-failed' });
    await store.shutdown();
    expect(readFileSync(outside, 'utf8')).toBe('outside-secret');
  });

  it('expires a stored result and removes its file before returning an expiry error', async () => {
    const root = parent();
    let now = 1_000;
    const store = new NodeToolResultSpillStore({
      parentDirectory: root,
      retentionMs: 10,
      now: () => now,
    });
    const { reference } = await store.write('ephemeral-secret');
    now = 1_010;
    await expect(store.read(reference)).rejects.toMatchObject({ code: 'expired' });
    const directory = join(root, readdirSync(root)[0]!);
    expect(spilled(directory)).toEqual([]);
    await store.shutdown();
  });

  it('names a missing committed file without returning a fallback payload', async () => {
    const root = parent();
    const store = new NodeToolResultSpillStore({ parentDirectory: root });
    const { reference } = await store.write('secret-that-is-gone');
    const directory = join(root, readdirSync(root)[0]!);
    unlinkSync(join(directory, spilled(directory)[0]!));
    await expect(store.read(reference)).rejects.toMatchObject({ code: 'missing' });
    await expect(store.shutdown()).rejects.toMatchObject({ code: 'cleanup-failed' });
  });

  it('removes expired files before accepting another write in a long-lived session', async () => {
    const root = parent();
    let now = 1_000;
    const store = new NodeToolResultSpillStore({
      parentDirectory: root,
      retentionMs: 10,
      now: () => now,
    });
    const first = await store.write('first');
    now = 1_011;
    await store.write('second');
    const directory = join(root, readdirSync(root)[0]!);
    expect(spilled(directory)).toHaveLength(1);
    await expect(store.read(first.reference)).rejects.toMatchObject({ code: 'missing' });
    await store.shutdown();
  });

  it('cleans an expired spill on its retention timer even when the session is idle', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-23T00:00:00Z'));
    const root = parent();
    const store = new NodeToolResultSpillStore({ parentDirectory: root, retentionMs: 25 });
    const { reference } = await store.write('short-lived-secret');
    const directory = join(root, readdirSync(root)[0]!);
    await vi.advanceTimersByTimeAsync(25);
    expect(spilled(directory)).toEqual([]);
    await expect(store.read(reference)).rejects.toMatchObject({ code: 'missing' });
    await store.shutdown();
  });

  it('reports an idle retention cleanup failure without exposing the payload', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-23T00:00:00Z'));
    const root = parent();
    const onCleanupFailure = vi.fn();
    const store = new NodeToolResultSpillStore({
      parentDirectory: root,
      retentionMs: 25,
      onCleanupFailure,
    });
    await store.write('secret-retention-body');
    const directory = join(root, readdirSync(root)[0]!);
    unlinkSync(join(directory, spilled(directory)[0]!));
    await vi.advanceTimersByTimeAsync(25);
    expect(onCleanupFailure).toHaveBeenCalledExactlyOnceWith('cleanup-failed');
    expect(JSON.stringify(onCleanupFailure.mock.calls)).not.toContain('secret-retention-body');
    await expect(store.shutdown()).rejects.toMatchObject({ code: 'cleanup-failed' });
  });

  it('names its directory for the owning process so a later start can tell it is stale', async () => {
    const root = parent();
    const store = new NodeToolResultSpillStore({ parentDirectory: root });

    expect(readdirSync(root)).toEqual([
      expect.stringMatching(new RegExp(`^agent-tool-results-${process.pid}-[A-Za-z0-9]{6}$`)),
    ]);
    await store.shutdown();
  });
});

describe('a spill directory left by a process that is gone', () => {
  const DEAD_PID = 2_147_000_000;

  it('is removed by the next start, and a live store beside it is not', async () => {
    const root = parent();
    const live = new NodeToolResultSpillStore({ parentDirectory: root });
    const { reference } = await live.write('still in use');
    const stale = leaveProcessScopedDirectory(
      root,
      'agent-tool-results-',
      goneProcessOwner(DEAD_PID),
    );

    expect(sweepStaleToolResultSpillDirectories(root)).toEqual([
      `agent-tool-results-${DEAD_PID}-abc123`,
    ]);

    expect(existsSync(stale)).toBe(false);
    expect(await live.read(reference)).toBe('still in use');
    await live.shutdown();
  });
});

describe('a process that exits without reaching shutdown()', () => {
  const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
  const storeModule = pathToFileURL(
    fileURLToPath(new URL('./tool-result-spill-store.ts', import.meta.url)),
  ).href;

  /** Runs the real store in a child process that ends the way `endWith` says. */
  function runChild(root: string, endWith: string): ReturnType<typeof spawnSync> {
    const script = [
      `import { NodeToolResultSpillStore } from ${JSON.stringify(storeModule)};`,
      'const store = new NodeToolResultSpillStore({ parentDirectory: process.argv[1] });',
      "await store.write('conversation content');",
      endWith,
    ].join('\n');
    return spawnSync(
      process.execPath,
      ['--import', tsx, '--conditions=source', '--input-type=module', '-e', script, root],
      { encoding: 'utf8', timeout: 30_000 },
    );
  }

  it('leaves nothing behind after a normal exit', () => {
    const root = parent();

    const child = runChild(root, 'process.exit(0);');

    // The child ran to its own exit, so an empty directory is the exit removal and not a failed start.
    expect(child.status).toBe(0);
    expect(readdirSync(root)).toEqual([]);
  });

  it('leaves what a kill cannot clean up, which the next start sweeps', () => {
    const root = parent();

    const child = runChild(root, "process.kill(process.pid, 'SIGKILL');");

    expect(child.signal).toBe('SIGKILL');
    const [left] = readdirSync(root);
    expect(left).toMatch(/^agent-tool-results-\d+-[A-Za-z0-9]{6}$/u);
    expect(sweepStaleToolResultSpillDirectories(root)).toEqual([left]);
    expect(readdirSync(root)).toEqual([]);
  });
});
