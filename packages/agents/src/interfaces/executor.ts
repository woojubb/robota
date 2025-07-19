import type { ChatOptions, ToolSchema } from './index';
import type { UniversalMessage, AssistantMessage } from '../managers/conversation-history-manager';

/**
 * Request for executing a chat completion through an executor
 */
export interface ChatExecutionRequest {
    /** Array of messages in the conversation */
    messages: UniversalMessage[];
    /** Chat options including model, temperature, etc. */
    options?: ChatOptions;
    /** Available tools for the AI to use */
    tools?: ToolSchema[];
    /** Target AI provider (e.g., 'openai', 'anthropic', 'google') */
    provider: string;
    /** Specific model to use */
    model: string;
}

/**
 * Request for executing a streaming chat completion through an executor
 */
export interface StreamExecutionRequest extends ChatExecutionRequest {
    /** Indicates this is a streaming request */
    stream: true;
}

/**
 * Interface for executing AI provider operations
 * 
 * Executors abstract the execution mechanism, allowing providers to work
 * with either local API calls or remote server calls transparently.
 * 
 * Implementation patterns:
 * - LocalExecutor: Direct API calls using provider SDKs
 * - RemoteExecutor: HTTP/WebSocket calls to remote server
 * - CacheExecutor: Cached responses with fallback to another executor
 * - HybridExecutor: Conditional local/remote execution
 */
export interface ExecutorInterface {
    /**
     * Execute a chat completion request
     * 
     * @param request - Chat execution request with messages, options, and tools
     * @returns Promise resolving to assistant message response
     * 
     * @example
     * ```typescript
     * const response = await executor.executeChat({
     *   messages: [{ role: 'user', content: 'Hello!' }],
     *   options: { model: 'gpt-4', temperature: 0.7 },
     *   provider: 'openai',
     *   model: 'gpt-4'
     * });
     * ```
     */
    executeChat(request: ChatExecutionRequest): Promise<AssistantMessage>;

    /**
     * Execute a streaming chat completion request
     * 
     * @param request - Streaming chat execution request
     * @returns AsyncIterable of message chunks
     * 
     * @example
     * ```typescript
     * for await (const chunk of executor.executeChatStream({
     *   messages: [{ role: 'user', content: 'Tell me a story' }],
     *   options: { model: 'gpt-4' },
     *   provider: 'openai',
     *   model: 'gpt-4',
     *   stream: true
     * })) {
     *   console.log(chunk.content);
     * }
     * ```
     */
    executeChatStream?(request: StreamExecutionRequest): AsyncIterable<UniversalMessage>;

    /**
     * Check if the executor supports tool calling
     * @returns true if tool calling is supported
     */
    supportsTools(): boolean;

    /**
     * Validate executor configuration
     * @returns true if configuration is valid
     */
    validateConfig(): boolean;

    /**
     * Clean up resources when executor is no longer needed
     */
    dispose?(): Promise<void>;

    /**
     * Get executor name/identifier
     */
    readonly name: string;

    /**
     * Get executor version
     */
    readonly version: string;
}

/**
 * Configuration options for local executor
 */
export interface LocalExecutorConfig {
    /** Timeout for API requests in milliseconds */
    timeout?: number;
    /** Maximum number of retry attempts */
    maxRetries?: number;
    /** Base delay between retries in milliseconds */
    retryDelay?: number;
    /** Whether to enable request/response logging */
    enableLogging?: boolean;
}

/**
 * Configuration options for remote executor
 */
export interface RemoteExecutorConfig {
    /** Remote server URL */
    serverUrl: string;
    /** User authentication token */
    userApiKey: string;
    /** Timeout for HTTP requests in milliseconds */
    timeout?: number;
    /** Maximum number of retry attempts */
    maxRetries?: number;
    /** Whether to enable WebSocket for streaming */
    enableWebSocket?: boolean;
    /** Custom headers to include in requests */
    headers?: Record<string, string>;
} 