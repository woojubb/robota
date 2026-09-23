/**
 * SCREEN-1993 — the prompt-history file at the path the host names (its user-level `history.jsonl`):
 * one JSON object per line, append-only, owner-only. A derived projection of what the session record
 * already holds, kept so the terminal UI can search prompts across sessions and projects without
 * decoding a record.
 *
 * Writes follow the `NodeSessionLogSink` regime (SEC-020): the directory is made owner-only when the
 * file is constructed, and every append tightens the file before writing with the owner-only mode.
 * Reads walk the file BACKWARDS in fixed blocks so the newest prompts are yielded first and the UI
 * can render them before the rest is read; the file is opened no-follow like every other session
 * file this package reads.
 */
import { appendFileSync, closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  OWNER_ONLY_FILE_MODE,
  ensureOwnerOnlyDirectory,
  tightenExistingFile,
} from '@robota-sdk/agent-core/node';

import type { TUniversalValue } from '@robota-sdk/agent-core';
import type {
  IPromptHistoryBlock,
  IPromptHistoryEntry,
  IPromptHistoryReadOptions,
  IPromptHistorySource,
  IPromptHistoryWriter,
} from '@robota-sdk/agent-interface-session';

const KIB = 1024;
const DEFAULT_BLOCK_KIB = 64;
/** 64 KiB: a few hundred prompts per block — enough for the first frame, small enough to yield often. */
export const DEFAULT_PROMPT_HISTORY_BLOCK_BYTES = DEFAULT_BLOCK_KIB * KIB;
const NEWLINE = 0x0a;

export interface INodePromptHistoryFileOptions {
  /** An ancestor of the file the host also owns, tightened along with the directory (SEC-020). */
  readonly ownedRoot?: string;
  /** Test seam: the read block size in bytes. */
  readonly blockBytes?: number;
}

function isEntry(value: TUniversalValue): value is IPromptHistoryEntry & TUniversalValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, TUniversalValue>;
  return (
    typeof record.at === 'string' &&
    typeof record.sessionId === 'string' &&
    typeof record.project === 'string' &&
    typeof record.text === 'string'
  );
}

/** One line → an entry, or `undefined` when the line is not a well-formed entry. */
export function parsePromptHistoryLine(line: string): IPromptHistoryEntry | undefined {
  if (line.trim().length === 0) return undefined;
  let parsed: TUniversalValue;
  try {
    parsed = JSON.parse(line) as TUniversalValue;
  } catch {
    // allow-fallback: a line JSON cannot parse is exactly what `skippedLines` counts for the caller.
    return undefined;
  }
  if (!isEntry(parsed)) return undefined;
  return { at: parsed.at, sessionId: parsed.sessionId, project: parsed.project, text: parsed.text };
}

function blockOf(lines: readonly string[]): IPromptHistoryBlock {
  const entries: IPromptHistoryEntry[] = [];
  let skippedLines = 0;
  for (const line of lines) {
    if (line.length === 0) continue;
    const entry = parsePromptHistoryLine(line);
    if (entry === undefined) skippedLines += 1;
    else entries.push(entry);
  }
  return { entries, skippedLines };
}

function isMissingFile(error: Error): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

export class NodePromptHistoryFile implements IPromptHistoryWriter, IPromptHistorySource {
  private readonly blockBytes: number;
  private readonly ownedRoot: string | undefined;

  constructor(
    private readonly path: string,
    options: INodePromptHistoryFileOptions = {},
  ) {
    this.blockBytes = options.blockBytes ?? DEFAULT_PROMPT_HISTORY_BLOCK_BYTES;
    this.ownedRoot = options.ownedRoot;
  }

  append(entry: IPromptHistoryEntry): void {
    const directory = dirname(this.path);
    ensureOwnerOnlyDirectory(
      directory,
      this.ownedRoot === undefined ? {} : { withinRoot: this.ownedRoot },
    );
    // SEC-020: `mode` applies only when the file is created; tightening first repairs an older file.
    tightenExistingFile(this.path);
    appendFileSync(this.path, `${JSON.stringify(entry)}\n`, { mode: OWNER_ONLY_FILE_MODE });
  }

  /**
   * Newest-first blocks. Only a missing file is the empty state (a fresh install, or history off);
   * any other open or read failure is thrown so the surface renders it instead of an empty list.
   */
  async *read(options: IPromptHistoryReadOptions): AsyncIterable<IPromptHistoryBlock> {
    let descriptor: number;
    try {
      descriptor = openSync(this.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    } catch (error) {
      if (error instanceof Error && isMissingFile(error)) return;
      throw error;
    }
    try {
      let position = fstatSync(descriptor).size;
      // The bytes after the last newline seen so far: a line the previous block cut in half.
      let carry = Buffer.alloc(0);
      while (position > 0 && !options.signal.aborted) {
        const length = Math.min(this.blockBytes, position);
        position -= length;
        const chunk = Buffer.alloc(length);
        const bytesRead = readSync(descriptor, chunk, 0, length, position);
        const buffer = Buffer.concat([chunk.subarray(0, bytesRead), carry]);
        const firstNewline = position === 0 ? -1 : buffer.indexOf(NEWLINE);
        // Everything before the first newline belongs to a line that continues in the block before.
        carry = firstNewline === -1 && position > 0 ? buffer : buffer.subarray(0, firstNewline + 1);
        const complete =
          position === 0
            ? buffer
            : firstNewline === -1
              ? Buffer.alloc(0)
              : buffer.subarray(firstNewline + 1);
        if (position > 0 && firstNewline === -1) continue;
        const lines = complete.toString('utf8').split('\n').reverse();
        yield blockOf(lines);
      }
    } finally {
      closeSync(descriptor);
    }
  }
}
