import { PERMISSION_DENIED_RESULT, reportToolCrash, toolFailure } from './permission-types.js';
import {
  createLogger,
  isExecutionControlError,
  ExecutionRecoveryError,
  isSnapshotableUniversalValue,
  isUniversalValueEqual,
  DEFAULT_ABSTRACT_EVENT_SERVICE,
  isAbortFailure,
  TOOL_BODY_EVENTS,
  TOOL_PERMISSION_EVENTS,
  snapshotToolProvenance,
  wasToolResultAdmitted,
  withToolProvenance,
} from '@robota-sdk/agent-core';
import { canonicaliseToolArguments } from './tool-argument-canonicalisation.js';
import {
  buildHookInput,
  firePostToolHook,
  runPreToolGate,
  truncateToolResult,
} from './tool-hook-helpers.js';

import type { TPreToolHookDecision } from './tool-hook-helpers.js';
import type { IPermissionEnforcerOptions, IPermissionRefusal } from './permission-types.js';
import type { TSessionLogData } from './session-logger.js';
import type {
  IHookInput,
  IHookTypeExecutor,
  IEventService,
  IToolExecutionContext,
  IToolResult,
  IToolWithEventService,
  ITerminalOutput,
  TToolArgs,
  TToolParameters,
  TToolEffectAdmission,
} from '@robota-sdk/agent-core';

const logger = createLogger('ToolBodyTrace');

class DeferredPermissionRefusal extends Error {
  constructor(readonly result: IToolResult) {
    super('Effective tool arguments were not authorized');
  }
}

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
  readonly hookTypeExecutors: readonly IHookTypeExecutor[];
  getPermissionMode: IPermissionEnforcerOptions['getPermissionMode'];
  log(event: string, detail: TSessionLogData): void;
  checkPermission(
    toolName: string,
    toolArgs: TToolArgs,
    signal?: AbortSignal,
    interaction?: IToolExecutionContext['permissionInteraction'],
    hookTraceEnv?: IToolExecutionContext['hookTraceEnv'],
    continuation?: IToolExecutionContext['continuation'],
    hookDecision?: TPreToolHookDecision,
    /** The call's id (`context.executionId`), so a prompt raised for it can name the call. */
    executionId?: string,
  ): Promise<boolean | IPermissionRefusal>;
}

/**
 * Wrap one tool so every call passes the permission gate, the hooks and the truncation limit.
 *
 * It takes what it needs as `deps` rather than the `PermissionEnforcer` itself: the ten members it
 * reads are the honest surface of this function, and naming them is what makes it a boundary rather
 * than a move.
 */
