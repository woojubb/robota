import {
  AbstractPlugin,
  PluginCategory,
  PluginPriority,
  createLogger,
  type ILogger,
  PluginError,
} from '@robota-sdk/agent-core';

// Import from Facade pattern modules for type safety
import type {
  IErrorHandlingContextData,
  IErrorHandlingPluginOptions,
  IErrorHandlingPluginStats,
} from './types';
import { toErrorContext, createPluginErrorContext } from './context-adapter';
import {
  validateErrorHandlingOptions,
  resolveRetryDelay,
  isCircuitBreakerStillOpen,
  sleep,
} from './error-handling-helpers';

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 1000;
const DEFAULT_FAILURE_THRESHOLD = 5;
const DEFAULT_CIRCUIT_BREAKER_TIMEOUT_MS = 60000;

/**
 * Provides configurable error recovery using one of four strategies:
 * simple logging, circuit breaker, exponential backoff, or silent.
 *
 * The circuit breaker opens after
 * {@link IErrorHandlingPluginOptions.failureThreshold | failureThreshold}
 * consecutive failures and automatically resets after
 * {@link IErrorHandlingPluginOptions.circuitBreakerTimeout | circuitBreakerTimeout} ms.
 * An optional custom error handler can be injected for application-specific
 * recovery logic.
 *
 * @extends AbstractPlugin
 * @see IErrorHandlingPluginOptions - configuration options
 * @see IErrorHandlingContextData - error context contract
 *
 * @example
 * ```ts
 * const plugin = new ErrorHandlingPlugin({
 *   strategy: 'circuit-breaker',
 *   failureThreshold: 5,
 *   circuitBreakerTimeout: 60000,
 * });
 * const result = await plugin.executeWithRetry(() => fetchData());
 * ```
 */
export class ErrorHandlingPlugin extends AbstractPlugin<
  IErrorHandlingPluginOptions,
  IErrorHandlingPluginStats
