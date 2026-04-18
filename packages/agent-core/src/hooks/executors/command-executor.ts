/**
 * Command hook executor — executes shell commands with JSON input on stdin.
 *
 * Exit codes:
 * - 0: allow/proceed
 * - 2: block/deny (stderr contains reason)
 * - other: proceed (logged as warning)
 */

import { spawn } from 'node:child_process';
import type {
  ICommandHookDefinition,
  IHookInput,
  IHookResult,
  IHookTypeExecutor,
} from '../types.js';

/** Default timeout in seconds */
const DEFAULT_TIMEOUT_SECONDS = 10;

export class CommandExecutor implements IHookTypeExecutor {
  readonly type = 'command' as const;

  execute(definition: ICommandHookDefinition, input: IHookInput): Promise<IHookResult> {
    const timeoutSeconds = definition.timeout ?? DEFAULT_TIMEOUT_SECONDS;
    const timeoutMs = timeoutSeconds * 1000;
    const inputJson = JSON.stringify(input);

    return new Promise<IHookResult>((resolve) => {
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let settled = false;

      const child = spawn('sh', ['-c', definition.command], {
        cwd: input.cwd,
        env: { ...process.env, ...input.env },
      });

      child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

      child.stdin.on('error', () => {
        // EPIPE: child closed stdin before we finished writing — safe to ignore
      });
      child.stdin.write(inputJson);
      child.stdin.end();

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          child.kill('SIGTERM');
          resolve({ exitCode: 1, stdout: '', stderr: 'Hook timed out' });
        }
      }, timeoutMs);

      child.on('close', (code: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          exitCode: code ?? 1,
          stdout: Buffer.concat(stdoutChunks).toString('utf8'),
          stderr: Buffer.concat(stderrChunks).toString('utf8'),
        });
      });

      child.on('error', (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ exitCode: 1, stdout: '', stderr: err.message });
      });
    });
  }
}
