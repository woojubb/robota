import type {
    ExecutorInterface,
    ChatExecutionRequest,
    StreamExecutionRequest
} from '../interfaces/executor';
import type { UniversalMessage, AssistantMessage } from '../managers/conversation-history-manager';
import { logger } from '../utils/logger';

/**
 * Base executor class providing common functionality
 * 
 * This abstract class implements common patterns and utilities that can be
 * shared across different executor implementations (Local, Remote, Cache, etc.)
 * 
 * @example
 * ```typescript
 * export class MyCustomExecutor extends BaseExecutor {
 *   async executeChat(request: ChatExecutionRequest): Promise<AssistantMessage> {
 *     // Custom implementation
 *     return this.withRetry(() => this.performChat(request));
 *   }
 * }
 * ```
 */
export abstract class BaseExecutor implements ExecutorInterface {
    abstract readonly name: string;
    abstract readonly version: string;

    /**
     * Execute a chat completion request
     * Must be implemented by concrete executor classes
     */
    abstract executeChat(request: ChatExecutionRequest): Promise<AssistantMessage>;

    /**
     * Execute a streaming chat completion request
     * Optional - can be implemented by concrete executor classes
     */
    abstract executeChatStream?(request: StreamExecutionRequest): AsyncIterable<UniversalMessage>;

    /**
     * Check if the executor supports tool calling
     * Default implementation returns false, can be overridden
     */
    supportsTools(): boolean {
        return false;
    }

    /**
     * Validate executor configuration
     * Default implementation returns true, can be overridden
     */
    validateConfig(): boolean {
        return true;
    }

    /**
     * Clean up resources when executor is no longer needed
     * Default implementation does nothing, can be overridden
     */
    async dispose?(): Promise<void> {
        // Default: no cleanup needed
    }

    /**
     * Execute function with retry logic
     * 
     * @param fn - Function to execute with retries
     * @param maxRetries - Maximum number of retry attempts (default: 3)
     * @param retryDelay - Delay between retries in milliseconds (default: 1000)
     * @returns Promise resolving to function result
     */
    protected async withRetry<T>(
        fn: () => Promise<T>,
        maxRetries: number = 3,
        retryDelay: number = 1000
    ): Promise<T> {
        let lastError: Error;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return await fn();
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));

                if (attempt < maxRetries) {
                    logger.warn(`[${this.name}] Attempt ${attempt + 1} failed, retrying in ${retryDelay}ms`, {
                        error: lastError.message,
                        attempt: attempt + 1,
                        maxRetries
                    });
                    await this.delay(retryDelay);
                }
            }
        }

        throw lastError!;
    }

    /**
     * Execute function with timeout
     * 
     * @param promise - Promise to execute with timeout
     * @param timeoutMs - Timeout in milliseconds
     * @returns Promise resolving to function result
     */
    protected async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => {
                reject(new Error(`Operation timed out after ${timeoutMs}ms`));
            }, timeoutMs);
        });

        return Promise.race([promise, timeoutPromise]);
    }

    /**
     * Delay execution for specified milliseconds
     * 
     * @param ms - Milliseconds to delay
     * @returns Promise that resolves after the delay
     */
    protected delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Log debug information (only if logging is enabled)
     * 
     * @param message - Log message
     * @param data - Optional data to log
     */
    protected logDebug(message: string, data?: any): void {
        logger.debug(`[${this.name}] ${message}`, data);
    }

    /**
     * Log error information
     * 
     * @param message - Log message
     * @param error - Error object
     * @param data - Optional additional data
     */
    protected logError(message: string, error: Error, data?: any): void {
        logger.error(`[${this.name}] ${message}`, {
            error: error.message,
            stack: error.stack,
            ...data
        });
    }

    /**
     * Validate that request has required fields
     * 
     * @param request - Chat execution request to validate
     * @throws Error if validation fails
     */
    protected validateRequest(request: ChatExecutionRequest): void {
        if (!request.messages || request.messages.length === 0) {
            throw new Error('Request must include at least one message');
        }

        if (!request.provider) {
            throw new Error('Request must specify a provider');
        }

        if (!request.model) {
            throw new Error('Request must specify a model');
        }
    }

    /**
     * Validate that response is properly formatted
     * 
     * @param response - Response to validate
     * @throws Error if validation fails
     */
    protected validateResponse(response: UniversalMessage): void {
        if (!response.role) {
            throw new Error('Response must have a role');
        }

        if (!response.content) {
            throw new Error('Response must have content');
        }
    }
} 