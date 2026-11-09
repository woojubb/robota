/**
 * The subagent transcript: where a subagent's session log is, the logger the child writes it with,
 * and the paged read the parent shows it through.
 *
 * Log structure:
 *   {baseLogsDir}/{parentSessionId}/subagents/{logSessionId}.jsonl
 *
 * The child and the parent derive the path from the one rule here. The log is named for the session
 * the child runs — the resumed record for a fork job, else the task — and a sealed log is bound to
 * that same id, so a reader that guessed another name would find nothing, or records that do not
 * open.
 *
 * A log that holds no sealed record pages by display lines. One that does counts STORED records
 * (physical lines), never display lines: an offset then names the same record whether the keys are
 * locked or not, and only the records on the page are opened.
 */

import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

import { isSealedArtifactLine } from '@robota-sdk/agent-core';
import { ensureOwnerOnlyDirectory } from '@robota-sdk/agent-core/node';
import { DEFAULT_BACKGROUND_TASK_LOG_PAGE_SIZE } from '@robota-sdk/agent-executor';
import { FileSessionLogger } from '@robota-sdk/agent-session';
import {
  NodeSessionLogSink,
  StoredLines,
  migrateSessionLogDirectory,
  registerProcessExitFlush,
  sessionSealingOf,
  splitStoredLines,
} from '@robota-sdk/agent-session/node';

import { NodeFileSystem } from '../adapters/node-file-system.js';

import type { IFileSystem, TArtifactLockedReason } from '@robota-sdk/agent-core';
import type {
  IMigrateSessionLogsOptions,
  ISessionLogCatchUpFailure,
  ISessionLogMigration,
  ISessionStoreOptions,
} from '@robota-sdk/agent-session/node';

/** The directory under a parent session's log folder that holds its subagents' logs. */
const SUBAGENT_LOG_DIRECTORY = 'subagents';

/** The session id a subagent's log is named and sealed under: the resumed record's, else the task's. */
export function resolveSubagentLogSessionId(
  request: { readonly resumeSessionId?: string },
  taskId: string,
): string {
  return request.resumeSessionId ?? taskId;
}

/** The one path rule the child (writing) and the parent (reading) both use. */
export function resolveSubagentTranscriptPath(
  baseLogsDir: string,
  parentSessionId: string,
  logSessionId: string,
): string {
  return join(resolveSubagentLogDir(parentSessionId, baseLogsDir), `${logSessionId}.jsonl`);
}

/**
 * Create a FileSessionLogger for a subagent session.
 *
 * The logger writes JSONL files into a `subagents/` subdirectory under the
 * parent session's log folder. The directory is created if it does not exist.
 *
 * @param parentSessionId - ID of the parent session (used as directory name)
 * @param agentId - Unique identifier for this subagent run
 * @param baseLogsDir - Root logs directory (e.g., `.agent/logs`)
 * @param options - `sealing` (required), as for the session stores: `{ sealer }` seals every record
 *   of the log, `'plain'` writes it plain
 * @param fs - the file system the directory is made in
 * @returns A FileSessionLogger writing to the subagent directory
 */
export function createSubagentLogger(
  parentSessionId: string,
  _agentId: string,
  baseLogsDir: string,
  options: ISessionStoreOptions,
  fs: IFileSystem = new NodeFileSystem(),
): FileSessionLogger {
  const subagentDir = resolveSubagentLogDir(parentSessionId, baseLogsDir);
  ensureOwnerOnlyDirectory(subagentDir, {
    withinRoot: baseLogsDir,
    rejectSymlinks: true,
    makeDirectory: (directory, mode) => fs.mkdirSync(directory, { recursive: true, mode }),
  });
  return new FileSessionLogger(new NodeSessionLogSink(subagentDir, options), {
    registerExitFlush: registerProcessExitFlush,
  });
}

/**
 * Resolve the subagent log directory path without creating it.
 *
 * Useful when the caller needs the path for display or configuration
 * but does not want to create the directory immediately.
 *
 * @param parentSessionId - ID of the parent session
 * @param baseLogsDir - Root logs directory
 * @returns The resolved subagent log directory path
 */
