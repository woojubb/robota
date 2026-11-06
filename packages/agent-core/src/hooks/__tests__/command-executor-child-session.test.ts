/**
 * A command hook is a program a repository or user configured: in secure mode it runs in its own
 * session, so it cannot reach the owner's terminal, and its timeout ends everything it started. In
 * plain mode it runs exactly as before, in this process's group.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { enableOwnChildSessions } from '../../node.js';
import { resetChildSessionsForTesting } from '../../testing/index.js';
import { CommandExecutor } from '../executors/command-executor.js';

import type { IHookInput } from '../types.js';

const input: IHookInput = {
  session_id: 'test',
  cwd: process.cwd(),
  hook_event_name: 'SessionStart',
};
const strays: number[] = [];

afterEach(() => {
  resetChildSessionsForTesting();
  for (const pid of strays.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
});

function processGroupOf(pid: number): number {
  return Number(
    execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' }).trim(),
  );
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function goneWithin(pid: number, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline && alive(pid))
    await new Promise((resolve) => setTimeout(resolve, 50));
  return !alive(pid);
}

/** The hook's own pid and process group, as the hook reports them. */
async function hookGroup(): Promise<{ pid: number; group: number }> {
  const outcome = await new CommandExecutor('/bin/sh').execute(
    { type: 'command', command: 'echo $$ $(ps -o pgid= -p $$)' },
    input,
  );
  if (outcome.outcome !== 'allow') throw new Error(`hook did not run: ${JSON.stringify(outcome)}`);
  const [pid, group] = outcome.stdout.trim().split(/\s+/u).map(Number);
  return { pid: pid!, group: group! };
}

describe.skipIf(process.platform === 'win32')('a command hook and the terminal session', () => {
  it('runs in this process group in plain mode, as before (guard)', async () => {
    const { group } = await hookGroup();

    expect(group).toBe(processGroupOf(process.pid));
  });

  it('leads its own session and group in secure mode', async () => {
    enableOwnChildSessions();
    const { pid, group } = await hookGroup();

    expect(group).toBe(pid);
  });

  it('ends what it started when its timeout fires in secure mode', async () => {
    enableOwnChildSessions();
    const root = mkdtempSync(join(tmpdir(), 'hook-group-'));
    try {
      const pidFile = join(root, 'grandchild');
      const outcome = await new CommandExecutor('/bin/sh').execute(
        { type: 'command', command: `sleep 60 & echo $! > ${pidFile}; wait`, timeout: 1 },
        input,
      );
      const grandchild = Number(readFileSync(pidFile, 'utf8').trim());
      strays.push(grandchild);

      expect(outcome.outcome === 'error' && outcome.kind).toBe('timeout');
      expect(await goneWithin(grandchild, 3000)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // Guard: without a controlling terminal (CI, this runner) the hook fails either way; agent-cli's pty
  // test shows the same hook opening the terminal in plain mode. The open runs in a subshell and the
  // hook exits 1 when it fails: dash (Linux's /bin/sh) exits a shell whose `exec` redirection fails
  // with status 2, which is a hook's way of saying deny, while bash exits 1.
  it('fails with its own error when it needs a terminal in secure mode (guard)', async () => {
    enableOwnChildSessions();
    const outcome = await new CommandExecutor('/bin/sh').execute(
      { type: 'command', command: '(exec 3</dev/tty) || exit 1' },
      input,
    );

    expect(outcome).toMatchObject({ outcome: 'error', kind: 'nonzero-exit' });
    expect(outcome.outcome === 'error' && outcome.reason).toMatch(/\/dev\/tty/u);
  });
});
