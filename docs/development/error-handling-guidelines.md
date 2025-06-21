# Error Handling Guidelines

This document defines comprehensive error handling strategies for the Robota project.

## Error Categories

### User Errors
- **Configuration Errors**: Invalid configuration parameters
- **Input Validation Errors**: Invalid user input
- **Authentication Errors**: API key issues, authorization failures
- **Usage Errors**: Incorrect API usage patterns

### System Errors
- **Network Errors**: API timeouts, connection failures
- **Resource Errors**: Memory limitations, file system issues
- **Provider Errors**: AI provider-specific failures
- **Internal Errors**: Unexpected system states

### Recoverable vs Non-Recoverable

#### Recoverable Errors
- Network timeouts → Retry with backoff
- Rate limiting → Wait and retry
- Temporary provider issues → Fallback to alternative
- Validation errors → Provide correction guidance

#### Non-Recoverable Errors
- Authentication failures → Require user action
- Malformed configuration → Require configuration fix
- Missing dependencies → Require installation
- Critical system errors → Require restart

## Error Design Patterns

### Typed Error Classes

```typescript
// Base error class
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
    }
}

// Specific error implementations
export class ConfigurationError extends RobotaError {
    readonly code = 'CONFIGURATION_ERROR';
    readonly category = 'user';
    readonly recoverable = false;
}

export class ProviderError extends RobotaError {
    readonly code = 'PROVIDER_ERROR';
    readonly category = 'provider';
    readonly recoverable = true;
    
    constructor(
        message: string,
        public readonly provider: string,
        public readonly originalError?: Error,
        context?: Record<string, any>
    ) {
        super(message, context);
    }
}
```

### Result Pattern for Operations

```typescript
// Result type for operations that can fail
type Result<T, E = RobotaError> = 
    | { success: true; data: T }
    | { success: false; error: E };

// Usage example
async function executeOperation(): Promise<Result<string>> {
    try {
        const result = await riskyOperation();
        return { success: true, data: result };
    } catch (error) {
        return { 
            success: false, 
            error: new OperationError('Operation failed', { originalError: error })
        };
    }
}
```

## Error Handling Strategies

### Retry Logic

```typescript
interface RetryConfig {
    maxAttempts: number;
    baseDelay: number;
    maxDelay: number;
    backoffMultiplier: number;
    retryableErrors: string[];
}

class RetryHandler {
    async executeWithRetry<T>(
        operation: () => Promise<T>,
        config: RetryConfig
    ): Promise<T> {
        let lastError: Error;
        
        for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error;
                
                if (!this.isRetryable(error, config.retryableErrors)) {
                    throw error;
                }
                
                if (attempt === config.maxAttempts) {
                    break;
                }
                
                const delay = Math.min(
                    config.baseDelay * Math.pow(config.backoffMultiplier, attempt - 1),
                    config.maxDelay
                );
                
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        
        throw lastError;
    }
    
    private isRetryable(error: Error, retryableCodes: string[]): boolean {
        if (error instanceof RobotaError) {
            return error.recoverable && retryableCodes.includes(error.code);
        }
        return false;
    }
}
```

### Circuit Breaker Pattern

```typescript
class CircuitBreaker {
    private failures = 0;
    private lastFailureTime = 0;
    private state: 'closed' | 'open' | 'half-open' = 'closed';
    
    constructor(
        private threshold: number,
        private timeout: number
    ) {}
    
    async execute<T>(operation: () => Promise<T>): Promise<T> {
        if (this.state === 'open') {
            if (Date.now() - this.lastFailureTime < this.timeout) {
                throw new CircuitBreakerOpenError('Circuit breaker is open');
            }
            this.state = 'half-open';
        }
        
        try {
            const result = await operation();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }
    
    private onSuccess(): void {
        this.failures = 0;
        this.state = 'closed';
    }
    
    private onFailure(): void {
        this.failures++;
        this.lastFailureTime = Date.now();
        
        if (this.failures >= this.threshold) {
            this.state = 'open';
        }
    }
}
```

## Error Reporting and Logging

### Structured Error Logging

```typescript
interface ErrorLogEntry {
    timestamp: string;
    level: 'error' | 'warn';
    message: string;
    errorCode?: string;
    category?: string;
    context?: Record<string, any>;
    stack?: string;
    userId?: string;
    sessionId?: string;
}

class ErrorLogger {
    logError(error: Error, context?: Record<string, any>): void {
        const entry: ErrorLogEntry = {
            timestamp: new Date().toISOString(),
            level: 'error',
            message: error.message,
            stack: error.stack,
            context
        };
        
        if (error instanceof RobotaError) {
            entry.errorCode = error.code;
            entry.category = error.category;
            entry.context = { ...entry.context, ...error.context };
        }
        
        // Log to appropriate destination
        this.writeLog(entry);
    }
}
```

