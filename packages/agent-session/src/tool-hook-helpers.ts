/**
 * Tool hook helpers — stateless utility functions for tool hook execution
 * and output truncation used by PermissionEnforcer.
 */

import { runHooks, createLogger, isEnforcing } from '@robota-sdk/agent-core';

import { MAX_TOOL_OUTPUT_CHARS, toolFailure } from './permission-types.js';

import type {
  IToolResult,
  TToolParameters,
  THooksConfig,
  IHookInput,
  IHookTypeExecutor,
} from '@robota-sdk/agent-core';

const logger = createLogger('ToolHookHelpers');

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
  permissionMode?: string,
  transcriptPath?: string,
): IHookInput {
  return {
    session_id: sessionId,
    cwd,
    hook_event_name: 'PreToolUse',
    tool_name: toolName,
    tool_input: parameters as Record<string, string | number | boolean | object>,
    ...(permissionMode !== undefined && { permission_mode: permissionMode }),
    ...(transcriptPath !== undefined && { transcript_path: transcriptPath }),
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
    // CORE-027, the third of the three outcomes the failure type names. This path was left behind by
    // the first pass: `permission-types.ts` declared `hook-blocked` while this still returned
    // `success: true`, so the type promised a distinction the code did not make — in the file that
    // exists to end exactly that.
    const reason = hookResult.reason ?? 'Blocked by hook';
    return toolFailure('hook-blocked', reason, { blocked: true, reason });
  }

  // SEC-016. A hook that reached NO verdict is not a hook that approved. Issue #2083 made that
  // distinction representable; this is where it starts costing something.
  //
  // Guarded by the policy rather than by a literal `true`, so the posture is stated in ONE place and
  // this boundary cannot drift from it. Note what this does NOT buy: the event is hardcoded here
  // because this function is `runPreToolHook`, so a future enforcing event needs its own boundary
  // and does not inherit anything — an earlier version of this comment claimed otherwise and review
  // caught it. What the indirection does buy is that flipping `PreToolUse` to advisory in the table
  // turns this gate off, and `scan-hook-enforcement-reachable.mjs` notices if the table and the code
  // disagree.
  //
  // The check stays HERE rather than inside `runHooks`, because the runner reports outcomes and must
  // not decide policy — the same split issue #2083 established between the decoder and the runner.
  if (isEnforcing('PreToolUse')) {
    // Bind the array, not `errors?.[0]`: narrowing the element does not narrow the collection, and
    // the count below needs the collection. The earlier shape needed a `?? 1` fallback that could
    // never be taken, which reads as though the array might be absent here.
    const failures = hookResult.errors;
    const failure = failures?.[0];
    if (failures !== undefined && failure !== undefined) {
      // The reason names the kind, the executor and the failure text, because a fail-closed gate
      // turns a misconfigured hook into a hard stop: whoever hits it needs enough to fix it.
      const others = failures.length - 1;
      const reason =
        `Hook could not evaluate (${failure.kind}, source: ${failure.source}): ${failure.reason}` +
        // Naming only the first would hide that several gates failed; the count is the cheap half of
        // that, and the reason line stays one line.
        (others > 0 ? ` (+${others} more hook failure(s))` : '');
      return toolFailure('hook-blocked', reason, { blocked: true, reason });
    }

    const unreachable = hookResult.unknownHookTypes;
    if (unreachable !== undefined && unreachable.length > 0) {
      // A configured hook type with no registered executor ran NOTHING. Before SEC-016 the runner
      // reported it and the gate proceeded, so a config declaring a guardrail with no registry
      // silently disabled itself. Startup rejection of such a config is issue #2099; this is the
      // runtime half.
      //
      // Denying is deliberate and is the approved SEC-016 semantics: a PreToolUse hook the user
      // wrote as a gate must not be silently skipped. But note WHICH configs land here, because it
      // is wider than a mistake — `prompt`, `agent` and `guardrail` are accepted by the config
      // schema while no product surface supplies the `providerFactory` / `sessionFactory` /
      // `guardrails` those executors need, so such a config validates and can never run. That gap
      // is issue #2245; it is the reason this message has to say what to do rather than only what
      // happened.
      const reason =
        `Hook type(s) with no registered executor: ${unreachable.join(', ')}. ` +
        'Nothing evaluated this gate, so the tool call is denied rather than silently allowed. ' +
        'Remove the hook from the PreToolUse configuration, or supply an executor for its type.';
      return toolFailure('hook-blocked', reason, { blocked: true, reason });
    }
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
  ).catch((error) => logger.warn('hook failed', { error }));
}
