import type { ISubagentWorkerEntry } from '@robota-sdk/agent-subagent-runner';

/**
 * DIST-006: how `the product` starts a copy of ITSELF in subagent-worker mode.
 *
 * This is composition-root knowledge by construction: the only party that knows how a process is
 * packaged is that process. The seam this replaced asked a library to find a worker file on disk,
 * which is a fact about the packaging step, and it was wrong twice — once when the file was never
 * emitted, and again when bundling `agent-subagent-runner` into this package moved the resolver's
 * notion of "next to me" one package along.
 *
 * `the product` ships in three artifact shapes and this answers for all of them:
 *
 * | Artifact                                   | `process.execPath` | entry            |
 * | ------------------------------------------ | ------------------ | ---------------- |
 * | npm `dist/node/bin.js`                     | the `node` binary  | that file        |
 * | `tsx src/bin.ts` (source)                  | the `node` binary  | that `.ts` file  |
 * | Bun single-file binary / desktop sidecar   | the binary itself  | embedded, unnamed |
 */

/**
 * Bun's single-file builds mount their entry in an embedded filesystem — `/$bunfs/…` on POSIX,
 * `B:\~BUN\…` on Windows. Those paths are readable only inside the running binary, so they can
 * never be handed to a new process; re-executing the binary is what re-enters that entry.
 *
 * Deliberately a prefix test rather than an existence test: `existsSync` returns TRUE for an
 * embedded path inside the binary, so it cannot tell the two cases apart.
 *
 * The POSIX prefix was verified against a real `bun --compile` binary. **The Windows prefix is
 * UNVERIFIED** — no Windows host was available. Measured blast radius if it is wrong: none. A
 * compiled binary always re-enters its embedded entry, and worker-mode dispatch happens before any
 * argument parsing, so a missed prefix costs one stray argv element rather than a dead worker
 * (handshake succeeded 3/3 when an embedded-looking entry arg was passed deliberately).
 */
function isEmbeddedEntry(entry: string): boolean {
  return entry.startsWith('/$bunfs/') || /^[A-Za-z]:\\~BUN\\/.test(entry);
}

/**
 * Preserve an existing TypeScript loader rather than adding a second one, and add one when the
 * entry is source but nothing loaded it — a `.ts` entry handed to bare `node` cannot run.
 */
function resolveSourceExecArgv(entry: string): readonly string[] | undefined {
  if (!entry.endsWith('.ts') && !entry.endsWith('.mts')) return undefined;
  if (process.execArgv.some((arg) => arg.includes('tsx'))) return [...process.execArgv];
  return [...process.execArgv, '--import', 'tsx'];
}

const DISABLE_INSPECTOR_SIGNAL = '--disable-sigusr1';

/**
 * #3679: Node opens an inspector on SIGUSR1, and any same-user process can send that signal and then
 * attach to the debugger to read or drive the copy — a daemon outlives its window, a worker holds the
 * session's credential. The entry a copy re-enters closes this too, but only once it runs; the flag
 * closes it from the copy's first instruction. It is a Node flag (added 22.14/23.7), so it is added
 * only when this Node accepts it, never under Bun, where SIGUSR1 opens no Node inspector, and once.
 */
export function withInspectorSignalDisabled(execArgv: readonly string[]): readonly string[] {
  if (process.versions.bun !== undefined) return execArgv;
  if (!process.allowedNodeEnvironmentFlags.has(DISABLE_INSPECTOR_SIGNAL)) return execArgv;
  if (execArgv.includes(DISABLE_INSPECTOR_SIGNAL)) return execArgv;
  return [DISABLE_INSPECTOR_SIGNAL, ...execArgv];
}

export function resolveSelfForkWorkerEntry(): ISubagentWorkerEntry {
  const entry = process.argv[1];
  if (entry === undefined || isEmbeddedEntry(entry)) {
    return { execPath: process.execPath, args: [] };
  }
  const execArgv = withInspectorSignalDisabled(resolveSourceExecArgv(entry) ?? []);
  return {
    execPath: process.execPath,
    args: [entry],
    ...(execArgv.length > 0 ? { execArgv } : {}),
  };
}
