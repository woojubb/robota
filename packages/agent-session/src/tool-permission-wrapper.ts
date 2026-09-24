import { PERMISSION_DENIED_RESULT, reportToolCrash } from './permission-types.js';
import { createLogger, isAbortFailure, TOOL_BODY_EVENTS, TOOL_PERMISSION_EVENTS } from '@robota-sdk/agent-core';
import { canonicaliseToolArguments } from './tool-argument-canonicalisation.js';
import {
  buildHookInput,
  firePostToolHook,
  runPreToolHook,
  truncateToolResult,
} from './tool-hook-helpers.js';

import type { IPermissionEnforcerOptions } from './permission-types.js';
import type { TSessionLogData } from './session-logger.js';
import type {
  IToolExecutionContext,
  IToolResult,
  IToolWithEventService,
  ITerminalOutput,
  TToolArgs,
  TToolParameters,
} from '@robota-sdk/agent-core';

const logger = createLogger('ToolBodyTrace');

/** Never let a permission observation break the tool_result it merely watches. */
function emitPermissionDecision(
  context: IToolExecutionContext | undefined,
  decision: 'allowed' | 'denied' | 'hook-blocked',
): void {
  try {
    context?.eventService?.emit(TOOL_PERMISSION_EVENTS.DECIDED, {
      timestamp: new Date(),
      executionId: context.executionId,
      decidedAt: new Date().toISOString(),
      decision,
    });
  } catch (error) {
    logger.warn(
      'tool permission observation failed',
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}

/** Exactly what the wrapper reads from the enforcer — no more, and named so it cannot quietly grow. */
export interface IToolWrapperDeps {
  readonly sessionId: string;
  readonly cwd: string;
  readonly config: IPermissionEnforcerOptions['config'];
  readonly terminal: ITerminalOutput;
  readonly transcriptPath?: string;
  readonly onToolExecution?: IPermissionEnforcerOptions['onToolExecution'];
  readonly hookTypeExecutors?: IPermissionEnforcerOptions['hookTypeExecutors'];
  getPermissionMode: IPermissionEnforcerOptions['getPermissionMode'];
  log(event: string, detail: TSessionLogData): void;
  checkPermission(
    toolName: string,
    toolArgs: TToolArgs,
    signal?: AbortSignal,
    interaction?: IToolExecutionContext['permissionInteraction'],
  ): Promise<boolean>;
}

/**
 * Wrap one tool so every call passes the permission gate, the hooks and the truncation limit.
 *
 * Extracted from `PermissionEnforcer` because the file-size ratchet refused to let it grow further,
 * and a ratchet that says "split instead of extending" is asking for exactly this. It takes what it
 * needs as `deps` rather than the enforcer itself: the ten members it reads are the honest surface
 * of this function, and naming them is what makes the extraction a boundary rather than a move.
 */
export function wrapToolWithPermission(
  tool: IToolWithEventService,
  enforcer: IToolWrapperDeps,
): IToolWithEventService {
  const originalExecute = tool.execute.bind(tool);

  const wrappedTool = Object.create(tool) as IToolWithEventService;
  wrappedTool.execute = async (
    rawParameters: TToolParameters,
    context?: IToolExecutionContext,
  ): Promise<IToolResult> => {
    // Issue #2429: the gate, the hooks, the logs and the tool all see ONE canonical form of the
    // arguments — a relative path argument resolved against the session root — so a pattern judges
    // the path the tool will actually open. Canonicalising needs the tool's name, which is read
    // inside the try below, so until then this holds the raw form.
    let parameters: TToolParameters = rawParameters;
    // Must NEVER throw — if this throws, the execution round records the
    // assistant tool_use in history but never adds a tool_result, which
    // corrupts the conversation and causes a 400 error on the next API call.
    // Read INSIDE the try, and held for the catch. Hoisting it out put an unguarded call above
    // the comment that says this function must never throw — a tool whose `getName` is missing or
    // throws would have propagated, which is the corruption that comment exists to prevent. The
    // catch needs the name only to announce the failure, and a call that has not reached it yet
    // has nothing to announce.
    let toolName = '(unknown)';

    try {
      toolName = tool.getName();
      parameters = canonicaliseToolArguments(toolName, rawParameters, enforcer.cwd);
      enforcer.log('tool_call', {
        tool: toolName,
        args: parameters as Record<string, string | number | boolean | object>,
      });

      const hookInput = buildHookInput(
        enforcer.sessionId,
        enforcer.cwd,
        toolName,
        parameters,
        enforcer.getPermissionMode(),
        enforcer.transcriptPath,
      );

      const preResult = await runPreToolHook(
        enforcer.config.hooks,
        hookInput,
        enforcer.hookTypeExecutors,
      );
      if (preResult) {
        enforcer.log('tool_blocked', { tool: toolName, reason: 'hook' });
        emitPermissionDecision(context, 'hook-blocked');
        return preResult;
      }

      // RUNTIME-005: the turn's signal reaches this wrapper (CORE-018) and stopped here.
      const allowed = await enforcer.checkPermission(
        toolName,
        parameters as TToolArgs,
        context?.signal,
        context?.permissionInteraction,
      );
      if (!allowed) {
        enforcer.log('tool_denied', { tool: toolName, reason: 'permission' });
        emitPermissionDecision(context, 'denied');
        enforcer.onToolExecution?.({
          type: 'end',
          toolName,
          toolArgs: parameters as TToolArgs,
          success: false,
          denied: true,
          executionId: context?.executionId,
        });
        return PERMISSION_DENIED_RESULT;
      }

      emitPermissionDecision(context, 'allowed');
      context?.signal?.throwIfAborted();
      enforcer.onToolExecution?.({
        type: 'start',
        toolName,
        toolArgs: parameters as TToolArgs,
        executionId: context?.executionId,
      });

      // The observation covers ONLY the awaited body, never approval, hooks, truncation or a
      // detached continuation. A pre-start denial/abort therefore has no tool-body span.
      const startedAtMs = Date.now();
      let outcome: 'success' | 'failure' | 'interrupted' = 'failure';
      let result: IToolResult;
      try {
        result = await originalExecute(parameters, context as IToolExecutionContext);
        outcome = context?.signal?.aborted ? 'interrupted' : result.success ? 'success' : 'failure';
      } catch (error) {
        outcome = context?.signal?.aborted || isAbortFailure(error) ? 'interrupted' : 'failure';
        throw error;
      } finally {
        try {
          context?.eventService?.emit(TOOL_BODY_EVENTS.COMPLETED, {
            timestamp: new Date(),
            executionId: context.executionId,
            startedAt: new Date(startedAtMs).toISOString(),
            endedAt: new Date(Math.max(Date.now(), startedAtMs)).toISOString(),
            outcome,
          });
        } catch (error) {
          // An observer must never turn a completed tool body into a missing tool_result.
          logger.warn(
            'tool body observation failed',
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      }

      // Truncate oversized tool output (matches 30K char limit)
      const truncatedResult = truncateToolResult(result);

      if (truncatedResult !== result && typeof result.data === 'string') {
        enforcer.terminal.writeLine(
          `  ⚠  Output truncated: ${result.data.length.toLocaleString()} chars total — model sees first and last 15,000 chars`,
        );
      }

      enforcer.onToolExecution?.({
        type: 'end',
        toolName,
        toolArgs: parameters as TToolArgs,
        success: truncatedResult.success,
        toolResultData:
          typeof truncatedResult.data === 'string'
            ? truncatedResult.data
            : JSON.stringify(truncatedResult.data),
        executionId: context?.executionId,
      });

      const dataSize =
        typeof truncatedResult.data === 'string'
          ? truncatedResult.data.length
          : (JSON.stringify(truncatedResult.data)?.length ?? 0);
      enforcer.log('tool_result', {
        tool: toolName,
        success: truncatedResult.success,
        dataChars: dataSize,
        truncated: truncatedResult !== result,
      });
      firePostToolHook(
        enforcer.config.hooks,
        hookInput,
        truncatedResult,
        enforcer.hookTypeExecutors,
      );
      return truncatedResult;
    } catch (err) {
      // CORE-027 — beside the envelope it returns, in `permission-types.ts`.
      return reportToolCrash(err, enforcer.onToolExecution, {
        toolName,
        toolArgs: parameters as TToolArgs,
        executionId: context?.executionId,
      });
    }
  };

  // SELFHOST-004: the wrapper runs `originalExecute` (bound to the ORIGINAL tool), which reads the
  // ORIGINAL tool's `eventService` (e.g. the `FunctionTool` span-completion emit). Because
  // `Object.create(tool)` would shadow a `setEventService` call onto the wrapper instance, forward it
  // to the original tool — otherwise an injected event bus never reaches the tool and spans never fire.
  wrappedTool.setEventService = (eventService) => {
    tool.setEventService(eventService);
  };

  return wrappedTool;
}
