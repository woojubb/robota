import { toProviderError, randomId } from '@robota-sdk/agent-core';

import {
  observeProviderNativeRawPayloadStream,
  toOpenAIResponsesToolChoice,
} from '../openai-compatible/index';

import { extraBodyWire } from './extra-body';
import { buildOpenAIResponsesTextConfig } from './openai-request-format';
import { parallelToolCallsWire } from './parallel-tool-policy';
import { resolveOpenAIReasoningOptions } from './reasoning-effort';
import {
  awaitWithProviderRequestId,
  readOpenAIRequestId,
  withProviderRequestId,
} from './request-id';
import {
  convertToOpenAIResponsesInput,
  convertToOpenAIResponsesTools,
} from './responses-converter';
import { openAIRequestOptions } from './request-options';
import { assembleOpenAIResponsesStream, parseOpenAIResponsesResponse } from './responses-parser';
import { includesHostedWebSearch } from './responses-web-search';

import type {
  IOpenAIResponsesRequestNonStreaming,
  IOpenAIResponsesRequestStreaming,
  TOpenAIResponsesStreamEvent,
  TOpenAIResponsesTool,
} from './responses-types';
import type { IOpenAIProviderOptions, TOpenAIExtraBody } from './types';
import type { IChatOptions, TTextDeltaCallback, TUniversalMessage } from '@robota-sdk/agent-core';
import type OpenAI from 'openai';

export interface IOpenAIResponsesChatOptions {
  client?: OpenAI;
  messages: TUniversalMessage[];
  chatOptions?: IChatOptions;
  providerOptions: IOpenAIProviderOptions;
  parallelToolCalls?: boolean;
  extraBody?: TOpenAIExtraBody;
  onTextDelta?: TTextDeltaCallback;
  /** Per-request headers (trusted `traceparent`), sent after the raw request payload is captured. */
  requestHeaders?: Readonly<Record<string, string>>;
  /** Names the provider instance, so a reply's items are sent back only by the one that recorded them. */
  replayOwner: string;
}

/** A request's wire body, with the decisions about it the response parser also needs. */
interface IResponsesRequest<TParams> {
  params: TParams;
  hostedWebSearch: boolean;
  /** Who may send this reply's items back: this instance on this model. Absent when unstored. */
  replayScope: string | undefined;
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
    const { params: requestParams, hostedWebSearch, replayScope } = buildResponsesRequest(input);
    input.chatOptions?.onProviderNativeRawPayload?.({
      provider: 'openai',
      apiSurface: 'responses',
      payloadKind: 'request',
      payload: requestParams,
    });
    const response = await input.client.responses.create(
      requestParams as OpenAI.Responses.ResponseCreateParamsNonStreaming,
      openAIRequestOptions(input.chatOptions?.signal, input.requestHeaders),
    );
    input.chatOptions?.onProviderNativeRawPayload?.({
      provider: 'openai',
      apiSurface: 'responses',
      payloadKind: 'response',
      payload: response,
    });
    return withProviderRequestId(
      parseOpenAIResponsesResponse(response, { hostedWebSearch, replayScope }),
      readOpenAIRequestId(response),
    );
  } catch (error) {
    throw toProviderError(error, 'openai', 'OpenAI responses failed');
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
    const {
      params: requestParams,
      hostedWebSearch,
      replayScope,
    } = buildResponsesStreamingRequest(input);
    input.chatOptions?.onProviderNativeRawPayload?.({
      provider: 'openai',
      apiSurface: 'responses',
      payloadKind: 'request',
      payload: requestParams,
    });
    const { data: stream, providerRequestId } = await awaitWithProviderRequestId(
      input.client.responses.create(
        requestParams as OpenAI.Responses.ResponseCreateParamsStreaming,
        openAIRequestOptions(input.chatOptions?.signal, input.requestHeaders),
      ),
    );
    const assembled = await assembleOpenAIResponsesStream({
      stream: observeProviderNativeRawPayloadStream(
        stream as AsyncIterable<TOpenAIResponsesStreamEvent>,
        {
          provider: 'openai',
          apiSurface: 'responses',
          onProviderNativeRawPayload: input.chatOptions?.onProviderNativeRawPayload,
        },
      ),
      onTextDelta: input.chatOptions?.onTextDelta,
      onThinkingDelta: input.chatOptions?.onThinkingDelta,
      signal: input.chatOptions?.signal,
      hostedWebSearch,
      replayScope,
    });
    return withProviderRequestId(assembled, providerRequestId);
  } catch (error) {
    throw toProviderError(error, 'openai', 'OpenAI responses stream failed');
  }
}

