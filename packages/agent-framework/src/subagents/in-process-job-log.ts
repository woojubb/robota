/**
 * The log of an in-process job, as a surface that follows it reads it.
 *
 * A child-process job writes a transcript file; an in-process job has none, only the session it runs.
 * Its log is that session's conversation from where the job began — the prefix a fork inherited is the
 * parent's, never the job's own — as bounded display lines, paged from the job's start. It exists
 * while the job runs: the runner holds the session no longer than
 * that, and an ended fork's conversation is the fork's record.
 */

import { createUserMessage } from '@robota-sdk/agent-core';
import { DEFAULT_BACKGROUND_TASK_LOG_PAGE_SIZE } from '@robota-sdk/agent-executor';

import type { TUniversalMessage } from '@robota-sdk/agent-core';
import type {
  IBackgroundTaskLogCursor,
  IBackgroundTaskLogPage,
} from '@robota-sdk/agent-interface/execution';

/** Bound each displayed line without splitting a UTF-16 surrogate pair. */
const LINE_LENGTH = 4096;
const PAGE_WIRE_BUDGET = 512 * 1024;
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
  const mirrored =
    message.parts?.some((part) => part.type === 'text' && part.text === text) === true;
  if (!mirrored && (text.length > 0 || message.role !== 'assistant')) {
    const [first = '', ...rest] = text.split(/\r?\n/u);
    lines.push(`${label}: ${first}`, ...rest);
  }
  for (const part of message.parts ?? []) {
    const partText =
      part.type === 'text' ? part.text : part.type === 'resource_embedded' ? part.text : undefined;
    if (partText !== undefined) {
      const [first = '', ...rest] = partText.split(/\r?\n/u);
      lines.push(`${label}: ${first}`, ...rest);
    }
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
  return linesPage(taskId, lines, cursor);
}

function linesPage(
  taskId: string,
  lines: readonly string[],
  cursor: IBackgroundTaskLogCursor | undefined,
): IBackgroundTaskLogPage {
  const from = Math.max(0, Math.trunc(cursor?.offset ?? 0));
  const encoder = new TextEncoder();
  const rowOverhead = encoder.encode(JSON.stringify(taskId)).length * 2 + 256;
  let bytes = 1024;
  let index = Math.min(from, lines.length);
  while (index < lines.length && index - from < DEFAULT_BACKGROUND_TASK_LOG_PAGE_SIZE) {
    const line = lines[index];
    if (line === undefined) break;
    const cost = encoder.encode(JSON.stringify(line)).length + rowOverhead;
    if (index > from && bytes + cost > PAGE_WIRE_BUDGET) break;
    bytes += cost;
    index++;
  }
  return {
    taskId,
    ...(cursor === undefined ? {} : { cursor }),
    ...(index < lines.length ? { nextCursor: { offset: index } } : {}),
    lines: lines.slice(from, index),
  };
}

/** A job-owned log survives changes to the model's compacted context. */
export class InProcessJobLog {
  private readonly lines: string[] = [];
  private readonly seen = new Set<string>();
  private closed = false;

  ignore(history: readonly TUniversalMessage[]): void {
    if (this.closed) return;
    for (const message of history) this.seen.add(message.id);
  }

  startTurn(prompt: string): void {
    if (this.closed) return;
    this.lines.push(...messageLines(createUserMessage(prompt)));
  }

  capture(history: readonly TUniversalMessage[]): void {
    if (this.closed) return;
    for (const message of history) {
      if (this.seen.has(message.id)) continue;
      this.seen.add(message.id);
      if (message.role !== 'system' && message.role !== 'user')
        this.lines.push(...messageLines(message));
    }
  }

  page(taskId: string, cursor: IBackgroundTaskLogCursor | undefined): IBackgroundTaskLogPage {
    return linesPage(taskId, this.lines, cursor);
  }

  clear(): void {
    this.closed = true;
    this.lines.length = 0;
    this.seen.clear();
  }
}
