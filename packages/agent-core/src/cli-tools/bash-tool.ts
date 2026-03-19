/**
 * BashTool — execute shell commands via child_process.spawn
 *
 * Returns TToolResult JSON string. Non-zero exit is returned as success:true
 * with exitCode set, matching Claude Code behaviour (the command ran, it just
 * exited non-zero — the LLM can decide what to do with that information).
 */

import { spawn } from 'node:child_process';
import { z } from 'zod';
import { createZodFunctionTool } from '@robota-sdk/agent-tools';
import type { TToolParameters } from '../interfaces/tool.js';
import { asZodSchema } from './schema-cast.js';
import type { TToolResult } from '../cli-permissions/types.js';

const DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes

const BashSchema = z.object({
  command: z.string().describe('Shell command to execute'),
  timeout: z.number().optional().describe('Timeout in milliseconds (default 120000)'),
  workingDirectory: z
    .string()
    .optional()
    .describe('Working directory for the command (default: process.cwd())'),
});

type TBashArgs = z.infer<typeof BashSchema>;

/** Build a TToolResult for a completed (non-timed-out) process */
function buildCloseResult(
  stdoutChunks: Buffer[],
  stderrChunks: Buffer[],
  code: number | null,
): TToolResult {
  const stdout = Buffer.concat(stdoutChunks).toString('utf8');
  const stderr = Buffer.concat(stderrChunks).toString('utf8');
  const exitCode = code ?? 0;
  const output = stderr ? `${stdout}\nstderr:\n${stderr}` : stdout;
  return { success: true, output, exitCode };
}

/** Build a TToolResult for a timed-out process */
function buildTimeoutResult(
  stdoutChunks: Buffer[],
  timeout: number,
  code: number | null,
): TToolResult {
  return {
    success: false,
    output: Buffer.concat(stdoutChunks).toString('utf8'),
    error: `Command timed out after ${timeout}ms`,
    exitCode: code ?? undefined,
  };
}

/**
 * Run a shell command and return stdout + stderr.
 * Resolves with the TToolResult JSON string.
 */
async function runBash(args: TBashArgs): Promise<string> {
  const { command, timeout = DEFAULT_TIMEOUT_MS, workingDirectory } = args;

  return new Promise<string>((resolve) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;
    let settled = false;

    const child = spawn('sh', ['-c', command], {
      cwd: workingDirectory ?? process.cwd(),
      env: process.env,
    });

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeout);

    function settle(result: TToolResult): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(JSON.stringify(result));
    }

    child.on('error', (err: Error) => {
      settle({ success: false, output: '', error: err.message });
    });

    child.on('close', (code: number | null) => {
      const result = timedOut
        ? buildTimeoutResult(stdoutChunks, timeout, code)
        : buildCloseResult(stdoutChunks, stderrChunks, code);
      settle(result);
    });
  });
}

/**
 * BashTool instance — register with Robota agent tools registry.
 */
export const bashTool = createZodFunctionTool(
  'Bash',
  'Execute a shell command and return stdout/stderr. Non-zero exit codes are returned in exitCode.',
  asZodSchema(BashSchema),
  async (params: TToolParameters) => {
    return runBash(params as TBashArgs);
  },
);
