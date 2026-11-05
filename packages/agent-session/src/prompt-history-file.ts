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
 * file this package reads. A file built with a sealer appends each entry as one sealed line that
 * opens on its own (`stored-append-lines.ts`), so no line waits for another and the first block
 * still renders before the rest is read.
 */
import { closeSync, constants, fchmodSync, fstatSync, lstatSync, openSync, readSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  OWNER_ONLY_FILE_MODE,
  ensureOwnerOnlyDirectory,
  ownerOnlyGuarantee,
} from '@robota-sdk/agent-core/node';

import { StoredLines, splitStoredLines } from './stored-append-lines.js';
import { sessionSealingOf } from './stored-session-record.js';

import type { ISessionStoreOptions } from './stored-session-record.js';
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

/** The owner id the one prompt history of a user state binds its sealed lines to. */
export const PROMPT_HISTORY_OWNER_ID = 'user';

export interface INodePromptHistoryFileOptions extends ISessionStoreOptions {
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

/**
 * One block's physical lines, newest first, as entries. Each line is read on its own, so nothing in
 * a block waits for another block. Damage and lines a newer build sealed are `skippedLines`; sealed
 * lines this process cannot open now are `unreadable`, reported only when there are some.
 */
function blockOf(lines: readonly string[], stored: StoredLines): IPromptHistoryBlock {
  const entries: IPromptHistoryEntry[] = [];
  let skippedLines = 0;
  let locked = 0;
  let noKeys = 0;
  for (const line of lines) {
    if (line.length === 0) continue;
    const read = stored.decode(line, PROMPT_HISTORY_OWNER_ID);
    if (read.kind === 'locked') {
      if (read.reason === 'no-keys') noKeys += 1;
      else locked += 1;
      continue;
    }
    if (read.kind !== 'lines') {
      skippedLines += 1;
      continue;
    }
    // A record holds its lines oldest first; the block is newest first.
    for (let index = read.lines.length - 1; index >= 0; index -= 1) {
      const entry = parsePromptHistoryLine(read.lines[index] as string);
      if (entry === undefined) skippedLines += 1;
      else entries.push(entry);
    }
  }
  return locked + noKeys === 0
    ? { entries, skippedLines }
    : { entries, skippedLines, unreadable: { locked, noKeys } };
}

function isMissingFile(error: Error): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

export class NodePromptHistoryFile implements IPromptHistoryWriter, IPromptHistorySource {
  private readonly blockBytes: number;
  private readonly ownedRoot: string | undefined;
  private readonly lines: StoredLines;

  /**
   * @param options `sealing` (required): `{ sealer }` appends each entry as one sealed line and
   *   opens sealed lines it reads (plain ones still read); `'plain'` appends plain lines and counts
   *   a sealed line as one no key in this process opens.
   */
  constructor(
    private readonly path: string,
    options: INodePromptHistoryFileOptions,
  ) {
    this.lines = new StoredLines(sessionSealingOf(options), 'prompt-history-line');
    this.blockBytes = options.blockBytes ?? DEFAULT_PROMPT_HISTORY_BLOCK_BYTES;
    this.ownedRoot = options.ownedRoot;
  }

  append(entry: IPromptHistoryEntry): void {
    // Sealed before the file is touched, so a sealing failure writes nothing at all.
    const stored = this.lines.encode(`${JSON.stringify(entry)}\n`, PROMPT_HISTORY_OWNER_ID);
    const directory = dirname(this.path);
    ensureOwnerOnlyDirectory(
      directory,
      this.ownedRoot === undefined
        ? { rejectSymlinks: true }
        : { withinRoot: this.ownedRoot, rejectSymlinks: true },
    );
    if (lstatSync(this.path, { throwIfNoEntry: false })?.isSymbolicLink()) {
      throw new Error('Prompt history must not be a symbolic link.');
    }
    const descriptor = openSync(
      this.path,
      constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
      OWNER_ONLY_FILE_MODE,
    );
    try {
      const metadata = fstatSync(descriptor);
      if (!metadata.isFile()) throw new Error('Prompt history must be a regular file.');
      if (ownerOnlyGuarantee() === 'posix-mode' && (metadata.mode & 0o077) !== 0) {
        fchmodSync(descriptor, OWNER_ONLY_FILE_MODE);
        if ((fstatSync(descriptor).mode & 0o077) !== 0) {
          throw new Error('Prompt history could not be made owner-only.');
        }
      }
      writeFileSync(descriptor, stored);
    } finally {
      closeSync(descriptor);
    }
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
      // The first block yielded holds the end of the file, and so any append still in progress.
      let holdsEnd = true;
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
        const text = complete.toString('utf8');
        const lines = (holdsEnd ? splitStoredLines(text) : text.split('\n')).reverse();
        holdsEnd = false;
        yield blockOf(lines, this.lines);
      }
    } finally {
      closeSync(descriptor);
    }
  }
}
