import { execSync } from 'node:child_process';

export const SHELL_EXEC_TIMEOUT_MS = 5_000;

export function createShellExec(): (command: string) => string {
  return (command: string): string =>
    execSync(command, {
      timeout: SHELL_EXEC_TIMEOUT_MS,
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trimEnd();
}
