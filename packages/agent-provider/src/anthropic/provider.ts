import { randomUUID } from 'node:crypto';

import Anthropic from '@anthropic-ai/sdk';
import {
  AbstractAIProvider,
  getModelMaxOutput,
  RateLimitError,
  ConfigurationError,
  ValidationError,
} from '@robota-sdk/agent-core';

import { convertToAnthropicFormat, convertToolsToAnthropicFormat } from './message-converter';
import { streamAndAssemble } from './streaming-handler';

import type { IAnthropicProviderOptions } from './types';
import type {
  IProviderCapabilities,
  IProviderNativeWebToolRequest,
  TUniversalMessage,
  IChatOptions,
  TTextDeltaCallback,
} from '@robota-sdk/agent-core';

/**
 * Anthropic provider implementation for Robota
 *
 * IMPORTANT PROVIDER-SPECIFIC RULES:
 * 1. This provider MUST extend BaseAIProvider from @robota-sdk/agent-core
 * 2. Content handling for Anthropic API:
 *    - When tool_calls are present: content MUST be null (not empty string)
 *    - For regular assistant messages: content should be a string
 * 3. Use override keyword for all methods inherited from BaseAIProvider
 * 4. Provider-specific API behavior should be documented here
 *
 * @public
 */
export class AnthropicProvider extends AbstractAIProvider {
  override readonly name = 'anthropic';
  override readonly version = '1.0.0';

  private readonly client?: Anthropic;
  private readonly options: IAnthropicProviderOptions;

  /**
   * When true, Anthropic server tools (web_search) are included in every request.
   * The server executes these tools internally — no local tool registration needed.
   */
  enableWebTools = false;

  /**
   * Optional callback for text deltas during streaming.
   * Set by the consumer (e.g., Session) to receive real-time text chunks.
   * When set, chat() uses streaming internally while still returning
   * the complete assembled message.
   */
  onTextDelta?: TTextDeltaCallback;

  /** Callback when a server tool (web_search etc.) is invoked by the API */
  onServerToolUse?: (toolName: string, input: Record<string, string>) => void;

  constructor(options: IAnthropicProviderOptions) {
    super();
    this.options = options;

    // Set executor if provided
    if (options.executor) {
      this.executor = options.executor;
    }

    // Only create client if not using executor
    if (!this.executor) {
      // Create client from apiKey if not provided.
      if (options.client) {
        this.client = options.client;
      } else if (options.apiKey) {
        this.client = new Anthropic({
          apiKey: options.apiKey,
          ...(options.timeout && { timeout: options.timeout }),
          ...(options.baseURL && { baseURL: options.baseURL }),
        });
      } else {
        throw new ConfigurationError('Either Anthropic client, apiKey, or executor is required');
      }
    }
  }

