/**
 * ShellTool — execute a host shell command via child_process.spawn (TERM-008).
 *
 * Cross-platform: the shell is resolved per OS through `resolvePlatformShell()` (POSIX `sh`/`bash`,
 * Windows PowerShell). The tool name is `Shell` and its description is built dynamically from the
 * resolved shell so the model is told the active shell/OS and writes the right syntax.
 *
 * Returns an IToolInvocationResult JSON string. A non-zero exit is returned as success:true with
 * exitCode set (the command ran, it just exited non-zero — the LLM decides what to do with that).
 *
 * ## SEC-007 — why `workingDirectory` is NOT path-contained (a deliberate decision, not an omission)
 *
 * `Read`/`Write`/`Edit` are contained by `checkPathWithinCwd`, and SEC-007 extended that to `Glob`
 * and `Grep`. This tool is deliberately excluded, and the reason is what the tool IS: it runs an
 * arbitrary command in a shell. A guard on `cwd` is undone by the first `cd ..` — or by an absolute
 * path in the command itself — so it would constrain nothing an attacker-controlled command cannot
 * trivially step around, while LOOKING like a boundary in the code and in review.
 *
 * That appearance is the actual hazard. SEC-006's R9 lesson was "'the guard is still there' is not a
 * verdict": a check that reads as containment but is not one is worse than no check, because the next
 * reviewer stops asking. The real boundary for this tool is the permission layer (every invocation is
 * permission-gated at call time) and the sandbox seam below — which is why SEC-006 already recorded
 * `js/indirect-command-line-injection` at the spawn site as a false positive on those same grounds.
 *
 * What the containment root DOES do here: it supplies the DEFAULT working directory. Binding a tool
 * to a session root and then silently running its commands in `process.cwd()` was a real defect — an
 * assembly that scoped its file tools to a workspace still ran `Shell` wherever the host process
 * happened to be started.
 */

import { spawn } from 'node:child_process';

import { createBoundedOutput, resolvePlatformShell } from '@robota-sdk/agent-core';
import { killProcessTree } from '@robota-sdk/agent-process';
import { z } from 'zod';

/** POSIX children are spawned detached so a process-group kill reaps grandchildren (CORE-023). */
const SPAWN_DETACHED = process.platform !== 'win32';

import { buildShellToolDescription } from './shell-tool-description.js';
import { createZodFunctionTool } from '../implementations/function-tool';

import type { ISandboxBuiltinToolOptions } from './tool-options.js';
import type { ISandboxToolOptions } from '../sandbox/types.js';
import type { IToolInvocationResult } from '../types/tool-result.js';
import type { FunctionTool } from '@robota-sdk/agent-core';

// CORE-030: defining a tool and telling the permission system what it does arrive together.
import '../tool-permission-profiles.js';

const DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes
/** ARCH-056: most bytes retained per stream while the child runs (head); the rest is dropped. */
const MAX_CAPTURED_OUTPUT_BYTES = 2_000_000;

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
  options: ISandboxToolOptions,
  signal?: AbortSignal,
): Promise<string> {
  const { command, timeout: rawTimeout = DEFAULT_TIMEOUT_MS, workingDirectory } = args;
  const timeout = Math.min(rawTimeout, 600_000);
  // SEC-007: the configured root is the DEFAULT working directory (see the file header for why it is
  // not a boundary). Without this, an assembly that scoped its file tools to a workspace still ran
  // every shell command in whatever directory the host process was started in.
  //
  // ARCH-010 removed a third `?? process.cwd()` link from this chain. `options.cwd` is required now,
  // so that link was unreachable — and an unreachable fallback still reads as a supported one, which
  // is how the ambient-root habit spreads. A caller that means the process directory says so.
  const effectiveCwd = workingDirectory ?? options.cwd;
  if (effectiveCwd === undefined) {
    // Only reachable from a caller that skipped the type — `options.cwd` is required. Refusing beats
    // letting `spawn` silently inherit the process directory, which was the last ambient root in this
    // package and the one contract violation that produced no message at all (ARCH-010).
    return JSON.stringify({
      success: false,
      output: '',
      error:
        'Shell tool has no working directory: it was constructed without a `cwd` (ARCH-010). This ' +
        'is an assembly bug — the tool would otherwise run in whatever directory the host process ' +
        'was started in.',
    });
  }
  if (options.sandboxClient) {
    return runInSandbox(command, timeout, workingDirectory ?? options.cwd, options);
  }

  const shell = resolvePlatformShell();

  if (signal?.aborted) {
    return JSON.stringify({ success: false, output: '', error: 'Aborted before start' });
  }

  return new Promise<string>((resolve) => {
    // ARCH-056: memory is bounded WHILE the child writes, not capped after a ten-minute buffer.
    const stdoutOutput = createBoundedOutput({ maxBytes: MAX_CAPTURED_OUTPUT_BYTES });
    const stderrOutput = createBoundedOutput({ maxBytes: MAX_CAPTURED_OUTPUT_BYTES });

    let timedOut = false;
    let settled = false;

    const child = spawn(shell.command, shell.commandArgs(command), {
      cwd: effectiveCwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: SPAWN_DETACHED,
    });

    // RUNTIME-31: the command inherits an open stdin pipe it can block reading on; close it
    // so commands that read stdin (e.g. `cat`) terminate instead of hanging until timeout.
    child.stdin?.end();

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutOutput.append(chunk);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderrOutput.append(chunk);
    });

    const timer = setTimeout(() => {
      timedOut = true;
      // CORE-023: kill the whole process group with SIGTERM→grace→SIGKILL so grandchildren
      // are reaped, not just the shell. Fire-and-forget: settle promptly, escalate in background.
      void killProcessTree(child, { processGroup: SPAWN_DETACHED });
      settle({
        success: false,
        output: stdoutOutput.toString(),
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
        output: stdoutOutput.toString(),
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
          output: stdoutOutput.toString(),
          error: `Command timed out after ${timeout}ms`,
          exitCode: code ?? undefined,
        });
        return;
      }

      const stdout = stdoutOutput.toString();
      const stderr = stderrOutput.toString();

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

/** Options for the shell tool factories (sandbox + description seam + routing-hint derivation). */
export interface IShellToolOptions extends ISandboxBuiltinToolOptions {
  /**
   * Registered names of the sibling tools available in this assembly (NEUT-002). When provided,
   * the default description's dedicated-tool routing hints are restricted to this set; when
   * omitted, the full default hint set is used. Ignored when `description` overrides the text.
   */
  availableTools?: readonly string[];
}

/**
 * Build a host-shell command tool under a given registered name. Both `Shell` and the
 * model-familiar `Bash` are registered as aliases of this one OS-aware implementation
 * (TERM-008): the shell is resolved per OS and the description names the active shell so the
 * model writes the right syntax regardless of which alias it calls.
 */
function createHostShellTool(name: string, options: IShellToolOptions): FunctionTool {
  return createZodFunctionTool(
    name,
    options.description ??
      buildShellToolDescription(resolvePlatformShell(), options.availableTools),
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
export function createShellTool(options: IShellToolOptions): FunctionTool {
  return createHostShellTool('Shell', options);
}

/**
 * Create a `Bash` tool instance — the model-familiar alias of the same OS-aware shell tool.
 */
export function createBashTool(options: IShellToolOptions): FunctionTool {
  return createHostShellTool('Bash', options);
}
