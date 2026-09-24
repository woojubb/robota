import {
  AbstractAIProvider,
  PERMISSIVE_TOOL_SCHEMA_PROFILE,
  SilentLogger,
} from '@robota-sdk/agent-core';
import OpenAI from 'openai';

import { parseGemmaChatCompletion, withGemmaProjectionMetadata } from './provider-projection';
import { GemmaReasoningProjector } from './reasoning-projector';
import {
  createGemmaStreamProjectionState,
  flushGemmaStreamProjection,
  projectGemmaStreamChunk,
} from './streaming-projection';
import { createGemmaToolCallProjector } from './tool-call-projector';
import {
  assembleOpenAICompatibleStream,
  awaitWithProviderRequestId,
  buildOpenAICompatibleRequestParams,
  observeProviderNativeRawPayloadStream,
  readOpenAICompatibleRequestId,
  withProviderRequestId,
} from '../shared/openai-compatible/index.js';

import type { IGemmaProviderOptions } from './types';
import type { IOpenAICompatibleError } from '../shared/openai-compatible/index.js';
import type {
  IAssistantMessage,
  IChatOptions,
  IProviderCapabilities,
  IToolSchemaProjectionProfile,
  TTextDeltaCallback,
  TUniversalMessage,
} from '@robota-sdk/agent-core';

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
        return (await this.executeViaExecutorOrDirect(messages, options)).message;
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

      options?.onProviderNativeRawPayload?.({
        provider: 'gemma',
        apiSurface: 'chat-completions',
        payloadKind: 'request',
        payload: requestParams,
      });
      const response = await this.client.chat.completions.create(requestParams);
      options?.onProviderNativeRawPayload?.({
        provider: 'gemma',
        apiSurface: 'chat-completions',
        payloadKind: 'response',
        payload: response,
      });
      return withProviderRequestId(
        parseGemmaChatCompletion(response, this.logger, options),
        readOpenAICompatibleRequestId(response),
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
    this.validateNativeWebTools(options?.nativeWebTools);

    if (this.executor) {
      try {
        for await (const event of this.executeStreamViaExecutorOrDirect(messages, options)) {
          if (event.kind === 'message') yield event.message;
        }
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
      options?.onProviderNativeRawPayload?.({
        provider: 'gemma',
        apiSurface: 'chat-completions',
        payloadKind: 'request',
        payload: requestParams,
      });
      const { data: stream, providerRequestId } = await awaitWithProviderRequestId(
        this.client.chat.completions.create(requestParams),
      );
      const projectionState = createGemmaStreamProjectionState(this.logger, options?.tools);

      const observedStream = observeProviderNativeRawPayloadStream(stream, {
        provider: 'gemma',
        apiSurface: 'chat-completions',
        onProviderNativeRawPayload: options?.onProviderNativeRawPayload,
      });

      for await (const chunk of this.streamWithAbort(observedStream, options?.signal)) {
        for (const message of projectGemmaStreamChunk(chunk, projectionState)) {
          yield withProviderRequestId(message, providerRequestId);
        }
      }

      for (const message of flushGemmaStreamProjection(projectionState)) {
        yield withProviderRequestId(message, providerRequestId);
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

  /**
   * MCP-005: gemma accepts standard JSON Schema — the permissive profile.
   */
  protected override projectionProfile(): IToolSchemaProjectionProfile | undefined {
    return { ...PERMISSIVE_TOOL_SCHEMA_PROFILE, providerName: 'gemma' };
  }

  /**
   * Project `options.tools` before either request-building path (`chat()` / `chatStream()`, both of
   * which route through `buildRequestParams`) reaches the shared `buildOpenAICompatibleRequestParams`
   * (`request-builder.ts:78-79`) — `options.tools` itself is never mutated.
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
  ): OpenAI.Chat.ChatCompletionCreateParamsNonStreaming {
    return buildOpenAICompatibleRequestParams({
      messages,
      options: this.projectChatOptions(options),
      defaultModel: this.options.defaultModel,
      // PROV-004: no `capabilityTable` — gemma publishes none, so no model of its declares
      // `json_schema`, and the builder must not emit `response_format` for it. Silence is not
      // permission; passing an empty table here would read as a deliberate denial instead.
    });
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
      options.onProviderNativeRawPayload?.({
        provider: 'gemma',
        apiSurface: 'chat-completions',
        payloadKind: 'request',
        payload: requestParams,
      });
      const { data: stream, providerRequestId } = await awaitWithProviderRequestId(
        this.client.chat.completions.create(
          requestParams,
          options.signal ? { signal: options.signal } : undefined,
        ),
      );
      const projector = new GemmaReasoningProjector();
      const result = await assembleOpenAICompatibleStream({
        stream: observeProviderNativeRawPayloadStream(stream, {
          provider: 'gemma',
          apiSurface: 'chat-completions',
          onProviderNativeRawPayload: options.onProviderNativeRawPayload,
        }),
        onTextDelta: options.onTextDelta,
        signal: options.signal,
        textProjector: (text) => projector.project(text),
        textProjectorFlush: () => projector.flush(),
        toolCallTextProjector: createGemmaToolCallProjector(options.tools),
      });

      return withProviderRequestId(
        withGemmaProjectionMetadata(result, projector.rawText, projector.removedReasoning),
        providerRequestId,
      );
    } catch (error) {
      const gemmaError = error as IOpenAICompatibleError;
      const errorMessage = gemmaError.message || 'Gemma streaming request failed';
      throw new Error(`Gemma stream failed: ${errorMessage}`);
    }
  }
}
