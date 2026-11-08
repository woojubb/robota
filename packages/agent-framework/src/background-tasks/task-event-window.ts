/**
 * Live follow: the window of a fork job's recent events.
 *
 * A surface that follows a running fork needs what the job is doing now, from the first moment it
 * looks — not only from then on. The parent already receives every event the job emits, so it keeps
 * a small, bounded, in-memory window of them per fork: the rows a follower reads, and nothing more.
 * Nothing about it is saved or sent anywhere — the job's own conversation is the durable record, and
 * a follower that wants more than the window reads it from there. The window goes with the task.
 *
 * The bound holds whatever the job does, because it is on what is kept rather than on what arrives:
 * a row is at most {@link TASK_EVENT_WINDOW_ROW_CHARACTERS} characters (a longer text becomes several
 * rows), and the oldest rows go once there are more than {@link TASK_EVENT_WINDOW_MAX_ROWS} or more
 * than {@link TASK_EVENT_WINDOW_MAX_BYTES} bytes of them. What went is counted, so a reader is told
 * that earlier rows exist instead of seeing a window that looks like the whole story.
 *
 * Platform-neutral: no host pieces. The clock is injected.
 */

import type {
  IExecutionDetailPage,
  IExecutionDetailRecord,
  TExecutionDetailRecordKind,
} from './execution-workspace-types.js';
import type { TBackgroundTaskEvent } from '@robota-sdk/agent-interface/execution';

/** Most rows a window keeps. */
export const TASK_EVENT_WINDOW_MAX_ROWS = 80;
/** Most UTF-8 bytes of row text a window keeps. */
export const TASK_EVENT_WINDOW_MAX_BYTES = 64 * 1024;
/** Most characters in one row; a longer text is several rows. */
export const TASK_EVENT_WINDOW_ROW_CHARACTERS = 2048;

/** A tool's name and its first argument are clipped so a row with its outcome still fits one row. */
const TOOL_LABEL_CHARACTERS = 1024;
const TOOL_ERROR_CHARACTERS = 512;

function droppedNotice(count: number): string {
  return count === 1
    ? '[1 earlier row is not kept here]'
    : `[${count} earlier rows are not kept here]`;
}

interface IWindowRow {
  /** The row's number among every row this window ever made; the row's id is built from it. */
  readonly number: number;
  readonly kind: TExecutionDetailRecordKind;
  text: string;
  bytes: number;
  readonly timestamp: string;
}

interface IOpenToolCall {
  readonly toolName: string;
  readonly label: string;
  readonly row: IWindowRow;
}

export class TaskEventWindow {
  private rows: IWindowRow[] = [];
  private bytes = 0;
  /** Rows ever made, which numbers them. */
  private made = 0;
  /** Rows let go from the front. */
  private dropped = 0;
  /** The text row the next streamed text goes into, until something else is shown. */
  private openText: IWindowRow | undefined;
  /** Tool calls started and not yet ended, oldest first. */
  private openTools: IOpenToolCall[] = [];

  constructor(
    private readonly taskId: string,
    private readonly now: () => string,
  ) {}

  /** Takes one event of the task; the events that only restate the task's state add nothing. */
  record(event: TBackgroundTaskEvent): void {
    if (eventTaskId(event) !== this.taskId) return;
    switch (event.type) {
      case 'background_task_text_delta':
        this.appendText(event.delta);
        return;
      case 'background_task_tool_start':
        this.startTool(event.toolName, event.firstArg);
        return;
      case 'background_task_tool_end':
        this.endTool(event.toolName, event.success, event.error);
        return;
      case 'background_task_permission_request':
        this.pushText('progress', `Waiting for permission: ${event.toolName}`);
        return;
      case 'background_task_completed': {
        const output = event.task.result?.output;
        this.pushText('result', output === undefined || output === '' ? 'Completed' : output);
        return;
      }
      case 'background_task_failed':
        this.pushText('error', event.task.error?.message ?? 'Failed');
        return;
      case 'background_task_cancelled':
        this.pushText('error', 'Cancelled');
        return;
      default:
        return;
    }
  }

  /** A message the person sent to the job, shown where it came in the job's own output. */
  recordSent(prompt: string): void {
    if (prompt === '') return;
    this.pushText('message', `You: ${prompt}`);
  }

  /** The kept rows, oldest first, led by one row that says how many earlier ones are gone. */
  page(entryId: string): IExecutionDetailPage {
    const records: IExecutionDetailRecord[] = this.rows.map((row) => ({
      id: `${entryId}:w:${row.number}`,
      kind: row.kind,
      text: row.text,
      timestamp: row.timestamp,
    }));
    if (this.dropped > 0) {
      records.unshift({
        id: `${entryId}:w:earlier`,
        kind: 'progress',
        text: droppedNotice(this.dropped),
      });
    }
    return { entryId, records };
  }

  private appendText(delta: string): void {
    let rest = delta;
    while (rest.length > 0) {
      let row = this.openText;
      if (row === undefined || row.text.length >= TASK_EVENT_WINDOW_ROW_CHARACTERS) {
        row = this.makeRow('message', '');
        this.openText = row;
      }
      const piece = leadingCharacters(rest, TASK_EVENT_WINDOW_ROW_CHARACTERS - row.text.length);
      if (piece === '') {
        // The next character does not fit what is left of this row: it starts the next one.
        this.openText = undefined;
        continue;
      }
      this.setText(row, row.text + piece);
      rest = rest.slice(piece.length);
      this.trim();
    }
  }

