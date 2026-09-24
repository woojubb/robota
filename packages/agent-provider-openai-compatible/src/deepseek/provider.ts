import {
  AbstractAIProvider,
  PERMISSIVE_TOOL_SCHEMA_PROFILE,
  SilentLogger,
} from '@robota-sdk/agent-core';
import OpenAI from 'openai';

import { DEEPSEEK_PROVIDER_CAPABILITIES } from './capabilities';
import { DEEPSEEK_CAPABILITY_TABLE } from './capability-table';
import { DEFAULT_DEEPSEEK_PROVIDER_BASE_URL } from './defaults';
import {
  assembleOpenAICompatibleStream,
  buildOpenAICompatibleRequestParams,
  observeProviderNativeRawPayloadStream,
  OpenAICompatibleResponseParser,
} from '../shared/openai-compatible/index.js';
import { awaitWithProviderRequestId, readOpenAICompatibleRequestId, withProviderRequestId } from '../shared/openai-compatible/request-id.js';

import type {
  IDeepSeekProviderOptions,
  IDeepSeekThinkingConfig,
  TDeepSeekReasoningEffort,
} from './types';
import type { IOpenAICompatibleError } from '../shared/openai-compatible/index.js';
import type {
  IChatOptions,
  IProviderCapabilities,
  IProviderCapabilityTable,
  IToolSchemaProjectionProfile,
  TTextDeltaCallback,
  TUniversalMessage,
} from '@robota-sdk/agent-core';

type TDeepSeekChatCompletionCreateParamsNonStreaming = Omit<
  OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
  'reasoning_effort'
> & {
  thinking?: IDeepSeekThinkingConfig;
  reasoning_effort?: TDeepSeekReasoningEffort;
};

type TDeepSeekChatCompletionCreateParamsStreaming = Omit<
  OpenAI.Chat.ChatCompletionCreateParamsStreaming,
  'reasoning_effort'
> & {
  thinking?: IDeepSeekThinkingConfig;
  reasoning_effort?: TDeepSeekReasoningEffort;
};

export class DeepSeekProvider extends AbstractAIProvider {
  override readonly name = 'deepseek';
  override readonly version = '1.0.0';

  private readonly client?: OpenAI;
  private readonly options: IDeepSeekProviderOptions;
  private readonly responseParser: OpenAICompatibleResponseParser;

  onTextDelta?: TTextDeltaCallback;

  constructor(options: IDeepSeekProviderOptions) {
    super(options.logger || SilentLogger);
    this.options = options;

    if (options.executor) {
      this.executor = options.executor;
    }

    if (!this.executor) {
      if (options.client) {
        this.client = options.client;
      } else if (options.apiKey) {
        this.client = new OpenAI({
          apiKey: options.apiKey,
          baseURL: options.baseURL ?? DEFAULT_DEEPSEEK_PROVIDER_BASE_URL,
          ...(options.timeout !== undefined && { timeout: options.timeout }),
        });
      } else {
        throw new Error('Either DeepSeek client, apiKey, or executor is required');
      }
    }

    this.responseParser = new OpenAICompatibleResponseParser({ logger: this.logger });
  }

