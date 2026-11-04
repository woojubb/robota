import { execSync } from 'node:child_process';

import { withChildSession } from '@robota-sdk/agent-core/node';

/**
 * The shell the TUI is given for its own command execution.
 *
 * The bounds are the point and they belong beside the call rather than inline in a thirty-key option
 * literal, where a five-second timeout and a piped stdio read as incidental formatting. `pipe` keeps
 * the child's output out of the operator's terminal — the TUI renders it — and the timeout means a
 * hung command surfaces as a failed one instead of a frozen interface. The command comes from a skill,
 * which a repository can supply, so in secure mode it runs in its own session.
 */
export function runShellCommand(command: string, hostEnvironment: Readonly<Record<string, string | undefined>>, env?: Readonly<Record<string, string>>): string {
  return execSync(command, withChildSession({
    timeout: 5000,
    encoding: 'utf-8',
    stdio: 'pipe',
    env: { ...hostEnvironment, ...env },
  })).trimEnd();
}
