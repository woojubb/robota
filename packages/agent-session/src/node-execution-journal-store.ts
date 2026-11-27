/**
 * The durable execution journal, kept beside the session records.
 *
 * Layout: `<baseDir>/journals/<sessionId>/<hex(executionId)>.jsonl`, one line per record, and
 * `<hex(executionId)>.sealed` once the execution is sealed. `baseDir` is the session store's own
 * directory, which has no use for the subdirectory (a listing reads `*.json` only), exactly as it has
 * none for `claims`.
 *
 * What an append promises when it returns: the whole line is on the device (file flush) and, when the
 * append created the file, so is the directory entry naming it. A managed run starts an effect only
 * after the record that admits it was acknowledged, so a crash can lose an append only before its
 * effect began.
 *
 * Damage is refused, never repaired. A last line without its newline is an append that was never
 * acknowledged, and it still stops the execution: the reader cannot tell it from a record the writer
 * began to write for an effect it was about to start, and dropping it would be a guess made on the
 * only history there is. The same holds for a line that does not parse, a gap in the numbering, or a
 * record naming another execution. A damaged journal is sealed (`abandoned`) without being opened:
 * the seal is its own file, so the bytes stay for whoever must find out what happened.
 *
 * A host that seals its stored artifacts has no sealed journal format yet; building this store for one
 * is refused instead of writing the conversation of a sealed session in plain text.
 */
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import { join, resolve, sep } from 'node:path';

import { ExecutionRecoveryError, isUniversalValueEqual } from '@robota-sdk/agent-core';
import type { TExecutionJournalRecord } from '@robota-sdk/agent-core';
import {
  OWNER_ONLY_FILE_MODE,
  ensureOwnerOnlyDirectory,
  tightenExistingFile,
  writeOwnerOnlyFile,
} from '@robota-sdk/agent-core/node';

import { decodeJournalValue, encodeJournalValue } from './execution-journal-value-codec.js';
import { ExecutionJournalStoreError } from './execution-journal-store.js';
import { assertSafeSessionId } from './session-id.js';
import { sessionSealingOf } from './stored-session-record.js';

import type {
  IExecutionJournalStore,
  IExecutionSeal,
  ISessionExecutionJournal,
  TExecutionSealReason,
} from './execution-journal-store.js';
import type { ISessionStoreOptions } from './stored-session-record.js';

/** Where a store keeps its journals: a directory beside the records that is not a `.json` file. */
export const SESSION_JOURNALS_DIRECTORY = 'journals';

const LINE_VERSION = 1;
const JOURNAL_SUFFIX = '.jsonl';
const SEAL_SUFFIX = '.sealed';
/** An execution id is a path component after hex-encoding; this keeps the name under 255 bytes. */
const MAX_EXECUTION_ID_BYTES = 96;
const SEAL_REASONS: ReadonlySet<string> = new Set<TExecutionSealReason>([
  'completed',
  'failed',
  'abandoned',
]);

/**
 * The durable steps of an append, injected so their order can be asserted: a flush that is skipped, or
 * runs before the write, is a crash-time property no test can observe on a healthy disk.
 */
export interface INodeExecutionJournalIo {
  /** Returns how many bytes were written; a short write is continued. */
  readonly writeSync?: (fileDescriptor: number, data: Uint8Array) => number;
  readonly fsyncSync?: (fileDescriptor: number) => void;
  readonly syncDirectory?: (directory: string) => void;
}

export interface INodeExecutionJournalStoreOptions extends ISessionStoreOptions {
  /** An ancestor of the store's directory the host also owns, tightened with it (see `NodeSessionStore`). */
  readonly ownedRoot?: string;
  readonly io?: INodeExecutionJournalIo;
}

interface ILoadedExecution {
  readonly records: TExecutionJournalRecord[];
  readonly byId: Map<string, TExecutionJournalRecord>;
  /** File size these records were read at; a different size means another writer, so a fresh read. */
  size: number;
}

