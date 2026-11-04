/**
 * The children this package starts besides the shell tool's — the sandbox probe and run, and the
 * grep worker Bun uses — run in their own session in secure mode and exactly as before in plain mode.
 * The shell tool already ran in its own session on POSIX in both modes; its options do not change.
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { enableOwnChildSessions } from '@robota-sdk/agent-core/node';
import { resetChildSessionsForTesting } from '@robota-sdk/agent-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IsolatedGrepSearch } from '../builtins/isolated-grep-search.js';
import { createShellTool } from '../builtins/shell-tool.js';
import { OsSandboxClient, detectOsSandbox } from '../sandbox/os-sandbox-client.js';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn(actual.spawn), spawnSync: vi.fn(actual.spawnSync) };
});

const POSIX = process.platform !== 'win32';
let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'tools-session-')));
});

afterEach(() => {
  resetChildSessionsForTesting();
  rmSync(root, { recursive: true, force: true });
  vi.mocked(spawn).mockClear();
  vi.mocked(spawnSync).mockClear();
});

function sandbox(): OsSandboxClient {
  return new OsSandboxClient({
    root,
    availability: { missing: [] },
    projectStateDirectory: '.test-product',
    userQuarantineDirectory: join(root, '.test-product', 'sandbox-quarantine'),
  });
}

async function sandboxRunReport(): Promise<{ pid: number; group: number }> {
  const result = await sandbox().run('echo $$ $(/bin/ps -o pgid= -p $$)');
  const [pid, group] = result.stdout.trim().split(/\s+/u).map(Number);
  return { pid: pid!, group: group! };
}

async function grepSpawnOptions(): Promise<unknown> {
  const versions = process.versions as Record<string, string | undefined>;
  Object.defineProperty(versions, 'bun', { value: 'test', configurable: true });
  let search: IsolatedGrepSearch;
  try {
    search = new IsolatedGrepSearch('x');
  } finally {
    delete versions.bun;
  }
  await search.stop();
  return vi.mocked(spawn).mock.calls.at(-1)?.[2];
}

describe.skipIf(!POSIX)('the sandbox and the terminal session', () => {
  it('runs a sandbox command in this process group in plain mode (guard)', async () => {
    const { group } = await sandboxRunReport();

    expect(group).toBe(
      Number(
        spawnSync('ps', ['-o', 'pgid=', '-p', String(process.pid)], {
          encoding: 'utf8',
        }).stdout.trim(),
      ),
    );
  });

  it('runs a sandbox command in its own session in secure mode', async () => {
    enableOwnChildSessions();
    const { pid, group } = await sandboxRunReport();

    expect(group).toBe(pid);
  });

  it('probes the backend with the options it always had in plain mode, and in its own session in secure mode', () => {
    detectOsSandbox({ platform: 'darwin' });
    const plain = vi.mocked(spawnSync).mock.calls.at(-1)?.[2];
    enableOwnChildSessions();
    detectOsSandbox({ platform: 'darwin' });
    const secure = vi.mocked(spawnSync).mock.calls.at(-1)?.[2];

    expect(plain).toEqual({ timeout: 5_000, encoding: 'utf8' });
    expect(secure).toEqual({ timeout: 5_000, encoding: 'utf8', detached: true });
  });
});

describe.skipIf(!POSIX)('the grep worker Bun uses', () => {
  it('starts with the options it always had in plain mode, and in its own session in secure mode', async () => {
    const plain = await grepSpawnOptions();
    enableOwnChildSessions();
    const secure = await grepSpawnOptions();
    const env = {
      BUN_BE_BUN: '1',
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    };

    expect(plain).toEqual({ env, cwd: tmpdir(), stdio: 'pipe' });
    expect(secure).toEqual({ env, cwd: tmpdir(), stdio: 'pipe', detached: true });
  });
});

describe.skipIf(!POSIX)('the shell tool', () => {
  it('starts with the same options in both modes, since it already had its own session (guard)', async () => {
    const run = async (): Promise<unknown> => {
      await createShellTool({ cwd: root }).execute({ command: 'true' });
      return vi.mocked(spawn).mock.calls.at(-1)?.[2];
    };
    const plain = await run();
    enableOwnChildSessions();
    const secure = await run();

    expect(plain).toMatchObject({ detached: true, stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });
    expect(secure).toEqual(plain);
  });
});
