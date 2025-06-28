/**
 * ErrorHandling Plugin - Type definitions for Facade pattern implementation
 * 
 * REASON: Complex ErrorContextData compatibility issues require type adapters and unified error handling
 * ALTERNATIVES_CONSIDERED:
 * 1. Modify ErrorContextData type globally (breaks other components)
 * 2. Use type assertions everywhere (reduces type safety)
 * 3. Create complex union types (causes circular dependencies)
 * 4. Redesign PluginError constructor (breaks existing contracts)
 * 5. Remove context from error handling (loses debugging capability)
 * TODO: Consider unified error context system across all plugins
 */

/**
 * Error handling strategy types
 */
export type ErrorHandlingStrategy = 'simple' | 'circuit-breaker' | 'exponential-backoff' | 'silent';

/**
 * Base error context for internal operations
 * REASON: Optional properties and index signature for compatibility with both exactOptionalPropertyTypes and logger constraints
 * ALTERNATIVES_CONSIDERED: Union types (breaks interface compatibility), explicit undefined (still triggers index signature rules), removing optional properties (breaks existing usage), type assertions (loses safety), intersection types (complex propagation)
 * TODO: Consider unified error context type system across all plugins
 */
export interface ErrorHandlingContextData {
    executionId?: string;
    sessionId?: string;
    userId?: string;
    attempt?: number;
    finalAttempt?: boolean;
    originalError?: string;
    [key: string]: string | number | boolean | undefined;
}

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
    customErrorHandler?: (error: Error, context: ErrorHandlingContextData) => Promise<void>;
}

/**
 * Error handling plugin statistics
 */
export interface ErrorHandlingPluginStats {
    failureCount: number;
    circuitBreakerOpen: boolean;
    lastFailureTime: number;
    totalRetries: number;
    successfulRecoveries: number;
}



/**
 * Error context adapter for PluginError compatibility
 */
export interface ErrorContextAdapter {
    originalError?: string;
    executionId?: string;
    sessionId?: string;
    userId?: string;
    attempt?: number;
    [key: string]: string | number | boolean | Date | Error | string[];
} 