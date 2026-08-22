import type {
  IBackgroundJobGroupState,
  IBackgroundTaskState,
  TBackgroundJobGroupEvent,
  TBackgroundTaskEvent,
} from '@robota-sdk/agent-interface-transport';

export function deriveBackgroundTasks(
  events: readonly TBackgroundTaskEvent[],
): IBackgroundTaskState[] {
  const tasks = new Map<string, IBackgroundTaskState>();
  for (const event of events) {
    const task = getBackgroundTaskSnapshot(event);
    if (task) tasks.set(task.id, task);
  }
  return [...tasks.values()];
}

function getBackgroundTaskSnapshot(event: TBackgroundTaskEvent): IBackgroundTaskState | undefined {
  switch (event.type) {
    case 'background_task_created':
    case 'background_task_started':
    case 'background_task_updated':
    case 'background_task_completed':
    case 'background_task_failed':
    case 'background_task_cancelled':
      return event.task;
    default:
      return undefined;
  }
}

export function deriveBackgroundJobGroups(
  events: readonly TBackgroundJobGroupEvent[],
): IBackgroundJobGroupState[] {
  const groups = new Map<string, IBackgroundJobGroupState>();
  for (const event of events) groups.set(event.group.id, event.group);
  return [...groups.values()];
}
