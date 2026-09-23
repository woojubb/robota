import { randomUUID } from 'node:crypto';

import Anthropic from '@anthropic-ai/sdk';
import {
  AbstractAIProvider,
  ConfigurationError,
  createModelEffortOutcome,
  resolveModelEffort,
  ValidationError,
} from '@robota-sdk/agent-core';

import { ANTHROPIC_CAPABILITY_TABLE } from './capability-table';
import { resolveAnthropicMaxTokens } from './claude-models.js';
import { rethrowAnthropicError } from './errors';
import {
  convertToAnthropicFormat,
  convertToolsToAnthropicFormat,
  toAnthropicToolChoice,
} from './message-converter';
import { ANTHROPIC_MODEL_EFFORT_TABLE } from './model-effort-table';
import { buildOutputConfig } from './output-schema.js';
import { anthropicProviderCapabilities } from './provider-capabilities';
import { streamAndAssemble, toUniversalStreamChunks } from './streaming-handler';

import type { IAnthropicProviderOptions } from './types';
import type {
  IProviderCapabilityTable,
  IProviderCapabilities,
  IProviderNativeWebToolRequest,
  IProviderModelEffortTable,
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
    const resolvedOptions = this.resolveEffortOptions(options);

    // Use executor when configured; otherwise use direct execution
    if (this.executor) {
      const result = await this.executeViaExecutorOrDirect(messages, resolvedOptions);
      if (result.modelEffortOutcome === undefined) {
        this.publishModelEffortOutcome(resolvedOptions, 'opaque-executor');
      }
      return result.message;
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

    if (!resolvedOptions?.model) {
      throw new Error(
        'Model is required in chat options. Please specify a model in defaultModel configuration.',
      );
    }

    const functionTools = resolvedOptions?.tools
      ? convertToolsToAnthropicFormat(resolvedOptions.tools)
      : [];
    const serverTools: Anthropic.Messages.ToolUnion[] = this.enableWebTools
      ? [{ type: 'web_search_20250305' as const, name: 'web_search' }]
      : [];
    const allTools: Anthropic.Messages.ToolUnion[] = [...functionTools, ...serverTools];

    const baseParams: Anthropic.MessageCreateParamsNonStreaming = {
      model: resolvedOptions.model,
      messages: anthropicMessages,
      max_tokens: resolveAnthropicMaxTokens(resolvedOptions.model, resolvedOptions.maxTokens),
      ...(systemPrompt && { system: systemPrompt }),
      ...(resolvedOptions.temperature !== undefined && {
        temperature: resolvedOptions.temperature,
      }),
      ...(allTools.length > 0 && { tools: allTools }),
      ...(allTools.length > 0 &&
        resolvedOptions.toolChoice !== undefined && {
          tool_choice: toAnthropicToolChoice(resolvedOptions.toolChoice),
        }),
      ...buildOutputConfig(resolvedOptions),
    };

    // Always use streaming to avoid Anthropic SDK's 10-minute non-streaming timeout.
    // When no onTextDelta callback is available, use a no-op to silently assemble the response.
    const textDeltaCb = resolvedOptions.onTextDelta ?? this.onTextDelta ?? (() => {});
    try {
      const response = await streamAndAssemble(
        this.client,
        baseParams,
        textDeltaCb,
        this.onServerToolUse,
        resolvedOptions.signal,
        resolvedOptions.onProviderNativeRawPayload,
      );
      this.publishModelEffortOutcome(resolvedOptions);
      return response;
    } catch (error) {
      rethrowAnthropicError(error);
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
    const resolvedOptions = this.resolveEffortOptions(options);

    // Use executor when configured; otherwise use direct execution
    if (this.executor) {
      let executorOutcomeSeen = false;
      for await (const event of this.executeStreamViaExecutorOrDirect(messages, resolvedOptions)) {
        if (event.kind === 'message') {
          yield event.message;
        } else {
          executorOutcomeSeen = event.modelEffortOutcome !== undefined;
        }
      }
      if (!executorOutcomeSeen) {
        this.publishModelEffortOutcome(resolvedOptions, 'opaque-executor');
      }
      return;
    }

    // Direct execution with Anthropic client
    if (!this.client) {
      throw new Error(
        'Anthropic client not available. Either provide a client/apiKey or use an executor.',
      );
    }

    const anthropicMessages = convertToAnthropicFormat(messages);

    if (!resolvedOptions?.model) {
      throw new Error(
        'Model is required in chat options. Please specify a model in defaultModel configuration.',
      );
    }

    const requestParams: Anthropic.MessageCreateParamsStreaming = {
      model: resolvedOptions.model,
      messages: anthropicMessages,
      max_tokens: resolveAnthropicMaxTokens(resolvedOptions.model, resolvedOptions.maxTokens),
      stream: true,
      ...buildOutputConfig(resolvedOptions),
    };

    if (resolvedOptions.temperature !== undefined) {
      requestParams.temperature = resolvedOptions.temperature;
    }

    const functionTools = resolvedOptions.tools
      ? convertToolsToAnthropicFormat(resolvedOptions.tools)
      : [];
    const serverTools: Anthropic.Messages.ToolUnion[] = this.enableWebTools
      ? [{ type: 'web_search_20250305' as const, name: 'web_search' }]
      : [];
    const allTools: Anthropic.Messages.ToolUnion[] = [...functionTools, ...serverTools];

    if (allTools.length > 0) {
      requestParams.tools = allTools;
      if (resolvedOptions.toolChoice !== undefined) {
        requestParams.tool_choice = toAnthropicToolChoice(resolvedOptions.toolChoice);
      }
    }

    resolvedOptions.onProviderNativeRawPayload?.({
      provider: 'anthropic',
      apiSurface: 'anthropic-messages',
      payloadKind: 'request',
      payload: requestParams,
    });
    let stream: AsyncIterable<Anthropic.MessageStreamEvent>;
    try {
      stream = await this.client.messages.create(requestParams);
    } catch (streamError) {
      rethrowAnthropicError(streamError);
    }

    let sequence = 0;
    for await (const chunk of stream) {
      resolvedOptions.onProviderNativeRawPayload?.({
        provider: 'anthropic',
        apiSurface: 'anthropic-messages',
        payloadKind: 'stream_event',
        sequence,
        payload: chunk,
      });
      sequence++;
      yield* toUniversalStreamChunks(chunk);
    }
    this.publishModelEffortOutcome(resolvedOptions);
  }

  /** What THIS vendor's models can do, per model (PROV-008). */
  capabilityTable(): IProviderCapabilityTable {
    return ANTHROPIC_CAPABILITY_TABLE;
  }

  override effortTable(): IProviderModelEffortTable | undefined {
    return this.endpointIsVendorDefault() ? ANTHROPIC_MODEL_EFFORT_TABLE : undefined;
  }

  /** CORE-043: a configured `baseURL` is a gateway, whose guarantees are not the vendor's. */
  endpointIsVendorDefault(): boolean {
    return this.options.baseURL === undefined;
  }

  private resolveEffortOptions(options: IChatOptions | undefined): IChatOptions | undefined {
    if (options?.effort === undefined || options.effortResolution !== undefined) return options;
    if (options.model === undefined) return options;
    return {
      ...options,
      effortResolution: resolveModelEffort(this.effortTable(), options.model, options.effort),
    };
  }

  private publishModelEffortOutcome(
    options: IChatOptions | undefined,
    opaqueReason?: string,
  ): void {
    const resolution = options?.effortResolution;
    const observer = options?.onModelEffortOutcome;
    if (resolution === undefined || observer === undefined) return;

    const nativeControl =
      opaqueReason !== undefined
        ? { state: 'omitted' as const, reason: opaqueReason }
        : resolution.effective !== null && resolution.disposition !== 'model-default'
          ? { state: 'sent' as const, id: 'output_config.effort' }
          : {
              state: 'omitted' as const,
              reason:
                resolution.disposition === 'model-default'
                  ? 'provider-default-selection'
                  : 'model-effort-not-applied',
            };
    const providerDispatch =
      opaqueReason !== undefined
        ? { state: 'not-dispatched' as const, reason: opaqueReason }
        : { state: 'sent' as const };
    try {
      observer(createModelEffortOutcome(resolution, { nativeControl, providerDispatch }));
    } catch (error) {
      this.logger.warn('Model-effort outcome observer failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  override supportsTools(): boolean {
    return true;
  }

  override getCapabilities(): IProviderCapabilities {
    return anthropicProviderCapabilities(this.enableWebTools);
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
