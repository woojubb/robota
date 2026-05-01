import OpenAI from 'openai';
import { AbstractAIProvider, SilentLogger } from '@robota-sdk/agent-core';
import type {
  IAssistantMessage,
  IChatOptions,
  TTextDeltaCallback,
  TUniversalMessage,
} from '@robota-sdk/agent-core';
import { isAssistantMessage } from '@robota-sdk/agent-core';
import {
  assembleOpenAICompatibleStream,
  convertToOpenAICompatibleMessages,
  convertToOpenAICompatibleTools,
  OpenAICompatibleResponseParser,
} from '@robota-sdk/agent-provider-openai-compatible';
import type { IOpenAICompatibleError } from '@robota-sdk/agent-provider-openai-compatible';
import type { IGemmaProviderOptions } from './types';
import { GemmaReasoningProjector, projectGemmaReasoningText } from './reasoning-projector';
import { createStreamTextMessage } from './message-factory';

export class GemmaProvider extends AbstractAIProvider {
  override readonly name = 'gemma';
  override readonly version = '1.0.0';

  private readonly client?: OpenAI;
  private readonly options: IGemmaProviderOptions;
  private readonly responseParser: OpenAICompatibleResponseParser;

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

    this.responseParser = new OpenAICompatibleResponseParser({ logger: this.logger });
  }

  override async chat(
    messages: TUniversalMessage[],
    options?: IChatOptions,
  ): Promise<TUniversalMessage> {
    this.validateMessages(messages);

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
      const rawContent = response.choices?.[0]?.message.content || '';
      const projection = projectGemmaReasoningText(rawContent);
      return withGemmaProjectionMetadata(
        {
          ...this.responseParser.parseResponse(response),
          content: projection.visibleText,
        },
        projection.rawText,
        projection.removedReasoning,
      );
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
      const projector = new GemmaReasoningProjector();

      for await (const chunk of this.streamWithAbort(stream, options?.signal)) {
        const choice = chunk.choices?.[0];
        if (!choice) {
          continue;
        }

        const toolCalls = this.responseParser.parseStreamingChunk(chunk);
        if (toolCalls !== null && isAssistantMessage(toolCalls) && toolCalls.toolCalls?.length) {
          yield toolCalls;
          continue;
        }

        const visibleContent = projector.project(choice.delta.content || '');
        if (visibleContent.length > 0) {
          yield createStreamTextMessage(visibleContent, choice.finish_reason);
        }
      }

      const flushedContent = projector.flush();
      if (flushedContent.length > 0) {
        yield createStreamTextMessage(flushedContent, null);
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
      });

      return withGemmaProjectionMetadata(result, projector.rawText, projector.removedReasoning);
    } catch (error) {
      const gemmaError = error as IOpenAICompatibleError;
      const errorMessage = gemmaError.message || 'Gemma streaming request failed';
      throw new Error(`Gemma stream failed: ${errorMessage}`);
    }
  }
}

function withGemmaProjectionMetadata(
  message: TUniversalMessage,
  rawContent: string,
  removedReasoning: boolean,
): TUniversalMessage {
  if (!removedReasoning) {
    return message;
  }

  return {
    ...message,
    metadata: {
      ...(message.metadata ?? {}),
      gemmaReasoningFiltered: true,
      gemmaRawContent: rawContent,
    },
  };
}