  private startTool(toolName: string, firstArg: string | undefined): void {
    this.openText = undefined;
    const label = clip(
      firstArg === undefined || firstArg === '' ? toolName : `${toolName} ${firstArg}`,
      TOOL_LABEL_CHARACTERS,
    );
    const row = this.makeRow('tool_activity', `${label} — running`);
    this.openTools.push({ toolName, label, row });
    this.trim();
  }

  private endTool(toolName: string, success: boolean, error: string | undefined): void {
    this.openText = undefined;
    const outcome = success
      ? 'done'
      : error === undefined || error === ''
        ? 'failed'
        : `failed: ${clip(error, TOOL_ERROR_CHARACTERS)}`;
    const index = this.openTools.findIndex((open) => open.toolName === toolName);
    if (index === -1) {
      // The start was never seen (or has gone from the window): the end is shown alone.
      this.makeRow('tool_activity', `${clip(toolName, TOOL_LABEL_CHARACTERS)} — ${outcome}`);
      this.trim();
      return;
    }
    const [open] = this.openTools.splice(index, 1);
    if (open === undefined) return;
    this.setText(open.row, `${open.label} — ${outcome}`);
    this.trim();
  }

  /** Shows `text` as one row, or as several when it is longer than a row. */
  private pushText(kind: TExecutionDetailRecordKind, text: string): void {
    this.openText = undefined;
    let rest = text;
    while (rest.length > 0) {
      const piece = leadingCharacters(rest, TASK_EVENT_WINDOW_ROW_CHARACTERS);
      this.makeRow(kind, piece);
      rest = rest.slice(piece.length);
      this.trim();
    }
  }

  private makeRow(kind: TExecutionDetailRecordKind, text: string): IWindowRow {
    const row: IWindowRow = {
      number: this.made,
      kind,
      text,
      bytes: utf8Length(text),
      timestamp: this.now(),
    };
    this.made += 1;
    this.bytes += row.bytes;
    this.rows.push(row);
    return row;
  }

  private setText(row: IWindowRow, text: string): void {
    const bytes = utf8Length(text);
    this.bytes += bytes - row.bytes;
    row.text = text;
    row.bytes = bytes;
  }

  /** Lets the oldest rows go until the window is within its bounds; the newest row always stays. */
  private trim(): void {
    while (
      this.rows.length > 1 &&
      (this.rows.length > TASK_EVENT_WINDOW_MAX_ROWS - (this.dropped > 0 ? 1 : 0) ||
        this.bytes + (this.dropped > 0 ? utf8Length(droppedNotice(this.dropped)) : 0) >
          TASK_EVENT_WINDOW_MAX_BYTES)
    ) {
      const gone = this.rows.shift();
      if (gone === undefined) return;
      this.bytes -= gone.bytes;
      this.dropped += 1;
      if (this.openText === gone) this.openText = undefined;
      this.openTools = this.openTools.filter((open) => open.row !== gone);
    }
  }
}

/**
 * The windows of one session: one per fork job, made when the fork's first event arrives and freed
 * when the task is closed. A task that is not a fork has none — the bound is on what a session holds,
 * so only the jobs a surface can follow are held at all.
 */
export class TaskEventWindows {
  private readonly windows = new Map<string, TaskEventWindow>();

  constructor(
    /** Whether the task is a fork job. */
    private readonly isFork: (taskId: string) => boolean,
    private readonly now: () => string,
  ) {}

  record(event: TBackgroundTaskEvent): void {
    const taskId = eventTaskId(event);
    if (event.type === 'background_task_closed') {
      this.windows.delete(taskId);
      return;
    }
    let window = this.windows.get(taskId);
    if (window === undefined) {
      if (!this.isFork(taskId)) return;
      window = new TaskEventWindow(taskId, this.now);
      this.windows.set(taskId, window);
    }
    window.record(event);
  }

  /** Shows a message the person sent to a job; false when the job has no window to show it in. */
  recordSent(taskId: string, prompt: string): boolean {
    const window = this.windows.get(taskId);
    if (window === undefined) return false;
    window.recordSent(prompt);
    return true;
  }

  has(taskId: string): boolean {
    return this.windows.has(taskId);
  }

  page(taskId: string, entryId: string): IExecutionDetailPage | undefined {
    return this.windows.get(taskId)?.page(entryId);
  }

  clear(): void {
    this.windows.clear();
  }
}

function eventTaskId(event: TBackgroundTaskEvent): string {
  return 'task' in event ? event.task.id : event.taskId;
}

/**
 * At most `room` characters from the start of `text`, never ending between the two halves of one
 * character; empty when the first character alone does not fit.
 */
function leadingCharacters(text: string, room: number): string {
  if (text.length <= room) return text;
  let end = room;
  if (isHighSurrogate(text.charCodeAt(end - 1)) && isLowSurrogate(text.charCodeAt(end))) end -= 1;
  return text.slice(0, end);
}

/** `text` cut to at most `limit` characters, with an ellipsis when something was cut. */
function clip(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${leadingCharacters(text, limit - 1)}…`;
}

/** The UTF-8 length of `text`, counted the way a UTF-8 encoder writes it (a lone surrogate is three). */
function utf8Length(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit < 0x80) {
      bytes += 1;
    } else if (unit < 0x800) {
      bytes += 2;
    } else if (isHighSurrogate(unit) && isLowSurrogate(text.charCodeAt(index + 1))) {
      bytes += 4;
      index += 1;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function isHighSurrogate(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff;
}

function isLowSurrogate(unit: number): boolean {
  return unit >= 0xdc00 && unit <= 0xdfff;
}
