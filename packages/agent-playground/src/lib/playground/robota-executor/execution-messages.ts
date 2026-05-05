import type { TUniversalMessage } from '@robota-sdk/agent-core';

const createMessageId = (): string => crypto.randomUUID();

export function createUserMessage(prompt: string): TUniversalMessage {
  return {
    id: createMessageId(),
    role: 'user',
    content: prompt,
    state: 'complete',
    timestamp: new Date(),
  };
}

export function createAssistantMessage(content: string): TUniversalMessage {
  return {
    id: createMessageId(),
    role: 'assistant',
    content,
    state: 'complete',
    timestamp: new Date(),
  };
}
