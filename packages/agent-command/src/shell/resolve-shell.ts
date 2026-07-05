/**
 * TERM-003 shell-selection seam, now backed by the cross-platform SSOT resolver in agent-core
 * (TERM-008). Keep all shell choice behind this function so the call sites never change; the
 * per-platform logic (POSIX `$SHELL`/`sh`, Windows PowerShell) lives once in `resolvePlatformShell`.
 */
import { resolvePlatformShell } from '@robota-sdk/agent-core';

export interface IResolvedShell {
  /** Executable to spawn. */
  command: string;
  /** Args for an interactive shell session (drop-to-shell). */
  interactiveArgs: readonly string[];
  /** Args to run a single command string non-interactively. */
  commandArgs(command: string): readonly string[];
}

/** Resolve the interactive shell for the current platform via the agent-core SSOT resolver. */
export function resolveShell(): IResolvedShell {
  const shell = resolvePlatformShell();
  return {
    command: shell.command,
    interactiveArgs: shell.interactiveArgs,
    commandArgs: (cmd: string) => shell.commandArgs(cmd),
  };
}
