/**
 * @fileoverview Abstract AI Provider Base Class
 *
 * 🎯 ABSTRACT CLASS - DO NOT DEPEND ON CONCRETE IMPLEMENTATIONS
 *
 * Defines the shared contract and helper utilities for all AI provider implementations.
 * Concrete providers should extend this class and inject their own dependencies.
 */
import type {
  IAIProvider,
  IToolSchema,
  IChatOptions,
  IProviderRequest,
  IRawProviderResponse,
} from '../interfaces/provider';
import type { IExecutor } from '../interfaces/executor';
import type { TUniversalMessage } from '../interfaces/messages';
import { isAssistantMessage } from '../interfaces/messages';
import type { ILogger } from '../utils/logger';
import { SilentLogger } from '../utils/logger';

/**
 * Provider logging data type
 * Used for storing logging information in provider operations
 */
export type TProviderLoggingData = Record<string, string | number | boolean | Date | string[]>;

/**
 * Provider configuration base interface
 */
export interface IProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  timeout?: number;
  [key: string]: string | number | boolean | undefined;
}

/**
 * Enhanced provider configuration that supports executor injection
 */
export interface IExecutorAwareProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  timeout?: number;
  /**
   * Optional executor for handling AI requests
   * When provided, the provider will delegate all chat operations to this executor
   * instead of making direct API calls. This enables remote execution capabilities.
   */
  executor?: IExecutor;
  [key: string]: string | number | boolean | IExecutor | undefined;
}

/**
 * Base AI provider implementation with proper type constraints
 * All AI providers should extend this class
 *
 * ========================================
 * CRITICAL IMPLEMENTATION GUIDELINES
 * ========================================
 *
 * ALL AI PROVIDER IMPLEMENTATIONS (OpenAI, Anthropic, Google, etc.) MUST:
 *
 * 1. EXTEND THIS CLASS:
 *    ```typescript
 *    export class OpenAIProvider extends AbstractAIProvider {
 *        override readonly name = 'openai';
 *        override readonly version = '1.0.0';
 *    ```
 *
 * 2. USE IMPORTS FROM @robota-sdk/agent-core:
 *    ```typescript
 *    import { AbstractAIProvider } from '@robota-sdk/agent-core';
 *    import type {
 *        TUniversalMessage,
 *        ChatOptions,
 *        IToolCall,
 *        ToolSchema,
 *        AssistantMessage
 *    } from '@robota-sdk/agent-core';
 *    ```
 *
 * 3. USE OVERRIDE KEYWORD FOR ALL INHERITED METHODS:
 *    - override async chat(...)
 *    - override async *chatStream(...)
 *    - override supportsTools()
 *    - override validateConfig()
 *    - override async dispose()
 *
 * 4. DO NOT REDEFINE TYPES THAT EXIST IN @robota-sdk/agent-core:
 *    - TUniversalMessage
 *    - ChatOptions
 *    - IToolCall
 *    - ToolSchema
 *    - AssistantMessage
 *    - SystemMessage
 *    - UserMessage
 *    - ToolMessage
 *
 * 5. HANDLE MESSAGE CONTENT PROPERLY:
 *    - For tool calls: content should be null (not empty string)
 *    - For regular messages: content can be string or null
 *    - Always preserve null values from API responses
 *
 * 6. CALL SUPER() IN CONSTRUCTOR:
 *    ```typescript
 *    constructor(options: IProviderOptions) {
 *        super();
 *        // provider-specific initialization
 *    }
 *    ```
 *
 * This ensures ExecutionService can properly identify providers
 * and prevents type conflicts across the codebase.
 *
 * ========================================
 *
 * @template TConfig - Provider configuration type (defaults to IProviderConfig for type safety)
 * @template TUniversalMessage - Message type (defaults to TUniversalMessage for backward compatibility)
 * @template TResponse - Response type (defaults to TUniversalMessage for backward compatibility)
 */
