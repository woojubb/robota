import { AbstractAIProvider, SilentLogger } from '@robota-sdk/agent-core';
import OpenAI from 'openai';

import { DEEPSEEK_PROVIDER_CAPABILITIES } from './capabilities';
import { DEFAULT_DEEPSEEK_PROVIDER_BASE_URL } from './defaults';
import { DEEPSEEK_MODEL_CATALOG } from './model-catalog';
import {
  assembleOpenAICompatibleStream,
  buildOpenAICompatibleRequestParams,
  observeProviderNativeRawPayloadStream,
  OpenAICompatibleResponseParser,
} from '../shared/openai-compatible/index.js';

import type {
  IDeepSeekProviderOptions,
  IDeepSeekThinkingConfig,
  TDeepSeekReasoningEffort,
} from './types';
import type { IOpenAICompatibleError } from '../shared/openai-compatible/index.js';
import type {
  IChatOptions,
  IProviderCapabilities,
  IProviderModelCatalog,
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
        return await this.executeViaExecutorOrDirect(messages, options);
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
      return this.responseParser.parseResponse(response);
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
        yield* this.executeStreamViaExecutorOrDirect(messages, options);
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
      const stream = await client.chat.completions.create(
        requestParams as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
      );
      const observedStream = observeProviderNativeRawPayloadStream(stream, {
        provider: 'deepseek',
        apiSurface: 'chat-completions',
        onProviderNativeRawPayload: options?.onProviderNativeRawPayload,
      });

      for await (const chunk of this.streamWithAbort(observedStream, options?.signal)) {
        const universalMessage = this.responseParser.parseStreamingChunk(chunk);
        if (universalMessage) {
          yield universalMessage;
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
   * now `modelCatalog()`, which the execution seam asks before offering any.
   */
  override supportsTools(): boolean {
    return true;
  }

  modelCatalog(): IProviderModelCatalog {
    return DEEPSEEK_MODEL_CATALOG;
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

  private buildRequestParams(
    messages: TUniversalMessage[],
    options: IChatOptions | undefined,
  ): TDeepSeekChatCompletionCreateParamsNonStreaming {
    this.validateTools(options?.tools);

    return {
      ...buildOpenAICompatibleRequestParams({
        messages,
        options,
        defaultModel: this.options.defaultModel,
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
      const stream = await client.chat.completions.create(
        requestParams as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
        options.signal ? { signal: options.signal } : undefined,
      );

      return assembleOpenAICompatibleStream({
        stream: observeProviderNativeRawPayloadStream(stream, {
          provider: 'deepseek',
          apiSurface: 'chat-completions',
          onProviderNativeRawPayload: options.onProviderNativeRawPayload,
        }),
        onTextDelta: options.onTextDelta,
        signal: options.signal,
      });
    } catch (error) {
      const deepSeekError = error as IOpenAICompatibleError;
      const errorMessage = deepSeekError.message || 'DeepSeek streaming request failed';
      throw new Error(`DeepSeek stream failed: ${errorMessage}`);
    }
  }
}
