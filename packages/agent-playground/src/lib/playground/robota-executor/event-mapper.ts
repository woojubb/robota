import type { IConversationEvent } from '../plugins/playground-history-plugin';
import type { TSseEvent } from './sse-client';

function makeId(): string {
  return crypto.randomUUID();
}

export function mapSseEventToConversationEvent(
  event: TSseEvent,
  textAccumulator: { value: string },
  taskTextAccumulators?: Map<string, string>,
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
        content:
          typeof event.data.output === 'string'
            ? event.data.output
            : JSON.stringify(event.data.output),
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

    case 'agent_job_created':
      return {
        id: `job-created-${event.data.taskId}`,
        type: 'agent_job_created',
        timestamp: new Date(),
        taskId: event.data.taskId,
        content: event.data.promptPreview ?? event.data.label,
        metadata: {
          agentType: event.data.agentType,
          label: event.data.label,
          promptPreview: event.data.promptPreview,
          ...(event.data.originToolCallId ? { originToolCallId: event.data.originToolCallId } : {}),
        },
      };

    case 'agent_job_started':
      return null;

    case 'agent_job_text_delta':
      if (taskTextAccumulators) {
        const prev = taskTextAccumulators.get(event.data.taskId) ?? '';
        taskTextAccumulators.set(event.data.taskId, prev + event.data.delta);
      }
      return null;

    case 'agent_job_tool_start':
      return null;

    case 'agent_job_tool_end':
      return null;

    case 'agent_job_completed': {
      const accumulatedText = taskTextAccumulators?.get(event.data.taskId) ?? '';
      taskTextAccumulators?.delete(event.data.taskId);
      return {
        id: `job-completed-${event.data.taskId}`,
        type: 'agent_job_completed',
        timestamp: new Date(),
        taskId: event.data.taskId,
        content: accumulatedText,
        metadata: { agentType: event.data.agentType, label: event.data.label },
      };
    }

    case 'agent_job_failed':
      taskTextAccumulators?.delete(event.data.taskId);
      return {
        id: `job-failed-${event.data.taskId}`,
        type: 'agent_job_failed',
        timestamp: new Date(),
        taskId: event.data.taskId,
        content: event.data.label,
        metadata: { label: event.data.label },
      };
  }
}