export abstract class AbstractAIProvider<TConfig = IProviderConfig> implements IAIProvider {
  abstract readonly name: string;
  abstract readonly version: string;
  protected config?: TConfig;
  protected executor?: IExecutor;
  protected readonly logger: ILogger;

  constructor(logger: ILogger = SilentLogger) {
    this.logger = logger;
  }

  /**
   * Configure the provider with type-safe configuration
   */
  async configure(config: TConfig): Promise<void> {
    this.config = config;

    // Check if config includes executor and set it
    if (this.hasExecutor(config) && config.executor) {
      this.executor = config.executor;
    }

    // Subclasses can override for additional setup
  }

  private hasExecutor(config: TConfig): config is TConfig & { executor?: IExecutor } {
    return typeof config === 'object' && config !== null && 'executor' in config;
  }

  /**
   * Each provider must implement chat using their own native SDK types internally
   * @param messages - Array of messages from conversation history
   * @param options - Chat options including tools, model settings, etc.
   * @returns Promise resolving to a response
   */
  abstract chat(messages: TUniversalMessage[], options?: IChatOptions): Promise<TUniversalMessage>;

  /**
   * Wrap an async iterable to yield to the macrotask queue periodically.
   * Providers MUST use this when iterating over streaming events to ensure
   * the main thread event loop stays responsive (ESC abort, Ctrl+C, etc.).
   *
   * Usage in provider:
   *   for await (const event of this.streamWithAbort(stream, signal)) { ... }
   */
  protected async *streamWithAbort<T>(
    source: AsyncIterable<T>,
    signal?: AbortSignal,
  ): AsyncGenerator<T> {
    let count = 0;
    for await (const item of source) {
      if (signal?.aborted) break;
      yield item;
      count++;
      // Yield to macrotask queue every 3 events so stdin (ESC) can fire
      if (count % 3 === 0) {
        await new Promise<void>((resolve) => {
          setImmediate(resolve);
        });
        if (signal?.aborted) break;
      }
    }
  }

  /**
   * Each provider must implement streaming chat using their own native SDK types internally
   * @param messages - Array of messages from conversation history
   * @param options - Chat options including tools, model settings, etc.
   * @returns AsyncIterable of response chunks
   */
  chatStream?(
    messages: TUniversalMessage[],
    options?: IChatOptions,
  ): AsyncIterable<TUniversalMessage>;

  /**
   * Provider-agnostic raw response API.
   *
   * This is the canonical "raw payload" entrypoint required by the AIProvider contract.
   * The default implementation delegates to `chat()` and adapts the result into a
   * RawProviderResponse shape.
   */
  async generateResponse(payload: IProviderRequest): Promise<IRawProviderResponse> {
    const response = await this.chat(payload.messages, {
      ...(payload.model !== undefined && { model: payload.model }),
      ...(payload.temperature !== undefined && { temperature: payload.temperature }),
      ...(payload.maxTokens !== undefined && { maxTokens: payload.maxTokens }),
      ...(payload.tools !== undefined && { tools: payload.tools }),
    });

    return {
      content: response.content ?? null,
      toolCalls: isAssistantMessage(response) ? response.toolCalls : undefined,
      model: payload.model,
      metadata: payload.metadata,
    };
  }

  /**
   * Provider-agnostic raw streaming API.
   *
   * If a provider does not implement chatStream, it does not support streaming.
   */
  async *generateStreamingResponse(payload: IProviderRequest): AsyncIterable<IRawProviderResponse> {
    if (!this.chatStream) {
      throw new Error(`[AI-PROVIDER] Streaming is not supported by provider "${this.name}"`);
    }

    for await (const chunk of this.chatStream(payload.messages, {
      ...(payload.model !== undefined && { model: payload.model }),
      ...(payload.temperature !== undefined && { temperature: payload.temperature }),
      ...(payload.maxTokens !== undefined && { maxTokens: payload.maxTokens }),
      ...(payload.tools !== undefined && { tools: payload.tools }),
    })) {
      yield {
        content: chunk.content ?? null,
        toolCalls: isAssistantMessage(chunk) ? chunk.toolCalls : undefined,
        model: payload.model,
        metadata: payload.metadata,
      };
    }
  }