### Error Metrics and Monitoring

```typescript
interface ErrorMetrics {
    errorCount: Map<string, number>;
    errorRate: number;
    lastErrorTime: Date;
    topErrors: Array<{ code: string; count: number }>;
}

class ErrorMonitor {
    private metrics: ErrorMetrics = {
        errorCount: new Map(),
        errorRate: 0,
        lastErrorTime: new Date(),
        topErrors: []
    };
    
    recordError(error: RobotaError): void {
        const count = this.metrics.errorCount.get(error.code) || 0;
        this.metrics.errorCount.set(error.code, count + 1);
        this.metrics.lastErrorTime = new Date();
        
        this.updateMetrics();
    }
    
    getMetrics(): ErrorMetrics {
        return { ...this.metrics };
    }
}
```

## Error Recovery Strategies

### Graceful Degradation

```typescript
class AgentWithFallback {
    async run(input: string): Promise<string> {
        try {
            return await this.primaryProvider.chat(input);
        } catch (error) {
            if (error instanceof ProviderError) {
                logger.warn('Primary provider failed, trying fallback', { error });
                try {
                    return await this.fallbackProvider.chat(input);
                } catch (fallbackError) {
                    logger.error('Both providers failed', { error, fallbackError });
                    return this.generateFallbackResponse(input);
                }
            }
            throw error;
        }
    }
    
    private generateFallbackResponse(input: string): string {
        return "I'm experiencing technical difficulties. Please try again later.";
    }
}
```

### State Recovery

```typescript
interface RecoveryCheckpoint {
    conversationHistory: Message[];
    providerState: Record<string, any>;
    timestamp: Date;
}

class StateRecoveryManager {
    private checkpoints: Map<string, RecoveryCheckpoint> = new Map();
    
    createCheckpoint(sessionId: string, state: RecoveryCheckpoint): void {
        this.checkpoints.set(sessionId, state);
    }
    
    recoverState(sessionId: string): RecoveryCheckpoint | undefined {
        return this.checkpoints.get(sessionId);
    }
    
    async handleRecovery(sessionId: string, error: Error): Promise<void> {
        const checkpoint = this.recoverState(sessionId);
        if (checkpoint) {
            logger.info('Recovering from checkpoint', { sessionId, checkpointAge: Date.now() - checkpoint.timestamp.getTime() });
            // Restore state logic here
        }
    }
}
```

## User-Facing Error Messages

### Error Message Guidelines

- **Be Specific**: Clearly explain what went wrong
- **Be Actionable**: Tell users what they can do to fix it
- **Be Helpful**: Provide links to documentation or support
- **Be Professional**: Maintain a helpful, non-technical tone

### Message Templates

```typescript
const ERROR_MESSAGES = {
    INVALID_API_KEY: {
        user: "Your API key appears to be invalid. Please check your configuration and ensure you're using a valid API key.",
        developer: "Authentication failed with provider {provider}. Verify API key format and permissions.",
        action: "Visit {provider} dashboard to generate a new API key"
    },
    
    RATE_LIMIT_EXCEEDED: {
        user: "You've reached the rate limit for this service. Please wait a moment before trying again.",
        developer: "Rate limit exceeded for provider {provider}. Current limit: {limit} requests per {period}.",
        action: "Wait {retryAfter} seconds before retrying, or upgrade your plan for higher limits"
    },
    
    MODEL_NOT_AVAILABLE: {
        user: "The requested AI model is not available. Please try a different model.",
        developer: "Model {model} not supported by provider {provider}. Available models: {availableModels}",
        action: "Choose from available models: {modelList}"
    }
};
```

### Context-Aware Error Formatting

```typescript
class ErrorFormatter {
    formatError(error: RobotaError, userLevel: 'user' | 'developer' = 'user'): string {
        const template = ERROR_MESSAGES[error.code];
        if (!template) {
            return error.message;
        }
        
        const message = template[userLevel] || template.user;
        return this.interpolateTemplate(message, error.context || {});
    }
    
    private interpolateTemplate(template: string, context: Record<string, any>): string {
        return template.replace(/\{(\w+)\}/g, (match, key) => {
            return context[key]?.toString() || match;
        });
    }
}
``` 