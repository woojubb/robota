import {
  assembleOpenAICompatibleStream,
  observeProviderNativeRawPayloadStream,
} from '../shared/openai-compatible/index.js';

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
    const stream = await client.chat.completions.create(
      requestParams,
      options.signal ? { signal: options.signal } : undefined,
    );

    return assembleOpenAICompatibleStream({
      stream: observeProviderNativeRawPayloadStream(stream, {
        provider: 'qwen',
        apiSurface: 'chat-completions',
        onProviderNativeRawPayload: options.onProviderNativeRawPayload,
      }),
      onTextDelta: options.onTextDelta,
      signal: options.signal,
    });
  } catch (error) {
    const qwenError = error as IOpenAICompatibleError;
    const errorMessage = qwenError.message || 'Qwen streaming request failed';
    throw new Error(`Qwen stream failed: ${errorMessage}`);
  }
}
