/**
 * Execution methods (run, runStream) for the Robota agent.
 *
 * Extracted from robota.ts to keep the main class under 300 lines.
 */
import { AGENT_EVENTS } from '../agents/constants';

import type { TUniversalMessage, IAgentConfig, IRunOptions } from '../interfaces/agent';
import type { IAgentEventData } from '../interfaces/event-service';
import type { ExecutionService } from '../services/execution-service';
import type { IExecutionContext } from '../services/execution-types';
import type { ILogger } from '../utils/logger';

/** Dependencies required by the execution helpers. @internal */
export interface IRobotaExecutionDeps {
  readonly conversationId: string;
  readonly config: IAgentConfig;
  readonly logger: ILogger;
  getHistory(): TUniversalMessage[];
  getExecutionService(): ExecutionService;
  emitAgentEvent(eventType: string, data: Omit<IAgentEventData, 'timestamp'>): void;
}

function buildRunContext(
  deps: IRobotaExecutionDeps,
  options: IRunOptions,
): Partial<IExecutionContext> {
  return {
    conversationId: deps.conversationId,
    ...(options.sessionId && { sessionId: options.sessionId }),
    ...(options.userId && { userId: options.userId }),
    ...(options.driverId && { driverId: options.driverId }),
    ...(options.metadata && { metadata: options.metadata }),
    ...(options.signal && { signal: options.signal }),
    ...(options.onTextDelta && { onTextDelta: options.onTextDelta }),
    ...(options.onExecutionEvent && { onExecutionEvent: options.onExecutionEvent }),
    ...(options.maxExecutionRounds !== undefined && {
      maxExecutionRounds: options.maxExecutionRounds,
    }),
    ...(options.maxSameToolInputs !== undefined && {
      maxSameToolInputs: options.maxSameToolInputs,
    }),
    ...(options.allowToolOnlyCompletion !== undefined && {
      allowToolOnlyCompletion: options.allowToolOnlyCompletion,
    }),
    ...(options.maxTokens !== undefined && { maxTokens: options.maxTokens }),
    ...(options.temperature !== undefined && { temperature: options.temperature }),
    ...(options.toolChoice !== undefined && { toolChoice: options.toolChoice }),
    ...(options.ephemeralSystemContext !== undefined && {
      ephemeralSystemContext: options.ephemeralSystemContext,
    }),
  };
}

/** Execute a single conversation turn. @internal */
export async function robotaRun(
  deps: IRobotaExecutionDeps,
  input: string,
  options: IRunOptions = {},
  configOverrides?: Partial<IAgentConfig>,
): Promise<string> {
  try {
    deps.emitAgentEvent(AGENT_EVENTS.EXECUTION_START, {});

    deps.logger.debug('Starting Robota execution', {
      inputLength: input.length,
      conversationId: deps.conversationId,
      sessionId: options.sessionId || 'none',
      userId: options.userId || 'none',
      hasMetadata: !!options.metadata,
    });

    const messages = deps.getHistory();
    const executionConfig: IAgentConfig = { ...deps.config, ...configOverrides };

    const result = await deps
      .getExecutionService()
      .execute(input, messages, executionConfig, buildRunContext(deps, options));

    deps.logger.debug('Robota execution completed', {
      success: result.success,
      duration: result.duration,
      tokensUsed: result.tokensUsed,
      toolsExecuted: result.toolsExecuted,
      interrupted: result.interrupted,
    });

    if (result.interrupted) {
      deps.emitAgentEvent(AGENT_EVENTS.EXECUTION_COMPLETE, {});
      return result.response;
    }

    if (!result.success) {
      // CORE-020: every failed result must carry its error (SPEC invariant); a missing
      // error here is a contract violation, not a reason to fall through to the response.
      throw (
        result.error ??
        new Error(
          '[STRICT-POLICY] Failed execution result missing error field — every success:false result must carry error',
        )
      );
    }

    deps.emitAgentEvent(AGENT_EVENTS.EXECUTION_COMPLETE, {});
    return result.response;
  } catch (error) {
    deps.logger.error('Robota execution failed', {
      error: error instanceof Error ? error.message : String(error),
      conversationId: deps.conversationId,
    });
    deps.emitAgentEvent(AGENT_EVENTS.EXECUTION_ERROR, {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/** Execute a streaming conversation turn. @internal */
export async function* robotaRunStream(
  deps: IRobotaExecutionDeps,
  input: string,
  options: IRunOptions = {},
  configOverrides?: Partial<IAgentConfig>,
): AsyncGenerator<string, string, undefined> {
  try {
    deps.emitAgentEvent(AGENT_EVENTS.EXECUTION_START, {});

    deps.logger.debug('Starting Robota streaming execution', {
      inputLength: input.length,
      conversationId: deps.conversationId,
      sessionId: options.sessionId || 'none',
      userId: options.userId || 'none',
      hasMetadata: !!options.metadata,
    });

    const messages = deps.getHistory();
    const executionConfig: IAgentConfig = { ...deps.config, ...configOverrides };

    // CORE-018: the streaming context is built by the SAME buildRunContext as the round
    // path — the historical inline construction dropped signal/onTextDelta/onExecutionEvent
    // (and every run option added after it), making the public streaming API uncancellable.
    const stream = deps
      .getExecutionService()
      .executeStream(input, messages, executionConfig, buildRunContext(deps, options));

    // CORE-042: `yield*` rather than a manual loop -- it forwards `.return()` to the delegated
    // generator, which is what makes the adapter's abort-on-abandonment fire when a consumer breaks
    // out. It also carries the turn's final assistant text out as this generator's return value, so
    // `runStream` answers what `run` answers instead of making every caller re-accumulate deltas.
    const result = yield* stream;

    if (!result.success) {
      // CORE-020, and CORE-042 makes it the SAME rule on both entry points: `execute` reports a
      // failed turn by resolving with `success: false` and an error, and the caller throws it. The
      // streaming path used to reject from inside its own engine instead, which is how the two
      // could disagree about what a failed run looks like.
      throw (
        result.error ??
        new Error(
          '[STRICT-POLICY] Failed execution result missing error field — every success:false result must carry error',
        )
      );
    }
    return result.response;
  } catch (error) {
    deps.logger.error('Robota streaming execution failed', {
      error: error instanceof Error ? error.message : String(error),
      conversationId: deps.conversationId,
    });
    deps.emitAgentEvent(AGENT_EVENTS.EXECUTION_ERROR, {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    deps.emitAgentEvent(AGENT_EVENTS.EXECUTION_COMPLETE, {});
  }
}
