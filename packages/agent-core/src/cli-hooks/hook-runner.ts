/**
 * Hook runner — executes shell command hooks for lifecycle events.
 *
 * Hooks receive JSON input on stdin and communicate results via exit codes:
 * - 0: allow/proceed
 * - 2: block/deny (stderr contains reason)
 * - other: proceed (logged as warning)
 */

import { spawn } from 'node:child_process';
import type { THookEvent, THooksConfig, IHookGroup, IHookInput, IHookResult } from './types.js';

const HOOK_TIMEOUT_MS = 10_000;

/** Execute a single shell command with JSON input on stdin. */
function runCommand(command: string, input: string): Promise<IHookResult> {
  return new Promise<IHookResult>((resolve) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;

    const child = spawn('sh', ['-c', command], {
      cwd: process.cwd(),
      env: { ...process.env },
    });

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    // Write input to stdin
    child.stdin.write(input);
    child.stdin.end();

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGTERM');
        resolve({ exitCode: 1, stdout: '', stderr: 'Hook timed out' });
      }
    }, HOOK_TIMEOUT_MS);

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

/** Check if a tool name matches a hook group's matcher pattern. */
function matchesGroup(group: IHookGroup, toolName: string | undefined): boolean {
  // Empty matcher = match everything
  if (!group.matcher) return true;
  if (!toolName) return false;
  try {
    return new RegExp(group.matcher).test(toolName);
  } catch {
    return group.matcher === toolName;
  }
}

/**
 * Run all hooks for a given event.
 *
 * For PreToolUse: if any hook returns exit code 2, the tool call is blocked.
 * Returns { blocked: true, reason: string } if blocked, { blocked: false } otherwise.
 */
export async function runHooks(
  config: THooksConfig | undefined,
  event: THookEvent,
  input: IHookInput,
): Promise<{ blocked: boolean; reason?: string }> {
  if (!config) return { blocked: false };

  const groups = config[event];
  if (!groups || groups.length === 0) return { blocked: false };

  const inputJson = JSON.stringify(input);

  for (const group of groups) {
    if (!matchesGroup(group, input.tool_name)) continue;

    for (const hook of group.hooks) {
      if (hook.type !== 'command') continue;

      const result = await runCommand(hook.command, inputJson);

      // Exit code 2 = block/deny
      if (result.exitCode === 2) {
        return { blocked: true, reason: result.stderr || 'Blocked by hook' };
      }
    }
  }

  return { blocked: false };
}