  /**
   * Default implementation - most modern providers support tools
   * @returns true if tool calling is supported
   */
  supportsTools(): boolean {
    return true;
  }

  /**
   * Default implementation - providers can override for specific validation
   * @returns true if configuration is valid
   */
  validateConfig(): boolean {
    return true;
  }

  /**
   * Utility method for validating TUniversalMessage array
   * @param messages - Messages to validate
   */
  protected validateMessages(messages: TUniversalMessage[]): void {
    if (!Array.isArray(messages)) {
      throw new Error('Messages must be an array');
    }

    if (messages.length === 0) {
      throw new Error('Messages array cannot be empty');
    }

    for (const message of messages) {
      if (!message.role || !['user', 'assistant', 'system', 'tool'].includes(message.role)) {
        throw new Error(`Invalid message role: ${message.role}`);
      }
    }
  }

  /**
   * Utility method for validating tool schemas
   * @param tools - Tool schemas to validate
   */
  protected validateTools(tools?: IToolSchema[]): void {
    if (!tools) return;

    if (!Array.isArray(tools)) {
      throw new Error('Tools must be an array');
    }

    for (const tool of tools) {
      if (!tool.name || typeof tool.name !== 'string') {
        throw new Error('Tool must have a valid name');
      }
      if (!tool.description || typeof tool.description !== 'string') {
        throw new Error('Tool must have a valid description');
      }
      if (
        !tool.parameters ||
        typeof tool.parameters !== 'object' ||
        tool.parameters === null ||
        Array.isArray(tool.parameters)
      ) {
        throw new Error('Tool must have valid parameters');
      }
    }
  }

  /**
   * Execute chat via executor.
   *
   * Subclasses should call this only when an executor is configured.
   */
  protected async executeViaExecutorOrDirect(
    messages: TUniversalMessage[],
    options?: IChatOptions,
  ): Promise<TUniversalMessage> {
    if (!this.executor) {
      throw new Error(
        `Executor is required for ${this.name} provider. Configure an executor or use direct execution path.`,
      );
    }
    if (!options?.model) {
      throw new Error(`Model is required for executor execution in ${this.name} provider.`);
    }

    const result = await this.executor.executeChat({
      messages,
      options,
      provider: this.name,
      model: options.model,
      ...(options.tools && { tools: options.tools }),
    });

    return result;
  }

  /**
   * Execute streaming chat via executor.
   *
   * Subclasses should call this only when an executor is configured.
   */
  protected async *executeStreamViaExecutorOrDirect(
    messages: TUniversalMessage[],
    options?: IChatOptions,
  ): AsyncIterable<TUniversalMessage> {
    if (!this.executor || !this.executor.executeChatStream) {
      throw new Error(`Streaming executor is required for ${this.name} provider.`);
    }
    if (!options?.model) {
      throw new Error(`Model is required for executor streaming in ${this.name} provider.`);
    }

    // 🔍 [TOOL-FLOW] AbstractAIProvider.executeStreamViaExecutorOrDirect() - Preparing executor request
    this.logger.debug?.(
      '🔍 [TOOL-FLOW] AbstractAIProvider.executeStreamViaExecutorOrDirect() - Executor request',
      {
        provider: this.name,
        model: options.model,
        hasTools: !!options.tools,
        toolsCount: options.tools?.length || 0,
        toolNames: options.tools?.map((t: IToolSchema) => t.name) || [],
      },
    );

    const stream = this.executor.executeChatStream({
      messages,
      options,
      provider: this.name,
      model: options.model,
      stream: true,
      ...(options.tools && { tools: options.tools }),
    });

    for await (const chunk of stream) {
      yield chunk;
    }
    return;
  }

  /**
   * Clean up resources when provider is no longer needed
   * Override this method in subclasses for additional cleanup
   */
  async dispose(): Promise<void> {
    // Clean up executor if present
    if (this.executor?.dispose) {
      await this.executor.dispose();
    }

    // Subclasses can override for additional cleanup
  }
}
