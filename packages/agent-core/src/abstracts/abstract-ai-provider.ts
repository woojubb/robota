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
import {
  validateProviderMessages,
  validateProviderTools,
  executeChatViaExecutor,
  executeChatStreamViaExecutor,
} from './ai-provider-helpers';

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
 * Base AI provider implementation with proper type constraints.
 * All AI providers should extend this class.
 *
 * Subclasses MUST: extend this class, use override keyword, call super() in constructor,
 * not redefine types that exist in agent-core, handle null message content correctly.
 *
 * @template TConfig - Provider configuration type
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
    for await (const item of source) {
      if (signal?.aborted) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (signal?.aborted) break;
      yield item;
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

  /** Validate that messages is a non-empty array with valid roles. */
  protected validateMessages(messages: TUniversalMessage[]): void {
    validateProviderMessages(messages);
  }

  /** Validate tool schemas. No-ops if tools is undefined. */
  protected validateTools(tools?: IToolSchema[]): void {
    validateProviderTools(tools);
  }

  /**
   * Execute chat via executor.
   * Subclasses should call this only when an executor is configured.
   */
  protected async executeViaExecutorOrDirect(
    messages: TUniversalMessage[],
    options?: IChatOptions,
  ): Promise<TUniversalMessage> {
    return executeChatViaExecutor(this.executor, this.name, messages, options);
  }

  /**
   * Execute streaming chat via executor.
   * Subclasses should call this only when an executor is configured.
   */
  protected async *executeStreamViaExecutorOrDirect(
    messages: TUniversalMessage[],
    options?: IChatOptions,
  ): AsyncIterable<TUniversalMessage> {
    this.logger.debug?.(
      '🔍 [TOOL-FLOW] AbstractAIProvider.executeStreamViaExecutorOrDirect() - Executor request',
      {
        provider: this.name,
        model: options?.model,
        hasTools: !!options?.tools,
        toolsCount: options?.tools?.length || 0,
        toolNames: options?.tools?.map((t: IToolSchema) => t.name) || [],
      },
    );
    yield* executeChatStreamViaExecutor(this.executor, this.name, messages, options);
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
