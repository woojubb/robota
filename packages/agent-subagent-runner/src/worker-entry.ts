/**
 * DIST-006: how a subagent worker process is STARTED, stated by the composition root.
 *
 * The seam this replaces asked a library "where is my worker file on disk?" — a question it cannot
 * answer, because the answer is a property of the packaging step, not of the library. It was wrong
 * twice for the same reason: once when the worker had no bundle entry at all, and again when a
 * downstream bundler inlined this package into another artifact and moved the resolver's notion of
 * "next to me" one package along.
 *
 * The only party that knows how a process is packaged is that process. So the composition root
 * states how to start a copy of itself, and this package owns nothing but the IPC contract.
 */

/**
 * The argv flag that puts a composition root's own entry into subagent-worker mode.
 *
 * Deliberately not a plausible user flag: it is part of an internal process contract, and a user
 * who types it gets a loud refusal rather than a half-started worker.
 */
export const SUBAGENT_WORKER_MODE_FLAG = '--__robota-subagent-worker';

/**
 * How to spawn a copy of the running artifact in subagent-worker mode.
 *
 * `execPath` + `args` is the whole contract, and it is satisfiable by every artifact shape:
 * - a bundled Node build names the file it is currently executing;
 * - a `tsx` source run names the same thing and adds `--import tsx` to `execArgv`;
 * - a single-file compiled binary names NOTHING — `process.execPath` is the binary, and
 *   re-executing it re-enters its embedded entry.
 */
export interface ISubagentWorkerEntry {
  /** The executable to run. `process.execPath` for every artifact this repository ships. */
  readonly execPath: string;
  /** Arguments before the worker-mode flag — the entry module, or nothing when it is embedded. */
  readonly args: readonly string[];
  /** Extra runtime flags, e.g. `--import tsx` when the entry is TypeScript source. */
  readonly execArgv?: readonly string[];
}

/** True when this process was started as a subagent worker. */
export function isSubagentWorkerModeArgv(argv: readonly string[]): boolean {
  return argv.includes(SUBAGENT_WORKER_MODE_FLAG);
}
