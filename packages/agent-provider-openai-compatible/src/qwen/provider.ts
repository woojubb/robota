import {
  AbstractAIProvider,
  PERMISSIVE_TOOL_SCHEMA_PROFILE,
  SilentLogger,
  toProviderError,
  traceHeadersFor,
} from '@robota-sdk/agent-core';
import OpenAI from 'openai';

import { QWEN_CAPABILITY_TABLE } from './capability-table';
import {
  DEFAULT_QWEN_PROVIDER_BASE_URL,
  DEFAULT_QWEN_PROVIDER_RESPONSES_BASE_URL,
} from './defaults';
import { getQwenProviderCapabilities } from './provider-capabilities';
import { qwenChatWithStreamingAssembly } from './provider-streaming-assembly';
import { chatStreamWithQwenResponsesApi, chatWithQwenResponsesApi } from './responses-chat';
import { hasQwenBuiltInWebTools } from './responses-converter';
import {
  buildOpenAICompatibleRequestParams,
  observeProviderNativeRawPayloadStream,
  OpenAICompatibleResponseParser,
} from '../shared/openai-compatible/index.js';
import {
  awaitWithProviderRequestId,
  readOpenAICompatibleRequestId,
  withProviderRequestId,
} from '../shared/openai-compatible/request-id.js';
import { openAICompatibleRequestOptions } from '../shared/openai-compatible/request-options.js';

import type { IQwenProviderOptions } from './types';
import type {
  IProviderCapabilityTable,
  IChatOptions,
  IProviderCapabilities,
  IToolSchemaProjectionProfile,
  TTextDeltaCallback,
  TUniversalMessage,
} from '@robota-sdk/agent-core';

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
    this.validateNativeWebTools(options?.nativeWebTools);

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
      return (await this.executeViaExecutorOrDirect(messages, options)).message;
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
      chatOptions: this.projectChatOptions(options),
      defaultModel: this.options.defaultModel,
      builtInWebTools: this.options.builtInWebTools,
      onTextDelta: this.onTextDelta,
      requestHeaders: this.traceRequestHeaders(options, client),
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
        return qwenChatWithStreamingAssembly(
          client,
          { ...requestParams, stream: true },
          { ...options, onTextDelta: textDeltaCb },
          this.traceRequestHeaders(options, client),
        );
      }

      options?.onProviderNativeRawPayload?.({
        provider: 'qwen',
        apiSurface: 'chat-completions',
        payloadKind: 'request',
        payload: requestParams,
      });
      const chatRequestOptions = openAICompatibleRequestOptions(
        options?.signal,
        this.traceRequestHeaders(options, client),
      );
      const response = chatRequestOptions
        ? await client.chat.completions.create(requestParams, chatRequestOptions)
        : await client.chat.completions.create(requestParams);
      options?.onProviderNativeRawPayload?.({
        provider: 'qwen',
        apiSurface: 'chat-completions',
        payloadKind: 'response',
        payload: response,
      });
      return withProviderRequestId(
        this.responseParser.parseResponse(response),
        readOpenAICompatibleRequestId(response),
      );
    } catch (error) {
      throw toProviderError(error, 'qwen', 'Qwen chat failed');
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
        chatOptions: this.projectChatOptions(options),
        defaultModel: this.options.defaultModel,
        builtInWebTools: this.options.builtInWebTools,
        onTextDelta: this.onTextDelta,
        requestHeaders: this.traceRequestHeaders(options, this.responsesClient),
      });
      return;
    }

    try {
      const requestParams = this.buildStreamingRequestParams(messages, options);
      options?.onProviderNativeRawPayload?.({
        provider: 'qwen',
        apiSurface: 'chat-completions',
        payloadKind: 'request',
        payload: requestParams,
      });
      const streamRequestOptions = openAICompatibleRequestOptions(
        options?.signal,
        this.traceRequestHeaders(options, this.client),
      );
      const { data: stream, providerRequestId } = await awaitWithProviderRequestId(
        streamRequestOptions
          ? this.client.chat.completions.create(requestParams, streamRequestOptions)
          : this.client.chat.completions.create(requestParams),
      );

      const observedStream = observeProviderNativeRawPayloadStream(stream, {
        provider: 'qwen',
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
      throw toProviderError(error, 'qwen', 'Qwen stream failed');
    }
  }

  /** What THIS vendor's models can do, per model (PROV-008). */
  capabilityTable(): IProviderCapabilityTable {
    return QWEN_CAPABILITY_TABLE;
  }

  override supportsTools(): boolean {
    return true;
  }

  override getCapabilities(): IProviderCapabilities {
    return getQwenProviderCapabilities(this.options);
  }

  override validateConfig(): boolean {
    return (
      !!this.client && !!this.options && (!this.shouldUseResponsesApi() || !!this.responsesClient)
    );
  }

  override async dispose(): Promise<void> {
    // OpenAI-compatible Qwen clients do not need explicit cleanup.
  }

  /**
   * Qwen carries two clients (Chat Completions and Responses, potentially different base URLs), so
   * the answer this reports is for the Chat Completions client agent-core always constructs — the
   * one representative of "this provider instance can propagate at all". Each call site still
   * computes its own header from the client it actually uses (`traceRequestHeaders`), so a Responses
   * client on a different, listed origin still gets its header even when this answers about the
   * other surface. An executor sends elsewhere and neither client can propagate.
   */
  canPropagateTraceContext(): boolean {
    return !this.executor && this.effectiveBaseUrl(this.client) !== undefined;
  }

  private effectiveBaseUrl(client: OpenAI | undefined): string | undefined {
    const baseURL: unknown = (client as { baseURL?: unknown } | undefined)?.baseURL;
    return typeof baseURL === 'string' && baseURL.length > 0 ? baseURL : undefined;
  }

  private traceRequestHeaders(
    options: IChatOptions | undefined,
    client: OpenAI | undefined,
  ): Readonly<Record<string, string>> {
    if (this.executor) return {};
    const baseUrl = this.effectiveBaseUrl(client);
    if (baseUrl === undefined) return {};
    return traceHeadersFor(baseUrl, options?.outboundTraceContext);
  }

  /**
   * MCP-005: qwen (chat-completions and its Responses surface alike) accepts standard JSON Schema —
   * the permissive profile.
   */
  protected override projectionProfile(): IToolSchemaProjectionProfile | undefined {
    return { ...PERMISSIVE_TOOL_SCHEMA_PROFILE, providerName: 'qwen' };
  }

  /**
   * Project `options.tools` before EITHER request-building surface reaches a converter — the shared
   * Chat-Completions builder (`request-builder.ts:78-79`) and the Qwen Responses surface
   * (`responses-chat.ts:158`, live when `builtInWebTools` is on). `options.tools` itself is never
   * mutated.
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
    this.validateTools(options?.tools);

    return buildOpenAICompatibleRequestParams({
      messages,
      options: this.projectChatOptions(options),
      defaultModel: this.options.defaultModel,
      capabilityTable: this.capabilityTable(),
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
}
