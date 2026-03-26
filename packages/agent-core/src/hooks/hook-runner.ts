/**
 * Hook runner — executes hooks for lifecycle events using the strategy pattern.
 *
 * Dispatches to registered IHookTypeExecutor implementations by definition type.
 * Default executors: CommandExecutor (shell), HttpExecutor (HTTP POST).
 *
 * Exit code semantics:
 * - 0: allow/proceed
 * - 2: block/deny (stderr contains reason)
 * - other: proceed (logged as warning)
 */

import type {
  THookEvent,
  THooksConfig,
  IHookGroup,
  IHookInput,
  IHookTypeExecutor,
} from './types.js';
import { CommandExecutor } from './executors/command-executor.js';
import { HttpExecutor } from './executors/http-executor.js';

/** Default set of hook type executors */
function createDefaultExecutors(): IHookTypeExecutor[] {
  return [new CommandExecutor(), new HttpExecutor()];
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
 *
 * @param config - Hooks configuration mapping events to hook groups
 * @param event - The lifecycle event being fired
 * @param input - Hook input data passed to executors
 * @param executors - Optional array of hook type executors (defaults to command + http)
 */
/** Result of running hooks for an event. */
export interface IRunHooksResult {
  blocked: boolean;
  reason?: string;
  /** Collected stdout from all successful hooks (exit code 0). */
  stdout: string;
}

export async function runHooks(
  config: THooksConfig | undefined,
  event: THookEvent,
  input: IHookInput,
  executors?: IHookTypeExecutor[],
): Promise<IRunHooksResult> {
  if (!config) return { blocked: false, stdout: '' };

  const groups = config[event];
  if (!groups || groups.length === 0) return { blocked: false, stdout: '' };

  const resolvedExecutors = executors ?? createDefaultExecutors();
  const executorMap = new Map<string, IHookTypeExecutor>();
  for (const executor of resolvedExecutors) {
    executorMap.set(executor.type, executor);
  }

  const stdoutParts: string[] = [];

  for (const group of groups) {
    if (!matchesGroup(group, input.tool_name)) continue;

    // Merge group-level env vars into hook input
    const groupInput = group.env ? { ...input, env: { ...input.env, ...group.env } } : input;

    for (const hook of group.hooks) {
      const executor = executorMap.get(hook.type);
      if (!executor) {
        // Unknown hook type — skip with warning
        continue;
      }

      const result = await executor.execute(hook, groupInput);

      // Collect stdout from successful hooks
      if (result.exitCode === 0 && result.stdout.trim()) {
        stdoutParts.push(result.stdout.trim());
      }

      // Exit code 2 = block/deny
      if (result.exitCode === 2) {
        return {
          blocked: true,
          reason: result.stderr || 'Blocked by hook',
          stdout: stdoutParts.join('\n'),
        };
      }
    }
  }

  return { blocked: false, stdout: stdoutParts.join('\n') };
}
