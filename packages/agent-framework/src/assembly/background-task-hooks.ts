import { createLogger, runHooks } from '@robota-sdk/agent-core';

import type {
  IHookInput,
  IHookTypeExecutor,
  THooksConfig,
  THookEvent,
} from '@robota-sdk/agent-core';
import type { TBackgroundTaskEvent } from '@robota-sdk/agent-interface-execution';
import type { ICreateSessionOptions } from './create-session-types.js';

const logger = createLogger('BackgroundTaskHooks');
const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED_ENVIRONMENT_NAMES = new Set(['CLAUDE_PROJECT_DIR', 'CLAUDE_SESSION_ID']);

export function validateSubagentHookEnvironmentNames(
  names: ICreateSessionOptions['subagentHookEnvironmentNames'],
): void {
  const aliases = [names?.agentId, names?.agentType].filter((name): name is string => name !== undefined);
  for (const name of aliases) {
    if (!ENVIRONMENT_NAME.test(name) || RESERVED_ENVIRONMENT_NAMES.has(name)) {
      throw new Error(`Invalid subagent hook environment alias: ${name}`);
    }
  }
  if (aliases.length === 2 && aliases[0] === aliases[1]) {
    throw new Error(`Duplicate subagent hook environment alias: ${aliases[0]}`);
  }
}

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
  environmentNames?: ICreateSessionOptions['subagentHookEnvironmentNames'],
): void {
  const hookEventName = getSubagentHookEvent(event);
  if (!hookEventName || !('task' in event)) return;
  // #2079: `getSubagentHookEvent` only returns a hook name for an agent-kind task; this check is
  // what lets TypeScript narrow `event.task` to the agent-kind member (for `agentType`) below.
  if (event.task.kind !== 'agent') return;

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
      ...(environmentNames?.agentId === undefined
        ? {} : { [environmentNames.agentId]: event.task.id }),
      ...(environmentNames?.agentType === undefined
        ? {} : { [environmentNames.agentType]: event.task.agentType ?? event.task.label }),
    },
  };

  void runHooks(hooks, hookEventName, input, hookTypeExecutors).catch((error: unknown) => {
    // CORE-029: the same discarded rejection as the worktree runner. These are notifications, so
    // they stay unawaited — but a hook that failed must not look like a hook that ran.
    logger.warn('background task hook failed', {
      event: hookEventName,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}
