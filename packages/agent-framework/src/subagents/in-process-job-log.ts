/**
 * #3679 3f: the log of an in-process job, as a surface that follows it reads it.
 *
 * A child-process job writes a transcript file; an in-process job has none, only the session it runs.
 * Its log is that session's conversation from where the job began — the prefix a fork inherited is the
 * parent's, never the job's own — as display lines, paged by message with the cursor counting messages
 * from the job's start. It exists while the job runs: the runner holds the session no longer than
 * that, and an ended fork's conversation is the fork's record.
 */

import { DEFAULT_BACKGROUND_TASK_LOG_PAGE_SIZE } from '@robota-sdk/agent-executor';

import type { TUniversalMessage } from '@robota-sdk/agent-core';
import type {
  IBackgroundTaskLogCursor,
  IBackgroundTaskLogPage,
} from '@robota-sdk/agent-interface-execution';

/** The longest text one message shows in the log; the conversation keeps the rest. */
const MESSAGE_TEXT_LIMIT = 4096;
const TOOL_ARGUMENT_LIMIT = 200;

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/** One message as display lines: its first line says who spoke, and a tool call is one line. */
export function messageLines(message: TUniversalMessage): string[] {
  const text = typeof message.content === 'string' ? clip(message.content, MESSAGE_TEXT_LIMIT) : '';
  const label = message.role === 'tool' ? `tool ${message.name ?? ''}`.trimEnd() : message.role;
  const lines: string[] = [];
  if (text.length > 0 || message.role !== 'assistant') {
    const [first = '', ...rest] = text.split(/\r?\n/u);
    lines.push(`${label}: ${first}`, ...rest);
  }
  if (message.role === 'assistant') {
    for (const call of message.toolCalls ?? []) {
      lines.push(
        `assistant tool call: ${call.function.name}(${clip(call.function.arguments, TOOL_ARGUMENT_LIMIT)})`,
      );
    }
  }
  return lines;
}

/**
 * The messages a log counts: what was said and done. The prompt the session was assembled with is not
 * something the job said or was told, so it is no entry of the log and takes no offset.
 */
export function logMessages(history: readonly TUniversalMessage[]): TUniversalMessage[] {
  return history.filter((message) => message.role !== 'system');
}

/** The page of the log at `cursor`, counting from `start`: whole messages, at least one. */
export function jobLogPage(
  taskId: string,
  history: readonly TUniversalMessage[],
  start: number,
  cursor: IBackgroundTaskLogCursor | undefined,
): IBackgroundTaskLogPage {
  const messages = logMessages(history);
  const lines: string[] = [];
  const from = Math.max(0, Math.trunc(cursor?.offset ?? 0)) + start;
  let index = Math.min(from, messages.length);
  while (index < messages.length && lines.length < DEFAULT_BACKGROUND_TASK_LOG_PAGE_SIZE) {
    lines.push(...messageLines(messages[index] as TUniversalMessage));
    index += 1;
  }
  return {
    taskId,
    ...(cursor === undefined ? {} : { cursor }),
    ...(index < messages.length ? { nextCursor: { offset: index - start } } : {}),
    lines,
  };
}