  override async chat(
    messages: TUniversalMessage[],
    options?: IChatOptions,
  ): Promise<TUniversalMessage> {
    this.validateMessages(messages);
    this.validateNativeWebTools(options?.nativeWebTools);

    if (this.executor) {
      try {
        return (await this.executeViaExecutorOrDirect(messages, options)).message;
      } catch (error) {
        this.logger.error(
          'DeepSeek Provider executor chat error:',
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }
    }

    const client = this.getClient();

    try {
      const requestParams = this.buildRequestParams(messages, options);
      const textDeltaCb = options?.onTextDelta ?? this.onTextDelta;
      if (textDeltaCb) {
        return await this.chatWithStreamingAssembly(
          { ...requestParams, stream: true },
          { ...options, onTextDelta: textDeltaCb },
        );
      }

      options?.onProviderNativeRawPayload?.({
        provider: 'deepseek',
        apiSurface: 'chat-completions',
        payloadKind: 'request',
        payload: requestParams,
      });
      const response = await client.chat.completions.create(
        requestParams as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
      );
      options?.onProviderNativeRawPayload?.({
        provider: 'deepseek',
        apiSurface: 'chat-completions',
        payloadKind: 'response',
        payload: response,
      });
      return withProviderRequestId(
        this.responseParser.parseResponse(response),
        readOpenAICompatibleRequestId(response),
      );
    } catch (error) {
      const deepSeekError = error as IOpenAICompatibleError;
      const errorMessage = deepSeekError.message || 'DeepSeek API request failed';
      throw new Error(`DeepSeek chat failed: ${errorMessage}`);
    }
  }

  override async *chatStream(
    messages: TUniversalMessage[],
    options?: IChatOptions,
  ): AsyncIterable<TUniversalMessage> {
    this.validateMessages(messages);
    this.validateNativeWebTools(options?.nativeWebTools);

    if (this.executor) {
      try {
        for await (const event of this.executeStreamViaExecutorOrDirect(messages, options)) {
          if (event.kind === 'message') yield event.message;
        }
        return;
      } catch (error) {
        this.logger.error(
          'DeepSeek Provider executor stream error:',
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }
    }

    const client = this.getClient();

    try {
      const requestParams = this.buildStreamingRequestParams(messages, options);
      options?.onProviderNativeRawPayload?.({
        provider: 'deepseek',
        apiSurface: 'chat-completions',
        payloadKind: 'request',
        payload: requestParams,
      });
      const { data: stream, providerRequestId } = await awaitWithProviderRequestId(
        client.chat.completions.create(
          requestParams as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
        ),
      );
      const observedStream = observeProviderNativeRawPayloadStream(stream, {
        provider: 'deepseek',
        apiSurface: 'chat-completions',
        onProviderNativeRawPayload: options?.onProviderNativeRawPayload,
      });

      for await (const chunk of this.streamWithAbort(observedStream, options?.signal)) {
        const universalMessage = this.responseParser.parseStreamingChunk(chunk);
        if (universalMessage) {
          yield withProviderRequestId(universalMessage, providerRequestId);
        }
      }
    } catch (error) {
      const deepSeekError = error as IOpenAICompatibleError;
      const errorMessage = deepSeekError.message || 'DeepSeek API request failed';
      throw new Error(`DeepSeek stream failed: ${errorMessage}`);
    }
  }

  /**
   * PROV-006: this answers for the VENDOR — deepseek does support function calling — which is all a
   * provider-granular boolean can honestly say. It used to be the only answer anything read, while
   * this package's own catalog said `deepseek-reasoner` has no `tools`; the per-MODEL question is
   * now `capabilityTable()`, which the execution seam asks before offering any.
   */
  override supportsTools(): boolean {
    return true;
  }

  capabilityTable(): IProviderCapabilityTable {
    return DEEPSEEK_CAPABILITY_TABLE;
  }

  /**
   * CORE-043: compared against the vendor default rather than merely checked for presence — passing
   * DeepSeek's own URL explicitly is not a gateway, and reporting it as one would make the signal
   * noise.
   */
  endpointIsVendorDefault(): boolean {
    const configured = this.options.baseURL;
    return configured === undefined || configured === DEFAULT_DEEPSEEK_PROVIDER_BASE_URL;
  }

  override getCapabilities(): IProviderCapabilities {
    return DEEPSEEK_PROVIDER_CAPABILITIES;
  }

  override validateConfig(): boolean {
    return !!this.client && !!this.options;
  }

  override async dispose(): Promise<void> {
    // OpenAI-compatible DeepSeek clients do not need explicit cleanup.
  }

  /**
   * MCP-005: deepseek accepts standard JSON Schema — the permissive profile.
   */
  protected override projectionProfile(): IToolSchemaProjectionProfile | undefined {
    return { ...PERMISSIVE_TOOL_SCHEMA_PROFILE, providerName: 'deepseek' };
  }

  /**
   * Project `options.tools` before the shared `buildOpenAICompatibleRequestParams`
   * (`request-builder.ts:78-79`) reaches them — `options.tools` itself is never mutated.
   */
  private projectChatOptions(options: IChatOptions | undefined): IChatOptions | undefined {
    if (!options?.tools) {
      return options;
    }
    const model = options.model ?? this.options.defaultModel ?? '';
    const projected = this.projectTools(options.tools, model);
    return { ...options, tools: projected && projected.length > 0 ? projected : undefined };
  }

  private buildRequestParams(
    messages: TUniversalMessage[],
    options: IChatOptions | undefined,
  ): TDeepSeekChatCompletionCreateParamsNonStreaming {
    this.validateTools(options?.tools);

    return {
      ...buildOpenAICompatibleRequestParams({
        messages,
        options: this.projectChatOptions(options),
        defaultModel: this.options.defaultModel,
        capabilityTable: this.capabilityTable(),
      }),
      ...(this.options.thinking !== undefined && {
        thinking: { type: this.options.thinking },
      }),
      ...(this.options.reasoningEffort !== undefined && {
        reasoning_effort: this.options.reasoningEffort,
      }),
    };
  }

  private buildStreamingRequestParams(
    messages: TUniversalMessage[],
    options: IChatOptions | undefined,
  ): TDeepSeekChatCompletionCreateParamsStreaming {
    return {
      ...this.buildRequestParams(messages, options),
      stream: true,
    };
  }

  private getClient(): OpenAI {
    if (!this.client) {
      throw new Error(
        'DeepSeek client not available. Either provide a client/apiKey or use an executor.',
      );
    }

    return this.client;
  }

  private async chatWithStreamingAssembly(
    requestParams: TDeepSeekChatCompletionCreateParamsStreaming,
    options: IChatOptions,
  ): Promise<TUniversalMessage> {
    const client = this.getClient();

    try {
      options.onProviderNativeRawPayload?.({
        provider: 'deepseek',
        apiSurface: 'chat-completions',
        payloadKind: 'request',
        payload: requestParams,
      });
      const { data: stream, providerRequestId } = await awaitWithProviderRequestId(
        client.chat.completions.create(
          requestParams as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
          options.signal ? { signal: options.signal } : undefined,
        ),
      );

      const assembled = await assembleOpenAICompatibleStream({
        stream: observeProviderNativeRawPayloadStream(stream, {
          provider: 'deepseek',
          apiSurface: 'chat-completions',
          onProviderNativeRawPayload: options.onProviderNativeRawPayload,
        }),
        onTextDelta: options.onTextDelta,
        signal: options.signal,
      });
      return withProviderRequestId(assembled, providerRequestId);
    } catch (error) {
      const deepSeekError = error as IOpenAICompatibleError;
      const errorMessage = deepSeekError.message || 'DeepSeek streaming request failed';
      throw new Error(`DeepSeek stream failed: ${errorMessage}`);
    }
  }
}
