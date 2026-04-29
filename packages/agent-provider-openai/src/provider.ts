import OpenAI from 'openai';
import type { IOpenAIProviderOptions } from './types';
import type { IOpenAIError } from './types/api-types';
import { AbstractAIProvider } from '@robota-sdk/agent-core';
import type {
  TUniversalMessage,
  IChatOptions,
  IAssistantMessage,
  TTextDeltaCallback,
} from '@robota-sdk/agent-core';
import type { IPayloadLogger } from './interfaces/payload-logger';
import { OpenAIResponseParser } from './parsers/response-parser';
import { SilentLogger } from '@robota-sdk/agent-core';
import { convertToOpenAIMessages, convertToOpenAITools } from './message-converter';
import { assembleOpenAIStream } from './streaming/stream-assembler';

/**
 * OpenAI provider implementation for Robota
 *
 * Provides integration with OpenAI's GPT models following BaseAIProvider guidelines.
 * Uses OpenAI SDK native types internally for optimal performance and feature support.
 *
 * @public
 */
export class OpenAIProvider extends AbstractAIProvider {
  override readonly name = 'openai';
  override readonly version = '1.0.0';

  private readonly client?: OpenAI;
  private readonly options: IOpenAIProviderOptions;
  private readonly payloadLogger: IPayloadLogger | undefined;
  private readonly responseParser: OpenAIResponseParser;

  /**
   * Optional callback for text deltas during streaming.
   * Set by the consumer (e.g., Session) to receive real-time text chunks.
   * When set, chat() uses streaming internally while still returning
   * the complete assembled message.
   */
  onTextDelta?: TTextDeltaCallback;

  constructor(options: IOpenAIProviderOptions) {
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
          ...(options.organization && { organization: options.organization }),
          ...(options.timeout && { timeout: options.timeout }),
          ...(options.baseURL && { baseURL: options.baseURL }),
        });
      } else {
        throw new Error('Either OpenAI client, apiKey, or executor is required');
      }
    }

    this.responseParser = new OpenAIResponseParser(this.logger);
    this.payloadLogger = options.payloadLogger;
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
          'OpenAI Provider executor chat error:',
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }
    }

    if (!this.client) {
      throw new Error(
        'OpenAI client not available. Either provide a client/apiKey or use an executor.',
      );
    }

    try {
      const openaiMessages = convertToOpenAIMessages(messages);

      const chatOptions = options;
      if (!chatOptions?.model) {
        throw new Error(
          'Model is required in chat options. Please specify a model in defaultModel configuration.',
        );
      }

      const requestParams: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
        model: chatOptions.model,
        messages: openaiMessages,
        ...(chatOptions.temperature !== undefined && { temperature: chatOptions.temperature }),
        ...(chatOptions.maxTokens && { max_tokens: chatOptions.maxTokens }),
        ...(chatOptions.tools && {
          tools: convertToOpenAITools(chatOptions.tools),
          tool_choice: 'auto',
        }),
      };

      const textDeltaCb = chatOptions.onTextDelta ?? this.onTextDelta;
      if (textDeltaCb) {
        return await this.chatWithStreamingAssembly(
          {
            ...requestParams,
            stream: true,
          },
          {
            ...chatOptions,
            onTextDelta: textDeltaCb,
          },
        );
      }

      if (this.payloadLogger?.isEnabled()) {
        const logData = {
          model: requestParams.model,
          messagesCount: openaiMessages.length,
          hasTools: !!requestParams.tools,
          temperature: requestParams.temperature ?? undefined,
          maxTokens: requestParams.max_tokens ?? undefined,
          timestamp: new Date().toISOString(),
        };
        await this.payloadLogger.logPayload(logData, 'chat');
      }

      const response = await this.client.chat.completions.create(requestParams);

      return this.responseParser.parseResponse(response);
    } catch (error) {
      const openaiError = error as IOpenAIError;
      const errorMessage = openaiError.message || 'OpenAI API request failed';
      throw new Error(`OpenAI chat failed: ${errorMessage}`);
    }
  }

  private async chatWithStreamingAssembly(
    requestParams: OpenAI.Chat.ChatCompletionCreateParamsStreaming,
    options: IChatOptions,
  ): Promise<TUniversalMessage> {
    if (!this.client) {
      throw new Error(
        'OpenAI client not available. Either provide a client/apiKey or use an executor.',
      );
    }

    try {
      if (this.payloadLogger?.isEnabled()) {
        const logData = {
          model: requestParams.model,
          messagesCount: requestParams.messages.length,
          hasTools: !!requestParams.tools,
          temperature: requestParams.temperature ?? undefined,
          maxTokens: requestParams.max_tokens ?? undefined,
          timestamp: new Date().toISOString(),
        };
        await this.payloadLogger.logPayload(logData, 'stream');
      }

      const stream = await this.client.chat.completions.create(
        requestParams,
        options.signal ? { signal: options.signal } : undefined,
      );

      return assembleOpenAIStream({
        stream,
        onTextDelta: options.onTextDelta,
        signal: options.signal,
      });
    } catch (error) {
      const openaiError = error as IOpenAIError;
      const errorMessage = openaiError.message || 'OpenAI streaming request failed';
      throw new Error(`OpenAI stream failed: ${errorMessage}`);
    }
  }

  override async *chatStream(
    messages: TUniversalMessage[],
    options?: IChatOptions,
  ): AsyncIterable<TUniversalMessage> {
    if (this.executor) {
      try {
        yield* this.executeStreamViaExecutorOrDirect(messages, options);
        return;
      } catch (error) {
        this.logger.error(
          'OpenAI Provider executor stream error:',
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }
    }

    if (!this.client) {
      throw new Error(
        'OpenAI client not available. Either provide a client/apiKey or use an executor.',
      );
    }

    try {
      const openaiMessages = convertToOpenAIMessages(messages);

      if (!options?.model) {
        throw new Error(
          'Model is required in chat options. Please specify a model in defaultModel configuration.',
        );
      }

      const requestParams: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
        model: options.model,
        messages: openaiMessages,
        stream: true,
        ...(options?.temperature !== undefined && { temperature: options.temperature }),
        ...(options?.maxTokens && { max_tokens: options.maxTokens }),
        ...(options?.tools && {
          tools: convertToOpenAITools(options.tools),
          tool_choice: 'auto',
        }),
      };

      if (this.payloadLogger?.isEnabled()) {
        const logData = {
          model: requestParams.model,
          messagesCount: openaiMessages.length,
          hasTools: !!requestParams.tools,
          temperature: requestParams.temperature ?? undefined,
          maxTokens: requestParams.max_tokens ?? undefined,
          timestamp: new Date().toISOString(),
        };
        await this.payloadLogger.logPayload(logData, 'stream');
      }

      const stream = await this.client.chat.completions.create(requestParams);

      for await (const chunk of stream) {
        const universalMessage = this.responseParser.parseStreamingChunk(chunk);
        if (universalMessage) {
          yield universalMessage;
        }
      }
    } catch (error) {
      const openaiError = error as IOpenAIError;
      const errorMessage = openaiError.message || 'OpenAI API request failed';
      throw new Error(`OpenAI stream failed: ${errorMessage}`);
    }
  }

  override supportsTools(): boolean {
    return true;
  }

  override validateConfig(): boolean {
    return !!this.client && !!this.options;
  }

  override async dispose(): Promise<void> {
    // OpenAI client doesn't need explicit cleanup
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
}
