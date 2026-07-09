import { RateLimitError } from '@robota-sdk/agent-core';
import {
  observeProviderNativeRawPayloadStream,
  toOpenAICompatibleToolChoice,
} from '@robota-sdk/agent-provider-openai-compatible/shared';

import { convertToOpenAIMessages, convertToOpenAITools } from './message-converter';
import { buildOpenAIChatResponseFormat, mergeChatResponseFormat } from './openai-request-format';
import { assembleOpenAIStream } from './streaming/stream-assembler';

import type { IPayloadLogger } from './interfaces/payload-logger';
import type { OpenAIResponseParser } from './parsers/response-parser';
import type { IOpenAIProviderOptions } from './types';
import type { IOpenAIError, IOpenAILogData } from './types/api-types';
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
    const response = await client.chat.completions.create(requestParams);
    input.chatOptions?.onProviderNativeRawPayload?.({
      provider: 'openai',
      apiSurface: 'chat-completions',
      payloadKind: 'response',
      payload: response,
    });
    return input.responseParser.parseResponse(response);
  } catch (error) {
    // allow-fallback: maps 429 to RateLimitError, wraps others in Error
    const openaiError = error as IOpenAIError;
    if (openaiError.status === 429) {
      throw new RateLimitError(
        openaiError.message ?? 'OpenAI rate limit exceeded.',
        undefined,
        'openai',
      );
    }
    const errorMessage = openaiError.message || 'OpenAI API request failed';
    throw new Error(`OpenAI chat failed: ${errorMessage}`);
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
    const stream = await client.chat.completions.create(
      requestParams,
      input.chatOptions?.signal ? { signal: input.chatOptions.signal } : undefined,
    );

    for await (const chunk of observeProviderNativeRawPayloadStream(stream, {
      provider: 'openai',
      apiSurface: 'chat-completions',
      onProviderNativeRawPayload: input.chatOptions?.onProviderNativeRawPayload,
    })) {
      const universalMessage = input.responseParser.parseStreamingChunk(chunk);
      if (universalMessage) {
        yield universalMessage;
      }
    }
  } catch (error) {
    // allow-fallback: maps 429 to RateLimitError, wraps others in Error
    const openaiError = error as IOpenAIError;
    if (openaiError.status === 429) {
      throw new RateLimitError(
        openaiError.message ?? 'OpenAI rate limit exceeded.',
        undefined,
        'openai',
      );
    }
    const errorMessage = openaiError.message || 'OpenAI API request failed';
    throw new Error(`OpenAI stream failed: ${errorMessage}`);
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
    const stream = await client.chat.completions.create(
      requestParams,
      input.chatOptions?.signal ? { signal: input.chatOptions.signal } : undefined,
    );

    return assembleOpenAIStream({
      stream: observeProviderNativeRawPayloadStream(stream, {
        provider: 'openai',
        apiSurface: 'chat-completions',
        onProviderNativeRawPayload: input.chatOptions?.onProviderNativeRawPayload,
      }),
      onTextDelta: input.chatOptions?.onTextDelta ?? input.onTextDelta,
      signal: input.chatOptions?.signal,
    });
  } catch (error) {
    // allow-fallback: maps 429 to RateLimitError, wraps others in Error
    const openaiError = error as IOpenAIError;
    if (openaiError.status === 429) {
      throw new RateLimitError(
        openaiError.message ?? 'OpenAI rate limit exceeded.',
        undefined,
        'openai',
      );
    }
    const errorMessage = openaiError.message || 'OpenAI streaming request failed';
    throw new Error(`OpenAI stream failed: ${errorMessage}`);
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
