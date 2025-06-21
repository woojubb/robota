/**
 * Base error class for all Robota errors
 */
export abstract class RobotaError extends Error {
    abstract readonly code: string;
    abstract readonly category: 'user' | 'system' | 'provider';
    abstract readonly recoverable: boolean;

    constructor(
        message: string,
        public readonly context?: Record<string, any>
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

    constructor(message: string, context?: Record<string, any>) {
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

    constructor(message: string, public readonly field?: string, context?: Record<string, any>) {
        super(`Validation Error: ${message}`, context);
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
        context?: Record<string, any>
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
        context?: Record<string, any>
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
        context?: Record<string, any>
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
        context?: Record<string, any>
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
        context?: Record<string, any>
    ) {
        super(`Tool Execution Error (${toolName}): ${message}`, context);
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
        context?: Record<string, any>
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

    constructor(message: string = 'Circuit breaker is open', context?: Record<string, any>) {
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
        context?: Record<string, any>
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

    constructor(
        message: string,
        context?: Record<string, any>
    ) {
        super(`Storage Error: ${message}`, context);
    }
}

/**
 * Error utility functions
 */
export class ErrorUtils {
    /**
     * Check if error is recoverable
     */
    static isRecoverable(error: Error): boolean {
        if (error instanceof RobotaError) {
            return error.recoverable;
        }
        return false;
    }

    /**
     * Extract error code from any error
     */
    static getErrorCode(error: Error): string {
        if (error instanceof RobotaError) {
            return error.code;
        }
        return 'UNKNOWN_ERROR';
    }

    /**
 * Create error from unknown value
 */
    static fromUnknown(error: unknown, defaultMessage = 'An unknown error occurred'): RobotaError {
        if (error instanceof RobotaError) {
            return error;
        }

        if (error instanceof Error) {
            return new ConfigurationError(error.message || defaultMessage);
        }

        const message = typeof error === 'string' ? error : defaultMessage;
        return new ConfigurationError(message);
    }

    /**
     * Wrap external errors
     */
    static wrapProviderError(
        error: unknown,
        provider: string,
        operation: string
    ): ProviderError {
        const originalError = error instanceof Error ? error : new Error(String(error));
        return new ProviderError(
            `Failed to ${operation}`,
            provider,
            originalError,
            { operation }
        );
    }
} 