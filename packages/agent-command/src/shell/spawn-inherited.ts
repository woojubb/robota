/**
 * Pure-Node spawn with the real terminal inherited (interactive input + output). Used inside a
 * terminal-handoff `runWithTerminal(fn)` — the framework/transport own the suspend/restore; this just
 * runs the child attached to the real TTY and resolves with its exit code.
 */
import { spawn } from 'node:child_process';
import { constants } from 'node:os';

export function spawnInherited(
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(command, [...args], { cwd, stdio: 'inherit', env: process.env });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      // RUNTIME-53: a signal-terminated child reports code=null; resolving 0 there is a false
      // success. Translate to the shell convention 128 + signal number so callers see the failure.
      if (code !== null) {
        resolve(code);
        return;
      }
      if (signal) {
        const signalNumber = constants.signals[signal as keyof typeof constants.signals];
        resolve(128 + (signalNumber ?? 0));
        return;
      }
      resolve(0);
    });
  });
}
