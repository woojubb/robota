import type { IChatOptions, IToolSchema } from './index';
import type { TUniversalMessage, IAssistantMessage } from './messages';
import type { IModelEffortOutcome } from './model-effort-capability';

/**
 * Request for executing a streaming chat completion through an executor
 */
export interface IChatExecutionRequest {
  /** Array of messages in the conversation */
  messages: TUniversalMessage[];
  /** Chat options including model, temperature, etc. */
  options?: IChatOptions;
  /** Available tools for the AI to use */
  tools?: IToolSchema[];
  /** Target AI provider (e.g., 'openai', 'anthropic', 'google') */
  provider: string;
  /** Specific model to use */
  model: string;
}

/**
 * Request for executing a streaming chat completion through an executor
 */
export interface IStreamExecutionRequest extends IChatExecutionRequest {
  /** Indicates this is a streaming request */
  stream: true;
}

/** Terminal result of a non-streaming executor call; outcome metadata is not part of the message. */
export interface IExecutorChatResult {
  message: IAssistantMessage;
  modelEffortOutcome?: IModelEffortOutcome;
}

/** A streamed message, kept separate from the one result-bearing terminal event. */
export interface IExecutorStreamMessageEvent {
  kind: 'message';
  message: TUniversalMessage;
}

/** Exactly one successful stream terminal is emitted after all message events. */
export interface IExecutorStreamTerminalEvent {
  kind: 'terminal';
  modelEffortOutcome?: IModelEffortOutcome;
}

export type TExecutorStreamEvent = IExecutorStreamMessageEvent | IExecutorStreamTerminalEvent;

/**
 * Interface for executing AI provider operations
 *
 * Executors abstract the execution mechanism, allowing providers to work
 * with either local API calls or remote server calls transparently.
 *
 * Implementation patterns:
 * - LocalExecutor: Direct API calls using provider SDKs
 * - RemoteExecutor: HTTP/WebSocket calls to remote server
 * - CacheExecutor: Cached responses with explicit error propagation
 * - HybridExecutor: Conditional local/remote execution
 */
export interface IExecutor {
  /**
   * Execute a chat completion request
   *
   * @param request - Chat execution request with messages, options, and tools
   * @returns Promise resolving to an assistant message plus one terminal outcome envelope
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
  executeChat(request: IChatExecutionRequest): Promise<IExecutorChatResult>;

  /**
   * Execute a streaming chat completion request
   *
   * @param request - Streaming chat execution request
   * @returns AsyncIterable of message events followed by exactly one terminal event
   *
   * @example
   * ```typescript
   * for await (const event of executor.executeChatStream({
   *   messages: [{ role: 'user', content: 'Tell me a story' }],
   *   options: { model: 'gpt-4' },
   *   provider: 'openai',
   *   model: 'gpt-4',
   *   stream: true
   * })) {
   *   if (event.kind === 'message') console.log(event.message.content);
   *   else console.log(event.modelEffortOutcome);
   * }
   * ```
   */
  executeChatStream?(request: IStreamExecutionRequest): AsyncIterable<TExecutorStreamEvent>;

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
export interface ILocalExecutorConfig {
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
export interface IRemoteExecutorConfig {
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
