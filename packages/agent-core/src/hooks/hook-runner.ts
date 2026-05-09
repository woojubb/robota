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
 *
 * stdout JSON semantics (Claude Code compatible):
 * - { continue: false } → block, regardless of exit code
 * - PreToolUse: { hookSpecificOutput: { permissionDecision, updatedInput } }
 * - UserPromptSubmit: { decision: "block" } → block; hookSpecificOutput.additionalContext → injected into stdout
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

/** Permission decision priority: deny=3 > defer=2 > ask=1 > allow=0 */
const PERMISSION_PRIORITY: Record<string, number> = { deny: 3, defer: 2, ask: 1, allow: 0 };

/** Parse hook stdout as JSON if it starts with '{', otherwise return null. */
function parseHookJson(stdout: string): Record<string, unknown> | null {
  const trimmed = stdout.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    // allow-fallback: hook stdout may be plain text; malformed JSON means raw stdout
    return null;
  }
}

/** Check if a tool name matches a hook group's matcher pattern. */
function matchesGroup(group: IHookGroup, matcherTarget: string | undefined): boolean {
  // Empty matcher = match everything
  if (!group.matcher) return true;
  if (!matcherTarget) return false;
  try {
    return new RegExp(group.matcher).test(matcherTarget);
  } catch {
    // allow-fallback: invalid regex → fall back to exact string match
    return group.matcher === matcherTarget;
  }
}

function getMatcherTarget(input: IHookInput): string | undefined {
  if (input.tool_name) return input.tool_name;
  if (input.hook_event_name === 'SubagentStart' || input.hook_event_name === 'SubagentStop') {
    return input.agent_type ?? input.agent_id;
  }
  if (input.hook_event_name === 'SessionEnd') return input.reason;
  return undefined;
}

/** Result of running hooks for an event. */
export interface IRunHooksResult {
  blocked: boolean;
  reason?: string;
  /** Collected stdout from all successful hooks (exit code 0). */
  stdout: string;
  /** Parsed updatedInput from PreToolUse hookSpecificOutput (PreToolUse only). */
  updatedInput?: Record<string, unknown>;
  /** Highest-priority permissionDecision from PreToolUse hooks (PreToolUse only). */
  permissionDecision?: 'allow' | 'deny' | 'ask' | 'defer';
}

/**
 * Run all hooks for a given event.
 *
 * For PreToolUse: if any hook returns exit code 2 or JSON deny, the tool call is blocked.
 * JSON stdout responses are parsed and applied per Claude Code spec.
 * Returns { blocked: true, reason } if blocked, otherwise { blocked: false, stdout }.
 *
 * @param config - Hooks configuration mapping events to hook groups
 * @param event - The lifecycle event being fired
 * @param input - Hook input data passed to executors
 * @param executors - Optional array of hook type executors (defaults to command + http)
 */
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
  const matcherTarget = getMatcherTarget(input);

  // PreToolUse multi-hook priority tracking
  let highestPermissionPriority = -1;
  let highestPermissionDecision: 'allow' | 'deny' | 'ask' | 'defer' | undefined;
  let lastUpdatedInput: Record<string, unknown> | undefined;

  for (const group of groups) {
    if (!matchesGroup(group, matcherTarget)) continue;

    // Merge group-level env vars into hook input
    const groupInput = group.env ? { ...input, env: { ...input.env, ...group.env } } : input;

    for (const hook of group.hooks) {
      const executor = executorMap.get(hook.type);
      if (!executor) {
        // Unknown hook type — skip with warning
        continue;
      }

      const result = await executor.execute(hook, groupInput);

      // Exit code 2 = block/deny (exit early)
      if (result.exitCode === 2) {
        return {
          blocked: true,
          reason: result.stderr || 'Blocked by hook',
          stdout: stdoutParts.join('\n'),
        };
      }

      // Only parse stdout for exit code 0 responses
      if (result.exitCode !== 0) continue;

      const json = parseHookJson(result.stdout);

      if (json !== null) {
        // Common: continue: false → block
        if (json['continue'] === false) {
          const stopReason =
            typeof json['stopReason'] === 'string'
              ? json['stopReason']
              : 'Blocked by hook (continue: false)';
          return {
            blocked: true,
            reason: stopReason,
            stdout: stdoutParts.join('\n'),
          };
        }

        // UserPromptSubmit: decision: "block" → block
        if (event === 'UserPromptSubmit' && json['decision'] === 'block') {
          const hookSpecific = json['hookSpecificOutput'];
          const additionalContext =
            hookSpecific !== null &&
            typeof hookSpecific === 'object' &&
            'additionalContext' in (hookSpecific as object)
              ? String((hookSpecific as Record<string, unknown>)['additionalContext'])
              : undefined;
          return {
            blocked: true,
            reason: 'Blocked by hook (decision: block)',
            stdout: additionalContext
              ? [...stdoutParts, additionalContext].join('\n')
              : stdoutParts.join('\n'),
          };
        }

        // UserPromptSubmit: additionalContext without block → inject into stdout
        if (event === 'UserPromptSubmit') {
          const hookSpecific = json['hookSpecificOutput'];
          if (
            hookSpecific !== null &&
            typeof hookSpecific === 'object' &&
            'additionalContext' in (hookSpecific as object)
          ) {
            const ctx = String((hookSpecific as Record<string, unknown>)['additionalContext']);
            if (ctx) stdoutParts.push(ctx);
          }
        }

        // PreToolUse: parse permissionDecision and updatedInput
        if (event === 'PreToolUse') {
          const hookSpecific = json['hookSpecificOutput'];
          if (hookSpecific !== null && typeof hookSpecific === 'object') {
            const specific = hookSpecific as Record<string, unknown>;
            const decision = specific['permissionDecision'];
            if (typeof decision === 'string' && decision in PERMISSION_PRIORITY) {
              const priority = PERMISSION_PRIORITY[decision];
              if (priority > highestPermissionPriority) {
                highestPermissionPriority = priority;
                highestPermissionDecision = decision as 'allow' | 'deny' | 'ask' | 'defer';
              }
              // deny → immediate block
              if (decision === 'deny') {
                return {
                  blocked: true,
                  reason: 'Blocked by hook (permissionDecision: deny)',
                  stdout: stdoutParts.join('\n'),
                  permissionDecision: 'deny',
                };
              }
              // Track updatedInput from the highest-priority decision
              if (priority >= highestPermissionPriority && specific['updatedInput'] !== undefined) {
                lastUpdatedInput = specific['updatedInput'] as Record<string, unknown>;
              }
            }
          }
        }

        // systemMessage → inject into stdout for AI context
        if (typeof json['systemMessage'] === 'string' && json['systemMessage']) {
          stdoutParts.push(json['systemMessage']);
        }
      } else if (result.stdout.trim()) {
        // Raw text stdout (non-JSON)
        stdoutParts.push(result.stdout.trim());
      }
    }
  }

  const finalResult: IRunHooksResult = {
    blocked: false,
    stdout: stdoutParts.join('\n'),
  };

  if (highestPermissionDecision !== undefined) {
    finalResult.permissionDecision = highestPermissionDecision;
  }
  if (lastUpdatedInput !== undefined) {
    finalResult.updatedInput = lastUpdatedInput;
  }

  return finalResult;
}
