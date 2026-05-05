import { randomUUID } from 'node:crypto';
import type OpenAI from 'openai';
import type { IChatOptions, TTextDeltaCallback, TUniversalMessage } from '@robota-sdk/agent-core';
import { observeProviderNativeRawPayloadStream } from '@robota-sdk/agent-provider-openai-compatible';
import type { IOpenAIError } from './types/api-types';
import type { IOpenAIProviderOptions } from './types';
import { buildOpenAIResponsesTextConfig } from './openai-request-format';
import {
  convertToOpenAIResponsesInput,
  convertToOpenAIResponsesTools,
} from './responses-converter';
import { assembleOpenAIResponsesStream, parseOpenAIResponsesResponse } from './responses-parser';
import type {
  IOpenAIResponsesRequestNonStreaming,
  IOpenAIResponsesRequestStreaming,
  TOpenAIResponsesStreamEvent,
} from './responses-types';

export interface IOpenAIResponsesChatOptions {
  client?: OpenAI;
  messages: TUniversalMessage[];
  chatOptions?: IChatOptions;
  providerOptions: IOpenAIProviderOptions;
  onTextDelta?: TTextDeltaCallback;
}

interface IResponsesStreamMessageQueue {
  deltas: TUniversalMessage[];
  finalMessage?: TUniversalMessage;
  error?: Error;
  wake?: () => void;
}

export async function chatWithOpenAIResponsesApi(
  input: IOpenAIResponsesChatOptions,
): Promise<TUniversalMessage> {
  const textDeltaCb = input.chatOptions?.onTextDelta ?? input.onTextDelta;
  if (textDeltaCb) {
    return chatWithOpenAIResponsesStreamingAssembly({
      ...input,
      chatOptions: {
        ...input.chatOptions,
        onTextDelta: textDeltaCb,
      },
    });
  }

  if (!input.client) {
    throw new Error('OpenAI Responses client not available.');
  }

  try {
    const requestParams = buildResponsesRequestParams(input);
    input.chatOptions?.onProviderNativeRawPayload?.({
      provider: 'openai',
      apiSurface: 'responses',
      payloadKind: 'request',
      payload: requestParams,
    });
    const response = await input.client.responses.create(
      requestParams as OpenAI.Responses.ResponseCreateParamsNonStreaming,
      input.chatOptions?.signal ? { signal: input.chatOptions.signal } : undefined,
    );
    input.chatOptions?.onProviderNativeRawPayload?.({
      provider: 'openai',
      apiSurface: 'responses',
      payloadKind: 'response',
      payload: response,
    });
    return parseOpenAIResponsesResponse(response);
  } catch (error) {
    const openaiError = error as IOpenAIError;
    const errorMessage = openaiError.message || 'OpenAI Responses API request failed';
    throw new Error(`OpenAI responses failed: ${errorMessage}`);
  }
}

export async function* chatStreamWithOpenAIResponsesApi(
  input: IOpenAIResponsesChatOptions,
): AsyncIterable<TUniversalMessage> {
  const queue: IResponsesStreamMessageQueue = { deltas: [] };
  const textDeltaCb = input.chatOptions?.onTextDelta ?? input.onTextDelta;
  const assembly = chatWithOpenAIResponsesStreamingAssembly({
    ...input,
    chatOptions: {
      ...input.chatOptions,
      onTextDelta: (delta) => {
        textDeltaCb?.(delta);
        enqueueStreamDelta(queue, createStreamDeltaMessage(delta));
      },
    },
  })
    .then((result) => finishStreamQueue(queue, result))
    .catch((error) => failStreamQueue(queue, toError(error)));

  yield* drainResponsesStreamQueue(queue);
  await assembly;
}