  /**
   * Generate response using TUniversalMessage
   */
  override async chat(
    messages: TUniversalMessage[],
    options?: IChatOptions,
  ): Promise<TUniversalMessage> {
    this.validateMessages(messages);
    this.validateNativeWebTools(options?.nativeWebTools);

    // Use executor when configured; otherwise use direct execution
    if (this.executor) {
      return this.executeViaExecutorOrDirect(messages, options);
    }

    // Direct execution with Anthropic client
    if (!this.client) {
      throw new Error(
        'Anthropic client not available. Either provide a client/apiKey or use an executor.',
      );
    }

    // Separate system messages for the Anthropic system parameter
    const systemMessages = messages.filter((m) => m.role === 'system');
    const nonSystemMessages = messages.filter((m) => m.role !== 'system');
    const anthropicMessages = convertToAnthropicFormat(nonSystemMessages);
    const systemPrompt = systemMessages.map((m) => m.content || '').join('\n\n') || undefined;

    if (!options?.model) {
      throw new Error(
        'Model is required in chat options. Please specify a model in defaultModel configuration.',
      );
    }

    const functionTools = options?.tools ? convertToolsToAnthropicFormat(options.tools) : [];
    const serverTools: Anthropic.Messages.ToolUnion[] = this.enableWebTools
      ? [{ type: 'web_search_20250305' as const, name: 'web_search' }]
      : [];
    const allTools: Anthropic.Messages.ToolUnion[] = [...functionTools, ...serverTools];

    const baseParams: Anthropic.MessageCreateParamsNonStreaming = {
      model: options.model as string,
      messages: anthropicMessages,
      max_tokens: options?.maxTokens || getModelMaxOutput(options.model as string),
      ...(systemPrompt && { system: systemPrompt }),
      ...(options?.temperature !== undefined && { temperature: options.temperature }),
      ...(allTools.length > 0 && { tools: allTools }),
      ...buildOutputConfig(options),
    };

    // Always use streaming to avoid Anthropic SDK's 10-minute non-streaming timeout.
    // When no onTextDelta callback is available, use a no-op to silently assemble the response.
    const textDeltaCb = options?.onTextDelta ?? this.onTextDelta ?? (() => {});
    try {
      return await streamAndAssemble(
        this.client,
        baseParams,
        textDeltaCb,
        this.onServerToolUse,
        options?.signal,
        options?.onProviderNativeRawPayload,
      );
    } catch (error) {
      // allow-fallback: re-throws original after mapping 429 to RateLimitError
      const anthropicError = error as {
        status?: number;
        error?: { type?: string };
        message?: string;
      };
      if (anthropicError.status === 429 || anthropicError.error?.type === 'rate_limit_error') {
        throw new RateLimitError(
          anthropicError.message ?? 'Anthropic rate limit exceeded.',
          undefined,
          'anthropic',
        );
      }
      throw error;
    }
  }

  /**
   * Generate streaming response using TUniversalMessage
   */
  override async *chatStream(
    messages: TUniversalMessage[],
    options?: IChatOptions,
  ): AsyncIterable<TUniversalMessage> {
    this.validateMessages(messages);
    this.validateNativeWebTools(options?.nativeWebTools);

    // Use executor when configured; otherwise use direct execution
    if (this.executor) {
      yield* this.executeStreamViaExecutorOrDirect(messages, options);
      return;
    }

    // Direct execution with Anthropic client
    if (!this.client) {
      throw new Error(
        'Anthropic client not available. Either provide a client/apiKey or use an executor.',
      );
    }

    const anthropicMessages = convertToAnthropicFormat(messages);

    if (!options?.model) {
      throw new Error(
        'Model is required in chat options. Please specify a model in defaultModel configuration.',
      );
    }

    const requestParams: Anthropic.MessageCreateParamsStreaming = {
      model: options.model as string,
      messages: anthropicMessages,
      max_tokens: options?.maxTokens || getModelMaxOutput(options.model as string),
      stream: true,
      ...buildOutputConfig(options),
    };

    if (options?.temperature !== undefined) {
      requestParams.temperature = options.temperature;
    }

    const functionTools = options?.tools ? convertToolsToAnthropicFormat(options.tools) : [];
    const serverTools: Anthropic.Messages.ToolUnion[] = this.enableWebTools
      ? [{ type: 'web_search_20250305' as const, name: 'web_search' }]
      : [];
    const allTools: Anthropic.Messages.ToolUnion[] = [...functionTools, ...serverTools];

    if (allTools.length > 0) {
      requestParams.tools = allTools;
    }

    options?.onProviderNativeRawPayload?.({
      provider: 'anthropic',
      apiSurface: 'anthropic-messages',
      payloadKind: 'request',
      payload: requestParams,
    });
    let stream: AsyncIterable<Anthropic.MessageStreamEvent>;
    try {
      stream = await this.client.messages.create(requestParams);
    } catch (streamError) {
      // allow-fallback: re-throws original after mapping 429 to RateLimitError
      const anthropicError = streamError as {
        status?: number;
        error?: { type?: string };
        message?: string;
      }; // allow-any: narrowing unknown HTTP error shape from Anthropic SDK
      if (anthropicError.status === 429 || anthropicError.error?.type === 'rate_limit_error') {
        throw new RateLimitError(
          anthropicError.message ?? 'Anthropic rate limit exceeded.',
          undefined,
          'anthropic',
        );
      }
      throw streamError;
    }

    let sequence = 0;
    for await (const chunk of stream) {
      options?.onProviderNativeRawPayload?.({
        provider: 'anthropic',
        apiSurface: 'anthropic-messages',
        payloadKind: 'stream_event',
        sequence,
        payload: chunk,
      });
      sequence++;
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        yield {
          id: randomUUID(),
          role: 'assistant',
          content: chunk.delta.text,
          state: 'complete' as const,
          timestamp: new Date(),
        };
      }
    }
  }

  override supportsTools(): boolean {
    return true;
  }

  override getCapabilities(): IProviderCapabilities {
    return {
      functionCalling: { supported: true },
      nativeWebTools: {
        webSearch: this.enableWebTools
          ? { supported: true, enabled: true, source: 'anthropic-messages' }
          : {
              supported: true,
              enabled: false,
              source: 'anthropic-messages',
              reason: 'Call configureNativeWebTools({ webSearch: true }) or set enableWebTools.',
            },
        webFetch: {
          supported: false,
          enabled: false,
          source: 'anthropic-messages',
          reason: 'Anthropic provider exposes server web search only.',
        },
      },
    };
  }

  configureNativeWebTools(request: IProviderNativeWebToolRequest): IProviderCapabilities {
    if (request.webSearch === true) {
      this.enableWebTools = true;
    }
    this.validateNativeWebTools(request);
    return this.getCapabilities();
  }

  override validateConfig(): boolean {
    return !!this.client && !!this.options && !!this.options.apiKey;
  }

  override async dispose(): Promise<void> {
    // Anthropic client doesn't need explicit cleanup
  }

  /**
   * Validate TUniversalMessage array
   */
  protected override validateMessages(messages: TUniversalMessage[]): void {
    if (!Array.isArray(messages)) {
      throw new ValidationError('Messages must be an array', 'messages');
    }

    if (messages.length === 0) {
      throw new ValidationError('Messages array cannot be empty', 'messages');
    }

    for (const message of messages) {
      if (!message.role || !['user', 'assistant', 'system', 'tool'].includes(message.role)) {
        throw new ValidationError(`Invalid message role: ${message.role}`, 'role');
      }
    }
  }
}

