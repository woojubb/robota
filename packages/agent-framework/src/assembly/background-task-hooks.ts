import { runHooks } from '@robota-sdk/agent-core';
import type {
  IHookInput,
  IHookTypeExecutor,
  THooksConfig,
  THookEvent,
} from '@robota-sdk/agent-core';
import type { TBackgroundTaskEvent } from '../background-tasks/index.js';

function getSubagentHookEvent(event: TBackgroundTaskEvent): THookEvent | undefined {
  if (event.type === 'background_task_started' && event.task.kind === 'agent') {
    return 'SubagentStart';
  }
  if (
    (event.type === 'background_task_completed' ||
      event.type === 'background_task_failed' ||
      event.type === 'background_task_cancelled') &&
    event.task.kind === 'agent'
  ) {
    return 'SubagentStop';
  }
  return undefined;
}

export function fireSubagentLifecycleHook(
  event: TBackgroundTaskEvent,
  cwd: string,
  hooks: THooksConfig | undefined,
  hookTypeExecutors: IHookTypeExecutor[] | undefined,
): void {
  const hookEventName = getSubagentHookEvent(event);
  if (!hookEventName || !('task' in event)) return;

  const input: IHookInput = {
    session_id: event.task.parentSessionId,
    cwd,
    hook_event_name: hookEventName,
    agent_id: event.task.id,
    agent_type: event.task.agentType ?? event.task.label,
    ...(event.task.transcriptPath
      ? {
          agent_transcript_path: event.task.transcriptPath,
          transcript_path: event.task.transcriptPath,
        }
      : {}),
    ...(event.task.error?.message || event.task.timeoutReason
      ? { reason: event.task.error?.message ?? event.task.timeoutReason }
      : {}),
    ...(hookEventName === 'SubagentStop'
      ? {
          stop_hook_active: false,
          ...(event.task.result?.output
            ? { last_assistant_message: event.task.result.output }
            : {}),
        }
      : {}),
    env: {
      CLAUDE_PROJECT_DIR: cwd,
      CLAUDE_SESSION_ID: event.task.parentSessionId,
      ROBOTA_AGENT_ID: event.task.id,
      ROBOTA_AGENT_TYPE: event.task.agentType ?? event.task.label,
    },
  };

  void runHooks(hooks, hookEventName, input, hookTypeExecutors).catch(() => undefined);
}
