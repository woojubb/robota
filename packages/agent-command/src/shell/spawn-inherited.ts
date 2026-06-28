/**
 * Pure-Node spawn with the real terminal inherited (interactive input + output). Used inside a
 * terminal-handoff `runWithTerminal(fn)` — the framework/transport own the suspend/restore; this just
 * runs the child attached to the real TTY and resolves with its exit code.
 */
import { spawn } from 'node:child_process';

export function spawnInherited(
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(command, [...args], { cwd, stdio: 'inherit', env: process.env });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 0));
  });
}
