/**
 * The recovery journal on disk.
 *
 * Layout: `<root>/recovery-journal/<hex(conversationId)>/<hex(participantId)>.jsonl`, one line per entry:
 * `{"v":1,"n":<index>,"e":<encoded entry>}`. The entry is written with agent-core's journal value
 * codec, so the dates inside an execution record come back as dates.
 *
 * What an append promises when it returns: the whole line is on the device (file flush) and, when the
 * append created the file, so is the directory entry naming it. The adapter admits a paid effect only
 * after the entry that records it was acknowledged, so a crash can lose an append only before its
 * effect began.
 *
 * Damage is refused, never repaired. A last line without its newline is an append that was never
 * acknowledged, and it still stops the scope: the reader cannot tell it from an entry the writer was
 * about to act on, and dropping it would be a guess made on the only history there is. The same holds
 * for a line that does not parse, a gap in the numbering, or an entry that is not one of the
 * adapter's, or one that lacks the fields its kind is read by. The file is left as it is for whoever
 * must find out what happened.
 *
 * The journal owns the `recovery-journal` directory under the root it is given and makes it and
 * everything below it owner-only; the root itself is the host's and is never changed.
 *
 * One writer per scope. The conversation claim does not fence this file: two processes appending to
 * one scope interleave lines, and the second is refused only when it next reads a size it did not
 * write.
 */
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  statSync,
  writeSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

import { decodeJournalValue, encodeJournalValue } from '@robota-sdk/agent-core';
import {
  OWNER_ONLY_FILE_MODE,
  ensureOwnerOnlyDirectory,
  tightenExistingFile,
} from '@robota-sdk/agent-core/node';

import type {
  RecoveryJournal,
  RecoveryJournalEntry,
  RecoveryScope,
  SessionRecoveryOptions,
} from './recovery-journal';

const LINE_VERSION = 1;
const JOURNAL_SUFFIX = '.jsonl';
/** An id is a path component after hex-encoding; this keeps every name under 255 bytes. */
const MAX_ID_BYTES = 96;
/** The directory the journal owns under the root a host passes, so a shared root is never chmodded. */
const JOURNAL_DIRECTORY = 'recovery-journal';
const OUTCOME_KINDS: ReadonlySet<string> = new Set(['speak', 'yield', 'wait']);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const hasStrings = (value: Record<string, unknown>, fields: readonly string[]): boolean =>
  fields.every((field) => typeof value[field] === 'string');

/** Why a value is not an adapter entry, or undefined when it has the fields its kind is read by. */
function entryProblem(entry: unknown): string | undefined {
  if (!isObject(entry)) return 'not an adapter entry';
  switch (entry.kind) {
    case 'binding':
      return hasStrings(entry, ['attemptId', 'sessionId', 'executionId', 'cwd'])
        ? undefined
        : 'binding entry is missing a field';
    case 'effect-call':
      return hasStrings(entry, ['attemptId', 'actionId', 'callId'])
        ? undefined
        : 'effect-call entry is missing a field';
    case 'turn-end':
      return hasStrings(entry, ['attemptId', 'phase']) &&
        isObject(entry.outcome) &&
        OUTCOME_KINDS.has(entry.outcome.kind as string) &&
        isObject(entry.checkpoint) &&
        typeof entry.checkpoint.version === 'string' &&
        'data' in entry.checkpoint
        ? undefined
        : 'turn-end entry is missing a field';
    case 'record':
      return isObject(entry.record) && hasStrings(entry.record, ['recordId', 'executionId', 'kind'])
        ? undefined
        : 'record entry is missing a field';
    default:
      return 'not an adapter entry';
  }
}

/** Raised by the file recovery journal; the file is never modified to make a refusal go away. */
export class FileRecoveryJournalError extends Error {
  constructor(
    public readonly code: 'invalid-scope' | 'torn-tail' | 'corrupt-entry',
    message: string,
  ) {
    super(message);
    this.name = 'FileRecoveryJournalError';
  }
}

/**
 * The durable steps of an append, injected so their order can be asserted: a flush that is skipped,
 * or runs before the write, is a crash-time property no test can observe on a healthy disk.
 */
