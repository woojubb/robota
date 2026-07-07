/**
 * ShellTool — execute a host shell command via child_process.spawn (TERM-008).
 *
 * Cross-platform: the shell is resolved per OS through `resolvePlatformShell()` (POSIX `sh`/`bash`,
 * Windows PowerShell). The tool name is `Shell` and its description is built dynamically from the
 * resolved shell so the model is told the active shell/OS and writes the right syntax.
 *
 * Returns an IToolInvocationResult JSON string. A non-zero exit is returned as success:true with
 * exitCode set (the command ran, it just exited non-zero — the LLM decides what to do with that).
 */

import { spawn } from 'node:child_process';

import { resolvePlatformShell } from '@robota-sdk/agent-core';
import { killProcessTree } from '@robota-sdk/agent-process';
import { z } from 'zod';

/** POSIX children are spawned detached so a process-group kill reaps grandchildren (CORE-023). */
const SPAWN_DETACHED = process.platform !== 'win32';

import { createZodFunctionTool } from '../implementations/function-tool';

import type { ISandboxToolOptions } from '../sandbox/types.js';
import type { IToolInvocationResult } from '../types/tool-result.js';
import type { FunctionTool, IPlatformShell } from '@robota-sdk/agent-core';

const DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes

const ShellSchema = z.object({
  command: z.string().describe('The shell command to execute'),
  timeout: z
    .number()
    .optional()
    .describe('Optional timeout in milliseconds (max 600000). Default is 120000 (2 minutes)'),
  workingDirectory: z
    .string()
    .optional()
    .describe('Working directory for the command. Defaults to the current working directory'),
});

type TShellArgs = z.infer<typeof ShellSchema>;

/** Build the OS-aware tool description so the model writes syntax the host shell can run. */
function buildShellToolDescription(shell: IPlatformShell): string {
  return [
    `Executes a command in the host shell and returns its output.`,
    ``,
    `Active shell: ${shell.label}. ${shell.syntaxHint}`,
    ``,
    `The working directory persists between commands, but shell state does not.`,
    ``,
    `IMPORTANT: Avoid using this tool to run \`find\`, \`grep\`, \`cat\`, \`head\`, \`tail\`, \`sed\`, \`awk\`, or \`echo\` commands. Instead, use the appropriate dedicated tool:`,
    ` - File search: Use Glob (NOT find or ls)`,
    ` - Content search: Use Grep (NOT grep or rg)`,
    ` - Read files: Use Read (NOT cat/head/tail)`,
    ` - Edit files: Use Edit (NOT sed/awk)`,
    ``,
    `For simple commands, keep the description brief (5-10 words). For complex commands, include enough context to clarify what the command does.`,
    ``,
    `Output is limited to 30,000 characters. Longer output will be middle-truncated.`,
  ].join('\n');
}

/** Run a shell command through the sandbox client, surfacing failures as a structured result. */
async function runInSandbox(
  command: string,
  timeout: number,
  workingDirectory: string | undefined,
  options: ISandboxToolOptions,
): Promise<string> {
  try {
    const sandboxResult = await options.sandboxClient!.run(command, {
      timeoutMs: timeout,
      workingDirectory,
    });
    const output = sandboxResult.stderr
      ? `${sandboxResult.stdout}\nstderr:\n${sandboxResult.stderr}`
      : sandboxResult.stdout;
    const result: IToolInvocationResult = {
      success: true,
      output,
      exitCode: sandboxResult.exitCode,
    };
    return JSON.stringify(result);
  } catch (err) {
    // allow-fallback: tool-result contract reports a failed run as success:false + error (faithful surfacing of a terminal failure, not silent recovery)
    const result: IToolInvocationResult = {
      success: false,
      output: '',
      error: err instanceof Error ? err.message : String(err),
    };
    return JSON.stringify(result);
  }
}

/**
 * Run a shell command and return stdout + stderr.
 * Resolves with the IToolInvocationResult JSON string.
 */
async function runShell(
  args: TShellArgs,
  options: ISandboxToolOptions = {},
  signal?: AbortSignal,
): Promise<string> {
  const { command, timeout: rawTimeout = DEFAULT_TIMEOUT_MS, workingDirectory } = args;
  const timeout = Math.min(rawTimeout, 600_000);
  if (options.sandboxClient) {
    return runInSandbox(command, timeout, workingDirectory, options);
  }

  const shell = resolvePlatformShell();

  if (signal?.aborted) {
    return JSON.stringify({ success: false, output: '', error: 'Aborted before start' });
  }

  return new Promise<string>((resolve) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    let timedOut = false;
    let settled = false;

    const child = spawn(shell.command, shell.commandArgs(command), {
      cwd: workingDirectory ?? process.cwd(),
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: SPAWN_DETACHED,
    });

    // RUNTIME-31: the command inherits an open stdin pipe it can block reading on; close it
    // so commands that read stdin (e.g. `cat`) terminate instead of hanging until timeout.
    child.stdin?.end();

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    const timer = setTimeout(() => {
      timedOut = true;
      // CORE-023: kill the whole process group with SIGTERM→grace→SIGKILL so grandchildren
      // are reaped, not just the shell. Fire-and-forget: settle promptly, escalate in background.
      void killProcessTree(child, { processGroup: SPAWN_DETACHED });
      settle({
        success: false,
        output: Buffer.concat(stdoutChunks).toString('utf8'),
        error: `Command timed out after ${timeout}ms`,
      });
    }, timeout);

    function settle(result: IToolInvocationResult): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(JSON.stringify(result));
    }

    // CORE-018: the run-scoped signal must terminate the underlying work — completing
    // silently after an abort is a cancellation-contract violation. CORE-023: process-group
    // kill reaps grandchildren the bare SIGTERM left orphaned.
    function onAbort(): void {
      void killProcessTree(child, { processGroup: SPAWN_DETACHED });
      settle({
        success: false,
        output: Buffer.concat(stdoutChunks).toString('utf8'),
        error: 'Aborted',
      });
    }
    signal?.addEventListener('abort', onAbort, { once: true });

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
 * Build a host-shell command tool under a given registered name. Both `Shell` and the
 * model-familiar `Bash` are registered as aliases of this one OS-aware implementation
 * (TERM-008): the shell is resolved per OS and the description names the active shell so the
 * model writes the right syntax regardless of which alias it calls.
 */
function createHostShellTool(name: string, options: ISandboxToolOptions): FunctionTool {
  return createZodFunctionTool(
    name,
    buildShellToolDescription(resolvePlatformShell()),
    ShellSchema,
    async (params, context) => {
      return runShell(params, options, context?.signal);
    },
  );
}

/**
 * Create a `Shell` tool instance — register with the Robota agent tools registry.
 * The description is resolved at creation time for the host's active shell.
 */
export function createShellTool(options: ISandboxToolOptions = {}): FunctionTool {
  return createHostShellTool('Shell', options);
}

/**
 * Create a `Bash` tool instance — the model-familiar alias of the same OS-aware shell tool.
 */
export function createBashTool(options: ISandboxToolOptions = {}): FunctionTool {
  return createHostShellTool('Bash', options);
}

/** `Shell` tool instance — register with the Robota agent tools registry. */
export const shellTool = createShellTool();

/** `Bash` tool instance — model-familiar alias of {@link shellTool}. */
export const bashTool = createBashTool();
