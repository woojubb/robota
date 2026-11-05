/**
 * #3679 3f: the log of an in-process job, as a surface that follows it reads it.
 *
 * A child-process job writes a transcript file; an in-process job has none, only the session it runs.
 * Its log is that session's conversation from where the job began — the prefix a fork inherited is the
 * parent's, never the job's own — as bounded display lines, paged from the job's start. It exists
 * while the job runs: the runner holds the session no longer than
 * that, and an ended fork's conversation is the fork's record.
 */

import { DEFAULT_BACKGROUND_TASK_LOG_PAGE_SIZE } from '@robota-sdk/agent-executor';

import type { TUniversalMessage } from '@robota-sdk/agent-core';
import type {
  IBackgroundTaskLogCursor,
  IBackgroundTaskLogPage,
} from '@robota-sdk/agent-interface-execution';

/** Bound each displayed line without splitting a UTF-16 surrogate pair. */
const LINE_LENGTH = 4096;
function splitLongLine(text: string): string[] {
  const result: string[] = [];
  let remaining = text;
  while (remaining.length > LINE_LENGTH) {
    let end = LINE_LENGTH;
    const code = remaining.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff) end--;
    result.push(remaining.slice(0, end));
    remaining = remaining.slice(end);
  }
  result.push(remaining);
  return result;
}

/** One message as display lines: its first line says who spoke, and a tool call is one line. */
export function messageLines(message: TUniversalMessage): string[] {
  const text = typeof message.content === 'string' ? message.content : '';
  const label = message.role === 'tool' ? `tool ${message.name ?? ''}`.trimEnd() : message.role;
  const lines: string[] = [];
  if (text.length > 0 || message.role !== 'assistant') {
    const [first = '', ...rest] = text.split(/\r?\n/u);
    lines.push(`${label}: ${first}`, ...rest);
  }
  if (message.role === 'assistant') {
    for (const call of message.toolCalls ?? []) {
      lines.push(`assistant tool call: ${call.function.name}(${call.function.arguments})`);
    }
  }
  return lines.flatMap(splitLongLine);
}

/**
 * The messages a log counts: what was said and done. The prompt the session was assembled with is not
 * something the job said or was told, so it is no entry of the log and takes no offset.
 */
export function logMessages(history: readonly TUniversalMessage[]): TUniversalMessage[] {
  return history.filter((message) => message.role !== 'system');
}

/** The page of display lines at `cursor`, after the inherited message prefix. */
export function jobLogPage(
  taskId: string,
  history: readonly TUniversalMessage[],
  start: number,
  cursor: IBackgroundTaskLogCursor | undefined,
): IBackgroundTaskLogPage {
  const lines = logMessages(history).slice(start).flatMap(messageLines);
  const from = Math.max(0, Math.trunc(cursor?.offset ?? 0));
  const index = Math.min(from + DEFAULT_BACKGROUND_TASK_LOG_PAGE_SIZE, lines.length);
  return {
    taskId,
    ...(cursor === undefined ? {} : { cursor }),
    ...(index < lines.length ? { nextCursor: { offset: index } } : {}),
    lines: lines.slice(from, index),
  };
}
