import type { IBackgroundTaskState } from '../background-tasks/index.js';
import type { InteractiveSession } from '../interactive/interactive-session.js';
import type { ICommandResult } from './system-command.js';

const DECIMAL_RADIX = 10;

function parseCommandParts(args: string): string[] {
  return args.trim().split(/\s+/).filter(Boolean);
}

function formatBackgroundTask(task: IBackgroundTaskState): string {
  const preview = task.promptPreview ?? task.commandPreview ?? '';
  const unread = task.unread ? ' unread' : '';
  const action = task.currentAction ? ` (${task.currentAction})` : '';
  const timeout = task.timeoutReason ? ` timeout=${task.timeoutReason}` : '';
  const activity = task.lastActivityAt ? ` lastActivityAt=${task.lastActivityAt}` : '';
  const suffix = preview ? ` — ${preview}` : '';
  return `${task.id} [${task.status}${unread}${timeout}${activity}] ${task.kind}:${task.label}${action}${suffix}`;
}

function formatBackgroundTaskList(tasks: IBackgroundTaskState[]): string {
  if (tasks.length === 0) return 'No background tasks.';
  return ['Background tasks:', ...tasks.map((task) => `  ${formatBackgroundTask(task)}`)].join(
    '\n',
  );
}

function parseCursor(value?: string): { offset: number } | undefined {
  if (!value) return undefined;
  const offset = Number.parseInt(value, DECIMAL_RADIX);
  return Number.isNaN(offset) ? undefined : { offset };
}

export async function executeBackgroundCommand(
  session: InteractiveSession,
  args: string,
): Promise<ICommandResult> {
  const [action = 'list', taskId, ...reasonParts] = parseCommandParts(args);
  if (action === 'list') {
    const tasks = session.listBackgroundTasks();
    return {
      message: formatBackgroundTaskList(tasks),
      success: true,
      data: { count: tasks.length },
    };
  }

  if (!taskId) {
    return {
      message:
        'Usage: background list | background read <task-id> [offset] | background cancel <task-id> | background close <task-id>',
      success: false,
    };
  }

  if (action === 'read' || action === 'log' || action === 'open') {
    const page = await session.readBackgroundTaskLog(taskId, parseCursor(reasonParts[0]));
    const next = page.nextCursor ? `\nNext offset: ${page.nextCursor.offset}` : '';
    return {
      message:
        page.lines.length > 0 ? `${page.lines.join('\n')}${next}` : `No log lines: ${taskId}`,
      success: true,
      data: { taskId, nextOffset: page.nextCursor?.offset },
    };
  }

  if (action === 'cancel' || action === 'stop') {
    await session.cancelBackgroundTask(taskId, reasonParts.join(' ') || undefined);
    return { message: `Background task cancelled: ${taskId}`, success: true, data: { taskId } };
  }

  if (action === 'close' || action === 'dismiss') {
    await session.closeBackgroundTask(taskId);
    return { message: `Background task closed: ${taskId}`, success: true, data: { taskId } };
  }

  return { message: `Unknown background action: ${action}`, success: false };
}