async function chatWithOpenAIResponsesStreamingAssembly(
  input: IOpenAIResponsesChatOptions,
): Promise<TUniversalMessage> {
  if (!input.client) {
    throw new Error('OpenAI Responses client not available.');
  }

  try {
    const requestParams = buildResponsesStreamingRequestParams(input);
    input.chatOptions?.onProviderNativeRawPayload?.({
      provider: 'openai',
      apiSurface: 'responses',
      payloadKind: 'request',
      payload: requestParams,
    });
    const stream = await input.client.responses.create(
      requestParams as OpenAI.Responses.ResponseCreateParamsStreaming,
      input.chatOptions?.signal ? { signal: input.chatOptions.signal } : undefined,
    );
    return assembleOpenAIResponsesStream({
      stream: observeProviderNativeRawPayloadStream(
        stream as AsyncIterable<TOpenAIResponsesStreamEvent>,
        {
          provider: 'openai',
          apiSurface: 'responses',
          onProviderNativeRawPayload: input.chatOptions?.onProviderNativeRawPayload,
        },
      ),
      onTextDelta: input.chatOptions?.onTextDelta,
      signal: input.chatOptions?.signal,
    });
  } catch (error) {
    const openaiError = error as IOpenAIError;
    const errorMessage = openaiError.message || 'OpenAI Responses streaming request failed';
    throw new Error(`OpenAI responses stream failed: ${errorMessage}`);
  }
}

function buildResponsesRequestParams(
  input: IOpenAIResponsesChatOptions,
): IOpenAIResponsesRequestNonStreaming {
  const model = input.chatOptions?.model ?? input.providerOptions.defaultModel;
  if (!model) {
    throw new Error(
      'Model is required in chat options. Please specify a model in defaultModel configuration.',
    );
  }

  const tools = convertToOpenAIResponsesTools(
    input.chatOptions?.tools,
    input.providerOptions.strictTools,
  );
  const textConfig = buildOpenAIResponsesTextConfig(input.providerOptions);
  return {
    model,
    input: convertToOpenAIResponsesInput(input.messages),
    ...(tools !== undefined && { tools, tool_choice: 'auto' }),
    ...(input.chatOptions?.temperature !== undefined && {
      temperature: input.chatOptions.temperature,
    }),
    ...(input.chatOptions?.maxTokens !== undefined && {
      max_output_tokens: input.chatOptions.maxTokens,
    }),
    ...(textConfig !== undefined && { text: textConfig }),
    ...(input.providerOptions.reasoning !== undefined && {
      reasoning: input.providerOptions.reasoning,
    }),
    ...(input.providerOptions.includeEncryptedReasoning === true && {
      include: ['reasoning.encrypted_content'],
    }),
    ...(input.providerOptions.store !== undefined && { store: input.providerOptions.store }),
  };
}

function buildResponsesStreamingRequestParams(
  input: IOpenAIResponsesChatOptions,
): IOpenAIResponsesRequestStreaming {
  return {
    ...buildResponsesRequestParams(input),
    stream: true,
  };
}

function createStreamDeltaMessage(delta: string): TUniversalMessage {
  return {
    id: randomUUID(),
    role: 'assistant',
    content: delta,
    state: 'complete',
    timestamp: new Date(),
    metadata: {
      providerApiSurface: 'responses',
      isStreamChunk: true,
      isComplete: false,
    },
  };
}

async function* drainResponsesStreamQueue(
  queue: IResponsesStreamMessageQueue,
): AsyncIterable<TUniversalMessage> {
  while (true) {
    const next = queue.deltas.shift();
    if (next !== undefined) {
      yield next;
      continue;
    }
    if (queue.error !== undefined) {
      throw queue.error;
    }
    if (queue.finalMessage !== undefined) {
      yield createFinalStreamMessage(queue.finalMessage);
      return;
    }
    await waitForStreamQueue(queue);
  }
}

function enqueueStreamDelta(queue: IResponsesStreamMessageQueue, message: TUniversalMessage): void {
  queue.deltas.push(message);
  wakeStreamQueue(queue);
}

function finishStreamQueue(queue: IResponsesStreamMessageQueue, result: TUniversalMessage): void {
  queue.finalMessage = result;
  wakeStreamQueue(queue);
}

function failStreamQueue(queue: IResponsesStreamMessageQueue, error: Error): void {
  queue.error = error;
  wakeStreamQueue(queue);
}

function waitForStreamQueue(queue: IResponsesStreamMessageQueue): Promise<void> {
  return new Promise((resolve) => {
    queue.wake = resolve;
  });
}

function wakeStreamQueue(queue: IResponsesStreamMessageQueue): void {
  queue.wake?.();
  queue.wake = undefined;
}

function createFinalStreamMessage(result: TUniversalMessage): TUniversalMessage {
  return {
    ...result,
    content: '',
    metadata: {
      ...result.metadata,
      isStreamChunk: true,
      isComplete: true,
    },
  };
}

function toError(error: Error | string): Error {
  return error instanceof Error ? error : new Error(String(error));
}
