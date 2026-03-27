/**
 * Tool hook helpers — stateless utility functions for tool hook execution
 * and output truncation used by PermissionEnforcer.
 */

import { runHooks } from '@robota-sdk/agent-core';
import type {
  IToolResult,
  TToolParameters,
  THooksConfig,
  IHookInput,
  IHookTypeExecutor,
} from '@robota-sdk/agent-core';
import { MAX_TOOL_OUTPUT_CHARS } from './permission-types.js';

/**
 * Truncate tool result data if it exceeds MAX_TOOL_OUTPUT_CHARS.
 * Uses middle-truncation: keeps first and last portions, removes middle.
 */
export function truncateToolResult(result: IToolResult): IToolResult {
  if (typeof result.data !== 'string') return result;
  if (result.data.length <= MAX_TOOL_OUTPUT_CHARS) return result;

  const halfLimit = Math.floor(MAX_TOOL_OUTPUT_CHARS / 2);
  const head = result.data.substring(0, halfLimit);
  const tail = result.data.substring(result.data.length - halfLimit);
  const originalSize = result.data.length;
  const truncatedData = `${head}\n\n[... output truncated: ${originalSize.toLocaleString()} chars total, showing first and last ${halfLimit.toLocaleString()} chars ...]\n\n${tail}`;

  return { ...result, data: truncatedData };
}

/** Build a hook input object for tool execution hooks */
export function buildHookInput(
  sessionId: string,
  cwd: string,
  toolName: string,
  parameters: TToolParameters,
): IHookInput {
  return {
    session_id: sessionId,
    cwd,
    hook_event_name: 'PreToolUse',
    tool_name: toolName,
    tool_input: parameters as Record<string, string | number | boolean | object>,
  };
}

/** Run PreToolUse hooks; returns a denial IToolResult if blocked, or null to proceed */
export async function runPreToolHook(
  hooks: Record<string, unknown> | undefined,
  hookInput: IHookInput,
  hookTypeExecutors: IHookTypeExecutor[] | undefined,
): Promise<IToolResult | null> {
  const hookResult = await runHooks(
    hooks as THooksConfig | undefined,
    'PreToolUse',
    hookInput,
    hookTypeExecutors,
  );
  if (hookResult.blocked) {
    return {
      success: true,
      data: JSON.stringify({
        success: false,
        output: '',
        error: `Blocked by hook: ${hookResult.reason}`,
      }),
      metadata: {},
    };
  }
  return null;
}

/** Fire PostToolUse hooks (fire and forget) */
export function firePostToolHook(
  hooks: Record<string, unknown> | undefined,
  hookInput: IHookInput,
  result: IToolResult,
  hookTypeExecutors: IHookTypeExecutor[] | undefined,
): void {
  const postHookInput: IHookInput = {
    ...hookInput,
    hook_event_name: 'PostToolUse',
    tool_output: typeof result.data === 'string' ? result.data : JSON.stringify(result.data),
  };
  runHooks(
    hooks as THooksConfig | undefined,
    'PostToolUse',
    postHookInput,
    hookTypeExecutors,
  ).catch(() => {});
}