function buildResponsesRequest(
  input: IOpenAIResponsesChatOptions,
): IResponsesRequest<IOpenAIResponsesRequestNonStreaming> {
  const model = input.chatOptions?.model ?? input.providerOptions.defaultModel;
  if (!model) {
    throw new Error(
      'Model is required in chat options. Please specify a model in defaultModel configuration.',
    );
  }

  // OpenAI has no items for an unstored response, so there is nothing to send back for one.
  const replayScope =
    input.providerOptions.store === false ? undefined : `${input.replayOwner}/${model}`;
  const textConfig = buildOpenAIResponsesTextConfig(input.providerOptions);
  // Native effort mapping: thread the per-call reasoning-effort dial onto the Responses
  // API `reasoning.effort` parameter, merged with any static reasoning options.
  const reasoning = resolveOpenAIReasoningOptions(
    input.providerOptions.reasoning,
    input.chatOptions?.effortResolution,
  );
  const hostedWebSearch = includesHostedWebSearch({
    providerOptions: input.providerOptions,
    chatOptions: input.chatOptions,
    model,
    reasoning,
  });
  const functionTools = convertToOpenAIResponsesTools(
    input.chatOptions?.tools,
    input.providerOptions.strictTools,
  );
  // Hosted search goes last, after the caller's functions; a request with neither sends no tools.
  const tools: TOpenAIResponsesTool[] | undefined = hostedWebSearch
    ? [...(functionTools ?? []), { type: 'web_search' }]
    : functionTools;
  const params: IOpenAIResponsesRequestNonStreaming = {
    ...extraBodyWire(input.extraBody),
    model,
    ...parallelToolCallsWire(input.parallelToolCalls),
    // Search items go back only on a request that declares the tool: OpenAI backends are reported to
    // refuse them otherwise, and a forced summary, the last-resort answer, must not fail on that.
    input: convertToOpenAIResponsesInput(input.messages, hostedWebSearch ? replayScope : undefined),
    ...(tools !== undefined && {
      tools,
      tool_choice: toOpenAIResponsesToolChoice(input.chatOptions?.toolChoice),
    }),
    ...(input.chatOptions?.temperature !== undefined && {
      temperature: input.chatOptions.temperature,
    }),
    ...(input.chatOptions?.maxTokens !== undefined && {
      max_output_tokens: input.chatOptions.maxTokens,
    }),
    ...(textConfig !== undefined && { text: textConfig }),
    ...(reasoning !== undefined && {
      reasoning,
    }),
    ...(input.providerOptions.includeEncryptedReasoning === true && {
      include: ['reasoning.encrypted_content'],
    }),
    ...(input.providerOptions.store !== undefined && { store: input.providerOptions.store }),
  };
  return { params, hostedWebSearch, replayScope };
}

function buildResponsesStreamingRequest(
  input: IOpenAIResponsesChatOptions,
): IResponsesRequest<IOpenAIResponsesRequestStreaming> {
  const { params, ...request } = buildResponsesRequest(input);
  return { params: { ...params, stream: true }, ...request };
}

function createStreamDeltaMessage(delta: string): TUniversalMessage {
  return {
    id: randomId(),
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