export function wrapToolWithPermission(
  tool: IToolWithEventService,
  enforcer: IToolWrapperDeps,
): IToolWithEventService {
  const originalExecute = tool.execute.bind(tool);
  const originalExecuteWithAdmission = tool.executeWithAdmission?.bind(tool);
  const provenance = snapshotToolProvenance(tool.provenance);
  const onToolExecution: IToolWrapperDeps['onToolExecution'] = (event) => {
    const report = (error: unknown) =>
      logger.warn(
        'tool execution observation failed',
        error instanceof Error ? error : new Error(String(error)),
      );
    try {
      const observed =
        event.type === 'end' && provenance
          ? {
              ...event,
              toolResultParts: withToolProvenance(
                { success: event.success ?? false, parts: event.toolResultParts },
                provenance,
              ).parts,
            }
          : event;
      void Promise.resolve(enforcer.onToolExecution?.(observed)).catch(report);
    } catch (error) {
      report(error);
    }
  };
  // What this session gave the tool with `setEventService`. The tool instance may be shared with
  // other sessions, and the service set on it is whichever session set one last, so each call
  // carries this one instead. Until the session sets one, calls carry the no-op service: its calls
  // must not reach a service another session set.
  let sessionEventService: IEventService = DEFAULT_ABSTRACT_EVENT_SERVICE;

  const wrappedTool = Object.create(tool) as IToolWithEventService;
  Object.defineProperty(wrappedTool, 'provenance', { value: provenance, enumerable: true });
  const execute = async (
    rawParameters: TToolParameters,
    context?: IToolExecutionContext,
    beforeEffect?: TToolEffectAdmission,
  ): Promise<IToolResult> => {
    // The gate, the hooks, the logs and the tool all see ONE canonical form of the
    // arguments — a relative path argument resolved against the session root — so a pattern judges
    // the path the tool will actually open. Canonicalising needs the tool's name, which is read
    // inside the try below, so until then this holds the raw form.
    let parameters: TToolParameters = rawParameters;
    // Ordinary tool failures become results. A journal failure must stop the execution owner,
    // preventing a later model call from treating a persistence failure as a retryable tool error.
    // Resolve the name inside the protected path so a malformed tool still produces a result.
    let toolName = '(unknown)';

    try {
      toolName = tool.getName();
      parameters = canonicaliseToolArguments(toolName, rawParameters, enforcer.cwd);
      enforcer.log('tool_call', {
        tool: toolName,
        args: parameters as Record<string, string | number | boolean | object>,
      });

      let hookInput = buildHookInput(
        enforcer.sessionId,
        enforcer.cwd,
        toolName,
        parameters,
        enforcer.getPermissionMode(),
        enforcer.transcriptPath,
      );

      const gate = await runPreToolGate(
        enforcer.config.hooks,
        hookInput,
        enforcer.hookTypeExecutors,
        context?.hookTraceEnv,
      );
      if (gate.refusal) {
        enforcer.log('tool_blocked', { tool: toolName, reason: 'hook' });
        emitPermissionDecision(context, 'hook-blocked');
        return gate.refusal;
      }

      if (gate.parameters !== undefined) {
        parameters = gate.parameters;
        hookInput = { ...hookInput, tool_input: parameters as IHookInput['tool_input'] };
      }

      // The turn's signal reaches this wrapper and stopped here.
      const verdict = await enforcer.checkPermission(
        toolName,
        parameters as TToolArgs,
        context?.signal,
        context?.permissionInteraction,
        context?.hookTraceEnv,
        context?.continuation,
        gate.decision,
        context?.executionId,
      );
      if (verdict !== true) {
        enforcer.log('tool_denied', { tool: toolName, reason: 'permission' });
        emitPermissionDecision(context, 'denied');
        onToolExecution({
          type: 'end',
          toolName,
          toolArgs: parameters as TToolArgs,
          success: false,
          denied: true,
          executionId: context?.executionId,
        });
        // A refusal that carries its reason (the auto-mode classifier) hands it to the model.
        return typeof verdict === 'object'
          ? toolFailure('denied', verdict.message)
          : PERMISSION_DENIED_RESULT;
      }

      emitPermissionDecision(context, 'allowed');
      context?.signal?.throwIfAborted();
      onToolExecution({
        type: 'start',
        toolName,
        toolArgs: structuredClone(parameters) as TToolArgs,
        executionId: context?.executionId,
      });
      context?.signal?.throwIfAborted();

      // The observation covers ONLY the awaited body, never approval, hooks, truncation or a
      // detached continuation. A pre-start denial/abort therefore has no tool-body span.
      let startedAtMs: number | undefined;
      let admittedParameters: TToolParameters | undefined;
      const admit: TToolEffectAdmission = async (effective) => {
        context?.signal?.throwIfAborted();
        if (!isSnapshotableUniversalValue(effective))
          throw new ExecutionRecoveryError(
            'EXECUTION_RECOVERY_INVALID',
            'Tool parameters cannot be represented for effect admission',
          );
        const snapshot = structuredClone(effective);
        const approvedArguments = canonicaliseToolArguments(toolName, snapshot, enforcer.cwd);
        if (JSON.stringify(approvedArguments) !== JSON.stringify(snapshot)) {
          throw new DeferredPermissionRefusal(
            toolFailure(
              'denied',
              'Tool admission requires final canonical arguments; relative paths must be resolved before admission.',
            ),
          );
        }
        if (JSON.stringify(approvedArguments) !== JSON.stringify(parameters)) {
          const nextHookInput = buildHookInput(
            enforcer.sessionId,
            enforcer.cwd,
            toolName,
            approvedArguments,
            enforcer.getPermissionMode(),
            enforcer.transcriptPath,
          );
          const nextGate = await runPreToolGate(
            enforcer.config.hooks,
            nextHookInput,
            enforcer.hookTypeExecutors,
            context?.hookTraceEnv,
          );
          if (nextGate.refusal) throw new DeferredPermissionRefusal(nextGate.refusal);
          if (
            nextGate.parameters !== undefined &&
            JSON.stringify(nextGate.parameters) !== JSON.stringify(approvedArguments)
          )
            throw new DeferredPermissionRefusal(
              toolFailure(
                'hook-blocked',
                'A hook cannot replace arguments already settled by the tool; retry as a new call.',
              ),
            );
          const effectiveVerdict = await enforcer.checkPermission(
            toolName,
            approvedArguments as TToolArgs,
            context?.signal,
            context?.permissionInteraction,
            context?.hookTraceEnv,
            context?.continuation,
            nextGate.decision,
            context?.executionId,
          );
          if (effectiveVerdict !== true)
            throw new DeferredPermissionRefusal(
              typeof effectiveVerdict === 'object'
                ? toolFailure('denied', effectiveVerdict.message)
                : PERMISSION_DENIED_RESULT,
            );
          hookInput = nextHookInput;
        }
        if (!isUniversalValueEqual(effective, snapshot))
          throw new ExecutionRecoveryError(
            'EXECUTION_RECOVERY_INVALID',
            'Tool parameters changed while awaiting permission',
          );
        parameters = structuredClone(snapshot);
        context?.signal?.throwIfAborted();
        await beforeEffect?.(parameters);
        if (!isUniversalValueEqual(effective, snapshot))
          throw new ExecutionRecoveryError(
            'EXECUTION_RECOVERY_REQUIRED',
            'Tool parameters changed while effect admission was being recorded',
            context?.continuation ? [context.continuation.action.actionId] : [],
          );
        admittedParameters = structuredClone(snapshot);
        context?.signal?.throwIfAborted();
        startedAtMs = Date.now();
      };
      let outcome: 'success' | 'failure' | 'interrupted' = 'failure';
      let result: IToolResult;
      let alreadyAdmitted = false;
      try {
        // A call without a context was not made by an agent, so it has no session to carry.
        const toolContext =
          context === undefined
            ? undefined
            : { ...context, parameters, instanceEventService: sessionEventService };
        if (beforeEffect && originalExecuteWithAdmission) {
          result = await originalExecuteWithAdmission(
            parameters,
            toolContext as IToolExecutionContext,
            admit,
          );
        } else {
          if (beforeEffect) await admit(parameters);
          else startedAtMs = Date.now();
          context?.signal?.throwIfAborted();
          result = await originalExecute(parameters, toolContext as IToolExecutionContext);
        }
        if (beforeEffect) {
          try {
            alreadyAdmitted = wasToolResultAdmitted(result);
            const { success, data, parts, error, metadata, view } = result;
            const settled = structuredClone({ success, data, parts, error, metadata });
            JSON.stringify(settled);
            result = { ...settled, ...(view && { view }) };
          } catch {
            throw new ExecutionRecoveryError(
              'EXECUTION_RECOVERY_REQUIRED',
              'Tool result cannot be safely settled after the effect',
            );
          }
        }
        outcome = context?.signal?.aborted ? 'interrupted' : result.success ? 'success' : 'failure';
      } catch (error) {
        outcome = context?.signal?.aborted || isAbortFailure(error) ? 'interrupted' : 'failure';
        throw error;
      } finally {
        try {
          if (startedAtMs !== undefined)
            context?.eventService?.emit(TOOL_BODY_EVENTS.COMPLETED, {
              timestamp: new Date(),
              executionId: context.executionId,
              startedAt: new Date(startedAtMs).toISOString(),
              endedAt: new Date(Math.max(Date.now(), startedAtMs)).toISOString(),
              outcome,
              toolName,
              ...(typeof context.toolBodyId === 'string' ? { toolBodyId: context.toolBodyId } : {}),
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
      const truncatedResult = alreadyAdmitted ? result : truncateToolResult(result);

      if (truncatedResult !== result && typeof result.data === 'string') {
        enforcer.terminal.writeLine(
          `  ⚠  Output truncated: ${result.data.length.toLocaleString()} chars total — model sees first and last 15,000 chars`,
        );
      }

      onToolExecution({
        type: 'end',
        toolName,
        toolArgs: (beforeEffect
          ? structuredClone(admittedParameters ?? parameters)
          : parameters) as TToolArgs,
        success: truncatedResult.success,
        toolResultData:
          typeof truncatedResult.data === 'string'
            ? truncatedResult.data
            : JSON.stringify(truncatedResult.data),
        toolResultParts:
          beforeEffect && truncatedResult.parts
            ? structuredClone(truncatedResult.parts)
            : truncatedResult.parts,
        executionId: context?.executionId,
        // Display data for a surface only: it never joins `toolResultData`, which is what is logged.
        ...(truncatedResult.view ? { view: truncatedResult.view } : {}),
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
        context?.hookTraceEnv,
      );
      return truncatedResult;
    } catch (err) {
      if (isExecutionControlError(err)) throw err;
      if (err instanceof DeferredPermissionRefusal) return err.result;
      // Beside the envelope it returns, in `permission-types.ts`.
      return reportToolCrash(err, onToolExecution, {
        toolName,
        toolArgs: parameters as TToolArgs,
        executionId: context?.executionId,
      });
    }
  };

  const executeAttributed: typeof execute = async (...args) =>
    withToolProvenance(await execute(...args), provenance);
  wrappedTool.execute = executeAttributed;
  wrappedTool.executeWithAdmission = executeAttributed;

  // Kept for the calls above, and still forwarded to the original tool, because
  // `Object.create(tool)` would otherwise shadow it onto the wrapper: a tool that reads only the
  // service set on it, such as an `AbstractTool` subclass, keeps receiving it.
  wrappedTool.setEventService = (eventService) => {
    sessionEventService = eventService ?? DEFAULT_ABSTRACT_EVENT_SERVICE;
    tool.setEventService(eventService);
  };

  return wrappedTool;
}
