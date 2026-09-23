/**
 * @fileoverview Abstract AI Provider Base Class
 *
 * 🎯 ABSTRACT CLASS - DO NOT DEPEND ON CONCRETE IMPLEMENTATIONS
 *
 * Defines the shared contract and helper utilities for all AI provider implementations.
 * Concrete providers should extend this class and inject their own dependencies.
 */
import { executeProviderStreamViaExecutor } from './abstract-ai-provider-executor-stream';
import {
  generateGenericResponse,
  generateGenericStreamingResponse,
} from './abstract-ai-provider-model-effort';
import {
  validateProviderMessages,
  validateProviderTools,
  executeChatViaExecutor,
} from './ai-provider-helpers';
import {
  assertProviderNativeWebToolsAvailable,
  createDefaultProviderCapabilities,
} from '../interfaces/provider-capabilities';
import { hashToolSchema, projectToolSchema } from '../schema/project-tool-schema';
import { createLogger, SilentLogger } from '../utils/logger';

import type { IExecutor, IExecutorChatResult, TExecutorStreamEvent } from '../interfaces/executor';
import type { TUniversalMessage } from '../interfaces/messages';
import type { IProviderModelEffortTable } from '../interfaces/model-effort-capability';
import type {
  IAIProvider,
  IToolSchema,
  IChatOptions,
  IProviderRequest,
  IRawProviderResponse,
} from '../interfaces/provider';
import type {
  IProviderCapabilities,
  IProviderNativeWebToolRequest,
} from '../interfaces/provider-capabilities';
import type { IToolSchemaProjectionProfile } from '../schema/project-tool-schema';
import type { ILogger } from '../utils/logger';

/**
 * MCP-005: the global-sink logger every `projectTools` quarantine line goes through.
 *
 * `AnthropicProvider` and `GeminiProvider` construct with no logger, so `this.logger` is
 * `SilentLogger` (`:89` below) — a quarantine reported only there would be silent on two of four
 * providers. `createLogger('ToolSchemaProjection')` is the CORE-040 precedent
 * (`agent-mcp/src/third-party-schema.ts`, `createLogger('ThirdPartySchema')`): audible without an
 * injected logger, because it writes to the process-wide sink a host installs with
 * `setGlobalLoggerSink`.
 */
const toolSchemaProjectionLogger: ILogger = createLogger('ToolSchemaProjection');

/**
 * Provider logging data type
 * Used for storing logging information in provider operations
 */
export type TProviderLoggingData = Record<string, string | number | boolean | Date | string[]>;

/**
 * Provider configuration base interface
 */
export interface IProviderRuntimeConfig {
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
export abstract class AbstractAIProvider<TConfig = IProviderRuntimeConfig> implements IAIProvider {
  abstract readonly name: string;
  abstract readonly version: string;
  protected config?: TConfig;
  protected executor?: IExecutor;
  protected readonly logger: ILogger;

