import type {
  IBackgroundTaskListFilter,
  IBackgroundTaskLogCursor,
  IBackgroundTaskLogPage,
  IBackgroundTaskState,
} from '../../background-tasks/index.js';
import type { ICommand } from '../types.js';
import type { ICommandHostContext } from '../host-context.js';

const DECIMAL_RADIX = 10;

export const BACKGROUND_COMMAND_DESCRIPTION = 'List and control background tasks';
export const BACKGROUND_COMMAND_USAGE =
  'Usage: background list | background read <task-id> [offset] | background cancel <task-id> | background close <task-id>';

export function buildBackgroundCommandSubcommands(): ICommand[] {
  return [
    { name: 'list', description: 'List background tasks', source: 'background' },
    { name: 'read', description: 'Read a background task log page', source: 'background' },
    { name: 'cancel', description: 'Cancel a running background task', source: 'background' },
    { name: 'close', description: 'Dismiss a terminal background task', source: 'background' },
  ];
}

export function formatCommandBackgroundTask(task: IBackgroundTaskState): string {
  const preview = task.promptPreview ?? task.commandPreview ?? '';
  const unread = task.unread ? ' unread' : '';
  const action = task.currentAction ? ` (${task.currentAction})` : '';
  const timeout = task.timeoutReason ? ` timeout=${task.timeoutReason}` : '';
  const activity = task.lastActivityAt ? ` lastActivityAt=${task.lastActivityAt}` : '';
  const suffix = preview ? ` — ${preview}` : '';
  return `${task.id} [${task.status}${unread}${timeout}${activity}] ${task.kind}:${task.label}${action}${suffix}`;
}

export function formatCommandBackgroundTaskList(tasks: IBackgroundTaskState[]): string {
  if (tasks.length === 0) return 'No background tasks.';
  return [
    'Background tasks:',
    ...tasks.map((task) => `  ${formatCommandBackgroundTask(task)}`),
  ].join('\n');
}

export function parseCommandBackgroundLogCursor(
  value?: string,
): IBackgroundTaskLogCursor | undefined {
  if (!value) return undefined;
  const offset = Number.parseInt(value, DECIMAL_RADIX);
  return Number.isNaN(offset) ? undefined : { offset };
}

export function listCommandBackgroundTasks(
  context: ICommandHostContext,
  filter?: IBackgroundTaskListFilter,
): IBackgroundTaskState[] {
  return context.listBackgroundTasks(filter);
}

export function readCommandBackgroundTaskLog(
  context: ICommandHostContext,
  taskId: string,
  cursor?: IBackgroundTaskLogCursor,
): Promise<IBackgroundTaskLogPage> {
  return context.readBackgroundTaskLog(taskId, cursor);
}

export function cancelCommandBackgroundTask(
  context: ICommandHostContext,
  taskId: string,
  reason?: string,
): Promise<void> {
  return context.cancelBackgroundTask(taskId, reason);
}

export function closeCommandBackgroundTask(
  context: ICommandHostContext,
  taskId: string,
): Promise<void> {
  return context.closeBackgroundTask(taskId);
}
