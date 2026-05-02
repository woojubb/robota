import OpenAI from 'openai';
import { AbstractAIProvider, SilentLogger } from '@robota-sdk/agent-core';
import type { IChatOptions, TTextDeltaCallback, TUniversalMessage } from '@robota-sdk/agent-core';
import {
  assembleOpenAICompatibleStream,
  convertToOpenAICompatibleMessages,
  convertToOpenAICompatibleTools,
  OpenAICompatibleResponseParser,
} from '@robota-sdk/agent-provider-openai-compatible';
import type { IOpenAICompatibleError } from '@robota-sdk/agent-provider-openai-compatible';
import {
  DEFAULT_QWEN_PROVIDER_BASE_URL,
  DEFAULT_QWEN_PROVIDER_RESPONSES_BASE_URL,
} from './defaults';
import { hasQwenBuiltInWebTools } from './responses-converter';
import { chatStreamWithQwenResponsesApi, chatWithQwenResponsesApi } from './responses-chat';
import type { IQwenProviderOptions } from './types';

export class QwenProvider extends AbstractAIProvider {
  override readonly name = 'qwen';
  override readonly version = '1.0.0';

  private readonly client?: OpenAI;
  private readonly responsesClient?: OpenAI;
  private readonly options: IQwenProviderOptions;
  private readonly responseParser: OpenAICompatibleResponseParser;

  onTextDelta?: TTextDeltaCallback;

  constructor(options: IQwenProviderOptions) {
    super(options.logger || SilentLogger);
    this.options = options;

    if (options.executor) {
      this.executor = options.executor;
    }

    if (!this.executor) {
      if (options.client) {
        this.client = options.client;
        this.responsesClient = options.client;
      } else if (options.apiKey) {
        this.client = new OpenAI({
          apiKey: options.apiKey,
          baseURL: options.baseURL ?? DEFAULT_QWEN_PROVIDER_BASE_URL,
          ...(options.timeout !== undefined && { timeout: options.timeout }),
        });
        this.responsesClient = new OpenAI({
          apiKey: options.apiKey,
          baseURL: options.responsesBaseURL ?? DEFAULT_QWEN_PROVIDER_RESPONSES_BASE_URL,
          ...(options.timeout !== undefined && { timeout: options.timeout }),
        });
      } else {
        throw new Error('Either Qwen client, apiKey, or executor is required');
      }
    }

    this.responseParser = new OpenAICompatibleResponseParser({ logger: this.logger });
  }

  override async chat(
    messages: TUniversalMessage[],
    options?: IChatOptions,
  ): Promise<TUniversalMessage> {
    this.validateMessages(messages);

    if (this.executor) {
      return this.chatViaExecutor(messages, options);
    }

    if (this.shouldUseResponsesApi()) {
      return this.chatViaResponsesApi(messages, options, this.getResponsesClient());
    }

    return this.chatViaChatCompletions(messages, options, this.getClient());
  }

