import { randomUUID } from 'node:crypto';
import type OpenAI from 'openai';
import type { IChatOptions, TTextDeltaCallback, TUniversalMessage } from '@robota-sdk/agent-core';
import type { IOpenAICompatibleError } from '@robota-sdk/agent-provider-openai-compatible';
import {
  buildQwenResponsesTools,
  convertToQwenResponsesInput,
  getQwenBuiltInWebToolNames,
} from './responses-converter';
import { assembleQwenResponsesStream, parseQwenResponsesResponse } from './responses-parser';
import type {
  IQwenBuiltInWebToolsOptions,
  IQwenResponsesRequestNonStreaming,
  IQwenResponsesRequestStreaming,
  TQwenResponsesStreamEvent,
} from './types';

export interface IQwenResponsesChatOptions {
  client?: OpenAI;
  messages: TUniversalMessage[];
  chatOptions?: IChatOptions;
  defaultModel?: string;
  builtInWebTools?: IQwenBuiltInWebToolsOptions;
  onTextDelta?: TTextDeltaCallback;
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
    const response = await input.client.responses.create(
      requestParams as OpenAI.Responses.ResponseCreateParamsNonStreaming,
      input.chatOptions?.signal ? { signal: input.chatOptions.signal } : undefined,
    );
    return parseQwenResponsesResponse(response, {
      enabledBuiltInTools: getQwenBuiltInWebToolNames(input.builtInWebTools),
    });
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
    const stream = await input.client.responses.create(
      requestParams as OpenAI.Responses.ResponseCreateParamsStreaming,
      input.chatOptions?.signal ? { signal: input.chatOptions.signal } : undefined,
    );
    return assembleQwenResponsesStream({
      stream: stream as AsyncIterable<TQwenResponsesStreamEvent>,
      enabledBuiltInTools: getQwenBuiltInWebToolNames(input.builtInWebTools),
      onTextDelta: input.chatOptions?.onTextDelta,
      signal: input.chatOptions?.signal,
    });
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

  const enabledBuiltInTools = getQwenBuiltInWebToolNames(input.builtInWebTools);
  const tools = buildQwenResponsesTools(enabledBuiltInTools, input.chatOptions?.tools);

  return {
    model,
    input: convertToQwenResponsesInput(input.messages),
    ...(tools !== undefined && { tools }),
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
