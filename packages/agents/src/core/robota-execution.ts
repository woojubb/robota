/**
 * Execution methods (run, runStream) for the Robota agent.
 *
 * Extracted from robota.ts to keep the main class under 300 lines.
 */
import type { TUniversalMessage, IAgentConfig, IRunOptions } from '../interfaces/agent';
import type { ExecutionService } from '../services/execution-service';
import type { ILogger } from '../utils/logger';
import type { IAgentEventData } from '../interfaces/event-service';
import { AGENT_EVENTS } from '../agents/constants';

/** Dependencies required by the execution helpers. @internal */
export interface IRobotaExecutionDeps {
  readonly conversationId: string;
  readonly config: IAgentConfig;
  readonly logger: ILogger;
  getHistory(): TUniversalMessage[];
  getExecutionService(): ExecutionService;
  emitAgentEvent(eventType: string, data: Omit<IAgentEventData, 'timestamp'>): void;
}

/** Execute a single conversation turn. @internal */
export async function robotaRun(
  deps: IRobotaExecutionDeps,
  input: string,
  options: IRunOptions = {},
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
    const executionConfig: IAgentConfig = { ...deps.config };

    const result = await deps.getExecutionService().execute(input, messages, executionConfig, {
      conversationId: deps.conversationId,
      ...(options.sessionId && { sessionId: options.sessionId }),
      ...(options.userId && { userId: options.userId }),
      ...(options.metadata && { metadata: options.metadata }),
    });

    deps.logger.debug('Robota execution completed', {
      success: result.success,
      duration: result.duration,
      tokensUsed: result.tokensUsed,
      toolsExecuted: result.toolsExecuted,
    });

    if (!result.success && result.error) {
      throw result.error;
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
): AsyncGenerator<string, void, undefined> {
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
    const executionConfig: IAgentConfig = { ...deps.config };

    const stream = deps.getExecutionService().executeStream(input, messages, executionConfig, {
      conversationId: deps.conversationId,
      ...(options.sessionId && { sessionId: options.sessionId }),
      ...(options.userId && { userId: options.userId }),
      ...(options.metadata && { metadata: options.metadata }),
    });

    for await (const chunk of stream) {
      yield chunk.chunk;
    }
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
