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
 * Base error class for all Robota errors
 */
export abstract class RobotaError extends Error {
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
export class ConfigurationError extends RobotaError {
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
export class ValidationError extends RobotaError {
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
export class StructuredOutputError extends RobotaError {
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

/**
 * Provider related errors
 */
export class ProviderError extends RobotaError {
  readonly code = 'PROVIDER_ERROR';
  readonly category = 'provider' as const;
  readonly recoverable = true;

  constructor(
    message: string,
    public readonly provider: string,
    public readonly originalError?: Error,
    context?: TErrorContextData,
  ) {
    super(`Provider Error (${provider}): ${message}`, context);
  }
}

/**
 * Authentication errors
 */
export class AuthenticationError extends RobotaError {
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
export class RateLimitError extends RobotaError {
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
export class NetworkError extends RobotaError {
  readonly code = 'NETWORK_ERROR';
  readonly category = 'system' as const;
  readonly recoverable = true;

  constructor(
    message: string,
    public readonly originalError?: Error,
    context?: TErrorContextData,
  ) {
    super(`Network Error: ${message}`, context);
  }
}

/**
 * Tool execution errors
 */
export class ToolExecutionError extends RobotaError {
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
 * a caller must be able to tell "the agent looped" from "the network died". `RobotaError` carries
 * `code`/`category`/`recoverable` out through CORE-027's failure path intact.
 *
 * `recoverable` is TRUE: the loop is a property of this turn's prompt and tool set, not of the
 * system, and a caller that varies either can reasonably try again.
 */
export class SameToolInputLoopError extends RobotaError {
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
 * Model not available errors
 */
export class ModelNotAvailableError extends RobotaError {
  readonly code = 'MODEL_NOT_AVAILABLE';
  readonly category = 'user' as const;
  readonly recoverable = false;

  constructor(
    model: string,
    provider: string,
    public readonly availableModels?: string[],
    context?: TErrorContextData,
  ) {
    super(`Model "${model}" is not available for provider "${provider}"`, context);
  }
}

/**
 * Circuit breaker open error
 */
export class CircuitBreakerOpenError extends RobotaError {
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
export class PluginError extends RobotaError {
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
export class StorageError extends RobotaError {
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
export class CacheIntegrityError extends RobotaError {
  readonly code = 'CACHE_INTEGRITY_ERROR';
  readonly category = 'system' as const;
  readonly recoverable = false;

  constructor(message: string, context?: TErrorContextData) {
    super(`Cache Integrity Error: ${message}`, context);
  }
}