export function resolveSubagentLogDir(parentSessionId: string, baseLogsDir: string): string {
  return join(baseLogsDir, parentSessionId, SUBAGENT_LOG_DIRECTORY);
}

/** What a migration of every subagent transcript under one root did, or (planning) would do. */
export interface ISubagentTranscriptMigration extends ISessionLogMigration {
  /** Parent directories holding a `subagents/` directory that were visited. */
  readonly directories: number;
}

/**
 * Seals in place every subagent transcript a host wrote in plaintext under `baseLogsDir`:
 * each parent's `subagents/` directory, as `migrateSessionLogDirectory` seals one, `baseLogsDir`
 * being the root the host owns. A parent entry that is a link is never followed and is reported.
 */
export async function migrateSubagentTranscripts(
  baseLogsDir: string,
  options: Omit<IMigrateSessionLogsOptions, 'ownedRoot'>,
): Promise<ISubagentTranscriptMigration> {
  const total = {
    directories: 0,
    logs: 0,
    lines: 0,
    payloads: 0,
    alreadySealed: 0,
    unopenable: [] as string[],
    refused: [] as string[],
    changed: [] as string[],
    catchUpFailed: [] as ISessionLogCatchUpFailure[],
    staleTemporaries: 0,
  };
  let parents: string[];
  try {
    if (!lstatSync(baseLogsDir).isDirectory()) return { ...total, refused: [baseLogsDir] };
    parents = readdirSync(baseLogsDir).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return total;
    throw error;
  }
  for (const parent of parents) {
    const parentPath = join(baseLogsDir, parent);
    const metadata = lstatSync(parentPath, { throwIfNoEntry: false });
    if (metadata === undefined || metadata.isFile()) continue;
    if (!metadata.isDirectory()) {
      total.refused.push(parentPath);
      continue;
    }
    const directory = resolveSubagentLogDir(parent, baseLogsDir);
    if (lstatSync(directory, { throwIfNoEntry: false }) === undefined) continue;
    total.directories += 1;
    const migrated = await migrateSessionLogDirectory(directory, {
      ...options,
      ownedRoot: baseLogsDir,
    });
    total.logs += migrated.logs;
    total.lines += migrated.lines;
    total.payloads += migrated.payloads;
    total.alreadySealed += migrated.alreadySealed;
    total.unopenable.push(...migrated.unopenable);
    total.refused.push(...migrated.refused);
    total.changed.push(...migrated.changed);
    total.catchUpFailed.push(...migrated.catchUpFailed);
    total.staleTemporaries += migrated.staleTemporaries;
  }
  return total;
}

/** How many of a transcript's records could not be shown as content, by why. */
export interface ISubagentTranscriptUnreadable {
  /** Sealed and intact; the keys are locked, and an unlock shows them. */
  readonly locked: number;
  /** Sealed and intact; this process holds no keys at all, so no unlock here shows them. */
  readonly noKeys: number;
  /** Damaged, sealed with other keys, or sealed by a newer build. */
  readonly doesNotOpen: number;
}

/** One page of a transcript, as display lines. */
export interface ISubagentTranscriptPage {
  /** Plain lines, the lines of opened records, and a fixed line for what could not be opened. */
  readonly lines: readonly string[];
  /** The stored-record offset the next page starts at; absent on the last page. */
  readonly nextOffset?: number;
  /** Present only when some record on the page could not be shown as content. */
  readonly unreadable?: ISubagentTranscriptUnreadable;
}

export interface IReadSubagentTranscriptPageOptions extends ISessionStoreOptions {
  /** The stored record the page starts at. */
  readonly offset?: number;
  /** A page holds whole records until it has at least this many display lines. */
  readonly pageLines?: number;
}

/** Fixed text: a count and nothing read from the records, so it carries no content, key or path. */
function lockedRunLine(reason: TArtifactLockedReason, count: number): string {
  const records = count === 1 ? '1 sealed log record' : `${count} sealed log records`;
  return reason === 'no-keys'
    ? `[${records}; this process has no keys to open ${count === 1 ? 'it' : 'them'}]`
    : `[${records}; the keys are locked]`;
}