function hex(executionId: string): string {
  if (typeof executionId !== 'string' || executionId.length === 0)
    throw new ExecutionJournalStoreError('invalid-identity', 'An execution id must not be empty');
  const bytes = Buffer.from(executionId, 'utf8');
  if (bytes.length > MAX_EXECUTION_ID_BYTES)
    throw new ExecutionJournalStoreError(
      'invalid-identity',
      `An execution id must be at most ${MAX_EXECUTION_ID_BYTES} bytes`,
    );
  return bytes.toString('hex');
}

function unhex(name: string): string | undefined {
  if (name.length === 0 || name.length % 2 !== 0 || !/^[0-9a-f]+$/.test(name)) return undefined;
  return Buffer.from(name, 'hex').toString('utf8');
}

function syncDirectory(directory: string): void {
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

/** Persistent journals for the sessions of one directory. */
export class NodeExecutionJournalStore implements IExecutionJournalStore {
  readonly #root: string;
  readonly #ownedRoot: string | undefined;
  readonly #io: INodeExecutionJournalIo;

  /**
   * @param baseDir the session store's directory; journals live in its `journals` subdirectory.
   * @param options `sealing` (required, as for every store): `'plain'` only, see the file comment.
   */
  constructor(baseDir: string, options: INodeExecutionJournalStoreOptions) {
    const sealing = sessionSealingOf(options);
    if (sealing !== 'plain')
      throw new ExecutionJournalStoreError(
        'unsupported-sealing',
        'The execution journal has no sealed format; a sealing host must not enable journaled execution',
      );
    this.#root = join(resolve(baseDir), SESSION_JOURNALS_DIRECTORY);
    this.#ownedRoot = options.ownedRoot;
    this.#io = options.io ?? {};
  }

  forSession(sessionId: string): ISessionExecutionJournal {
    assertSafeSessionId(sessionId);
    const directory = resolve(this.#root, sessionId);
    if (!directory.startsWith(this.#root + sep))
      throw new ExecutionJournalStoreError('invalid-identity', 'Invalid session id');
    return new SessionJournal(directory, this.#ownedRoot, this.#io);
  }
}

class SessionJournal implements ISessionExecutionJournal {
  readonly #directory: string;
  readonly #ownedRoot: string | undefined;
  readonly #io: INodeExecutionJournalIo;
  readonly #loaded = new Map<string, ILoadedExecution>();

  constructor(directory: string, ownedRoot: string | undefined, io: INodeExecutionJournalIo) {
    this.#directory = directory;
    this.#ownedRoot = ownedRoot;
    this.#io = io;
  }

  #journalPath(executionId: string): string {
    return join(this.#directory, `${hex(executionId)}${JOURNAL_SUFFIX}`);
  }

  #sealPath(executionId: string): string {
    return join(this.#directory, `${hex(executionId)}${SEAL_SUFFIX}`);
  }

  #ensureDirectory(): void {
    ensureOwnerOnlyDirectory(this.#directory, {
      durable: true,
      ...(this.#ownedRoot === undefined ? {} : { withinRoot: this.#ownedRoot }),
      ...(this.#io.syncDirectory === undefined ? {} : { syncDirectory: this.#io.syncDirectory }),
    });
  }

  /** The complete, validated history of one execution; throws on any damage. */
  #load(executionId: string): ILoadedExecution {
    const path = this.#journalPath(executionId);
    let size: number;
    try {
      size = statSync(path).size;
    } catch (error) {
      if (isMissing(error)) {
        this.#loaded.delete(executionId);
        return { records: [], byId: new Map(), size: 0 };
      }
      throw error;
    }
    const cached = this.#loaded.get(executionId);
    if (cached && cached.size === size) return cached;
    this.#loaded.delete(executionId);
    const loaded = this.#parse(executionId, readFileSync(path));
    this.#loaded.set(executionId, loaded);
    return loaded;
  }

  #parse(executionId: string, bytes: Buffer): ILoadedExecution {
    const records: TExecutionJournalRecord[] = [];
    const byId = new Map<string, TExecutionJournalRecord>();
    if (bytes.length > 0 && bytes[bytes.length - 1] !== 0x0a)
      throw new ExecutionJournalStoreError(
        'torn-tail',
        'The execution journal ends in a partial line: an append was interrupted and the stored history ' +
          'cannot be shown complete. It is kept as it is; abandon the execution to record that.',
      );
    const lines = bytes.length === 0 ? [] : bytes.toString('utf8').split('\n').slice(0, -1);
    lines.forEach((line, index) => {
      const damaged = (why: string): never => {
        throw new ExecutionJournalStoreError(
          'corrupt-record',
          `The execution journal has an unreadable record at line ${index + 1} (${why}). It is kept as it ` +
            'is; abandon the execution to record that.',
        );
      };
      let envelope: unknown;
      try {
        envelope = JSON.parse(line);
      } catch {
        return damaged('not JSON');
      }
      const frame = envelope as { v?: unknown; n?: unknown; r?: unknown } | null;
      if (typeof frame !== 'object' || frame === null || frame.v !== LINE_VERSION)
        return damaged('unknown format');
      if (frame.n !== index) return damaged('record numbering has a gap');
      let record: TExecutionJournalRecord;
      try {
        record = decodeJournalValue(frame.r) as TExecutionJournalRecord;
      } catch {
        return damaged('value does not decode');
      }
      if (
        typeof record !== 'object' ||
        record === null ||
        typeof record.recordId !== 'string' ||
        record.recordId.length === 0 ||
        record.executionId !== executionId
      )
        return damaged('record names another execution');
      if (byId.has(record.recordId)) return damaged('record id repeated');
      records.push(record);
      byId.set(record.recordId, record);
    });
    return { records, byId, size: bytes.length };
  }

  #seal(executionId: string): IExecutionSeal | undefined {
    let text: string;
    try {
      text = readFileSync(this.#sealPath(executionId), 'utf8');
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
    const parsed = JSON.parse(text) as Partial<IExecutionSeal> & { v?: unknown };
    if (
      parsed.v !== LINE_VERSION ||
      typeof parsed.reason !== 'string' ||
      !SEAL_REASONS.has(parsed.reason) ||
      typeof parsed.sealedAt !== 'string' ||
      typeof parsed.records !== 'number'
    )
      throw new ExecutionJournalStoreError('corrupt-record', 'The execution seal is unreadable');
    return {
      reason: parsed.reason,
      sealedAt: parsed.sealedAt,
      records: parsed.records,
      ...(typeof parsed.note === 'string' ? { note: parsed.note } : {}),
    };
  }

  async read(executionId: string): Promise<readonly TExecutionJournalRecord[]> {
    const seal = this.#seal(executionId);
    if (seal?.reason === 'abandoned')
      throw new ExecutionRecoveryError(
        'EXECUTION_RECOVERY_CONFLICT',
        'The execution was abandoned and cannot be resumed',
      );
    return structuredClone(this.#load(executionId).records);
  }

  async append(record: TExecutionJournalRecord): Promise<void> {
    const executionId = record?.executionId;
    if (typeof record?.recordId !== 'string' || record.recordId.length === 0)
      throw new ExecutionJournalStoreError('invalid-identity', 'A record needs a record id');
    const path = this.#journalPath(executionId);
    if (this.#seal(executionId) !== undefined)
      throw new ExecutionJournalStoreError(
        'sealed',
        'The execution is sealed and takes no appends',
      );
    const loaded = this.#load(executionId);
    const existing = loaded.byId.get(record.recordId);
    if (existing !== undefined) {
      if (isUniversalValueEqual(existing, record)) return;
      throw new ExecutionJournalStoreError(
        'conflict',
        `Journal record id was already used with different content: ${record.recordId}`,
      );
    }
    const stored = structuredClone(record);
    const line = Buffer.from(
      `${JSON.stringify({ v: LINE_VERSION, n: loaded.records.length, r: encodeJournalValue(stored) })}\n`,
      'utf8',
    );
    this.#ensureDirectory();
    const created = !existsSync(path);
    if (!created) tightenExistingFile(path);
    const descriptor = openSync(path, 'a', OWNER_ONLY_FILE_MODE);
    try {
      // From here a failure may leave part of the line behind. The cached view is dropped so the
      // next use reads the file and refuses it as a torn tail instead of appending after it.
      this.#loaded.delete(executionId);
      const write = this.#io.writeSync ?? ((fd: number, data: Uint8Array) => writeSync(fd, data));
      let offset = 0;
      while (offset < line.length) {
        const written = write(descriptor, line.subarray(offset));
        if (!(written > 0)) throw new Error('The execution journal write made no progress');
        offset += written;
      }
      (this.#io.fsyncSync ?? fsyncSync)(descriptor);
    } finally {
      closeSync(descriptor);
    }
    if (created) (this.#io.syncDirectory ?? syncDirectory)(this.#directory);
    loaded.records.push(stored);
    loaded.byId.set(stored.recordId, stored);
    loaded.size += line.length;
    this.#loaded.set(executionId, loaded);
  }

  async unresolved(): Promise<readonly string[]> {
    let names: string[];
    try {
      names = readdirSync(this.#directory);
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
    const sealed = new Set(
      names
        .filter((name) => name.endsWith(SEAL_SUFFIX))
        .map((name) => name.slice(0, -SEAL_SUFFIX.length)),
    );
    return names
      .filter((name) => name.endsWith(JOURNAL_SUFFIX))
      .map((name) => ({ name: name.slice(0, -JOURNAL_SUFFIX.length), mtime: this.#modified(name) }))
      .filter(({ name }) => !sealed.has(name) && unhex(name) !== undefined)
      .sort((left, right) => left.mtime - right.mtime || left.name.localeCompare(right.name))
      .map(({ name }) => unhex(name)!);
  }

  #modified(name: string): number {
    try {
      return statSync(join(this.#directory, name)).mtimeMs;
    } catch {
      // allow-fallback: ordering is a courtesy; a file that vanished is still reported by name.
      return 0;
    }
  }

  async seal(
    executionId: string,
    outcome: { reason: TExecutionSealReason; note?: string },
  ): Promise<IExecutionSeal> {
    if (!SEAL_REASONS.has(outcome.reason))
      throw new ExecutionJournalStoreError('invalid-identity', 'Unknown seal reason');
    const first = this.#seal(executionId);
    if (first !== undefined) return this.#sameSeal(first, outcome.reason);
    this.#ensureDirectory();
    const seal: IExecutionSeal = {
      reason: outcome.reason,
      sealedAt: new Date().toISOString(),
      records: this.#countLines(executionId),
      ...(outcome.note === undefined ? {} : { note: outcome.note }),
    };
    try {
      writeOwnerOnlyFile(
        this.#sealPath(executionId),
        JSON.stringify({ v: LINE_VERSION, ...seal }),
        {
          durable: true,
          createOnly: true,
          ...(this.#io.syncDirectory === undefined
            ? {}
            : { syncDirectory: this.#io.syncDirectory }),
          ...(this.#io.fsyncSync === undefined ? {} : { syncFile: this.#io.fsyncSync }),
        },
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const raced = this.#seal(executionId);
      if (raced !== undefined) return this.#sameSeal(raced, outcome.reason);
      throw error;
    }
    this.#loaded.delete(executionId);
    return seal;
  }

  #sameSeal(existing: IExecutionSeal, reason: TExecutionSealReason): IExecutionSeal {
    if (existing.reason === reason) return existing;
    throw new ExecutionJournalStoreError(
      'sealed',
      `The execution was already sealed as ${existing.reason}`,
    );
  }

  /** Complete lines only, counted without parsing, so a damaged journal can still be sealed. */
  #countLines(executionId: string): number {
    try {
      let count = 0;
      for (const byte of readFileSync(this.#journalPath(executionId)))
        if (byte === 0x0a) count += 1;
      return count;
    } catch (error) {
      if (isMissing(error)) return 0;
      throw error;
    }
  }

  async sealOf(executionId: string): Promise<IExecutionSeal | undefined> {
    return this.#seal(executionId);
  }
}

/** Remove every journal a session left, with the session itself. */
export function removeSessionJournals(baseDir: string, sessionId: string): void {
  assertSafeSessionId(sessionId);
  const root = join(resolve(baseDir), SESSION_JOURNALS_DIRECTORY);
  const directory = resolve(root, sessionId);
  if (!directory.startsWith(root + sep)) return;
  rmSync(directory, { recursive: true, force: true });
}
