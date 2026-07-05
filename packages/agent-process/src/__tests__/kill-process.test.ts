/**
 * CORE-023 — killProcessTree escalation tests against real child processes.
 *
 * These spawn actual processes (some SIGTERM-ignoring via `trap '' TERM`) and assert the
 * SIGTERM → grace → SIGKILL escalation settles on the real exit event, and that a detached
 * child's grandchild is reaped by the process-group kill (the CORE-018 grandchild-survival
 * regression this helper exists to fix).
 */
import { spawn } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_KILL_GRACE_MS, killProcessTree } from '../kill-process';

import type { ChildProcess } from 'node:child_process';

const isPosix = process.platform !== 'win32';
const spawned: ChildProcess[] = [];

function track(child: ChildProcess): ChildProcess {
  spawned.push(child);
  return child;
}

/** Resolve when the child prints `ready` on stdout (its trap/grandchild is installed) or after `ms`. */
function waitForReady(child: ChildProcess, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    child.stdout?.on('data', (chunk: Buffer) => {
      if (chunk.toString('utf8').includes('ready')) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}

afterEach(() => {
  for (const child of spawned) {
    try {
      if (child.pid && child.exitCode === null) process.kill(-child.pid, 'SIGKILL');
    } catch {
      /* best effort */
    }
    try {
      child.kill('SIGKILL');
    } catch {
      /* best effort */
    }
  }
  spawned.length = 0;
});

describe('killProcessTree (CORE-023)', () => {
  it('exposes the shared grace default', () => {
    expect(DEFAULT_KILL_GRACE_MS).toBe(2000);
  });

  it('resolves immediately for an already-exited child without signalling', async () => {
    const child = track(spawn('true', [], { detached: isPosix }));
    await new Promise<void>((resolve) => child.on('exit', () => resolve()));

    const start = Date.now();
    await killProcessTree(child);
    expect(Date.now() - start).toBeLessThan(200);
  });

  it('a cooperative child exits on SIGTERM well before the grace window', async () => {
    const child = track(spawn('sleep', ['30'], { detached: isPosix }));
    // give it a beat to actually start
    await new Promise((r) => setTimeout(r, 100));

    const start = Date.now();
    await killProcessTree(child, { graceMs: 5000, processGroup: isPosix });
    // Resolved on real exit, and long before the 5s grace → SIGTERM did it.
    expect(Date.now() - start).toBeLessThan(2000);
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  });

  it.runIf(isPosix)('a SIGTERM-ignoring child is SIGKILLed after the grace window', async () => {
    // trap '' TERM ignores SIGTERM; only SIGKILL can end it.
    // `echo ready` fires only AFTER the trap is installed, so we never signal before the child
    // is ignoring SIGTERM (a fixed sleep raced under parallel-suite load and got SIGTERM-killed).
    const child = track(
      spawn('sh', ['-c', "trap '' TERM; echo ready; while true; do sleep 0.2; done"], {
        detached: true,
      }),
    );
    await waitForReady(child, 2000);

    const start = Date.now();
    await killProcessTree(child, { graceMs: 400, processGroup: true });
    const elapsed = Date.now() - start;
    // SIGKILL is the meaningful outcome: SIGTERM was ignored, only the escalation ended it.
    // The elapsed lower bound is a loose sanity that it did not resolve instantly.
    expect(child.signalCode).toBe('SIGKILL');
    expect(elapsed).toBeGreaterThanOrEqual(200);
  });

  it.runIf(isPosix)(
    'reaps a grandchild via the process-group kill (CORE-018 regression)',
    async () => {
      // The shell (direct child) backgrounds `sleep` (grandchild) and prints its PID. A non-group
      // SIGTERM would kill only the shell and orphan the sleep; a process-group kill reaps both.
      // Asserting on the exact grandchild PID (not a pgrep pattern) is collision-free under load.
      const child = track(
        spawn('sh', ['-c', `sleep 120 & echo ready $!; wait`], { detached: true }),
      );

      let grandchildPid = 0;
      child.stdout?.on('data', (chunk: Buffer) => {
        const match = /ready (\d+)/.exec(chunk.toString('utf8'));
        if (match) grandchildPid = Number(match[1]);
      });
      for (let i = 0; i < 20 && grandchildPid === 0; i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(grandchildPid).toBeGreaterThan(0);

      await killProcessTree(child, { graceMs: 600, processGroup: true });
      await new Promise((r) => setTimeout(r, 200));

      // The grandchild PID must be dead — kill -0 throws ESRCH for a reaped process.
      const grandchildAlive = ((): boolean => {
        try {
          process.kill(grandchildPid, 0);
          return true;
        } catch {
          return false;
        }
      })();
      expect(grandchildAlive).toBe(false);
    },
  );

  it('runs preKill before signalling and tolerates a throwing preKill', async () => {
    const order: string[] = [];
    const child = track(spawn('sleep', ['30'], { detached: isPosix }));
    await new Promise((r) => setTimeout(r, 100));
    child.on('exit', () => order.push('exit'));

    await killProcessTree(child, {
      graceMs: 5000,
      processGroup: isPosix,
      preKill: () => {
        order.push('preKill');
        throw new Error('preKill boom — must be swallowed');
      },
    });

    expect(order[0]).toBe('preKill');
    expect(order).toContain('exit');
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  });
});
