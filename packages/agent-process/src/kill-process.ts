import { spawnSync } from 'node:child_process';

import type { ChildProcess } from 'node:child_process';

/**
 * Shared grace window (ms) between the initial signal and the forced SIGKILL. Previously
 * duplicated as `DEFAULT_KILL_GRACE_MS` in every runner package (CORE-023).
 */
export const DEFAULT_KILL_GRACE_MS = 2000;

/** Options for {@link killProcessTree}. */
export interface IKillProcessOptions {
  /** Grace window before escalating to SIGKILL. Defaults to {@link DEFAULT_KILL_GRACE_MS}. */
  graceMs?: number;
  /** Initial signal to send. Defaults to `SIGTERM`. */
  signal?: NodeJS.Signals;
  /**
   * Kill the child's whole process group, not just the direct child. Requires the caller to
   * have spawned the child with `detached: true` on POSIX (so it is a group leader). Without
   * this a shell child's grandchildren survive the SIGTERM (the CORE-018 regression).
   */
  processGroup?: boolean;
  /**
   * Optional graceful step run before any signal — e.g. an IPC `{ type: 'cancel' }` message for
   * a forked worker. A throwing/rejecting pre-kill is swallowed; escalation still runs.
   */
  preKill?: () => void | Promise<void>;
}

const isWindows = process.platform === 'win32';

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

/** Send a signal to the child (or its group on POSIX), swallowing ESRCH for an already-dead target. */
function signalChild(child: ChildProcess, signal: NodeJS.Signals, processGroup: boolean): void {
  if (processGroup && !isWindows && typeof child.pid === 'number') {
    try {
      // Negative pid targets the whole process group (child must have been spawned detached).
      process.kill(-child.pid, signal);
      return;
    } catch {
      // allow-fallback: group gone or not a leader — fall through to direct-child signal; ESRCH on a dead target is by design
    }
  }
  try {
    child.kill(signal);
  } catch {
    // allow-fallback: signalling an already-exited child throws ESRCH — the terminal-safe no-op we want
  }
}

/** Force-kill the child tree: POSIX process-group SIGKILL, Windows `taskkill /T /F`. */
function forceKill(child: ChildProcess, processGroup: boolean): void {
  if (isWindows && typeof child.pid === 'number') {
    // node cannot kill a Windows process tree; taskkill /T terminates the whole tree.
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  signalChild(child, 'SIGKILL', processGroup);
}

/**
 * Terminate a spawned `ChildProcess` and its descendants, escalating SIGTERM → grace → SIGKILL,
 * and resolve only once the process has actually exited (CORE-023, SPEC § Termination contract).
 *
 * Settling on the real `exit` event — never synchronously, never on the misleading `child.killed`
 * flag — lets a caller safely run follow-up cleanup (temp-dir removal, worktree teardown) knowing
 * the tree is gone.
 *
 * @throws if the child was never spawned (no `pid` and no exit state) — a programming error.
 */
export async function killProcessTree(
  child: ChildProcess,
  options: IKillProcessOptions = {},
): Promise<void> {
  const graceMs = options.graceMs ?? DEFAULT_KILL_GRACE_MS;
  const signal = options.signal ?? 'SIGTERM';
  const processGroup = options.processGroup ?? false;

  if (hasExited(child)) return;
  if (typeof child.pid !== 'number') {
    throw new Error('[agent-process] killProcessTree called with an unspawned child (no pid)');
  }

  if (options.preKill) {
    try {
      await options.preKill();
    } catch {
      // allow-fallback: preKill is a best-effort graceful step (e.g. IPC cancel); escalation still runs
    }
    if (hasExited(child)) return;
  }

  return new Promise<void>((resolve) => {
    let graceTimer: ReturnType<typeof setTimeout> | undefined;

    const onExit = (): void => {
      if (graceTimer) clearTimeout(graceTimer);
      resolve();
    };
    child.once('exit', onExit);

    // Guard against a race where the child exited between hasExited() and listener attach.
    if (hasExited(child)) {
      child.removeListener('exit', onExit);
      resolve();
      return;
    }

    signalChild(child, signal, processGroup);

    graceTimer = setTimeout(() => {
      if (!hasExited(child)) forceKill(child, processGroup);
    }, graceMs);
    // Do not keep the event loop alive solely for the grace timer.
    graceTimer.unref?.();
  });
}
