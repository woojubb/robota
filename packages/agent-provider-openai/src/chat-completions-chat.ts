import type OpenAI from 'openai';
import type { IChatOptions, TTextDeltaCallback, TUniversalMessage } from '@robota-sdk/agent-core';
import type { IPayloadLogger } from './interfaces/payload-logger';
import type { IOpenAIError, IOpenAILogData } from './types/api-types';
import type { IOpenAIProviderOptions } from './types';
import { buildOpenAIChatResponseFormat } from './openai-request-format';
import { convertToOpenAIMessages, convertToOpenAITools } from './message-converter';
import { OpenAIResponseParser } from './parsers/response-parser';
import { assembleOpenAIStream } from './streaming/stream-assembler';

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
      });
    }

    await logPayload(input, requestParams, 'chat');
    const response = await client.chat.completions.create(requestParams);
    return input.responseParser.parseResponse(response);
  } catch (error) {
    const openaiError = error as IOpenAIError;
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
    };

    await logPayload(input, requestParams, 'stream');
    const stream = await client.chat.completions.create(
      requestParams,
      input.chatOptions?.signal ? { signal: input.chatOptions.signal } : undefined,
    );

    for await (const chunk of stream) {
      const universalMessage = input.responseParser.parseStreamingChunk(chunk);
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

  const responseFormat = buildOpenAIChatResponseFormat(input.providerOptions);
  return {
    model,
    messages: openaiMessages,
    ...(input.chatOptions?.temperature !== undefined && {
      temperature: input.chatOptions.temperature,
    }),
    ...(input.chatOptions?.maxTokens !== undefined && { max_tokens: input.chatOptions.maxTokens }),
    ...(input.chatOptions?.tools && {
      tools: convertToOpenAITools(input.chatOptions.tools),
      tool_choice: 'auto',
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
    const stream = await client.chat.completions.create(
      requestParams,
      input.chatOptions?.signal ? { signal: input.chatOptions.signal } : undefined,
    );

    return assembleOpenAIStream({
      stream,
      onTextDelta: input.chatOptions?.onTextDelta ?? input.onTextDelta,
      signal: input.chatOptions?.signal,
    });
  } catch (error) {
    const openaiError = error as IOpenAIError;
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
