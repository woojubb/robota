import { toProviderError } from '@robota-sdk/agent-core';
import {
  observeProviderNativeRawPayloadStream,
  toOpenAICompatibleToolChoice,
} from '@robota-sdk/agent-provider-openai-compatible/shared';

import { convertToOpenAIMessages, convertToOpenAITools } from './message-converter';
import { buildOpenAIChatResponseFormat, mergeChatResponseFormat } from './openai-request-format';
import {
  awaitWithProviderRequestId,
  readOpenAIRequestId,
  withProviderRequestId,
} from './request-id';
import { openAIRequestOptions } from './request-options';
import { assembleOpenAIStream } from './streaming/stream-assembler';

import type { IPayloadLogger } from './interfaces/payload-logger';
import type { OpenAIResponseParser } from './parsers/response-parser';
import type { IOpenAIProviderOptions } from './types';
import type { IOpenAILogData } from './types/api-types';
import type { IChatOptions, TTextDeltaCallback, TUniversalMessage } from '@robota-sdk/agent-core';
import type OpenAI from 'openai';

export interface IOpenAIChatCompletionsOptions {
  client?: OpenAI;
  messages: TUniversalMessage[];
  chatOptions?: IChatOptions;
  providerOptions: IOpenAIProviderOptions;
  payloadLogger?: IPayloadLogger;
  responseParser: OpenAIResponseParser;
  onTextDelta?: TTextDeltaCallback;
  /** Per-request headers (trusted `traceparent`), sent after the raw request payload is captured. */
  requestHeaders?: Readonly<Record<string, string>>;
}

export async function chatWithOpenAIChatCompletions(
  input: IOpenAIChatCompletionsOptions,
): Promise<TUniversalMessage> {
  const client = requireClient(input.client);

  try {
    const requestParams = buildChatRequestParams(input);
    const textDeltaCb = input.chatOptions?.onTextDelta ?? input.onTextDelta;
    if (textDeltaCb) {
      return await chatWithStreamingAssembly(client, input, {
        ...requestParams,
        stream: true,
        ...buildStreamOptions(input),
      });
    }

    await logPayload(input, requestParams, 'chat');
    input.chatOptions?.onProviderNativeRawPayload?.({
      provider: 'openai',
      apiSurface: 'chat-completions',
      payloadKind: 'request',
      payload: requestParams,
    });
    const requestOptions = openAIRequestOptions(undefined, input.requestHeaders);
    const response = requestOptions
      ? await client.chat.completions.create(requestParams, requestOptions)
      : await client.chat.completions.create(requestParams);
    input.chatOptions?.onProviderNativeRawPayload?.({
      provider: 'openai',
      apiSurface: 'chat-completions',
      payloadKind: 'response',
      payload: response,
    });
    return withProviderRequestId(
      input.responseParser.parseResponse(response),
      readOpenAIRequestId(response),
    );
  } catch (error) {
    throw toProviderError(error, 'openai', 'OpenAI chat failed');
  }
}

export async function* chatStreamWithOpenAIChatCompletions(
  input: IOpenAIChatCompletionsOptions,
): AsyncIterable<TUniversalMessage> {
  const client = requireClient(input.client);

  try {
    const requestParams: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
      ...buildChatRequestParams(input),
      stream: true,
      ...buildStreamOptions(input),
    };

    await logPayload(input, requestParams, 'stream');
    input.chatOptions?.onProviderNativeRawPayload?.({
      provider: 'openai',
      apiSurface: 'chat-completions',
      payloadKind: 'request',
      payload: requestParams,
    });
    const { data: stream, providerRequestId } = await awaitWithProviderRequestId(
      client.chat.completions.create(
        requestParams,
        openAIRequestOptions(input.chatOptions?.signal, input.requestHeaders),
      ),
    );

    for await (const chunk of observeProviderNativeRawPayloadStream(stream, {
      provider: 'openai',
      apiSurface: 'chat-completions',
      onProviderNativeRawPayload: input.chatOptions?.onProviderNativeRawPayload,
    })) {
      const universalMessage = input.responseParser.parseStreamingChunk(chunk);
      if (universalMessage) {
        yield withProviderRequestId(universalMessage, providerRequestId);
      }
    }
  } catch (error) {
    throw toProviderError(error, 'openai', 'OpenAI stream failed');
  }
}

