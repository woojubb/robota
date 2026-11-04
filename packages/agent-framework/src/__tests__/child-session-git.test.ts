/**
 * Every git this package starts — the `/git` verbs, the workspace trust check, the classifier's
 * remote read — runs repository configuration (hooks, fsmonitor, credential helpers) and is found on
 * `PATH`. In secure mode it runs in its own session; in plain mode exactly as before.
 *
 * A stub `git` reports its own pid and process group, so the session is observed, not assumed.
 */

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { enableOwnChildSessions } from '@robota-sdk/agent-core/node';
import { resetChildSessionsForTesting } from '@robota-sdk/agent-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readNodeGitRemotes } from '../git/read-git-remotes.js';
import { createGitProcess } from '../git/node-git-process.js';
import { createNodeWorkspaceIdentityResolver } from '../workspace-trust/node-host-workspace-trust.js';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) };
});

const POSIX = process.platform !== 'win32';
let bin: string;
let originalPath: string | undefined;

beforeEach(() => {
  bin = realpathSync(mkdtempSync(join(tmpdir(), 'git-stub-')));
  // Answers every invocation with `origin <pid>:<group> (fetch)`, the shape `git remote -v` prints.
  writeFileSync(
    join(bin, 'git'),
    '#!/bin/sh\necho "origin $$:$(/bin/ps -o pgid= -p $$ | tr -d \' \') (fetch)"\n',
  );
  chmodSync(join(bin, 'git'), 0o755);
  originalPath = process.env.PATH;
  process.env.PATH = `${bin}:${originalPath ?? ''}`;
});

afterEach(() => {
  resetChildSessionsForTesting();
  process.env.PATH = originalPath;
  rmSync(bin, { recursive: true, force: true });
  vi.mocked(execFileSync).mockClear();
});

function processGroupOf(pid: number): number {
  return Number(
    execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' }).trim(),
  );
}

function pidAndGroup(reported: string): { pid: number; group: number } {
  const [pid, group] = reported.split(':').map(Number);
  return { pid: pid!, group: group! };
}

async function gitProcessReport(): Promise<{ pid: number; group: number }> {
  const outcome = await createGitProcess({ executable: join(bin, 'git') }).run(['status'], {
    cwd: bin,
  });
  if (outcome.kind !== 'exited') throw new Error(`git did not run: ${JSON.stringify(outcome)}`);
  return pidAndGroup(outcome.stdout.trim().split(/\s+/u)[1]!);
}

async function remotesReport(): Promise<{ pid: number; group: number }> {
  const [remote] = await readNodeGitRemotes(bin);
  return pidAndGroup(remote!);
}

describe.skipIf(!POSIX)('git and the terminal session', () => {
  it('runs the /git verbs and the remote read in this process group in plain mode (guard)', async () => {
    const group = processGroupOf(process.pid);

    expect((await gitProcessReport()).group).toBe(group);
    expect((await remotesReport()).group).toBe(group);
  });

  it('runs the /git verbs in their own session in secure mode', async () => {
    enableOwnChildSessions();
    const { pid, group } = await gitProcessReport();

    expect(group).toBe(pid);
  });

  it('runs the classifier remote read in its own session in secure mode', async () => {
    enableOwnChildSessions();
    const { pid, group } = await remotesReport();

    expect(group).toBe(pid);
  });

  it('runs the trust check git with the options it always had in plain mode, and in its own session in secure mode', () => {
    const resolve = (): void => {
      try {
        createNodeWorkspaceIdentityResolver().resolve(bin);
      } catch {
        // the stub is not a repository; only the options git was started with matter here
      }
    };
    resolve();
    const plain = vi.mocked(execFileSync).mock.calls[0]?.[2];
    vi.mocked(execFileSync).mockClear();
    enableOwnChildSessions();
    resolve();
    const secure = vi.mocked(execFileSync).mock.calls[0]?.[2];

    expect(plain).toEqual({ cwd: bin, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    expect(secure).toEqual({
      cwd: bin,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      detached: true,
    });
  });
});
