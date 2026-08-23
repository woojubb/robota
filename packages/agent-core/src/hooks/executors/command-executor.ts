/**
 * Command hook executor — executes shell commands with JSON input on stdin.
 *
 * Exit-code mapping (SEC-015):
 * - `0` → `allow`, stdout carried for the runner's response-protocol decode
 * - `2` → `deny`, stderr carried as the reason
 * - any other code → `error` / `nonzero-exit`
 * - killed by a signal (exit code `null`) → `error` / `nonzero-exit`, signal named in the reason
 * - deadline elapsed → `error` / `timeout`
 * - the process never started → `error` / `spawn-failure`
 *
 * The last four used to be one number. A missing binary exits `127` and a timeout resolved `1`, and
 * the runner discarded both alike, so a gate that never ran was indistinguishable from one that
 * approved.
 */

import { spawn } from 'node:child_process';

import { resolvePlatformShell } from '../../utils/platform-shell.js';

import type {
  ICommandHookDefinition,
  IHookInput,
  THookOutcome,
  IHookTypeExecutor,
} from '../types.js';

/** Default timeout in seconds — matches Claude Code's 600s default */
const DEFAULT_TIMEOUT_SECONDS = 600;

/**
 * How a finished process maps onto an outcome — a pure function of what the process reported.
 *
 * Extracted from `execute` because it is the part that carries the contract: `execute` owns spawning
 * and settling exactly once, this owns what the result MEANS, and the two change for different
 * reasons.
 */
/**
 * Attach the output collectors and feed the hook input to stdin.
 *
 * Separated from `execute` so the promise body reads as the three things that can settle it —
 * timeout, close, spawn error — rather than as stream plumbing interleaved with them. The
 * `settled` guard those three share is the invariant worth keeping visible in one place.
 */
function wireChildIo(
  child: ReturnType<typeof spawn>,
  inputJson: string,
): { stdoutChunks: Buffer[]; stderrChunks: Buffer[] } {
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
  child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
  child.stdin?.on('error', () => {
    // EPIPE: child closed stdin before we finished writing — safe to ignore
  });
  child.stdin?.write(inputJson);
  child.stdin?.end();
  return { stdoutChunks, stderrChunks };
}

/** The platform shell's argv for a hook command. */
function shellArgs(command: string): string[] {
  return resolvePlatformShell().commandArgs(command);
}

function outcomeOfExit(
  code: number | null,
  signal: NodeJS.Signals | null,
  stdout: string,
  stderr: string,
): THookOutcome {
  if (code === 0) return { outcome: 'allow', source: 'command', stdout };
  if (code === 2) {
    return { outcome: 'deny', source: 'command', reason: stderr.trim() || 'Blocked by hook' };
  }
  const detail = stderr.trim() ? `: ${stderr.trim()}` : '';
  return {
    outcome: 'error',
    source: 'command',
    kind: 'nonzero-exit',
    // `code === null` means a signal ended it. That is not an exit code and must not be read as
    // one — the old `code ?? 1` made a SIGKILLed hook indistinguishable from one that exited 1.
    reason:
      code === null
        ? `Hook terminated by signal ${signal ?? 'unknown'}${detail}`
        : `Hook exited ${code}${detail}`,
  };
}

export class CommandExecutor implements IHookTypeExecutor {
  readonly type = 'command' as const;

  execute(definition: ICommandHookDefinition, input: IHookInput): Promise<THookOutcome> {
    const timeoutSeconds = definition.timeout ?? DEFAULT_TIMEOUT_SECONDS;
    const timeoutMs = timeoutSeconds * 1000;
    const inputJson = JSON.stringify(input);

    return new Promise<THookOutcome>((resolve) => {
      let settled = false;
      const child = spawn(resolvePlatformShell().command, shellArgs(definition.command), {
        cwd: input.cwd,
        env: { ...process.env, ...input.env },
      });
      const { stdoutChunks, stderrChunks } = wireChildIo(child, inputJson);

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          child.kill('SIGTERM');
          resolve({
            outcome: 'error',
            source: 'command',
            kind: 'timeout',
            reason: `Hook timed out after ${timeoutSeconds}s`,
          });
        }
      }, timeoutMs);

      child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(
          outcomeOfExit(
            code,
            signal,
            Buffer.concat(stdoutChunks).toString('utf8'),
            Buffer.concat(stderrChunks).toString('utf8'),
          ),
        );
      });

      child.on('error', (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          outcome: 'error',
          source: 'command',
          kind: 'spawn-failure',
          reason: err.message,
        });
      });
    });
  }
}