/**
 * Map a `json_schema` response format onto Anthropic's native structured-output
 * surface (`output_config.format`, CORE-015). Other formats have no Anthropic
 * equivalent and rely on the core-side validation loop.
 */
function buildOutputConfig(
  options: IChatOptions | undefined,
): Pick<Anthropic.MessageCreateParams, 'output_config'> | Record<string, never> {
  if (options?.responseFormat?.type !== 'json_schema') {
    return {};
  }
  return {
    output_config: {
      format: {
        type: 'json_schema',
        schema: closeObjectSchemas(options.responseFormat.schema) as Record<string, unknown>,
      },
    },
  };
}

/**
 * Anthropic's structured-output surface rejects open-world objects: every
 * `object` node must carry an explicit `additionalProperties: false`. The
 * universal schema subset leaves it unset (closed by convention), so close
 * every object node recursively at this SDK seam. The consumer's original
 * schema still governs core-side validation.
 */
function closeObjectSchemas(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(closeObjectSchemas);
  }
  if (typeof node !== 'object' || node === null) {
    return node;
  }
  const record = node as Record<string, unknown>;
  const closed: Record<string, unknown> = { ...record };
  if (record.properties && typeof record.properties === 'object') {
    closed.properties = Object.fromEntries(
      Object.entries(record.properties as Record<string, unknown>).map(([key, value]) => [
        key,
        closeObjectSchemas(value),
      ]),
    );
  }
  if (record.items && typeof record.items === 'object') {
    closed.items = closeObjectSchemas(record.items);
  }
  if (record.additionalProperties && typeof record.additionalProperties === 'object') {
    // Schema-valued additionalProperties (record types) pass through recursed;
    // Anthropic may reject them — surfaced as a provider error, not masked here.
    closed.additionalProperties = closeObjectSchemas(record.additionalProperties);
  } else if (record.type === 'object') {
    closed.additionalProperties = false;
  }
  return closed;
}
