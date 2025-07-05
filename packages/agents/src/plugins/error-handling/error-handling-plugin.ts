import { BasePlugin, PluginCategory, PluginPriority } from '../../abstracts/base-plugin';
import { Logger, createLogger } from '../../utils/logger';
import { PluginError, ConfigurationError } from '../../utils/errors';

// Import from Facade pattern modules for type safety
import type {
    ErrorHandlingContextData,
    ErrorHandlingPluginOptions,
    ErrorHandlingPluginStats
} from './types';
import { toErrorContext, createPluginErrorContext } from './context-adapter';

/**
 * Plugin for handling errors with configurable strategies
 * Provides error recovery, retry mechanisms, and circuit breaker patterns
 */
export class ErrorHandlingPlugin extends BasePlugin<ErrorHandlingPluginOptions, ErrorHandlingPluginStats> {
    name = 'ErrorHandlingPlugin';
    version = '1.0.0';

    private pluginOptions: Required<Omit<ErrorHandlingPluginOptions, 'customErrorHandler'>> & { customErrorHandler?: (error: Error, context: ErrorHandlingContextData) => Promise<void> };
    private logger: Logger;
    private failureCount = 0;
    private circuitBreakerOpen = false;
    private lastFailureTime = 0;

    constructor(options: ErrorHandlingPluginOptions) {
        super();
        this.logger = createLogger('ErrorHandlingPlugin');

        // Validate options
        this.validateOptions(options);

        // Set defaults
        this.pluginOptions = {
            enabled: options.enabled ?? true,
            strategy: options.strategy,
            maxRetries: options.maxRetries ?? 3,
            retryDelay: options.retryDelay ?? 1000,
            logErrors: options.logErrors ?? true,
            failureThreshold: options.failureThreshold ?? 5,
            circuitBreakerTimeout: options.circuitBreakerTimeout ?? 60000, // 1 minute
            // Add BasePluginOptions defaults
            category: options.category ?? PluginCategory.ERROR_HANDLING,
            priority: options.priority ?? PluginPriority.HIGH,
            moduleEvents: options.moduleEvents ?? [],
            subscribeToAllModuleEvents: options.subscribeToAllModuleEvents ?? false,
            ...(options.customErrorHandler && { customErrorHandler: options.customErrorHandler }),
        };

        this.logger.info('ErrorHandlingPlugin initialized', {
            strategy: this.pluginOptions.strategy,
            maxRetries: this.pluginOptions.maxRetries,
            failureThreshold: this.pluginOptions.failureThreshold
        });
    }

