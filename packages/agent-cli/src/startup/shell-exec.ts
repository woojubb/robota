import { execSync } from 'node:child_process';

/**
 * The shell the TUI is given for its own command execution.
 *
 * The bounds are the point and they belong beside the call rather than inline in a thirty-key option
 * literal, where a five-second timeout and a piped stdio read as incidental formatting. `pipe` keeps
 * the child's output out of the operator's terminal — the TUI renders it — and the timeout means a
 * hung command surfaces as a failed one instead of a frozen interface.
 */
export function runShellCommand(command: string): string {
  return execSync(command, { timeout: 5000, encoding: 'utf-8', stdio: 'pipe' }).trimEnd();
}
