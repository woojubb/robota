/**
 * One process-wide list of directories to remove when the process ends, however it ends.
 *
 * ## One registry, shared by every copy of this module
 *
 * A listener per directory runs into Node's listener-leak warning once an embedder makes eleven, and
 * two copies of this module in one process (two installed versions) would each keep their own list.
 * So the list and its listeners live on `globalThis` under a registered symbol: one `exit` listener
 * and one listener per signal for the whole process, installed while the list is non-empty and
 * removed when it empties, so a process with nothing registered keeps its signal handling untouched.
 *
 * ## Signals: clean up, then end exactly as the process would have
 *
 * Node runs `exit` listeners on a normal exit but not when a signal's default action kills it, and a
 * signal with any listener no longer kills by default. The signal listener therefore acts only when
 * nothing else handles the signal: it removes the directories, removes its own listeners and raises
 * the signal again, so the default action ends the process by that signal, as before. When the
 * process has its own handler (the terminal UI's graceful shutdown, a server's stop), that handler
 * decides how the process ends and the `exit` listener removes the directories then.
 *
 * signal-exit (loaded by Ink and others) follows the same "only when every listener is mine" rule;
 * its listeners are counted as ours, or each would defer to the other and the signal would be
 * ignored. After this listener re-raises, signal-exit is alone and runs its own exit handlers.
 *
 * Windows has no such signals; its console events are left to Node, and a run they end is swept at
 * the next start.
 *
 * ## Crashes
 *
 * An `uncaughtException` handler that rethrows ends the process without `exit`. Such a handler calls
 * {@link removeProcessScopedDirectoriesNow} before rethrowing. No handler is installed here: one would
 * keep a crashing process alive.
 */

import { rmSync } from 'node:fs';

const REGISTRY = Symbol.for('@robota-sdk/agent-core:process-exit-removals@1');
const SIGNALS = ['SIGHUP', 'SIGINT', 'SIGTERM'] as const;
const SIGNAL_EXIT_V4 = Symbol.for('signal-exit emitter');

interface IProcessExitRemovals {
  readonly directories: Set<string>;
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
    listening: false,
    onExit: () => removeAll(state),
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
  // Someone else handles this signal and decides how the process ends; its exit removes the list.
  if (process.listenerCount(signal) > 1 + signalExitListenerCount()) return;
  removeAll(state);
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

function removeAll(state: IProcessExitRemovals): void {
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
    if (state.directories.size === 0) stopListening(state);
  };
}

/**
 * Remove every directory registered with {@link removeDirectoryOnProcessExit} now. For an ending on
 * which Node emits no `exit`, such as an `uncaughtException` handler that rethrows. Safe to repeat.
 */
export function removeProcessScopedDirectoriesNow(): void {
  removeAll(registry());
}