> {
  name = 'ErrorHandlingPlugin';
  version = '1.0.0';

  private pluginOptions: Required<Omit<IErrorHandlingPluginOptions, 'customErrorHandler'>> & {
    customErrorHandler?: (error: Error, context: IErrorHandlingContextData) => Promise<void>;
  };
  private logger: ILogger;
  private failureCount = 0;
  private circuitBreakerOpen = false;
  private lastFailureTime = 0;

  constructor(options: IErrorHandlingPluginOptions) {
    super();
    this.logger = createLogger('ErrorHandlingPlugin');

    // Validate options
    validateErrorHandlingOptions(options);

    // Set defaults
    this.pluginOptions = {
      enabled: options.enabled ?? true,
      strategy: options.strategy,
      maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
      retryDelay: options.retryDelay ?? DEFAULT_RETRY_DELAY_MS,
      logErrors: options.logErrors ?? true,
      failureThreshold: options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD,
      circuitBreakerTimeout: options.circuitBreakerTimeout ?? DEFAULT_CIRCUIT_BREAKER_TIMEOUT_MS,
      // Add plugin options defaults
      category: options.category ?? PluginCategory.ERROR_HANDLING,
      priority: options.priority ?? PluginPriority.HIGH,
      moduleEvents: options.moduleEvents ?? [],
      subscribeToAllModuleEvents: options.subscribeToAllModuleEvents ?? false,
      ...(options.customErrorHandler && { customErrorHandler: options.customErrorHandler }),
    };

    this.logger.info('ErrorHandlingPlugin initialized', {
      strategy: this.pluginOptions.strategy,
      maxRetries: this.pluginOptions.maxRetries,
      failureThreshold: this.pluginOptions.failureThreshold,
    });
  }

  /**
   * Dispatches the error to the active strategy handler. If a custom error
   * handler is configured, it takes precedence over strategy-specific handling.
   */
  async handleError(error: Error, context: IErrorHandlingContextData = {}): Promise<void> {
    if (this.pluginOptions.logErrors) {
      this.logger.error('Error occurred', {
        error: error.message,
        stack: error.stack,
        context: context,
      });
    }

    // Custom error handler takes precedence
    if (this.pluginOptions.customErrorHandler) {
      try {
        await this.pluginOptions.customErrorHandler(error, context);
        return;
      } catch (handlerError) {
        this.logger.error('Custom error handler failed', {
          handlerError: handlerError instanceof Error ? handlerError.message : String(handlerError),
        });
      }
    }

    // Apply strategy-specific handling
    switch (this.pluginOptions.strategy) {
      case 'circuit-breaker':
        await this.handleCircuitBreaker(error, context);
        break;
      case 'exponential-backoff':
        await this.handleExponentialBackoff(error, context);
        break;
      case 'simple':
        await this.handleSimple(error, context);
        break;
      case 'silent':
        // Silent mode - do nothing
        break;
    }
  }

  /**
   * Executes a function with automatic retries up to
   * {@link IErrorHandlingPluginOptions.maxRetries | maxRetries}. The delay
   * between retries follows the configured strategy (fixed for simple /
   * circuit-breaker, doubling for exponential-backoff).
   *
   * @throws PluginError after all retry attempts are exhausted
   */
  async executeWithRetry<T>(
    fn: () => Promise<T>,
    context: IErrorHandlingContextData = {},
  ): Promise<T> {
    let lastError: Error | undefined;
    let attempt = 0;

    while (attempt <= this.pluginOptions.maxRetries) {
      try {
        // Check circuit breaker
        if (this.pluginOptions.strategy === 'circuit-breaker') {
          const cbState = isCircuitBreakerStillOpen(
            this.circuitBreakerOpen,
            this.lastFailureTime,
            this.pluginOptions.circuitBreakerTimeout,
          );
          if (cbState.shouldReset) {
            this.circuitBreakerOpen = false;
            this.failureCount = 0;
            this.logger.info('Circuit breaker timeout passed, attempting to close');
          }
          if (cbState.open) {
            throw new PluginError('Circuit breaker is open', this.name, toErrorContext(context));
          }
        }

        const result = await fn();

        // Reset failure count on success
        if (attempt > 0) {
          this.failureCount = 0;
          this.circuitBreakerOpen = false;
          this.logger.info('Operation succeeded after retry', {
            attempt: attempt,
            context: context,
          });
        }

        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        attempt++;

        if (attempt <= this.pluginOptions.maxRetries) {
          await this.handleError(lastError, { ...context, attempt });

          // Calculate delay
          const delay = resolveRetryDelay(
            this.pluginOptions.strategy,
            this.pluginOptions.retryDelay,
            attempt,
          );

          this.logger.debug('Retrying operation', {
            attempt: attempt,
            delay: delay,
            context: context,
          });
          await sleep(delay);
        } else {
          await this.handleError(lastError, { ...context, finalAttempt: true });
        }
      }
    }

    throw new PluginError(
      `Operation failed after ${this.pluginOptions.maxRetries} retries`,
      this.name,
      createPluginErrorContext(context, {
        originalError: lastError?.message || 'Unknown error',
      }),
    );
  }

  /**
   * Resets the circuit breaker to closed state, clearing failure count and
   * last failure timestamp.
   */
  resetCircuitBreaker(): void {
    this.failureCount = 0;
    this.circuitBreakerOpen = false;
    this.lastFailureTime = 0;
    this.logger.info('Circuit breaker reset');
  }

  /**
   * Get error handling statistics
   */
  override getStats(): IErrorHandlingPluginStats {
    const base = super.getStats();
    return {
      ...base,
      failureCount: this.failureCount,
      circuitBreakerOpen: this.circuitBreakerOpen,
      lastFailureTime: this.lastFailureTime,
      totalRetries: 0, // TODO: Track total retries
      successfulRecoveries: 0, // TODO: Track successful recoveries
    };
  }

  /**
   * Cleanup resources
   */
  async destroy(): Promise<void> {
    this.logger.info('ErrorHandlingPlugin destroyed');
  }

  private async handleSimple(error: Error, context: IErrorHandlingContextData): Promise<void> {
    // Simple logging - no additional logic
    this.logger.debug('Simple error handling applied', {
      error: error.message,
      context: context,
    });
  }

  private async handleCircuitBreaker(
    _error: Error,
    context: IErrorHandlingContextData,
  ): Promise<void> {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.pluginOptions.failureThreshold) {
      this.circuitBreakerOpen = true;
      this.logger.warn('Circuit breaker opened', {
        failureCount: this.failureCount,
        threshold: this.pluginOptions.failureThreshold,
        context: context,
      });
    }
  }

  private async handleExponentialBackoff(
    _error: Error,
    context: IErrorHandlingContextData,
  ): Promise<void> {
    this.failureCount++;
    this.logger.debug('Exponential backoff error handling applied', {
      error: _error.message,
      failureCount: this.failureCount,
      context: context,
    });
  }
}
