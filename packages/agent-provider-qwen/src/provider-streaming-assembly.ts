import OpenAI from 'openai';
import type { IChatOptions, TUniversalMessage } from '@robota-sdk/agent-core';
import {
  assembleOpenAICompatibleStream,
  observeProviderNativeRawPayloadStream,
} from '@robota-sdk/agent-provider-openai-compatible';
import type { IOpenAICompatibleError } from '@robota-sdk/agent-provider-openai-compatible';

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