  /**
   * MCP-005 per-tool quarantine memo — instance-scoped (never a module singleton), so one provider
   * instance's cache cannot silence another's, and a re-registered tool with a CHANGED schema is
   * judged and reported again while an unchanged one is not re-reported on every turn. Keyed by
   * `provider.name` + `model` + `tool.name` + `hashToolSchema(tool.parameters)`.
   */
  private readonly quarantinedToolSchemas = new Map<string, true>();

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
    const iterator = source[Symbol.asyncIterator]();
    try {
      while (!signal?.aborted) {
        const item = await nextStreamItem(iterator, signal);
        if (item.done) break;
        await yieldToMacrotask(signal);
        if (signal?.aborted) break;
        yield item.value;
      }
    } finally {
      if (signal?.aborted) {
        await iterator.return?.();
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

  /** Optional adapter-owned effort capability data. */
  effortTable?(): IProviderModelEffortTable | undefined;

  /**
   * Provider-agnostic raw response API.
   *
   * This is the canonical "raw payload" entrypoint required by the AIProvider contract.
   * The default implementation delegates to `chat()` and adapts the result into a
   * RawProviderResponse shape.
   */
  async generateResponse(payload: IProviderRequest): Promise<IRawProviderResponse> {
    return generateGenericResponse(this, this.logger, payload);
  }

  /**
   * Provider-agnostic raw streaming API.
   *
   * If a provider does not implement chatStream, it does not support streaming.
   */
  async *generateStreamingResponse(payload: IProviderRequest): AsyncIterable<IRawProviderResponse> {
    yield* generateGenericStreamingResponse(this, this.logger, payload);
  }

  /**
   * Default implementation - most modern providers support tools
   * @returns true if tool calling is supported
   */
  supportsTools(): boolean {
    return true;
  }

  getCapabilities(): IProviderCapabilities {
    return createDefaultProviderCapabilities(this.supportsTools());
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
   * MCP-005: this provider's tool-schema wire constraints, as data. `undefined` (the default) means
   * "adopt every tool unchanged, no diagnostics" — today's behaviour, kept for `agent-provider-replay`
   * and any embedding provider that overrides nothing.
   */
  protected projectionProfile(): IToolSchemaProjectionProfile | undefined {
    return undefined;
  }

  /**
   * Project `tools` through `projectionProfile()` before handing them to a converter. A helper, not
   * an automatic seam: `chat`/`chatStream` are abstract, so the base runs nothing itself — each
   * concrete provider calls this at its own request-building site(s), after `validateTools` and
   * before its converter.
   *
   * No profile: returns `tools` unchanged (same array, no diagnostics). With a profile: adopted and
   * adapted tools are returned in a NEW array (an adapted tool is a projected COPY; `tools` itself and
   * every original tool object are never mutated); a rejected tool is omitted from the returned array
   * and reported ONCE per cache identity via the global-sink `ToolSchemaProjection` logger.
   */
  protected projectTools(
    tools: IToolSchema[] | undefined,
    model: string,
  ): IToolSchema[] | undefined {
    const profile = this.projectionProfile();
    if (!profile || !tools) {
      return tools;
    }

    const kept: IToolSchema[] = [];
    for (const tool of tools) {
      const projection = projectToolSchema(tool, profile);
      if (projection.outcome !== 'rejected') {
        kept.push(projection.tool);
        continue;
      }

      const identity = `${this.name} ${model} ${tool.name} ${hashToolSchema(tool.parameters)}`;
      if (this.quarantinedToolSchemas.has(identity)) {
        continue;
      }
      this.quarantinedToolSchemas.set(identity, true);

      const { path, keyword, reason } = projection.rejection ?? {
        path: '',
        keyword: '',
        reason: 'rejected',
      };
      toolSchemaProjectionLogger.warn(
        `tool_schema_quarantined provider=${this.name} model=${model} tool=${tool.name} path=${path} keyword=${keyword} reason=${reason}`,
      );
    }
    return kept;
  }

  protected validateNativeWebTools(request?: IProviderNativeWebToolRequest): void {
    assertProviderNativeWebToolsAvailable(this.name, this.getCapabilities(), request);
  }

  /**
   * Execute chat via executor.
   * Subclasses should call this only when an executor is configured.
   */
  protected async executeViaExecutorOrDirect(
    messages: TUniversalMessage[],
    options?: IChatOptions,
  ): Promise<IExecutorChatResult> {
    return executeChatViaExecutor(this.executor, this.name, messages, options);
  }

  /**
   * Execute streaming chat via executor.
   * Subclasses should call this only when an executor is configured.
   */
  protected async *executeStreamViaExecutorOrDirect(
    messages: TUniversalMessage[],
    options?: IChatOptions,
  ): AsyncIterable<TExecutorStreamEvent> {
    yield* executeProviderStreamViaExecutor(
      this.logger,
      this.executor,
      this.name,
      messages,
      options,
    );
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

async function nextStreamItem<T>(
  iterator: AsyncIterator<T>,
  signal?: AbortSignal,
): Promise<IteratorResult<T>> {
  if (!signal) return iterator.next();
  if (signal.aborted) return { done: true, value: undefined as T };

  let abortListener: (() => void) | undefined;
  const aborted = new Promise<IteratorResult<T>>((resolve) => {
    abortListener = (): void => resolve({ done: true, value: undefined as T });
    signal.addEventListener('abort', abortListener, { once: true });
  });

  try {
    return await Promise.race([iterator.next(), aborted]);
  } finally {
    if (abortListener) signal.removeEventListener('abort', abortListener);
  }
}

async function yieldToMacrotask(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
