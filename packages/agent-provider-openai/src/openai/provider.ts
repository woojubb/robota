import { AbstractAIProvider } from '@robota-sdk/agent-core';
import { createModelEffortOutcome } from '@robota-sdk/agent-core';
import { resolveModelEffort } from '@robota-sdk/agent-core';
import { SilentLogger } from '@robota-sdk/agent-core';
import OpenAI from 'openai';

import {
  chatStreamWithOpenAIChatCompletions,
  chatWithOpenAIChatCompletions,
} from './chat-completions-chat';
import { OPENAI_MODEL_EFFORT_TABLE } from './model-effort-table';
import { OpenAIResponseParser } from './parsers/response-parser';
import { chatStreamWithOpenAIResponsesApi, chatWithOpenAIResponsesApi } from './responses-chat';

import type { IPayloadLogger } from './interfaces/payload-logger';
import type { IOpenAIProviderOptions, TOpenAIApiSurface } from './types';
import type {
  TUniversalMessage,
  IChatOptions,
  IAssistantMessage,
  IProviderCapabilities,
  IProviderModelEffortTable,
  TTextDeltaCallback,
} from '@robota-sdk/agent-core';

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
    const resolvedOptions = this.resolveEffortOptions(options);

    if (this.executor) {
      try {
        const result = await this.executeViaExecutorOrDirect(messages, resolvedOptions);
        if (result.modelEffortOutcome === undefined) {
          this.publishModelEffortOutcome(resolvedOptions, 'opaque-executor');
        }
        return result.message;
      } catch (error) {
        this.logger.error(
          'OpenAI Provider executor chat error:',
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }
    }

    if (this.apiSurface === 'responses') {
      const response = await chatWithOpenAIResponsesApi({
        client: this.client,
        messages,
        chatOptions: resolvedOptions,
        providerOptions: this.options,
        onTextDelta: this.onTextDelta,
      });
      this.publishModelEffortOutcome(resolvedOptions);
      return response;
    }

    const response = await chatWithOpenAIChatCompletions({
      client: this.client,
      messages,
      chatOptions: resolvedOptions,
      providerOptions: this.options,
      payloadLogger: this.payloadLogger,
      responseParser: this.responseParser,
      onTextDelta: this.onTextDelta,
    });
    this.publishModelEffortOutcome(resolvedOptions);
    return response;
  }

  override async *chatStream(
    messages: TUniversalMessage[],
    options?: IChatOptions,
  ): AsyncIterable<TUniversalMessage> {
    this.validateNativeWebTools(options?.nativeWebTools);
    const resolvedOptions = this.resolveEffortOptions(options);

    if (this.executor) {
      try {
        let executorOutcomeSeen = false;
        for await (const event of this.executeStreamViaExecutorOrDirect(
          messages,
          resolvedOptions,
        )) {
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
      } catch (error) {
        this.logger.error(
          'OpenAI Provider executor stream error:',
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }
    }

    yield* this.streamDirect(messages, resolvedOptions);
  }

  private async *streamDirect(
    messages: TUniversalMessage[],
    resolvedOptions: IChatOptions | undefined,
  ): AsyncIterable<TUniversalMessage> {
    if (this.apiSurface === 'responses') {
      yield* chatStreamWithOpenAIResponsesApi({
        client: this.client,
        messages,
        chatOptions: resolvedOptions,
        providerOptions: this.options,
        onTextDelta: this.onTextDelta,
      });
      this.publishModelEffortOutcome(resolvedOptions);
      return;
    }

    yield* chatStreamWithOpenAIChatCompletions({
      client: this.client,
      messages,
      chatOptions: resolvedOptions,
      providerOptions: this.options,
      payloadLogger: this.payloadLogger,
      responseParser: this.responseParser,
      onTextDelta: this.onTextDelta,
    });
    this.publishModelEffortOutcome(resolvedOptions);
  }

  /**
   * CORE-043: this provider declares no capability table — nobody has verified one for OpenAI, and
   * inventing one would be a fabricated claim. It can still answer THIS question honestly, which is
   * why the endpoint signal is not a field on the table.
   *
   * It matters most here of all the providers: setting `baseURL` also switches the API surface to
   * `chat-completions` (see `resolveApiSurface`), so the advertised gateway configuration is exactly
   * the one where a structured request is least likely to be enforced by whatever is on the far end.
   */
  endpointIsVendorDefault(): boolean {
    return this.options.baseURL === undefined;
  }

  override effortTable(): IProviderModelEffortTable | undefined {
    return this.endpointIsVendorDefault() && this.apiSurface === 'responses'
      ? OPENAI_MODEL_EFFORT_TABLE
      : undefined;
  }

  private resolveEffortOptions(options: IChatOptions | undefined): IChatOptions | undefined {
    if (options?.effort === undefined || options.effortResolution !== undefined) return options;
    const model = options.model ?? this.options.defaultModel;
    if (model === undefined) return options;
    return {
      ...options,
      effortResolution: resolveModelEffort(this.effortTable(), model, options.effort),
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
          ? { state: 'sent' as const, id: 'responses.reasoning.effort' }
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
