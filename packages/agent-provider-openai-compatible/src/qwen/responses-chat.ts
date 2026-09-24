import { randomUUID } from 'node:crypto';

import {
  buildQwenResponsesTools,
  convertToQwenResponsesInput,
  getQwenBuiltInWebToolNames,
} from './responses-converter';
import { assembleQwenResponsesStream, parseQwenResponsesResponse } from './responses-parser';
import {
  observeProviderNativeRawPayloadStream,
  toOpenAIResponsesToolChoice,
  type IOpenAICompatibleError,
} from '../shared/openai-compatible/index.js';
import { awaitWithProviderRequestId, readOpenAICompatibleRequestId, withProviderRequestId } from '../shared/openai-compatible/request-id.js';
import { openAICompatibleRequestOptions } from '../shared/openai-compatible/request-options.js';

import type {
  IQwenBuiltInWebToolsOptions,
  IQwenResponsesRequestNonStreaming,
  IQwenResponsesRequestStreaming,
  TQwenResponsesStreamEvent,
} from './types';
import type { IChatOptions, TTextDeltaCallback, TUniversalMessage } from '@robota-sdk/agent-core';
import type OpenAI from 'openai';

export interface IQwenResponsesChatOptions {
  client?: OpenAI;
  messages: TUniversalMessage[];
  chatOptions?: IChatOptions;
  defaultModel?: string;
  builtInWebTools?: IQwenBuiltInWebToolsOptions;
  onTextDelta?: TTextDeltaCallback;
  /** Per-request headers (trusted `traceparent`), sent after the raw request payload is captured. */
  requestHeaders?: Readonly<Record<string, string>>;
}

function enabledBuiltInWebTools(
  input: IQwenResponsesChatOptions,
): ReturnType<typeof getQwenBuiltInWebToolNames> {
  return input.chatOptions?.toolChoice === 'none'
    ? []
    : getQwenBuiltInWebToolNames(input.builtInWebTools);
}

export async function chatWithQwenResponsesApi(
  input: IQwenResponsesChatOptions,
): Promise<TUniversalMessage> {
  const textDeltaCb = input.chatOptions?.onTextDelta ?? input.onTextDelta;
  if (textDeltaCb) {
    return chatWithQwenResponsesStreamingAssembly({
      ...input,
      chatOptions: {
        ...input.chatOptions,
        onTextDelta: textDeltaCb,
      },
    });
  }

  if (!input.client) {
    throw new Error('Qwen Responses client not available for built-in web tools.');
  }

  try {
    const requestParams = buildResponsesRequestParams(input);
    input.chatOptions?.onProviderNativeRawPayload?.({
      provider: 'qwen',
      apiSurface: 'responses',
      payloadKind: 'request',
      payload: requestParams,
    });
    const response = await input.client.responses.create(
      requestParams as OpenAI.Responses.ResponseCreateParamsNonStreaming,
      openAICompatibleRequestOptions(input.chatOptions?.signal, input.requestHeaders),
    );
    input.chatOptions?.onProviderNativeRawPayload?.({
      provider: 'qwen',
      apiSurface: 'responses',
      payloadKind: 'response',
      payload: response,
    });
    return withProviderRequestId(
      parseQwenResponsesResponse(response, {
        enabledBuiltInTools: enabledBuiltInWebTools(input),
      }),
      readOpenAICompatibleRequestId(response),
    );
  } catch (error) {
    const qwenError = error as IOpenAICompatibleError;
    const errorMessage = qwenError.message || 'Qwen Responses API request failed';
    throw new Error(`Qwen responses failed: ${errorMessage}`);
  }
}

export async function* chatStreamWithQwenResponsesApi(
  input: IQwenResponsesChatOptions,
): AsyncIterable<TUniversalMessage> {
  const deltas: TUniversalMessage[] = [];
  const result = await chatWithQwenResponsesStreamingAssembly({
    ...input,
    chatOptions: {
      ...input.chatOptions,
      onTextDelta: (delta) => {
        input.chatOptions?.onTextDelta?.(delta);
        deltas.push(createStreamDeltaMessage(delta));
      },
    },
  });

  for (const delta of deltas) {
    yield delta;
  }
  yield {
    ...result,
    content: '',
    metadata: {
      ...result.metadata,
      isStreamChunk: true,
      isComplete: true,
    },
  };
}

async function chatWithQwenResponsesStreamingAssembly(
  input: IQwenResponsesChatOptions,
): Promise<TUniversalMessage> {
  if (!input.client) {
    throw new Error('Qwen Responses client not available for built-in web tools.');
  }

  try {
    const requestParams = buildResponsesStreamingRequestParams(input);
    input.chatOptions?.onProviderNativeRawPayload?.({
      provider: 'qwen',
      apiSurface: 'responses',
      payloadKind: 'request',
      payload: requestParams,
    });
    const { data: stream, providerRequestId } = await awaitWithProviderRequestId(
      input.client.responses.create(
        requestParams as OpenAI.Responses.ResponseCreateParamsStreaming,
        openAICompatibleRequestOptions(input.chatOptions?.signal, input.requestHeaders),
      ),
    );
    const assembled = await assembleQwenResponsesStream({
      stream: observeProviderNativeRawPayloadStream(
        stream as AsyncIterable<TQwenResponsesStreamEvent>,
        {
          provider: 'qwen',
          apiSurface: 'responses',
          onProviderNativeRawPayload: input.chatOptions?.onProviderNativeRawPayload,
        },
      ),
      enabledBuiltInTools: enabledBuiltInWebTools(input),
      onTextDelta: input.chatOptions?.onTextDelta,
      signal: input.chatOptions?.signal,
    });
    return withProviderRequestId(assembled, providerRequestId);
  } catch (error) {
    const qwenError = error as IOpenAICompatibleError;
    const errorMessage = qwenError.message || 'Qwen Responses streaming request failed';
    throw new Error(`Qwen responses stream failed: ${errorMessage}`);
  }
}

function buildResponsesRequestParams(
  input: IQwenResponsesChatOptions,
): IQwenResponsesRequestNonStreaming {
  const model = input.chatOptions?.model ?? input.defaultModel;
  if (!model) {
    throw new Error(
      'Model is required in chat options. Please specify a model in defaultModel configuration.',
    );
  }

  const enabledBuiltInTools = enabledBuiltInWebTools(input);
  const tools = buildQwenResponsesTools(enabledBuiltInTools, input.chatOptions?.tools);

  return {
    model,
    input: convertToQwenResponsesInput(input.messages),
    ...(tools !== undefined && { tools }),
    ...(tools !== undefined &&
      input.chatOptions?.toolChoice !== undefined && {
        tool_choice: toOpenAIResponsesToolChoice(input.chatOptions.toolChoice),
      }),
    ...(input.chatOptions?.temperature !== undefined && {
      temperature: input.chatOptions.temperature,
    }),
    ...(input.chatOptions?.maxTokens !== undefined && {
      max_output_tokens: input.chatOptions.maxTokens,
    }),
    ...(input.builtInWebTools?.enableThinking !== undefined && {
      enable_thinking: input.builtInWebTools.enableThinking,
    }),
  };
}

function buildResponsesStreamingRequestParams(
  input: IQwenResponsesChatOptions,
): IQwenResponsesRequestStreaming {
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
      isStreamChunk: true,
      isComplete: false,
    },
  };
}
