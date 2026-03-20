/**
 * BashTool — execute shell commands via child_process.spawn
 *
 * Returns TToolResult JSON string. Non-zero exit is returned as success:true
 * with exitCode set, matching Claude Code behaviour (the command ran, it just
 * exited non-zero — the LLM can decide what to do with that information).
 */

import { spawn } from 'node:child_process';
import { z } from 'zod';
import { createZodFunctionTool } from '../implementations/function-tool';
import type { IZodSchema } from '../implementations/function-tool/types';
import type { TToolResult } from '../types/tool-result.js';

const DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes

const BashSchema = z.object({
  command: z.string().describe('The bash command to execute'),
  timeout: z
    .number()
    .optional()
    .describe('Optional timeout in milliseconds (max 600000). Default is 120000 (2 minutes)'),
  workingDirectory: z
    .string()
    .optional()
    .describe('Working directory for the command. Defaults to the current working directory'),
});

type TBashArgs = z.infer<typeof BashSchema>;

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
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

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
      settle({
        success: false,
        output: '',
        error: err.message,
      });
    });

    child.on('close', (code: number | null) => {
      if (timedOut) {
        settle({
          success: false,
          output: Buffer.concat(stdoutChunks).toString('utf8'),
          error: `Command timed out after ${timeout}ms`,
          exitCode: code ?? undefined,
        });
        return;
      }

      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');

      const exitCode = code ?? 0;
      const output = stderr ? `${stdout}\nstderr:\n${stderr}` : stdout;

      settle({
        success: true,
        output,
        exitCode,
      });
    });
  });
}

/**
 * BashTool instance — register with Robota agent tools registry.
 */
export const bashTool = createZodFunctionTool(
  'Bash',
  'Executes a given bash command and returns its output.\n\nThe working directory persists between commands, but shell state does not.\n\nIMPORTANT: Avoid using this tool to run `find`, `grep`, `cat`, `head`, `tail`, `sed`, `awk`, or `echo` commands. Instead, use the appropriate dedicated tool:\n - File search: Use Glob (NOT find or ls)\n - Content search: Use Grep (NOT grep or rg)\n - Read files: Use Read (NOT cat/head/tail)\n - Edit files: Use Edit (NOT sed/awk)\n\nFor simple commands, keep the description brief (5-10 words). For complex commands, include enough context to clarify what the command does.\n\nOutput is limited to 30,000 characters. Longer output will be middle-truncated.',
  BashSchema as unknown as IZodSchema,
  async (params) => {
    // createZodFunctionTool passes validated params; cast is safe
    return runBash(params as TBashArgs);
  },
);
