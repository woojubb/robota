import { randomUUID } from 'node:crypto';

import type { IToolCall, TUniversalMessage } from '@robota-sdk/agent-core';
import type OpenAI from 'openai';

export function createStreamTextMessage(
  content: string,
  finishReason: OpenAI.Chat.ChatCompletionChunk.Choice['finish_reason'],
): TUniversalMessage {
  return {
    id: randomUUID(),
    role: 'assistant',
    content,
    state: 'complete',
    timestamp: new Date(),
    metadata: {
      isStreamChunk: true,
      isComplete: finishReason === 'stop' || finishReason === 'tool_calls',
    },
  };
}

export function createStreamToolCallMessage(
  toolCalls: IToolCall[],
  finishReason: OpenAI.Chat.ChatCompletionChunk.Choice['finish_reason'],
): TUniversalMessage {
  return {
    id: randomUUID(),
    role: 'assistant',
    content: '',
    toolCalls,
    state: 'complete',
    timestamp: new Date(),
    metadata: {
      isStreamChunk: true,
      isComplete: finishReason === 'stop' || finishReason === 'tool_calls',
    },
  };
}
