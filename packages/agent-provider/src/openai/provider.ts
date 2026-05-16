import OpenAI from 'openai';
import type { IOpenAIProviderOptions, TOpenAIApiSurface } from './types';
import { AbstractAIProvider } from '@robota-sdk/agent-core';
import type {
  TUniversalMessage,
  IChatOptions,
  IAssistantMessage,
  IProviderCapabilities,
  TTextDeltaCallback,
} from '@robota-sdk/agent-core';
import type { IPayloadLogger } from './interfaces/payload-logger';
import { OpenAIResponseParser } from './parsers/response-parser';
import { SilentLogger } from '@robota-sdk/agent-core';
import {
  chatStreamWithOpenAIChatCompletions,
  chatWithOpenAIChatCompletions,
} from './chat-completions-chat';
import { chatStreamWithOpenAIResponsesApi, chatWithOpenAIResponsesApi } from './responses-chat';

/**
 * OpenAI provider implementation for Robota
 *
 * Provides integration with OpenAI models through the Robota provider contract.
 * Uses OpenAI SDK native types internally for optimal performance and feature support.
 *
 * @public
 */
export class OpenAIProvider extends AbstractAIProvider {
  override readonly name = 'openai';
  override readonly version = '1.0.0';

  private readonly client?: OpenAI;
  private readonly options: IOpenAIProviderOptions;
  private readonly apiSurface: TOpenAIApiSurface;
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
    this.apiSurface = resolveApiSurface(options);
    validateOpenAIProviderNativeWebTools(this.apiSurface, options.nativeWebTools);

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
    this.validateNativeWebTools(options?.nativeWebTools);

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

    if (this.apiSurface === 'responses') {
      return chatWithOpenAIResponsesApi({
        client: this.client,
        messages,
        chatOptions: options,
        providerOptions: this.options,
        onTextDelta: this.onTextDelta,
      });
    }

    return chatWithOpenAIChatCompletions({
      client: this.client,
      messages,
      chatOptions: options,
      providerOptions: this.options,
      payloadLogger: this.payloadLogger,
      responseParser: this.responseParser,
      onTextDelta: this.onTextDelta,
    });
  }

  override async *chatStream(
    messages: TUniversalMessage[],
    options?: IChatOptions,
  ): AsyncIterable<TUniversalMessage> {
    this.validateNativeWebTools(options?.nativeWebTools);

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

    if (this.apiSurface === 'responses') {
      yield* chatStreamWithOpenAIResponsesApi({
        client: this.client,
        messages,
        chatOptions: options,
        providerOptions: this.options,
        onTextDelta: this.onTextDelta,
      });
      return;
    }

    yield* chatStreamWithOpenAIChatCompletions({
      client: this.client,
      messages,
      chatOptions: options,
      providerOptions: this.options,
      payloadLogger: this.payloadLogger,
      responseParser: this.responseParser,
      onTextDelta: this.onTextDelta,
    });
  }

  override supportsTools(): boolean {
    return true;
  }

  override getCapabilities(): IProviderCapabilities {
    const source =
      this.apiSurface === 'chat-completions'
        ? 'openai-compatible-chat-completions'
        : 'openai-responses';
    return {
      functionCalling: { supported: true },
      nativeWebTools: {
        webSearch: {
          supported: false,
          enabled: false,
          source,
          reason: getOpenAIUnsupportedNativeWebReason(this.apiSurface, 'search'),
        },
        webFetch: {
          supported: false,
          enabled: false,
          source,
          reason: getOpenAIUnsupportedNativeWebReason(this.apiSurface, 'fetch'),
        },
      },
    };
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

function resolveApiSurface(options: IOpenAIProviderOptions): TOpenAIApiSurface {
  if (options.apiSurface !== undefined) {
    return options.apiSurface;
  }
  return options.baseURL ? 'chat-completions' : 'responses';
}

function getOpenAIUnsupportedNativeWebReason(
  apiSurface: TOpenAIApiSurface,
  toolKind: 'search' | 'fetch',
): string {
  if (apiSurface === 'chat-completions') {
    return `OpenAI-compatible Chat Completions endpoints support declared function tools, not provider-native web ${toolKind}.`;
  }
  return `OpenAI Responses native web ${toolKind} is not wired in this Robota provider version.`;
}

function validateOpenAIProviderNativeWebTools(
  apiSurface: TOpenAIApiSurface,
  nativeWebTools: IOpenAIProviderOptions['nativeWebTools'],
): void {
  if (nativeWebTools?.webSearch !== true && nativeWebTools?.webFetch !== true) {
    return;
  }
  throw new Error(
    `Provider openai native web search/fetch is not supported for apiSurface ${apiSurface} in this Robota provider version.`,
  );
}
