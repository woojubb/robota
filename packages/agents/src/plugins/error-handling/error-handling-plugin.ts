import { BasePlugin } from '../../abstracts/base-plugin';
import { Logger } from '../../utils/logger';
import { PluginError, ConfigurationError } from '../../utils/errors';

/**
 * Error handling strategy types
 */
export type ErrorHandlingStrategy = 'simple' | 'circuit-breaker' | 'exponential-backoff' | 'silent';

/**
 * Configuration options for error handling plugin
 */
export interface ErrorHandlingPluginOptions {
    /** Error handling strategy to use */
    strategy: ErrorHandlingStrategy;
    /** Maximum number of retry attempts */
    maxRetries?: number;
    /** Initial delay between retries in milliseconds */
    retryDelay?: number;
    /** Whether to log errors */
    logErrors?: boolean;
    /** Circuit breaker failure threshold */
    failureThreshold?: number;
    /** Circuit breaker timeout in milliseconds */
    circuitBreakerTimeout?: number;
    /** Custom error handler function */
    customErrorHandler?: (error: Error, context: Record<string, any>) => Promise<void>;
}

/**
 * Plugin for handling errors with configurable strategies
 * Provides error recovery, retry mechanisms, and circuit breaker patterns
 */
export class ErrorHandlingPlugin extends BasePlugin {
    name = 'ErrorHandlingPlugin';
    version = '1.0.0';

    private options: Required<Omit<ErrorHandlingPluginOptions, 'customErrorHandler'>> & { customErrorHandler?: (error: Error, context: Record<string, any>) => Promise<void> };
    private logger: Logger;
    private failureCount = 0;
    private circuitBreakerOpen = false;
    private lastFailureTime = 0;

    constructor(options: ErrorHandlingPluginOptions) {
        super();
        this.logger = new Logger('ErrorHandlingPlugin');

        // Validate options
        this.validateOptions(options);

        // Set defaults
        this.options = {
            strategy: options.strategy,
            maxRetries: options.maxRetries ?? 3,
            retryDelay: options.retryDelay ?? 1000,
            logErrors: options.logErrors ?? true,
            failureThreshold: options.failureThreshold ?? 5,
            circuitBreakerTimeout: options.circuitBreakerTimeout ?? 60000, // 1 minute
            ...(options.customErrorHandler && { customErrorHandler: options.customErrorHandler }),
        };

        this.logger.info('ErrorHandlingPlugin initialized', {
            strategy: this.options.strategy,
            maxRetries: this.options.maxRetries,
            failureThreshold: this.options.failureThreshold
        });
    }

    /**
     * Handle an error with the configured strategy
     */
    async handleError(error: Error, context: Record<string, any> = {}): Promise<void> {
        if (this.options.logErrors) {
            this.logger.error('Error occurred', {
                error: error.message,
                stack: error.stack,
                context
            });
        }

        // Custom error handler takes precedence
        if (this.options.customErrorHandler) {
            try {
                await this.options.customErrorHandler(error, context);
                return;
            } catch (handlerError) {
                this.logger.error('Custom error handler failed', { handlerError });
            }
        }

        // Apply strategy-specific handling
        switch (this.options.strategy) {
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
    async executeWithRetry<T>(
        fn: () => Promise<T>,
        context: Record<string, any> = {}
    ): Promise<T> {
        let lastError: Error | null = null;
        let attempt = 0;

        while (attempt <= this.options.maxRetries) {
            try {
                // Check circuit breaker
                if (this.options.strategy === 'circuit-breaker' && this.isCircuitBreakerOpen()) {
                    throw new PluginError('Circuit breaker is open', this.name, context);
                }

                const result = await fn();

                // Reset failure count on success
                if (attempt > 0) {
                    this.failureCount = 0;
                    this.circuitBreakerOpen = false;
                    this.logger.info('Operation succeeded after retry', { attempt, context });
                }

                return result;
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                attempt++;

                if (attempt <= this.options.maxRetries) {
                    await this.handleError(lastError, { ...context, attempt });

                    // Calculate delay
                    const delay = this.options.strategy === 'exponential-backoff'
                        ? this.options.retryDelay * Math.pow(2, attempt - 1)
                        : this.options.retryDelay;

                    this.logger.debug('Retrying operation', { attempt, delay, context });
                    await this.sleep(delay);
                } else {
                    await this.handleError(lastError, { ...context, finalAttempt: true });
                }
            }
        }

        throw new PluginError(`Operation failed after ${this.options.maxRetries} retries`, this.name, {
            originalError: lastError?.message,
            context
        });
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
     * Get current error handling stats
     */
    override getStats(): { failureCount: number; circuitBreakerOpen: boolean; lastFailureTime: number } {
        return {
            failureCount: this.failureCount,
            circuitBreakerOpen: this.circuitBreakerOpen,
            lastFailureTime: this.lastFailureTime
        };
    }

    /**
     * Cleanup resources
     */
    async destroy(): Promise<void> {
        this.logger.info('ErrorHandlingPlugin destroyed');
    }

    private async handleSimple(error: Error, context: Record<string, any>): Promise<void> {
        // Simple logging - no additional logic
        this.logger.debug('Simple error handling applied', { error: error.message, context });
    }

    private async handleCircuitBreaker(_error: Error, context: Record<string, any>): Promise<void> {
        this.failureCount++;
        this.lastFailureTime = Date.now();

        if (this.failureCount >= this.options.failureThreshold) {
            this.circuitBreakerOpen = true;
            this.logger.warn('Circuit breaker opened', {
                failureCount: this.failureCount,
                threshold: this.options.failureThreshold,
                context
            });
        }
    }

    private async handleExponentialBackoff(_error: Error, context: Record<string, any>): Promise<void> {
        this.failureCount++;
        this.logger.debug('Exponential backoff error handling applied', {
            error: _error.message,
            failureCount: this.failureCount,
            context
        });
    }

    private isCircuitBreakerOpen(): boolean {
        if (!this.circuitBreakerOpen) {
            return false;
        }

        // Check if timeout period has passed
        const timeoutPassed = Date.now() - this.lastFailureTime > this.options.circuitBreakerTimeout;
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