const DOES_NOT_OPEN_LINE = '[a sealed log record here does not open]';
const NEWER_FORMAT_LINE = '[a log record here was sealed by a newer build]';

/** `Array.prototype.slice`'s reading of a start offset, as plain pages have it. */
function startIndex(offset: number, count: number): number {
  const relative = Math.trunc(offset) || 0;
  return relative < 0 ? Math.max(count + relative, 0) : Math.min(relative, count);
}

/**
 * A page of a plain transcript: its non-empty lines, from `offset` with `slice`'s reading of it, and
 * the next offset arithmetic too — a negative or non-numeric offset included.
 */
function plainTranscriptPage(
  text: string,
  offset: number,
  pageLines: number,
): ISubagentTranscriptPage {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const next = Math.min(offset + pageLines, lines.length);
  return { lines: lines.slice(offset, next), ...(next < lines.length ? { nextOffset: next } : {}) };
}

/**
 * One page of the transcript at `transcriptPath`, from `offset`, opened with `sealing` (required).
 * Never throws for what a record holds; `undefined` when there is no transcript. A transcript with
 * no sealed record pages by its plain lines. In one with sealed records `offset` is a stored record:
 * a run of locked records reads as one fixed line, each record that does not open or was sealed by a
 * newer build as one of its own, and a sealed record still being appended at the end of the file is
 * not a record yet.
 */
export function readSubagentTranscriptPage(
  transcriptPath: string,
  options: IReadSubagentTranscriptPageOptions,
): ISubagentTranscriptPage | undefined {
  const sealing = sessionSealingOf(options);
  if (!existsSync(transcriptPath)) return undefined;
  const text = readFileSync(transcriptPath, 'utf8');
  // The stores' one rule for an append in progress drops it before anything else looks at the file,
  // so a first sealed record cut short never reads as a plain line.
  const physicalLines = splitStoredLines(text);
  const pageLines = options.pageLines ?? DEFAULT_BACKGROUND_TASK_LOG_PAGE_SIZE;
  if (!physicalLines.some(isSealedArtifactLine)) {
    // Joined back, the lines are `text` itself, or `text` up to the newline before what was dropped.
    const wholeLines = text.slice(0, physicalLines.join('\n').length + 1);
    return plainTranscriptPage(wholeLines, options.offset ?? 0, pageLines);
  }
  const records = physicalLines
    .map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))
    .filter((line) => line.length > 0);
  const stored = new StoredLines(sealing, 'session-log-line');
  const ownerId = basename(transcriptPath, extname(transcriptPath));
  const unreadable = { locked: 0, noKeys: 0, doesNotOpen: 0 };
  const lines: string[] = [];
  let run: { reason: TArtifactLockedReason; count: number; at: number } | undefined;
  let index = startIndex(options.offset ?? 0, records.length);
  while (index < records.length && lines.length < pageLines) {
    const record = stored.decode(records[index] as string, ownerId);
    index += 1;
    if (record.kind === 'locked') {
      unreadable[record.reason === 'no-keys' ? 'noKeys' : 'locked'] += 1;
      if (run?.reason === record.reason) {
        run.count += 1;
      } else {
        run = { reason: record.reason, count: 1, at: lines.length };
        lines.push('');
      }
      lines[run.at] = lockedRunLine(run.reason, run.count);
      continue;
    }
    run = undefined;
    if (record.kind === 'lines') {
      lines.push(...record.lines);
    } else {
      unreadable.doesNotOpen += 1;
      lines.push(record.kind === 'newer-format' ? NEWER_FORMAT_LINE : DOES_NOT_OPEN_LINE);
    }
  }
  const anyUnreadable = unreadable.locked + unreadable.noKeys + unreadable.doesNotOpen > 0;
  return {
    lines,
    ...(index < records.length ? { nextOffset: index } : {}),
    ...(anyUnreadable ? { unreadable } : {}),
  };
}
