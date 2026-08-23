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
  // turns this gate off.
  //
  // And be exact about the scan, because the earlier wording here was too generous. Measured: with
  // this entire block deleted and the `hookResult.blocked` branch above left in place,
  // `scan-hook-enforcement-reachable.mjs` still passes. Its arm 3 asks whether SOME fire site awaits
  // `runHooks` and reads `.blocked` — which guards the older SELFHOST-009 denial path, not the
  // `errors` / `unknownHookTypes` gate SEC-016 adds. This gate is held by the unit tests in
  // `__tests__/tool-hook-helpers.test.ts`, which are red-proved against its removal — not by the
  // scan.
  //
  // What the scan DOES catch, each measured rather than assumed: deleting the `.blocked` read above
  // fires `[inert-enforcing-row]`; flipping BOTH `posture` and `enforcementReachable` fires
  // `[stale-reachability]` — and, measured, `[no-enforcing-rows]` alongside it, because
  // `PreToolUse` is currently the only enforcing row. Flipping only `posture` fires `[no-enforcing-rows]` instead — and note
  // that arm only holds while `PreToolUse` is the sole enforcing row, so a second enforcing event
  // would make the same disarming edit silent (issue #2259).
  //
  // The first of those was FALSE until the scan learned to blank comments before matching. It
  // matched raw source, so this very comment's mention of `hookResult.blocked` vouched for the
  // branch after the branch was deleted — prose holding up the guard it describes.
  //
  // The check stays HERE rather than inside `runHooks`, because the runner reports outcomes and must
  // not decide policy — the same split issue #2083 established between the decoder and the runner.
  if (isEnforcing('PreToolUse')) {
    // Bind the array, not `errors?.[0]`: narrowing the element does not narrow the collection, and
    // the count below needs the collection. The earlier shape needed a `?? 1` fallback that could
    // never be taken, which reads as though the array might be absent here.
    const failures = hookResult.errors;
    const failure = failures?.[0];
    // ONE binding for one field. Two bindings, each defended differently against `undefined`, is a
    // drift surface: the two branches below disagreed about whether the field could be absent.
    const unregistered = hookResult.unknownHookTypes ?? [];

    // A configured hook type with no registered executor ran NOTHING. Before SEC-016 the runner
    // reported it and the gate proceeded, so a config declaring a guardrail with no registry
    // silently disabled itself. Startup rejection of such a config is issue #2099; this is the
    // runtime half.
    //
    // Denying is deliberate and is the approved SEC-016 semantics: a PreToolUse hook the user wrote
    // as a gate must not be silently skipped. But note WHICH configs land here, because it is wider
    // than a mistake — `prompt`, `agent` and `guardrail` are accepted by the config schema while no
    // product surface supplies the `providerFactory` / `sessionFactory` / `guardrails` those
    // executors need, so such a config validates and can never run. That gap is issue #2245; it is
    // the reason this text says what to DO rather than only what happened.
    //
    // Built once and used by both branches. The earlier shape wrote the cause twice — a full
    // sentence in the standalone branch and a shorter one appended to the error branch — so the
    // operator with TWO faults got less guidance than the one with a single fault, which is exactly
    // backwards, and the two wordings were free to drift apart.
    const unregisteredReason =
      unregistered.length > 0
        ? `Hook type(s) with no registered executor: ${unregistered.join(', ')}. ` +
          'Nothing evaluated this gate, so the tool call is denied rather than silently allowed. ' +
          'Remove the hook from the PreToolUse configuration, or supply an executor for its type.'
        : '';

    if (failures !== undefined && failure !== undefined) {
      // The reason names the kind, the executor and the failure text, because a fail-closed gate
      // turns a misconfigured hook into a hard stop: whoever hits it needs enough to fix it.
      const others = failures.length - 1;
      const reason =
        `Hook could not evaluate (${failure.kind}, source: ${failure.source}): ${failure.reason}.` +
        // Naming only the first would hide that several gates failed; the count is the cheap half of
        // that, and the reason line stays one line.
        (others > 0 ? ` (+${others} more hook failure(s))` : '') +
        // Both causes in ONE reason. This branch returns before the unregistered branch, so a turn
        // carrying both used to report only the error — the operator fixed the named cause, retried,
        // and hit a second denial with no warning it was queued. A fail-closed gate that reveals its
        // reasons one per attempt is a gate you debug by being repeatedly stopped.
        (unregisteredReason !== '' ? ` Also unevaluated — ${unregisteredReason}` : '');
      return toolFailure('hook-blocked', reason, { blocked: true, reason });
    }

    if (unregisteredReason !== '') {
      return toolFailure('hook-blocked', unregisteredReason, {
        blocked: true,
        reason: unregisteredReason,
      });
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