export interface FileRecoveryJournalIo {
  /** Returns how many bytes were written; a short write is continued. */
  readonly writeSync?: (fileDescriptor: number, data: Uint8Array) => number;
  readonly fsyncSync?: (fileDescriptor: number) => void;
  readonly syncDirectory?: (directory: string) => void;
}

export interface FileRecoveryJournalOptions {
  readonly io?: FileRecoveryJournalIo;
}

function hex(id: string, what: string): string {
  if (typeof id !== 'string' || id.length === 0)
    throw new FileRecoveryJournalError('invalid-scope', `A ${what} must not be empty`);
  const bytes = Buffer.from(id, 'utf8');
  if (bytes.length > MAX_ID_BYTES)
    throw new FileRecoveryJournalError(
      'invalid-scope',
      `A ${what} must be at most ${MAX_ID_BYTES} bytes`,
    );
  return bytes.toString('hex');
}

function syncDirectoryOnDisk(directory: string): void {
  if (process.platform === 'win32') return;
  const descriptor = openSync(directory, 'r');
  try {
    fsyncSync(descriptor);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // allow-fallback: EINVAL/ENOTSUP mean the filesystem has no directory flush to offer.
    if (code !== 'EINVAL' && code !== 'ENOTSUP') throw error;
  } finally {
    closeSync(descriptor);
  }
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

interface ILoaded {
  readonly entries: RecoveryJournalEntry[];
  /** File size these entries were read at; a different size means another writer, so a fresh read. */
  size: number;
}

/** What the journals of one root share: where they live and which directory entries are flushed. */
class Root {
  readonly directory: string;
  readonly io: FileRecoveryJournalIo;
  /** Directory entries this instance has flushed; a file found in place may never have been. */
  readonly synced = new Set<string>();

  constructor(directory: string, io: FileRecoveryJournalIo) {
    this.directory = join(resolve(directory), JOURNAL_DIRECTORY);
    this.io = io;
  }

  flush(directory: string): void {
    (this.io.syncDirectory ?? syncDirectoryOnDisk)(directory);
  }

  /**
   * Make the entry of a scope's file durable, once per instance (or when `force`d), and the entries
   * of the directories above it once. A file found already in place may have been put there by an
   * append that died before its directory flush, so it was never acknowledged; whoever returns or
   * extends it must flush that entry first.
   */
  flushEntries(scopeDirectory: string, file: string, force: boolean): void {
    if (force || !this.synced.has(file)) {
      this.flush(scopeDirectory);
      this.synced.add(file);
    }
    if (!this.synced.has(scopeDirectory)) {
      this.flush(this.directory);
      this.synced.add(scopeDirectory);
    }
    if (!this.synced.has(this.directory)) {
      this.flush(dirname(this.directory));
      this.synced.add(this.directory);
    }
  }
}

class FileJournal implements RecoveryJournal {
  readonly durability = 'durable' as const;
  readonly #root: Root;
  readonly #directory: string;
  readonly #path: string;
  #loaded: ILoaded | undefined;

  constructor(root: Root, scope: RecoveryScope) {
    this.#root = root;
    this.#directory = join(root.directory, hex(scope.conversationId, 'conversation id'));
    this.#path = join(
      this.#directory,
      `${hex(scope.participantId, 'participant id')}${JOURNAL_SUFFIX}`,
    );
    if (!this.#directory.startsWith(root.directory + sep))
      throw new FileRecoveryJournalError('invalid-scope', 'Invalid conversation id');
  }

  /** The complete, validated history of the scope; throws on any damage. */
  #load(): ILoaded {
    let size: number;
    try {
      size = statSync(this.#path).size;
    } catch (error) {
      if (isMissing(error)) {
        this.#loaded = undefined;
        return { entries: [], size: 0 };
      }
      throw error;
    }
    if (this.#loaded && this.#loaded.size === size) return this.#loaded;
    this.#loaded = undefined;
    const loaded = this.#parse(readFileSync(this.#path));
    this.#loaded = loaded;
    return loaded;
  }

  #parse(bytes: Buffer): ILoaded {
    if (bytes.length > 0 && bytes[bytes.length - 1] !== 0x0a)
      throw new FileRecoveryJournalError(
        'torn-tail',
        'The recovery journal ends in a partial line: an append was interrupted and the stored history ' +
          'cannot be shown complete. The file is kept as it is.',
      );
    const lines = bytes.length === 0 ? [] : bytes.toString('utf8').split('\n').slice(0, -1);
    const entries = lines.map((line, index): RecoveryJournalEntry => {
      const damaged = (why: string): never => {
        throw new FileRecoveryJournalError(
          'corrupt-entry',
          `The recovery journal has an unreadable entry at line ${index + 1} (${why}). The file is kept as it is.`,
        );
      };
      let frame: { v?: unknown; n?: unknown; e?: unknown } | null;
      try {
        frame = JSON.parse(line) as typeof frame;
      } catch {
        return damaged('not JSON');
      }
      if (typeof frame !== 'object' || frame === null || frame.v !== LINE_VERSION)
        return damaged('unknown format');
      if (frame.n !== index) return damaged('entry numbering has a gap');
      let entry: RecoveryJournalEntry;
      try {
        entry = decodeJournalValue(frame.e) as RecoveryJournalEntry;
      } catch {
        return damaged('value does not decode');
      }
      const problem = entryProblem(entry);
      if (problem) return damaged(problem);
      return entry;
    });
    return { entries, size: bytes.length };
  }

  async read(): Promise<readonly RecoveryJournalEntry[]> {
    return structuredClone(this.#load().entries);
  }

  async append(entry: RecoveryJournalEntry): Promise<void> {
    const problem = entryProblem(entry);
    if (problem)
      throw new FileRecoveryJournalError(
        'corrupt-entry',
        `Not a recovery journal entry (${problem})`,
      );
    const loaded = this.#load();
    const stored = structuredClone(entry);
    const line = Buffer.from(
      `${JSON.stringify({ v: LINE_VERSION, n: loaded.entries.length, e: encodeJournalValue(stored) })}\n`,
      'utf8',
    );
    const io = this.#root.io;
    ensureOwnerOnlyDirectory(this.#directory, {
      durable: true,
      withinRoot: this.#root.directory,
      ...(io.syncDirectory === undefined ? {} : { syncDirectory: io.syncDirectory }),
    });
    const created = !existsSync(this.#path);
    if (!created) tightenExistingFile(this.#path);
    const descriptor = openSync(this.#path, 'a', OWNER_ONLY_FILE_MODE);
    try {
      // From here a failure may leave part of the line behind. The cached view is dropped so the next
      // use reads the file and refuses it as a torn tail instead of appending after it.
      this.#loaded = undefined;
      const write = io.writeSync ?? ((fd: number, data: Uint8Array) => writeSync(fd, data));
      let offset = 0;
      while (offset < line.length) {
        const written = write(descriptor, line.subarray(offset));
        if (!(written > 0)) throw new Error('The recovery journal write made no progress');
        offset += written;
      }
      (io.fsyncSync ?? fsyncSync)(descriptor);
    } finally {
      closeSync(descriptor);
    }
    this.#root.flushEntries(this.#directory, this.#path, created);
    loaded.entries.push(stored);
    loaded.size += line.length;
    this.#loaded = loaded;
  }
}

/**
 * The recovery journals under one directory, for `SessionRecoveryOptions`. The journal owns a
 * `recovery-journal` subdirectory of it, which and everything below it are made owner-only; the
 * directory passed in is left as the host made it. A scope's journal is one object per
 * instance, so a scope has one writer inside a process; across processes that is the host's rule.
 */
export function createFileRecoveryJournals(
  root: string,
  options: FileRecoveryJournalOptions = {},
): SessionRecoveryOptions {
  const shared = new Root(root, options.io ?? {});
  const journals = new Map<string, FileJournal>();
  return {
    journal(scope: RecoveryScope): RecoveryJournal {
      const key = JSON.stringify([scope.conversationId, scope.participantId]);
      let journal = journals.get(key);
      if (!journal) {
        journal = new FileJournal(shared, scope);
        journals.set(key, journal);
      }
      return journal;
    },
  };
}
