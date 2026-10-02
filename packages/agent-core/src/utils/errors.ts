/**
 * Reusable type definitions for error utilities
 */

/**
 * Error context data type
 * Used for storing contextual information in error instances
 */
export type TErrorContextData = Record<
  string,
  string | number | boolean | Date | Error | string[] | undefined
>;

/**
 * Error external input type
 * Used for handling external errors from unknown sources
 */
export type TErrorExternalInput =
  Error | string | Record<string, string | number | boolean> | null | undefined;

/**
 * Base error class for all ConversationAgent errors
 */
export abstract class AgentRuntimeError extends Error {
  abstract readonly code: string;
  abstract readonly category: 'user' | 'system' | 'provider';
  abstract readonly recoverable: boolean;

  constructor(
    message: string,
    public readonly context?: TErrorContextData,
  ) {
    super(message);
    this.name = this.constructor.name;

    // Ensure proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Configuration related errors
 */
export class ConfigurationError extends AgentRuntimeError {
  readonly code = 'CONFIGURATION_ERROR';
  readonly category = 'user' as const;
  readonly recoverable = false;

  constructor(message: string, context?: TErrorContextData) {
    super(`Configuration Error: ${message}`, context);
  }
}

/**
 * Input validation errors
 */
export class ValidationError extends AgentRuntimeError {
  readonly code = 'VALIDATION_ERROR';
  readonly category = 'user' as const;
  readonly recoverable = false;

  constructor(
    message: string,
    public readonly field?: string,
    context?: TErrorContextData,
  ) {
    super(`Validation Error: ${message}`, context);
  }
}

/**
 * Structured output validation exhausted its retry budget (CORE-015).
 *
 * Thrown by `run(input, { output })` when the model's final response still fails
 * schema validation after the configured number of retries. `issues` holds the
 * validation messages from the last attempt; `attempts` is the total number of
 * provider turns spent (initial + retries).
 */
export class StructuredOutputError extends AgentRuntimeError {
  readonly code = 'STRUCTURED_OUTPUT_ERROR';
  readonly category = 'provider' as const;
  readonly recoverable = true;

  constructor(
    message: string,
    public readonly issues: string[],
    public readonly attempts: number,
    context?: TErrorContextData,
  ) {
    super(`Structured Output Error: ${message}`, context);
  }
}

/** What the vendor said about a failed call, as far as it said anything. */
export interface IProviderFailureDetails {
  /** The HTTP status of the failed response; absent for a failure with no response (e.g. an SSE error event). */
  status?: number;
  /** The vendor's own error type, e.g. Anthropic's `overloaded_error`. */
  type?: string;
}

/**
 * Provider related errors
 */
export class ProviderError extends AgentRuntimeError {
  readonly code = 'PROVIDER_ERROR';
  readonly category = 'provider' as const;
  readonly recoverable = true;
  readonly status?: number;
  readonly type?: string;

  constructor(
    message: string,
    public readonly provider: string,
    public readonly originalError?: Error,
    context?: TErrorContextData,
    details?: IProviderFailureDetails,
  ) {
    super(`Provider Error (${provider}): ${message}`, context);
    if (details?.status !== undefined) this.status = details.status;
    if (details?.type !== undefined) this.type = details.type;
  }
}

/**
 * Authentication errors
 */
export class AuthenticationError extends AgentRuntimeError {
  readonly code = 'AUTHENTICATION_ERROR';
  readonly category = 'user' as const;
  readonly recoverable = false;

  constructor(
    message: string,
    public readonly provider?: string,
    context?: TErrorContextData,
  ) {
    super(`Authentication Error: ${message}`, context);
  }
}

/**
 * Rate limit errors
 */
export class RateLimitError extends AgentRuntimeError {
  readonly code = 'RATE_LIMIT_ERROR';
  readonly category = 'provider' as const;
  readonly recoverable = true;

  constructor(
    message: string,
    public readonly retryAfter?: number,
    public readonly provider?: string,
    context?: TErrorContextData,
  ) {
    super(`Rate Limit Error: ${message}`, context);
  }
}

/**
 * Network/connectivity errors
 */
export class NetworkError extends AgentRuntimeError {
  readonly code = 'NETWORK_ERROR';
  readonly category = 'system' as const;
  readonly recoverable = true;

  constructor(
    message: string,
    public readonly originalError?: Error,
    context?: TErrorContextData,
    /** `undefined` for a network failure with no provider context (e.g. a generic timeout). */
    public readonly provider?: string,
  ) {
    super(`Network Error: ${message}`, context);
  }
}

/**
 * Tool execution errors
 */
export class ToolExecutionError extends AgentRuntimeError {
  readonly code = 'TOOL_EXECUTION_ERROR';
  readonly category = 'system' as const;
  readonly recoverable = false;

  constructor(
    message: string,
    public readonly toolName: string,
    public readonly originalError?: Error,
    context?: TErrorContextData,
  ) {
    super(`Tool Execution Error (${toolName}): ${message}`, context);
  }
}

/**
 * The same-tool-input loop guard tripped — CORE-035.
 *
 * A tool was invoked with byte-identical serialized inputs more times than `maxSameToolInputs`
 * allows, so the turn stopped rather than looping. This is the AGENT giving up, not the user
 * cancelling: the SPEC used to promise an `AbortError` here, which `isAbortFailure` resolves as
 * `success: true, interrupted: true` — reporting a run that produced no answer as a success.
 *
 * Named rather than a bare `Error` for the reason the SPEC was reaching for by naming a type at all:
 * a caller must be able to tell "the agent looped" from "the network died". `AgentRuntimeError` carries
 * `code`/`category`/`recoverable` out through CORE-027's failure path intact.
 *
 * `recoverable` is TRUE: the loop is a property of this turn's prompt and tool set, not of the
 * system, and a caller that varies either can reasonably try again.
 */
export class SameToolInputLoopError extends AgentRuntimeError {
  readonly code = 'SAME_TOOL_INPUT_LOOP';
  readonly category = 'system' as const;
  readonly recoverable = true;

  constructor(
    public readonly toolName: string,
    public readonly callCount: number,
    public readonly maxSameToolInputs: number,
    context?: TErrorContextData,
  ) {
    super(
      `Tool "${toolName}" was called with identical input ${callCount} times, past the ` +
        `maxSameToolInputs limit of ${maxSameToolInputs} — stopping the turn to break the loop`,
      context,
    );
  }
}

/**
 * A turn ended with neither a tool result nor a final text response while `allowToolOnlyCompletion`
 * was set.
 *
 * `allowToolOnlyCompletion` only WIDENS what counts as a valid finish (a tool call alone, with no
 * final text after it); it never narrows the ordinary case. Without the flag, a round that produces
 * neither is recovered by one more provider call asking for a summary (`forceSummaryCall`). Setting
 * the flag is what turns that rescue off — a decision agent wants exactly one provider call, never a
 * follow-up — so a round that produces neither has nothing left to recover it. That is a genuinely
 * unanswered turn, not the internal `[STRICT-POLICY]` result-shape violation an actually malformed
 * execution result trips; a caller must be able to catch this by type instead of parsing that message.
 *
 * `recoverable` is TRUE: like `SameToolInputLoopError`, this is a property of this turn's prompt and
 * model response, not of the system, and a caller that varies either can reasonably try again.
 */
export class EmptyCompletionError extends AgentRuntimeError {
  readonly code = 'EMPTY_COMPLETION';
  readonly category = 'provider' as const;
  readonly recoverable = true;

  constructor(
    public readonly round: number,
    context?: TErrorContextData,
  ) {
    super(
      `Round ${round} ended with no tool call and no text response, and allowToolOnlyCompletion ` +
        'prevented the follow-up call that would otherwise recover it',
      context,
    );
  }
}

/**
 * Model not available errors
 */
export class ModelNotAvailableError extends AgentRuntimeError {
  readonly code = 'MODEL_NOT_AVAILABLE';
  readonly category = 'user' as const;
  readonly recoverable = false;

  constructor(
    /** `undefined` when the failure names no model — a provider adapter classifying a raw HTTP
     *  response by status alone does not always know which model the vendor meant. */
    public readonly model: string | undefined,
    public readonly provider: string,
    public readonly availableModels?: string[],
    /**
     * `context.originalMessage`, when given, is the vendor's own text (already scrubbed of any
     * credential by the caller) — folded into `message` so a "Details" disclosure built from
     * `message` alone still shows the real cause instead of just this class's fixed sentence.
     */
    context?: TErrorContextData,
  ) {
    const base =
      model !== undefined
        ? `Model "${model}" is not available for provider "${provider}"`
        : `No model available for provider "${provider}"`;
    const detail = context?.['originalMessage'];
    super(typeof detail === 'string' && detail.length > 0 ? `${base}: ${detail}` : base, context);
  }
}

/**
 * Circuit breaker open error
 */
export class CircuitBreakerOpenError extends AgentRuntimeError {
  readonly code = 'CIRCUIT_BREAKER_OPEN';
  readonly category = 'system' as const;
  readonly recoverable = true;

  constructor(message: string = 'Circuit breaker is open', context?: TErrorContextData) {
    super(message, context);
  }
}

/**
 * Plugin errors
 */
export class PluginError extends AgentRuntimeError {
  readonly code = 'PLUGIN_ERROR';
  readonly category = 'system' as const;
  readonly recoverable = false;

  constructor(
    message: string,
    public readonly pluginName: string,
    context?: TErrorContextData,
  ) {
    super(`Plugin Error (${pluginName}): ${message}`, context);
  }
}

/**
 * Storage related errors
 */
export class StorageError extends AgentRuntimeError {
  readonly code = 'STORAGE_ERROR';
  readonly category = 'system' as const;
  readonly recoverable = true;

  constructor(message: string, context?: TErrorContextData) {
    super(`Storage Error: ${message}`, context);
  }
}

/**
 * Cache integrity validation errors
 */
export class CacheIntegrityError extends AgentRuntimeError {
  readonly code = 'CACHE_INTEGRITY_ERROR';
  readonly category = 'system' as const;
  readonly recoverable = false;

  constructor(message: string, context?: TErrorContextData) {
    super(`Cache Integrity Error: ${message}`, context);
  }
}