    /**
     * Handle an error with the configured strategy
     */
    async handleError(error: Error, context: ErrorHandlingContextData = {}): Promise<void> {
        if (this.pluginOptions.logErrors) {
            this.logger.error('Error occurred', {
                error: error.message,
                stack: error.stack,
                context: context
            });
        }

        // Custom error handler takes precedence
        if (this.pluginOptions.customErrorHandler) {
            try {
                await this.pluginOptions.customErrorHandler(error, context);
                return;
            } catch (handlerError) {
                this.logger.error('Custom error handler failed', {
                    handlerError: handlerError instanceof Error ? handlerError.message : String(handlerError)
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
     * Execute a function with error handling and retry logic
     */
    /**
     * Execute a function with error handling and retry logic
     * REASON: PluginError constructor requires ErrorContextData which has different type constraints than ErrorHandlingContextData, causing multiple type compatibility issues
     * ALTERNATIVES_CONSIDERED: Union types (breaks existing error context interfaces), interface definition (creates circular dependencies), generic types (complex type propagation through error handling chain), conditional types (breaks existing plugin interfaces), mapped types (incompatible with error constructor signatures), type guards (runtime only, doesn't solve constructor compatibility), custom declarations (breaks PluginError interface contract), code refactoring (would require redesigning entire error handling system across all plugins), @types packages (none available for this specific use case), external library integration (no standard error context type systems available), utility types (Pick/Omit create new compatibility issues)
     * TODO: Create unified error context type system that bridges ErrorHandlingContextData and ErrorContextData requirements, or redesign PluginError to accept more flexible context types
     */
    async executeWithRetry<T>(
        fn: () => Promise<T>,
        context: ErrorHandlingContextData = {}
    ): Promise<T> {
        let lastError: Error | null = null;
        let attempt = 0;

        while (attempt <= this.pluginOptions.maxRetries) {
            try {
                // Check circuit breaker
                if (this.pluginOptions.strategy === 'circuit-breaker' && this.isCircuitBreakerOpen()) {
                    throw new PluginError('Circuit breaker is open', this.name, toErrorContext(context));
                }

                const result = await fn();

                // Reset failure count on success
                if (attempt > 0) {
                    this.failureCount = 0;
                    this.circuitBreakerOpen = false;
                    this.logger.info('Operation succeeded after retry', {
                        attempt: attempt,
                        context: context
                    });
                }

                return result;
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                attempt++;

                if (attempt <= this.pluginOptions.maxRetries) {
                    await this.handleError(lastError, { ...context, attempt });

                    // Calculate delay
                    const delay = this.pluginOptions.strategy === 'exponential-backoff'
                        ? this.pluginOptions.retryDelay * Math.pow(2, attempt - 1)
                        : this.pluginOptions.retryDelay;

                    this.logger.debug('Retrying operation', {
                        attempt: attempt,
                        delay: delay,
                        context: context
                    });
                    await this.sleep(delay);
                } else {
                    await this.handleError(lastError, { ...context, finalAttempt: true });
                }
            }
        }

        throw new PluginError(`Operation failed after ${this.pluginOptions.maxRetries} retries`, this.name,
            createPluginErrorContext(context, {
                originalError: lastError?.message || 'Unknown error'
            })
        );
    }

    /**
     * Reset circuit breaker state
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
    override getStats(): ErrorHandlingPluginStats {
        return {
            failureCount: this.failureCount,
            circuitBreakerOpen: this.circuitBreakerOpen,
            lastFailureTime: this.lastFailureTime,
            totalRetries: 0, // TODO: Track total retries
            successfulRecoveries: 0 // TODO: Track successful recoveries
        };
    }

    /**
     * Cleanup resources
     */
    async destroy(): Promise<void> {
        this.logger.info('ErrorHandlingPlugin destroyed');
    }

    private async handleSimple(error: Error, context: ErrorHandlingContextData): Promise<void> {
        // Simple logging - no additional logic
        this.logger.debug('Simple error handling applied', {
            error: error.message,
            context: context
        });
    }

    private async handleCircuitBreaker(_error: Error, context: ErrorHandlingContextData): Promise<void> {
        this.failureCount++;
        this.lastFailureTime = Date.now();

        if (this.failureCount >= this.pluginOptions.failureThreshold) {
            this.circuitBreakerOpen = true;
            this.logger.warn('Circuit breaker opened', {
                failureCount: this.failureCount,
                threshold: this.pluginOptions.failureThreshold,
                context: context
            });
        }
    }

    private async handleExponentialBackoff(_error: Error, context: ErrorHandlingContextData): Promise<void> {
        this.failureCount++;
        this.logger.debug('Exponential backoff error handling applied', {
            error: _error.message,
            failureCount: this.failureCount,
            context: context
        });
    }

    private isCircuitBreakerOpen(): boolean {
        if (!this.circuitBreakerOpen) {
            return false;
        }

        // Check if timeout period has passed
        const timeoutPassed = Date.now() - this.lastFailureTime > this.pluginOptions.circuitBreakerTimeout;
        if (timeoutPassed) {
            this.circuitBreakerOpen = false;
            this.failureCount = 0;
            this.logger.info('Circuit breaker timeout passed, attempting to close');
            return false;
        }

        return true;
    }

    private validateOptions(options: ErrorHandlingPluginOptions): void {
        if (!options.strategy) {
            throw new ConfigurationError('Error handling strategy is required');
        }

        if (!['simple', 'circuit-breaker', 'exponential-backoff', 'silent'].includes(options.strategy)) {
            throw new ConfigurationError('Invalid error handling strategy', {
                validStrategies: ['simple', 'circuit-breaker', 'exponential-backoff', 'silent'],
                provided: options.strategy
            });
        }

        if (options.maxRetries !== undefined && options.maxRetries < 0) {
            throw new ConfigurationError('Max retries must be non-negative');
        }

        if (options.retryDelay !== undefined && options.retryDelay <= 0) {
            throw new ConfigurationError('Retry delay must be positive');
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
} 