/**
 * TERM-003: shell-selection seam. macOS/Linux first; Windows (`%ComSpec%` / PowerShell) is the
 * follow-up (TERM-007) — keep all shell choice behind this function so the call sites never change.
 */
export interface IResolvedShell {
  /** Executable to spawn. */
  command: string;
  /** Args for an interactive shell session (drop-to-shell). */
  interactiveArgs: readonly string[];
  /** Args to run a single command string non-interactively. */
  commandArgs(command: string): readonly string[];
}

/** Resolve the interactive shell for the current platform (POSIX: `$SHELL`, fallback `/bin/sh`). */
export function resolveShell(): IResolvedShell {
  // Windows branch is intentionally deferred to TERM-007; on POSIX use the user's shell.
  const fromEnv = process.env.SHELL;
  const command = fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : '/bin/sh';
  return {
    command,
    interactiveArgs: [],
    commandArgs: (cmd: string) => ['-c', cmd],
  };
}