/**
 * Streaming requests opt into token usage via `stream_options: { include_usage: true }`
 * unless the provider sets `includeStreamUsage: false`. Only ever sent on streaming requests.
 */
function buildStreamOptions(
  input: IOpenAIChatCompletionsOptions,
): { stream_options: { include_usage: true } } | Record<string, never> {
  if (input.providerOptions.includeStreamUsage === false) {
    return {};
  }
  return { stream_options: { include_usage: true } };
}

function buildChatRequestParams(
  input: IOpenAIChatCompletionsOptions,
): OpenAI.Chat.ChatCompletionCreateParamsNonStreaming {
  const openaiMessages = convertToOpenAIMessages(input.messages);
  const model = input.chatOptions?.model ?? input.providerOptions.defaultModel;
  if (!model) {
    throw new Error(
      'Model is required in chat options. Please specify a model in defaultModel configuration.',
    );
  }

  const responseFormat = buildOpenAIChatResponseFormat(
    mergeChatResponseFormat(input.providerOptions, input.chatOptions?.responseFormat),
  );
  return {
    model,
    messages: openaiMessages,
    ...(input.chatOptions?.temperature !== undefined && {
      temperature: input.chatOptions.temperature,
    }),
    ...(input.chatOptions?.maxTokens !== undefined && { max_tokens: input.chatOptions.maxTokens }),
    ...(input.chatOptions?.tools && {
      tools: convertToOpenAITools(input.chatOptions.tools),
      tool_choice: toOpenAICompatibleToolChoice(input.chatOptions.toolChoice),
    }),
    ...(responseFormat !== undefined && { response_format: responseFormat }),
  } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming;
}

async function chatWithStreamingAssembly(
  client: OpenAI,
  input: IOpenAIChatCompletionsOptions,
  requestParams: OpenAI.Chat.ChatCompletionCreateParamsStreaming,
): Promise<TUniversalMessage> {
  try {
    await logPayload(input, requestParams, 'stream');
    input.chatOptions?.onProviderNativeRawPayload?.({
      provider: 'openai',
      apiSurface: 'chat-completions',
      payloadKind: 'request',
      payload: requestParams,
    });
    const { data: stream, providerRequestId } = await awaitWithProviderRequestId(
      client.chat.completions.create(
        requestParams,
        openAIRequestOptions(input.chatOptions?.signal, input.requestHeaders),
      ),
    );

    const assembled = await assembleOpenAIStream({
      stream: observeProviderNativeRawPayloadStream(stream, {
        provider: 'openai',
        apiSurface: 'chat-completions',
        onProviderNativeRawPayload: input.chatOptions?.onProviderNativeRawPayload,
      }),
      onTextDelta: input.chatOptions?.onTextDelta ?? input.onTextDelta,
      signal: input.chatOptions?.signal,
    });
    return withProviderRequestId(assembled, providerRequestId);
  } catch (error) {
    throw toProviderError(error, 'openai', 'OpenAI stream failed');
  }
}

async function logPayload(
  input: IOpenAIChatCompletionsOptions,
  requestParams:
    | OpenAI.Chat.ChatCompletionCreateParamsNonStreaming
    | OpenAI.Chat.ChatCompletionCreateParamsStreaming,
  type: 'chat' | 'stream',
): Promise<void> {
  if (!input.payloadLogger?.isEnabled()) {
    return;
  }

  const logData: IOpenAILogData = {
    model: requestParams.model,
    messagesCount: requestParams.messages.length,
    hasTools: !!requestParams.tools,
    temperature: requestParams.temperature ?? undefined,
    maxTokens: requestParams.max_tokens ?? undefined,
    timestamp: new Date().toISOString(),
  };
  await input.payloadLogger.logPayload(logData, type);
}

function requireClient(client: OpenAI | undefined): OpenAI {
  if (!client) {
    throw new Error(
      'OpenAI client not available. Either provide a client/apiKey or use an executor.',
    );
  }
  return client;
}
