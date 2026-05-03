import type { ICommandHostContext, ICommandResult } from '@robota-sdk/agent-sdk';
import {
  BACKGROUND_COMMAND_USAGE,
  cancelCommandBackgroundTask,
  closeCommandBackgroundTask,
  formatCommandBackgroundTaskList,
  listCommandBackgroundTasks,
  parseCommandBackgroundLogCursor,
  readCommandBackgroundTaskLog,
} from '@robota-sdk/agent-sdk';

function parseCommandParts(args: string): string[] {
  return args.trim().split(/\s+/).filter(Boolean);
}

export async function executeBackgroundCommand(
  context: ICommandHostContext,
  args: string,
): Promise<ICommandResult> {
  const [action = 'list', taskId, ...reasonParts] = parseCommandParts(args);
  if (action === 'list') {
    const tasks = listCommandBackgroundTasks(context);
    return {
      message: formatCommandBackgroundTaskList(tasks),
      success: true,
      data: { count: tasks.length },
    };
  }

  if (!taskId) {
    return {
      message: BACKGROUND_COMMAND_USAGE,
      success: false,
    };
  }

  if (action === 'read' || action === 'log' || action === 'open') {
    const page = await readCommandBackgroundTaskLog(
      context,
      taskId,
      parseCommandBackgroundLogCursor(reasonParts[0]),
    );
    const next = page.nextCursor ? `\nNext offset: ${page.nextCursor.offset}` : '';
    return {
      message:
        page.lines.length > 0 ? `${page.lines.join('\n')}${next}` : `No log lines: ${taskId}`,
      success: true,
      data: { taskId, nextOffset: page.nextCursor?.offset },
    };
  }

  if (action === 'cancel' || action === 'stop') {
    await cancelCommandBackgroundTask(context, taskId, reasonParts.join(' ') || undefined);
    return { message: `Background task cancelled: ${taskId}`, success: true, data: { taskId } };
  }

  if (action === 'close' || action === 'dismiss') {
    await closeCommandBackgroundTask(context, taskId);
    return { message: `Background task closed: ${taskId}`, success: true, data: { taskId } };
  }

  return { message: `Unknown background action: ${action}`, success: false };
}
