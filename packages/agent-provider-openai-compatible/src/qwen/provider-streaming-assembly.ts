import {
  assembleOpenAICompatibleStream,
  observeProviderNativeRawPayloadStream,
} from '../shared/openai-compatible/index.js';
import { awaitWithProviderRequestId, withProviderRequestId } from '../shared/openai-compatible/request-id.js';

import type { IOpenAICompatibleError } from '../shared/openai-compatible/index.js';
import type { IChatOptions, TUniversalMessage } from '@robota-sdk/agent-core';
import type OpenAI from 'openai';

export async function qwenChatWithStreamingAssembly(
  client: OpenAI,
  requestParams: OpenAI.Chat.ChatCompletionCreateParamsStreaming,
  options: IChatOptions,
): Promise<TUniversalMessage> {
  try {
    options.onProviderNativeRawPayload?.({
      provider: 'qwen',
      apiSurface: 'chat-completions',
      payloadKind: 'request',
      payload: requestParams,
    });
    const { data: stream, providerRequestId } = await awaitWithProviderRequestId(
      client.chat.completions.create(
        requestParams,
        options.signal ? { signal: options.signal } : undefined,
      ),
    );

    const assembled = await assembleOpenAICompatibleStream({
      stream: observeProviderNativeRawPayloadStream(stream, {
        provider: 'qwen',
        apiSurface: 'chat-completions',
        onProviderNativeRawPayload: options.onProviderNativeRawPayload,
      }),
      onTextDelta: options.onTextDelta,
      signal: options.signal,
    });
    return withProviderRequestId(assembled, providerRequestId);
  } catch (error) {
    const qwenError = error as IOpenAICompatibleError;
    const errorMessage = qwenError.message || 'Qwen streaming request failed';
    throw new Error(`Qwen stream failed: ${errorMessage}`);
  }
}
