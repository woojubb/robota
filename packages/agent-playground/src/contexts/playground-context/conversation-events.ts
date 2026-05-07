import type { TUniversalValue } from '@robota-sdk/agent-core';

import type { IConversationEvent, PlaygroundExecutor } from '../../lib/playground/robota-executor';

export function buildConversationEvents(executor: PlaygroundExecutor): IConversationEvent[] {
  if (typeof executor.getPlaygroundEvents === 'function') return executor.getPlaygroundEvents();
  const history = executor.getHistory();
  return history.map((msg, index) => ({
    id: `msg_${index}_${msg.timestamp?.getTime() || Date.now()}`,
    type: msg.role === 'user' ? 'user_message' : 'assistant_response',
    content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || ''),
    timestamp: msg.timestamp || new Date(),
    parentEventId: undefined,
    childEventIds: [],
    executionLevel: 0,
    executionPath: 'basic',
    metadata: cloneMetadata(msg.metadata),
  }));
}

function cloneMetadata(metadata: Record<string, TUniversalValue> | undefined) {
  return metadata ? JSON.parse(JSON.stringify(metadata)) : {};
}
