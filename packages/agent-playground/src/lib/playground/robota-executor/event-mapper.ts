import type { IConversationEvent } from '../plugins/playground-history-plugin';
import type { TSseEvent } from './sse-client';

function makeId(): string {
  return crypto.randomUUID();
}

export function mapSseEventToConversationEvent(
  event: TSseEvent,
  textAccumulator: { value: string },
): IConversationEvent | null {
  switch (event.type) {
    case 'tool_call_start':
      return {
        id: makeId(),
        type: 'tool_call_start',
        timestamp: new Date(),
        toolName: event.data.name,
        content: JSON.stringify(event.data.input),
        metadata: { toolCallId: event.data.id },
      };

    case 'tool_call_complete':
      return {
        id: makeId(),
        type: 'tool_call_complete',
        timestamp: new Date(),
        content: JSON.stringify(event.data.output),
        metadata: { toolCallId: event.data.id },
      };

    case 'text_delta':
      textAccumulator.value += event.data.text;
      return null;

    case 'done':
      return {
        id: makeId(),
        type: 'assistant_response',
        timestamp: new Date(),
        content: textAccumulator.value,
        metadata: {
          promptTokens: event.data.usage.promptTokens,
          completionTokens: event.data.usage.completionTokens,
          totalTokens: event.data.usage.totalTokens,
        },
      };

    case 'error':
      return {
        id: makeId(),
        type: 'tool_call_error',
        timestamp: new Date(),
        content: event.data.message,
      };
  }
}