  private async chatViaExecutor(
    messages: TUniversalMessage[],
    options: IChatOptions | undefined,
  ): Promise<TUniversalMessage> {
    try {
      return await this.executeViaExecutorOrDirect(messages, options);
    } catch (error) {
      this.logger.error(
        'Qwen Provider executor chat error:',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  private async chatViaResponsesApi(
    messages: TUniversalMessage[],
    options: IChatOptions | undefined,
    client: OpenAI,
  ): Promise<TUniversalMessage> {
    this.validateTools(options?.tools);
    return chatWithQwenResponsesApi({
      client,
      messages,
      chatOptions: options,
      defaultModel: this.options.defaultModel,
      builtInWebTools: this.options.builtInWebTools,
      onTextDelta: this.onTextDelta,
    });
  }

  private async chatViaChatCompletions(
    messages: TUniversalMessage[],
    options: IChatOptions | undefined,
    client: OpenAI,
  ): Promise<TUniversalMessage> {
    try {
      const requestParams = this.buildRequestParams(messages, options);
      const textDeltaCb = options?.onTextDelta ?? this.onTextDelta;
      if (textDeltaCb) {
        return await this.chatWithStreamingAssembly(
          { ...requestParams, stream: true },
          { ...options, onTextDelta: textDeltaCb },
        );
      }

      const response = await client.chat.completions.create(requestParams);
      return this.responseParser.parseResponse(response);
    } catch (error) {
      const qwenError = error as IOpenAICompatibleError;
      const errorMessage = qwenError.message || 'Qwen API request failed';
      throw new Error(`Qwen chat failed: ${errorMessage}`);
    }
  }

  override async *chatStream(
    messages: TUniversalMessage[],
    options?: IChatOptions,
  ): AsyncIterable<TUniversalMessage> {
    this.validateMessages(messages);

    if (this.executor) {
      try {
        yield* this.executeStreamViaExecutorOrDirect(messages, options);
        return;
      } catch (error) {
        this.logger.error(
          'Qwen Provider executor stream error:',
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }
    }

    if (!this.client) {
      throw new Error(
        'Qwen client not available. Either provide a client/apiKey or use an executor.',
      );
    }

    if (this.shouldUseResponsesApi()) {
      this.validateTools(options?.tools);
      yield* chatStreamWithQwenResponsesApi({
        client: this.responsesClient,
        messages,
        chatOptions: options,
        defaultModel: this.options.defaultModel,
        builtInWebTools: this.options.builtInWebTools,
        onTextDelta: this.onTextDelta,
      });
      return;
    }

    try {
      const requestParams = this.buildStreamingRequestParams(messages, options);
      const stream = await this.client.chat.completions.create(requestParams);

      for await (const chunk of this.streamWithAbort(stream, options?.signal)) {
        const universalMessage = this.responseParser.parseStreamingChunk(chunk);
        if (universalMessage) {
          yield universalMessage;
        }
      }
    } catch (error) {
      const qwenError = error as IOpenAICompatibleError;
      const errorMessage = qwenError.message || 'Qwen API request failed';
      throw new Error(`Qwen stream failed: ${errorMessage}`);
    }
  }

  override supportsTools(): boolean {
    return true;
  }

  override validateConfig(): boolean {
    return (
      !!this.client && !!this.options && (!this.shouldUseResponsesApi() || !!this.responsesClient)
    );
  }

  override async dispose(): Promise<void> {
    // OpenAI-compatible Qwen clients do not need explicit cleanup.
  }

  private buildRequestParams(
    messages: TUniversalMessage[],
    options: IChatOptions | undefined,
  ): OpenAI.Chat.ChatCompletionCreateParamsNonStreaming {
    this.validateTools(options?.tools);
    const model = options?.model ?? this.options.defaultModel;
    if (!model) {
      throw new Error(
        'Model is required in chat options. Please specify a model in defaultModel configuration.',
      );
    }

    const requestParams = {
      model,
      messages: convertToOpenAICompatibleMessages(messages),
      ...(options?.temperature !== undefined && { temperature: options.temperature }),
      ...(options?.maxTokens !== undefined && { max_tokens: options.maxTokens }),
      ...(options?.tools && {
        tools: convertToOpenAICompatibleTools(options.tools),
        tool_choice: 'auto' as const,
      }),
    };

    return requestParams as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming;
  }

  private buildStreamingRequestParams(
    messages: TUniversalMessage[],
    options: IChatOptions | undefined,
  ): OpenAI.Chat.ChatCompletionCreateParamsStreaming {
    return {
      ...this.buildRequestParams(messages, options),
      stream: true,
    } as OpenAI.Chat.ChatCompletionCreateParamsStreaming;
  }

  private shouldUseResponsesApi(): boolean {
    return hasQwenBuiltInWebTools(this.options.builtInWebTools);
  }

  private getClient(): OpenAI {
    if (!this.client) {
      throw new Error(
        'Qwen client not available. Either provide a client/apiKey or use an executor.',
      );
    }

    return this.client;
  }

  private getResponsesClient(): OpenAI {
    if (!this.responsesClient) {
      throw new Error('Qwen Responses client not available for built-in web tools.');
    }

    return this.responsesClient;
  }

  private async chatWithStreamingAssembly(
    requestParams: OpenAI.Chat.ChatCompletionCreateParamsStreaming,
    options: IChatOptions,
  ): Promise<TUniversalMessage> {
    if (!this.client) {
      throw new Error(
        'Qwen client not available. Either provide a client/apiKey or use an executor.',
      );
    }

    try {
      const stream = await this.client.chat.completions.create(
        requestParams,
        options.signal ? { signal: options.signal } : undefined,
      );

      return assembleOpenAICompatibleStream({
        stream,
        onTextDelta: options.onTextDelta,
        signal: options.signal,
      });
    } catch (error) {
      const qwenError = error as IOpenAICompatibleError;
      const errorMessage = qwenError.message || 'Qwen streaming request failed';
      throw new Error(`Qwen stream failed: ${errorMessage}`);
    }
  }
}
