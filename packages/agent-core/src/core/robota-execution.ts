/**
 * Execution methods (run, runStream) for the Robota agent.
 *
 * Extracted from robota.ts to keep the main class under 300 lines.
 */
import { AGENT_EVENTS } from '../agents/constants';
import { parseStructuredResponseText } from '../schema/structured-output';
import { StructuredOutputError } from '../utils/errors';

import type { TUniversalMessage, IAgentConfig, IRunOptions } from '../interfaces/agent';
import type { IAgentEventData } from '../interfaces/event-service';
import type { TConfigValue } from '../interfaces/types';
import type { IStructuredOutputSpec } from '../schema/structured-output';
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
    const executionConfig: IAgentConfig = { ...deps.config, ...configOverrides };

    // CORE-018: the streaming context is built by the SAME buildRunContext as the round
    // path — the historical inline construction dropped signal/onTextDelta/onExecutionEvent
    // (and every run option added after it), making the public streaming API uncancellable.
    const stream = deps
      .getExecutionService()
      .executeStream(input, messages, executionConfig, buildRunContext(deps, options));

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

/** Config override that routes the structured-output schema to the provider surface. */
function structuredConfigOverrides(spec: IStructuredOutputSpec): Partial<IAgentConfig> {
  return {
    responseFormat: {
      type: 'json_schema',
      // The universal JSON-schema subset is plain JSON data; the interface merely
      // lacks an index signature, hence the widening cast.
      schema: spec.jsonSchema as unknown as Record<string, TConfigValue>,
      name: spec.name,
    },
  };
}

function buildRetryFeedbackInput(spec: IStructuredOutputSpec, issues: string[]): string {
  return [
    'Your previous response did not match the required JSON schema.',
    'Validation issues:',
    ...issues.map((issue) => `- ${issue}`),
    '',
    'Respond with ONLY a JSON object (no prose, no code fences) matching this JSON schema:',
    JSON.stringify(spec.jsonSchema),
  ].join('\n');
}

/**
 * Execute a schema-enforced structured turn (CORE-015). Each attempt is a full
 * conversation turn (history stays append-only); a validation failure feeds the
 * issues back as the next attempt's input, bounded by `outputRetries`.
 * @internal
 */
export async function robotaRunStructured(
  deps: IRobotaExecutionDeps,
  input: string,
  options: IRunOptions,
  spec: IStructuredOutputSpec,
): Promise<unknown> {
  const maxAttempts = (options.outputRetries ?? 2) + 1;
  const overrides = structuredConfigOverrides(spec);
  let attemptInput = input;
  let lastIssues: string[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const responseText = await robotaRun(deps, attemptInput, options, overrides);
    const outcome = validateStructuredText(spec, responseText);
    if (outcome.success) {
      return outcome.value;
    }
    lastIssues = outcome.issues;
    deps.logger.debug('Structured output validation failed', {
      attempt,
      maxAttempts,
      issues: lastIssues,
    });
    if (attempt < maxAttempts) {
      attemptInput = buildRetryFeedbackInput(spec, lastIssues);
    }
  }

  throw new StructuredOutputError(
    `response failed schema validation after ${maxAttempts} attempt(s)`,
    lastIssues,
    maxAttempts,
  );
}

/**
 * Streaming variant of the structured turn: text deltas stream as usual (retried
 * attempts stream too) and the validated object is the generator's return value.
 * @internal
 */
export async function* robotaRunStreamStructured(
  deps: IRobotaExecutionDeps,
  input: string,
  options: IRunOptions,
  spec: IStructuredOutputSpec,
): AsyncGenerator<string, unknown, undefined> {
  const maxAttempts = (options.outputRetries ?? 2) + 1;
  const overrides = structuredConfigOverrides(spec);
  let attemptInput = input;
  let lastIssues: string[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let responseText = '';
    for await (const chunk of robotaRunStream(deps, attemptInput, options, overrides)) {
      responseText += chunk;
      yield chunk;
    }
    const outcome = validateStructuredText(spec, responseText);
    if (outcome.success) {
      return outcome.value;
    }
    lastIssues = outcome.issues;
    deps.logger.debug('Structured output validation failed (stream)', {
      attempt,
      maxAttempts,
      issues: lastIssues,
    });
    if (attempt < maxAttempts) {
      attemptInput = buildRetryFeedbackInput(spec, lastIssues);
    }
  }

  throw new StructuredOutputError(
    `response failed schema validation after ${maxAttempts} attempt(s)`,
    lastIssues,
    maxAttempts,
  );
}

function validateStructuredText(
  spec: IStructuredOutputSpec,
  responseText: string,
): { success: true; value: unknown } | { success: false; issues: string[] } {
  const parsed = parseStructuredResponseText(responseText);
  if (!parsed.success) {
    return { success: false, issues: [parsed.issue] };
  }
  const validated = spec.validate(parsed.value);
  if (validated.success) {
    return { success: true, value: validated.value };
  }
  return { success: false, issues: validated.issues };
}
