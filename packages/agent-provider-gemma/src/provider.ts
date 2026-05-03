import OpenAI from 'openai';
import { AbstractAIProvider, SilentLogger } from '@robota-sdk/agent-core';
import type {
  IAssistantMessage,
  IChatOptions,
  IProviderCapabilities,
  TTextDeltaCallback,
  TUniversalMessage,
} from '@robota-sdk/agent-core';
import {
  assembleOpenAICompatibleStream,
  convertToOpenAICompatibleMessages,
  convertToOpenAICompatibleTools,
} from '@robota-sdk/agent-provider-openai-compatible';
import type { IOpenAICompatibleError } from '@robota-sdk/agent-provider-openai-compatible';
import type { IGemmaProviderOptions } from './types';
import { GemmaReasoningProjector } from './reasoning-projector';
import { createGemmaToolCallProjector } from './tool-call-projector';
import { parseGemmaChatCompletion, withGemmaProjectionMetadata } from './provider-projection';
import {
  createGemmaStreamProjectionState,
  flushGemmaStreamProjection,
  projectGemmaStreamChunk,
} from './streaming-projection';

export class GemmaProvider extends AbstractAIProvider {
  override readonly name = 'gemma';
  override readonly version = '1.0.0';

  private readonly client?: OpenAI;
  private readonly options: IGemmaProviderOptions;

  onTextDelta?: TTextDeltaCallback;

  constructor(options: IGemmaProviderOptions) {
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
          ...(options.baseURL !== undefined && { baseURL: options.baseURL }),
          ...(options.timeout !== undefined && { timeout: options.timeout }),
        });
      } else {
        throw new Error('Either Gemma client, apiKey, or executor is required');
      }
    }
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
          'Gemma Provider executor chat error:',
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }
    }

    if (!this.client) {
      throw new Error(
        'Gemma client not available. Either provide a client/apiKey or use an executor.',
      );
    }

    try {
      const requestParams = this.buildRequestParams(messages, options);
      const textDeltaCb = options?.onTextDelta ?? this.onTextDelta;
      if (textDeltaCb) {
        return await this.chatWithStreamingAssembly(
          {
            ...requestParams,
            stream: true,
          },
          {
            ...options,
            onTextDelta: textDeltaCb,
          },
        );
      }

      const response = await this.client.chat.completions.create(requestParams);
      return parseGemmaChatCompletion(response, this.logger, options);
    } catch (error) {
      const gemmaError = error as IOpenAICompatibleError;
      const errorMessage = gemmaError.message || 'Gemma API request failed';
      throw new Error(`Gemma chat failed: ${errorMessage}`);
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
          'Gemma Provider executor stream error:',
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }
    }

    if (!this.client) {
      throw new Error(
        'Gemma client not available. Either provide a client/apiKey or use an executor.',
      );
    }

    try {
      const requestParams = this.buildStreamingRequestParams(messages, options);
      const stream = await this.client.chat.completions.create(requestParams);
      const projectionState = createGemmaStreamProjectionState(this.logger, options?.tools);

      for await (const chunk of this.streamWithAbort(stream, options?.signal)) {
        for (const message of projectGemmaStreamChunk(chunk, projectionState)) {
          yield message;
        }
      }

      for (const message of flushGemmaStreamProjection(projectionState)) {
        yield message;
      }
    } catch (error) {
      const gemmaError = error as IOpenAICompatibleError;
      const errorMessage = gemmaError.message || 'Gemma API request failed';
      throw new Error(`Gemma stream failed: ${errorMessage}`);
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
            'Gemma OpenAI-compatible endpoints support declared function tools, not provider-native web search.',
        },
        webFetch: {
          supported: false,
          enabled: false,
          source: 'openai-compatible-chat-completions',
          reason:
            'Gemma OpenAI-compatible endpoints support declared function tools, not provider-native web fetch.',
        },
      },
    };
  }

  override validateConfig(): boolean {
    return !!this.client && !!this.options;
  }

  override async dispose(): Promise<void> {
    // OpenAI-compatible local clients do not need explicit cleanup.
  }

  protected override validateMessages(messages: TUniversalMessage[]): void {
    super.validateMessages(messages);

    for (const message of messages) {
      if (message.role === 'assistant') {
        const assistantMsg = message as IAssistantMessage;
        if (
          assistantMsg.toolCalls &&
          assistantMsg.toolCalls.length > 0 &&
          assistantMsg.content === ''
        ) {
          continue;
        }
      }
    }
  }

  private buildRequestParams(
    messages: TUniversalMessage[],
    options: IChatOptions | undefined,
  ): OpenAI.Chat.ChatCompletionCreateParamsNonStreaming {
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

  private async chatWithStreamingAssembly(
    requestParams: OpenAI.Chat.ChatCompletionCreateParamsStreaming,
    options: IChatOptions,
  ): Promise<TUniversalMessage> {
    if (!this.client) {
      throw new Error(
        'Gemma client not available. Either provide a client/apiKey or use an executor.',
      );
    }

    try {
      const stream = await this.client.chat.completions.create(
        requestParams,
        options.signal ? { signal: options.signal } : undefined,
      );
      const projector = new GemmaReasoningProjector();
      const result = await assembleOpenAICompatibleStream({
        stream,
        onTextDelta: options.onTextDelta,
        signal: options.signal,
        textProjector: (text) => projector.project(text),
        textProjectorFlush: () => projector.flush(),
        toolCallTextProjector: createGemmaToolCallProjector(options.tools),
      });

      return withGemmaProjectionMetadata(result, projector.rawText, projector.removedReasoning);
    } catch (error) {
      const gemmaError = error as IOpenAICompatibleError;
      const errorMessage = gemmaError.message || 'Gemma streaming request failed';
      throw new Error(`Gemma stream failed: ${errorMessage}`);
    }
  }
}
