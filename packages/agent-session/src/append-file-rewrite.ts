/**
 * Rewriting a file other processes append to by path, without losing what they append meanwhile
 * (#3679): the prompt history's compaction and the sealing of a plain session log in place both go
 * through here, so the two agree on what a snapshot is and how a late append is caught up.
 *
 * Such a file has no lock, so it cannot be rewritten in place. The new file is written beside it and
 * renamed over it, and what reached the old one meanwhile is caught up:
 *
 * 1. The snapshot is the old file up to just after its last newline; anything after that is an
 *    append still in progress and is left to the catch-up.
 * 2. Every line of the snapshot goes through the caller's rewriter into a temporary file, which is
 *    flushed and renamed over the original, and the directory is flushed.
 * 3. An append that opened the old file before the rename still lands in it, so the old descriptor
 *    is read from the snapshot's end until it stays quiet, and what it finds is rewritten onto the new
 *    file. A catch-up that fails part-way is reported with how much of the old file it left unread,
 *    since what was appended there is lost with the old file.
 * 4. The new file is read once more. A plain line there is plaintext an older build appended by path
 *    after the rename; it is counted for the caller to report, never hidden.
 *
 * Windows will not replace a file while any handle on it is open, this process's own included, so
 * there the order changes: the catch-up of step 3 runs before the rename, then the old descriptor is
 * released and the rename is made, retried a few times while another handle still holds the file. A
 * writer that holds the file open therefore blocks the rename instead of appending after it, and a
 * catch-up that fails abandons the rewrite with nothing replaced. What cannot be caught there is an
 * append that lands between the last read of the old file and the rename, an instant no platform
 * primitive closes; step 4 still reports plaintext that reaches the new file afterwards.
 *
 * Just before the rename the path must still name the file that was opened: another rewrite that
 * renamed its own file in meanwhile holds what was appended since, and renaming over it would lose
 * that, so the rewrite is abandoned instead (a rewrite that renames in the instant between that look
 * and the rename is not caught; cooperating callers keep two rewrites from running at all). A file
 * deleted meanwhile is not put back either.
 *
 * A file that is not a regular file of its own — a symbolic link or a second hard link, as a dotfile
 * sync makes — is refused: the rename would replace the link and leave the plaintext where it points.
 */
import { randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { isSealedArtifactLine } from '@robota-sdk/agent-core';
import { OWNER_ONLY_FILE_MODE, ensureOwnerOnlyDirectory } from '@robota-sdk/agent-core/node';

import { splitStoredLines } from './stored-append-lines.js';

import type { IStoredLineSink } from './stored-append-lines.js';

const NEWLINE_BYTE = 0x0a;
/** Writes are batched up to this many bytes. */
const WRITE_BATCH_BYTES = 1024 * 1024;
/** Quiet passes, each after a pause, before the old file counts as stable. */
const QUIET_PASSES = 2;
const DEFAULT_PAUSE_MS = 20;
const TEMPORARY_SUFFIX_BYTES = 6;
/** Renames tried where an open handle blocks the replacement (Windows) before the failure is raised. */
const BUSY_RENAME_ATTEMPTS = 10;
/** What a rename over a file another handle holds open fails with on Windows. */
const BUSY_RENAME_CODES: ReadonlySet<string> = new Set(['EPERM', 'EBUSY', 'EACCES']);

/** Why a file was left as it is. */
export type TAppendFileRefusal =
  /** A symbolic link, a directory, or anything else that is not a regular file. */
  | 'not-a-regular-file'
  /** A regular file with another name too, which a rename would leave holding the old bytes. */
  | 'hard-linked';

export type TOpenedAppendFile =
  | { readonly status: 'missing' }
  | { readonly status: 'refused'; readonly reason: TAppendFileRefusal }
  | { readonly status: 'open'; readonly descriptor: number };

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

/** What a `bigint` stat says of which file it looked at. */
export interface IFileIdentity {
  readonly ino: bigint;
  readonly dev: bigint;
}

/**
 * Whether `named`, a look at a path (`lstat`), and `held`, a look at an open descriptor (`fstat`),
 * are the same file. Both are read with `bigint`, so a 64-bit file index is compared exactly.
 *
 * POSIX compares the inode and the device. A Windows path has no device number to give: `lstat`
 * reports 0 where `fstat` of a descriptor reports the volume serial, so the two never agree and only
 * the file index is compared there. That is the platform's limit, not a choice: a file with the same
 * index on another volume would pass. A file index of 0 means the filesystem reports no identity, so
 * nothing can be compared and the two do not count as the same.
 */
export function isSameFileIdentity(
  named: IFileIdentity,
  held: IFileIdentity,
  platform: string = process.platform,
): boolean {
  if (platform === 'win32') return named.ino !== 0n && named.ino === held.ino;
  return named.ino === held.ino && named.dev === held.dev;
}

/** The file opened for reading, after the checks that make it safe to replace by rename. */
export function openAppendFile(path: string): TOpenedAppendFile {
  let linked;
  try {
    linked = lstatSync(path, { bigint: true });
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return { status: 'missing' };
    throw error;
  }
  if (!linked.isFile()) return { status: 'refused', reason: 'not-a-regular-file' };
  let descriptor: number;
  try {
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return { status: 'missing' };
    if (errorCode(error) === 'ELOOP') return { status: 'refused', reason: 'not-a-regular-file' };
    throw error;
  }
  const opened = fstatSync(descriptor, { bigint: true });
  // Replaced between the two looks: what was opened is not the file that was checked.
  const sameFile = opened.isFile() && isSameFileIdentity(linked, opened);
  if (!sameFile || opened.nlink > 1n) {
    closeSync(descriptor);
    return { status: 'refused', reason: sameFile ? 'hard-linked' : 'not-a-regular-file' };
  }
  return { status: 'open', descriptor };
}

function readRange(descriptor: number, from: number, to: number): Buffer {
  const buffer = Buffer.alloc(Math.max(0, to - from));
  let filled = 0;
  while (filled < buffer.length) {
    const bytesRead = readSync(descriptor, buffer, filled, buffer.length - filled, from + filled);
    if (bytesRead === 0) break;
    filled += bytesRead;
  }
  return buffer.subarray(0, filled);
}

/** The whole of an opened file, as its descriptor reports it now. */
export function readWhole(descriptor: number): Buffer {
  return readRange(descriptor, 0, fstatSync(descriptor).size);
}

/** The physical lines of `buffer`, which ends with a newline or is empty. */
function* linesOf(buffer: Buffer): Generator<string> {
  let start = 0;
  while (start < buffer.length) {
    const end = buffer.indexOf(NEWLINE_BYTE, start);
    const stop = end === -1 ? buffer.length : end;
    yield buffer.toString('utf8', start, stop);
    start = stop + 1;
  }
}

function writeAll(descriptor: number, text: string): void {
  const bytes = Buffer.from(text, 'utf8');
  let written = 0;
  while (written < bytes.length) {
    written += writeSync(descriptor, bytes, written, bytes.length - written);
  }
}

/** Batches writes to one descriptor. */
class BatchedWriter {
  #parts: string[] = [];
  #length = 0;

  constructor(private readonly descriptor: number) {}

  write(text: string): void {
    this.#parts.push(text);
    this.#length += text.length;
    if (this.#length >= WRITE_BATCH_BYTES) this.flush();
  }

  flush(): void {
    if (this.#parts.length === 0) return;
    writeAll(this.descriptor, this.#parts.join(''));
    this.#parts = [];
    this.#length = 0;
  }
}

/** Flushes a directory's entries where the platform can (not on Windows). */
function flushDirectory(directory: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(directory, constants.O_RDONLY);
    fsyncSync(descriptor);
  } catch {
    // allow-fallback: a directory that cannot be opened or flushed (Windows) still holds the rename.
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function removeQuietly(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // allow-fallback: a temporary file that cannot be removed holds rewritten lines only.
  }
}

/** Plain lines in the file now, read by path as every reader reads it. */
function countPlainLines(path: string): number {
  const opened = openAppendFile(path);
  if (opened.status !== 'open') return 0;
  try {
    return splitStoredLines(readWhole(opened.descriptor).toString('utf8')).filter(
      (line) => line.length > 0 && !isSealedArtifactLine(line),
    ).length;
  } finally {
    closeSync(opened.descriptor);
  }
}

/** What turns a file's physical lines into the lines its replacement holds. */
export interface IAppendFileRewriter {
  /**
   * Writes what `lines` become to `out`. `leadingNewline` is set for the catch-up, which appends to
   * a file other writers append to at the same time and so frames each line `\n<line>\n`.
   */
  rewrite(lines: Iterable<string>, out: IStoredLineSink, leadingNewline: boolean): void;
}

export interface IRewriteAppendFileOptions {
  /** An ancestor of the file the host also owns, tightened along with the directory (SEC-020). */
  readonly ownedRoot?: string;
  /**
   * Runs once the snapshot is rewritten and flushed, just before the new file replaces the old.
   * Throwing abandons the rewrite with nothing replaced and no temporary file left.
   */
  readonly beforeCommit?: () => void;
  /** Waits between catch-up passes over the replaced file; defaults to a short timer. */
  readonly pause?: () => Promise<void>;
  /** Test seam: the platform whose rename rules apply; defaults to this one. */
  readonly platform?: string;
}

/** A catch-up that failed after the rename: what of the replaced file it never carried over. */
export interface IAppendFileCatchUpFailure {
  /** Bytes of the replaced file past the last line carried over (at most what was lost). */
  readonly unreadBytes: number;
  /** The failure's name; never its message, which may quote what was being rewritten. */
  readonly reason: string;
}

export type TAppendFileRewrite =
  | { readonly status: 'missing' }
  | { readonly status: 'refused'; readonly reason: TAppendFileRefusal }
  /** Another rewrite replaced the file before this one's rename; nothing was replaced. */
  | { readonly status: 'replaced' }
  /** The file was deleted before this one's rename; nothing was put in its place. */
  | { readonly status: 'removed' }
  | {
      readonly status: 'rewritten';
      /** The replaced file ended in an unfinished sealed append, which no reader shows; it was dropped. */
      readonly droppedTail: boolean;
      /** Plain lines in the new file afterwards: plaintext an older build appended meanwhile. */
      readonly plainLinesAfter: number;
      /** Set when the catch-up failed part-way. */
      readonly catchUpFailed?: IAppendFileCatchUpFailure;
    };

/**
 * Reads the replaced file from `progress.read` until it stays quiet, rewriting what it finds onto
 * `out` and moving `progress.read` past each chunk carried over. Returns whether it ended in an
 * unfinished sealed append, which was dropped.
 */
async function catchUp(
  oldDescriptor: number,
  progress: { read: number },
  rewriter: IAppendFileRewriter,
  out: BatchedWriter,
  pause: () => Promise<void>,
): Promise<boolean> {
  let quiet = 0;
  for (;;) {
    const size = fstatSync(oldDescriptor).size;
    if (size > progress.read) {
      const chunk = readRange(oldDescriptor, progress.read, size);
      const end = chunk.lastIndexOf(NEWLINE_BYTE);
      if (end !== -1) {
        rewriter.rewrite(linesOf(chunk.subarray(0, end + 1)), out, true);
        out.flush();
        progress.read += end + 1;
        quiet = 0;
        continue;
      }
    }
    if (quiet >= QUIET_PASSES) break;
    quiet += 1;
    await pause();
  }
  const end = fstatSync(oldDescriptor).size;
  const tail = readRange(oldDescriptor, progress.read, end).toString('utf8');
  if (tail.length === 0) return false;
  // A writer that stayed quiet this long is gone: a plain fragment is still a line to rewrite, while
  // a sealed one is what no reader shows (`splitStoredLines`).
  const kept = splitStoredLines(tail);
  rewriter.rewrite(kept, out, true);
  out.flush();
  progress.read = end;
  return kept.length === 0;
}

/** What `path` names now, by `lstat`: the file open at `descriptor`, another one, or nothing. */
function namedNow(path: string, descriptor: number): 'same' | 'replaced' | 'removed' {
  let linked;
  try {
    linked = lstatSync(path, { bigint: true });
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return 'removed';
    throw error;
  }
  const opened = fstatSync(descriptor, { bigint: true });
  return linked.isFile() && isSameFileIdentity(linked, opened) ? 'same' : 'replaced';
}

function waitBriefly(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, DEFAULT_PAUSE_MS));
}

/** The old file's descriptor, held until it is released for a rename that cannot replace an open file. */
interface IHeldFile {
  descriptor: number | undefined;
}

/**
 * The replacement where the platform will not replace an open file (Windows), as the module
 * documentation describes: catch up, release the old descriptor, rename. A file another handle still
 * holds open fails the rename; the old file is then opened again, checked to be the same one, caught
 * up with what was appended meanwhile, and the rename retried. Returns whether the old file ended in
 * an unfinished sealed append that was dropped, or what stood in the way of the replacement.
 */
async function replaceAfterCatchUp(
  path: string,
  temporary: string,
  held: IHeldFile,
  progress: { read: number },
  rewriter: IAppendFileRewriter,
  out: BatchedWriter,
  newDescriptor: number,
  pause: () => Promise<void>,
): Promise<
  { readonly droppedTail: boolean } | Exclude<TAppendFileRewrite, { status: 'rewritten' }>
> {
  const identity = fstatSync(held.descriptor as number, { bigint: true });
  let droppedTail = false;
  for (let attempt = 1; ; attempt += 1) {
    const dropped = await catchUp(held.descriptor as number, progress, rewriter, out, pause);
    droppedTail = dropped || droppedTail;
    fsyncSync(newDescriptor);
    closeSync(held.descriptor as number);
    held.descriptor = undefined;
    try {
      renameSync(temporary, path);
      return { droppedTail };
    } catch (error) {
      const code = errorCode(error);
      if (code === undefined || !BUSY_RENAME_CODES.has(code) || attempt >= BUSY_RENAME_ATTEMPTS) {
        throw error;
      }
    }
    await pause();
    const reopened = openAppendFile(path);
    if (reopened.status === 'missing') return { status: 'removed' };
    if (reopened.status !== 'open') return reopened;
    if (!isSameFileIdentity(fstatSync(reopened.descriptor, { bigint: true }), identity)) {
      closeSync(reopened.descriptor);
      return { status: 'replaced' };
    }
    held.descriptor = reopened.descriptor;
  }
}

/** Rewrites the file at `path` through `rewriter`, as the module documentation describes. */
export async function rewriteAppendFile(
  path: string,
  rewriter: IAppendFileRewriter,
  options: IRewriteAppendFileOptions = {},
): Promise<TAppendFileRewrite> {
  const opened = openAppendFile(path);
  if (opened.status !== 'open') return opened;
  const oldDescriptor = opened.descriptor;
  const held: IHeldFile = { descriptor: oldDescriptor };
  const directory = dirname(path);
  const temporary = join(
    directory,
    `.${basename(path)}.${process.pid}.${randomBytes(TEMPORARY_SUFFIX_BYTES).toString('hex')}.tmp`,
  );
  const pause = options.pause ?? waitBriefly;
  let newDescriptor: number | undefined;
  let committed = false;
  try {
    const buffer = readWhole(oldDescriptor);
    const snapshotEnd = buffer.lastIndexOf(NEWLINE_BYTE) + 1;
    ensureOwnerOnlyDirectory(
      directory,
      options.ownedRoot === undefined ? {} : { withinRoot: options.ownedRoot },
    );
    newDescriptor = openSync(
      temporary,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_APPEND |
        (constants.O_NOFOLLOW ?? 0),
      OWNER_ONLY_FILE_MODE,
    );
    const out = new BatchedWriter(newDescriptor);
    rewriter.rewrite(linesOf(buffer.subarray(0, snapshotEnd)), out, false);
    out.flush();
    fsyncSync(newDescriptor);
    options.beforeCommit?.();
    const named = namedNow(path, oldDescriptor);
    if (named !== 'same') return { status: named };
    const progress = { read: snapshotEnd };
    let droppedTail = false;
    let catchUpFailed: IAppendFileCatchUpFailure | undefined;
    if ((options.platform ?? process.platform) === 'win32') {
      const replacement = await replaceAfterCatchUp(
        path,
        temporary,
        held,
        progress,
        rewriter,
        out,
        newDescriptor,
        pause,
      );
      if ('status' in replacement) return replacement;
      committed = true;
      droppedTail = replacement.droppedTail;
    } else {
      renameSync(temporary, path);
      committed = true;
      flushDirectory(directory);
      try {
        droppedTail = await catchUp(oldDescriptor, progress, rewriter, out, pause);
      } catch (error) {
        catchUpFailed = {
          unreadBytes: Math.max(0, fstatSync(oldDescriptor).size - progress.read),
          reason: error instanceof Error ? error.name : 'unknown',
        };
      }
      fsyncSync(newDescriptor);
    }
    return {
      status: 'rewritten',
      droppedTail,
      plainLinesAfter: countPlainLines(path),
      ...(catchUpFailed === undefined ? {} : { catchUpFailed }),
    };
  } finally {
    if (newDescriptor !== undefined) closeSync(newDescriptor);
    if (held.descriptor !== undefined) closeSync(held.descriptor);
    if (!committed) removeQuietly(temporary);
  }
}
