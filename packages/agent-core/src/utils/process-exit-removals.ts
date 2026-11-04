/**
 * One process-wide list of what goes when the process ends, however it ends: directories to remove,
 * and the process groups of children that were given their own session.
 *
 * ## One registry, shared by every copy of this module
 *
 * A listener per entry runs into Node's listener-leak warning once an embedder makes eleven, and two
 * copies of this module in one process (two installed versions) would each keep their own list. So
 * the list and its listeners live on `globalThis` under a registered symbol: one `exit` listener and
 * one listener per signal for the whole process, installed while the list is non-empty and removed
 * when it empties, so a process with nothing registered keeps its signal handling untouched.
 * Directories and child groups share it because two registries would each see the other's signal
 * listener as "someone else handles this", and the signal would then be ignored.
 *
 * ## Signals: clean up, then end exactly as the process would have
 *
 * Node runs `exit` listeners on a normal exit but not when a signal's default action kills it, and a
 * signal with any listener no longer kills by default. The signal listener therefore acts only when
 * nothing else handles the signal: it ends the groups, removes the directories, removes its own
 * listeners and raises the signal again, so the default action ends the process by that signal, as
 * before. When the process has its own handler (the terminal UI's graceful shutdown, a server's
 * stop), that handler decides how the process ends and the `exit` listener runs the list then.
 *
 * signal-exit (loaded by Ink and others) follows the same "only when every listener is mine" rule;
 * its listeners are counted as ours, or each would defer to the other and the signal would be
 * ignored. After this listener re-raises, signal-exit is alone and runs its own exit handlers.
 *
 * Windows has no such signals; its console events are left to Node, and a run they end is swept at
 * the next start. No child group is ever registered there (see `child-session.ts`).
 *
 * ## Child groups
 *
 * A child in its own session no longer receives the terminal's hangup, so this process ends it
 * instead. Groups are ended before directories are removed, since a child may still be writing into
 * one. The end is SIGKILL: an `exit` listener cannot wait for a grace period, and a group that
 * ignored SIGTERM would outlive the process. A group is registered only while its leader lives; once
 * the leader is reaped its pid, and so the group id, can belong to an unrelated process.
 *
 * ## Crashes
 *
 * An `uncaughtException` handler that rethrows ends the process without `exit`. Such a handler calls
 * {@link runProcessEndNow} before rethrowing. No handler is installed here: one would keep a crashing
 * process alive.
 */

import { rmSync } from 'node:fs';

const REGISTRY = Symbol.for('@robota-sdk/agent-core:process-exit-removals@2');
const SIGNALS = ['SIGHUP', 'SIGINT', 'SIGTERM'] as const;
const SIGNAL_EXIT_V4 = Symbol.for('signal-exit emitter');

interface IProcessExitRemovals {
  readonly directories: Set<string>;
  readonly groups: Set<number>;
  listening: boolean;
  readonly onExit: () => void;
  readonly onSignal: ReadonlyMap<NodeJS.Signals, () => void>;
}

type TRegistryHolder = { [REGISTRY]?: IProcessExitRemovals };
type TSignalExitHolder = { [SIGNAL_EXIT_V4]?: { count?: unknown } };

function registry(): IProcessExitRemovals {
  const holder = globalThis as TRegistryHolder;
  holder[REGISTRY] ??= createRegistry();
  return holder[REGISTRY];
}

function createRegistry(): IProcessExitRemovals {
  const state: IProcessExitRemovals = {
    directories: new Set(),
    groups: new Set(),
    listening: false,
    onExit: () => runAll(state),
    onSignal: new Map(SIGNALS.map((signal) => [signal, () => onSignal(state, signal)])),
  };
  return state;
}

/** Listeners signal-exit 3 and 4 hold on each signal: one per loaded copy. */
function signalExitListenerCount(): number {
  const v3 = (process as { __signal_exit_emitter__?: { count?: unknown } }).__signal_exit_emitter__;
  const v4 = (globalThis as TSignalExitHolder)[SIGNAL_EXIT_V4];
  const count = (value: unknown): number => (typeof value === 'number' ? value : 0);
  return count(v3?.count) + count(v4?.count);
}

function onSignal(state: IProcessExitRemovals, signal: NodeJS.Signals): void {
  // Someone else handles this signal and decides how the process ends; its exit runs the list.
  if (process.listenerCount(signal) > 1 + signalExitListenerCount()) return;
  runAll(state);
  process.kill(process.pid, signal);
}

function startListening(state: IProcessExitRemovals): void {
  if (state.listening) return;
  state.listening = true;
  process.on('exit', state.onExit);
  if (process.platform === 'win32') return;
  // Prepended, so a `once` handler that runs first cannot hide that the process has a handler.
  for (const [signal, listener] of state.onSignal) process.prependListener(signal, listener);
}

function stopListening(state: IProcessExitRemovals): void {
  if (!state.listening) return;
  state.listening = false;
  process.removeListener('exit', state.onExit);
  for (const [signal, listener] of state.onSignal) process.removeListener(signal, listener);
}

function stopWhenEmpty(state: IProcessExitRemovals): void {
  if (state.directories.size === 0 && state.groups.size === 0) stopListening(state);
}

function runAll(state: IProcessExitRemovals): void {
  for (const group of state.groups) {
    try {
      process.kill(-group, 'SIGKILL');
    } catch {
      // allow-fallback: the group already ended; nothing of it is left to end.
    }
  }
  state.groups.clear();
  for (const directory of state.directories) {
    try {
      rmSync(directory, { recursive: true, force: true });
    } catch {
      // allow-fallback: the process is ending and cannot report or retry; the next start's sweep retries.
    }
  }
  state.directories.clear();
  stopListening(state);
}

/**
 * Remove `directory` and everything in it when this process ends — at exit, or on SIGHUP, SIGINT or
 * SIGTERM that nothing else handles. Returns the function that cancels the removal, for an owner that
 * removes the directory itself first.
 */
export function removeDirectoryOnProcessExit(directory: string): () => void {
  const state = registry();
  state.directories.add(directory);
  startListening(state);
  return () => {
    state.directories.delete(directory);
    stopWhenEmpty(state);
  };
}

/**
 * Kill the process group `groupId` when this process ends, on the same occasions as
 * {@link removeDirectoryOnProcessExit}. Returns the function that cancels it, which the owner calls
 * the moment the group's leader is reaped.
 */
export function endProcessGroupOnProcessExit(groupId: number): () => void {
  const state = registry();
  state.groups.add(groupId);
  startListening(state);
  return () => {
    state.groups.delete(groupId);
    stopWhenEmpty(state);
  };
}

/**
 * End every registered child group and remove every registered directory now. For an ending on which
 * Node emits no `exit`, such as an `uncaughtException` handler that rethrows. Safe to repeat.
 */
export function runProcessEndNow(): void {
  runAll(registry());
}
