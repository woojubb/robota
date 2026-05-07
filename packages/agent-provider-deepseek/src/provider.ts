import OpenAI from 'openai';
import { AbstractAIProvider, SilentLogger } from '@robota-sdk/agent-core';
import type {
  IChatOptions,
  IProviderCapabilities,
  TTextDeltaCallback,
  TUniversalMessage,
} from '@robota-sdk/agent-core';
import {
  assembleOpenAICompatibleStream,
  convertToOpenAICompatibleMessages,
  convertToOpenAICompatibleTools,
  observeProviderNativeRawPayloadStream,
  OpenAICompatibleResponseParser,
} from '@robota-sdk/agent-provider-openai-compatible';
import type { IOpenAICompatibleError } from '@robota-sdk/agent-provider-openai-compatible';
import { DEFAULT_DEEPSEEK_PROVIDER_BASE_URL } from './defaults';
import type {
  IDeepSeekProviderOptions,
  IDeepSeekThinkingConfig,
  TDeepSeekReasoningEffort,
} from './types';

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

  override supportsTools(): boolean {
    return true;
  }

  override getCapabilities(): IProviderCapabilities {
    return {
      functionCalling: { supported: true },
      nativeWebTools: {
        webSearch: {
          supported: false,
          enabled: false,
          source: 'openai-compatible-chat-completions',
          reason:
            'DeepSeek OpenAI-compatible Chat Completions supports declared function tools, not provider-native web search.',
        },
        webFetch: {
          supported: false,
          enabled: false,
          source: 'openai-compatible-chat-completions',
          reason:
            'DeepSeek OpenAI-compatible Chat Completions supports declared function tools, not provider-native web fetch.',
        },
      },
    };
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
    const model = options?.model ?? this.options.defaultModel;
    if (!model) {
      throw new Error(
        'Model is required in chat options. Please specify a model in defaultModel configuration.',
      );
    }

    return {
      model,
      messages: convertToOpenAICompatibleMessages(messages),
      ...(options?.temperature !== undefined && { temperature: options.temperature }),
      ...(options?.maxTokens !== undefined && { max_tokens: options.maxTokens }),
      ...(options?.tools && {
        tools: convertToOpenAICompatibleTools(options.tools),
        tool_choice: 'auto' as const,
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
