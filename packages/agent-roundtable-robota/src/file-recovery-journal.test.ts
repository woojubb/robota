import {
  appendFileSync,
  chmodSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encodeJournalValue, isUniversalValueEqual } from '@robota-sdk/agent-core';
import type { TExecutionJournalRecord } from '@robota-sdk/agent-core';
import {
  FileRecoveryJournalError,
  createFileRecoveryJournals,
  type FileRecoveryJournalIo,
} from './node';
import type { RecoveryJournal, RecoveryJournalEntry, RecoveryScope } from './recovery-journal';

const scope: RecoveryScope = { conversationId: 'room/1', participantId: 'alice' };
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'file-recovery-journal-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const hex = (text: string): string => Buffer.from(text, 'utf8').toString('hex');
/** The directory the journal owns under the root a host passes. */
const owned = (): string => join(root, 'recovery-journal');
const journalFile = (): string =>
  join(owned(), hex(scope.conversationId), `${hex(scope.participantId)}.jsonl`);

function journalOf(io?: FileRecoveryJournalIo, which: RecoveryScope = scope): RecoveryJournal {
  return createFileRecoveryJournals(root, io ? { io } : {}).journal(which);
}

const record = (extra: Record<string, unknown> = {}): TExecutionJournalRecord =>
  ({
    kind: 'model-response',
    recordId: 'call-1:response',
    executionId: 'e1',
    callId: 'call-1',
    providerId: 'p',
    modelId: 'm',
    response: {
      id: 'r',
      role: 'assistant',
      content: 'x',
      state: 'complete',
      timestamp: new Date('2026-01-02T03:04:05.678Z'),
    },
    ...extra,
  }) as TExecutionJournalRecord;

const entries: RecoveryJournalEntry[] = [
  { kind: 'binding', attemptId: 'a1', sessionId: 's1', executionId: 'e1', cwd: '/work' },
  { kind: 'effect-call', attemptId: 'a1', actionId: 'act', callId: 'effect:1' },
  { kind: 'record', record: record() },
  {
    kind: 'turn-end',
    attemptId: 'a1',
    phase: 'turn',
    outcome: { kind: 'speak', content: 'done' },
    checkpoint: {
      version: 'v1',
      data: { when: new Date(5), nested: { gone: undefined, zero: -0 } },
    },
  } as unknown as RecoveryJournalEntry,
];

describe('createFileRecoveryJournals', () => {
  it('is durable and starts empty', async () => {
    const journal = journalOf();
    expect(journal.durability).toBe('durable');
    expect(await journal.read()).toEqual([]);
  });

  it('round-trips every entry kind, dates included, through a fresh instance', async () => {
    const journal = journalOf();
    for (const entry of entries) await journal.append(entry);
    const read = await journalOf().read();
    expect(read).toHaveLength(entries.length);
    entries.forEach((entry, index) => expect(isUniversalValueEqual(read[index], entry)).toBe(true));
    const saved = read[2] as Extract<RecoveryJournalEntry, { kind: 'record' }>;
    expect(
      (saved.record as unknown as { response: { timestamp: unknown } }).response.timestamp,
    ).toBeInstanceOf(Date);
    expect(readdirSync(join(owned(), hex(scope.conversationId)))).toEqual([
      `${hex(scope.participantId)}.jsonl`,
    ]);
  });

  it('keeps scopes apart', async () => {
    await journalOf().append(entries[0]!);
    const other = journalOf(undefined, { conversationId: 'room/1', participantId: 'bob' });
    expect(await other.read()).toEqual([]);
  });

  it('refuses a scope that cannot name a file', () => {
    const journals = createFileRecoveryJournals(root);
    expect(() => journals.journal({ conversationId: '', participantId: 'a' })).toThrow(
      FileRecoveryJournalError,
    );
    expect(() => journals.journal({ conversationId: 'c', participantId: 'x'.repeat(97) })).toThrow(
      FileRecoveryJournalError,
    );
  });

  it('refuses an entry the journal cannot carry before writing anything', async () => {
    const journal = journalOf();
    await journal.append(entries[0]!);
    const before = readFileSync(journalFile());
    await expect(
      journal.append({
        kind: 'record',
        record: record({ extra: () => 1 }),
      }),
    ).rejects.toThrow();
    await expect(journal.append({ kind: 'nonsense' } as never)).rejects.toThrow(
      FileRecoveryJournalError,
    );
    expect(readFileSync(journalFile()).equals(before)).toBe(true);
    await journal.append(entries[1]!);
    expect(await journal.read()).toHaveLength(2);
  });

  it.runIf(process.platform !== 'win32')('writes owner-only files and directories', async () => {
    await journalOf().append(entries[0]!);
    expect(statSync(journalFile()).mode & 0o777).toBe(0o600);
    expect(statSync(join(owned(), hex(scope.conversationId))).mode & 0o777).toBe(0o700);
    expect(statSync(owned()).mode & 0o777).toBe(0o700);
  });

  it.runIf(process.platform !== 'win32')(
    'owns a subdirectory of the root it is given and never changes the root itself',
    async () => {
      // A host may hand over a directory it shares with other files and has set its own mode on.
      chmodSync(root, 0o755);
      const journal = journalOf();
      await journal.append(entries[0]!);
      await journal.append(entries[1]!);
      expect(statSync(root).mode & 0o777).toBe(0o755);
      expect(readdirSync(root)).toEqual(['recovery-journal']);
      expect(statSync(owned()).mode & 0o777).toBe(0o700);
    },
  );

  it('creates the root when it does not exist yet', async () => {
    const missing = join(root, 'not', 'yet');
    const journal = createFileRecoveryJournals(missing).journal(scope);
    await journal.append(entries[0]!);
    expect(await createFileRecoveryJournals(missing).journal(scope).read()).toHaveLength(1);
  });

  describe('damage is refused and never repaired', () => {
    async function seeded(): Promise<void> {
      const journal = journalOf();
      await journal.append(entries[0]!);
      await journal.append(entries[1]!);
    }

    async function expectRefused(code: FileRecoveryJournalError['code']): Promise<Buffer> {
      const bytes = readFileSync(journalFile());
      await expect(journalOf().read()).rejects.toMatchObject({ code });
      await expect(journalOf().append(entries[2]!)).rejects.toMatchObject({ code });
      expect(readFileSync(journalFile()).equals(bytes)).toBe(true);
      return bytes;
    }

    it('a torn tail', async () => {
      await seeded();
      appendFileSync(journalFile(), '{"v":1,"n":2,"e":{"$o":[["ki');
      await expectRefused('torn-tail');
    });

    it('a gap in the numbering', async () => {
      await seeded();
      const lines = readFileSync(journalFile(), 'utf8').split('\n');
      writeFileSync(journalFile(), `${lines[1]}\n`);
      await expectRefused('corrupt-entry');
    });

    it('a line that is not JSON', async () => {
      await seeded();
      appendFileSync(journalFile(), 'not json\n');
      await expectRefused('corrupt-entry');
    });

    it('a value that does not decode, and one that is not an adapter entry', async () => {
      await seeded();
      appendFileSync(journalFile(), `${JSON.stringify({ v: 1, n: 2, e: { nope: 1 } })}\n`);
      await expectRefused('corrupt-entry');
      writeFileSync(
        journalFile(),
        `${readFileSync(journalFile(), 'utf8').split('\n').slice(0, 2).join('\n')}\n${JSON.stringify({ v: 1, n: 2, e: { $o: [['kind', 'other']] } })}\n`,
      );
      await expectRefused('corrupt-entry');
    });

    it('an entry of a known kind that lacks the fields it is read by', async () => {
      const incomplete: unknown[] = [
        { kind: 'binding', attemptId: 'a1', sessionId: 's1', cwd: '/work' },
        { kind: 'effect-call', attemptId: 'a1', actionId: 'act', callId: 7 },
        { kind: 'turn-end', attemptId: 'a1', phase: 'turn', outcome: { kind: 'speak' } },
        {
          kind: 'turn-end',
          attemptId: 'a1',
          phase: 'turn',
          outcome: { kind: 'failed' },
          checkpoint: { version: 'v1', data: null },
        },
        {
          kind: 'turn-end',
          attemptId: 'a1',
          phase: 'turn',
          outcome: { kind: 'yield' },
          checkpoint: { data: null },
        },
        { kind: 'record' },
        { kind: 'record', record: { recordId: 'r1', kind: 'model-request' } },
      ];
      for (const entry of incomplete) {
        await seeded();
        // Written as a well-formed line of the right format, so only its shape is wrong.
        appendFileSync(
          journalFile(),
          `${JSON.stringify({ v: 1, n: 2, e: encodeJournalValue(entry) })}\n`,
        );
        await expectRefused('corrupt-entry');
        rmSync(owned(), { recursive: true, force: true });
      }
    });

    it('refuses to append an entry that lacks the fields its kind is read by, writing nothing', async () => {
      const journal = journalOf();
      await journal.append(entries[0]!);
      const before = readFileSync(journalFile());
      for (const entry of [
        { kind: 'binding', attemptId: 'a1' },
        { kind: 'turn-end', attemptId: 'a1', phase: 'turn' },
        { kind: 'record', record: {} },
      ]) {
        await expect(journal.append(entry as never)).rejects.toMatchObject({
          code: 'corrupt-entry',
        });
      }
      expect(readFileSync(journalFile()).equals(before)).toBe(true);
    });

    it('an unknown format version', async () => {
      await seeded();
      appendFileSync(journalFile(), `${JSON.stringify({ v: 2, n: 2, e: null })}\n`);
      await expectRefused('corrupt-entry');
    });
  });

  describe('what an append does before it returns', () => {
    it('writes the line, flushes the file, then the directory entries, in that order', async () => {
      const steps: string[] = [];
      const io: FileRecoveryJournalIo = {
        writeSync: (_fd, data) => {
          steps.push('write');
          return data.length;
        },
        fsyncSync: () => steps.push('fsync-file'),
        syncDirectory: (directory) => steps.push(`sync-dir:${directory}`),
      };
      await journalOf(io).append(entries[0]!);
      const conversation = join(owned(), hex(scope.conversationId));
      const file = steps.indexOf('fsync-file');
      expect(steps.indexOf('write')).toBeLessThan(file);
      // Directory entries are flushed only after the file's own flush.
      expect(steps.indexOf(`sync-dir:${conversation}`, file)).toBeGreaterThan(file);
      expect(steps).toContain(`sync-dir:${root}`);
      expect(steps.at(-1)!.startsWith('sync-dir:')).toBe(true);
    });

    it('flushes ancestors once per instance, not on every append', async () => {
      const synced: string[] = [];
      const io: FileRecoveryJournalIo = { syncDirectory: (d) => synced.push(d) };
      const journal = journalOf(io);
      await journal.append(entries[0]!);
      const first = synced.length;
      await journal.append(entries[1]!);
      expect(synced.length).toBe(first);
    });

    it('flushes the entry of a file it found already in place before acknowledging', async () => {
      await journalOf().append(entries[0]!);
      const synced: string[] = [];
      await journalOf({ syncDirectory: (d) => synced.push(d) }).append(entries[1]!);
      expect(synced).toContain(join(owned(), hex(scope.conversationId)));
    });

    it('continues a short write until the whole line is written', async () => {
      let calls = 0;
      const io: FileRecoveryJournalIo = {
        writeSync: (fd, data) => {
          calls += 1;
          const part = data.subarray(0, 7);
          // Delegates to the real write, a few bytes at a time.
          return writeSync(fd, part);
        },
      };
      await journalOf(io).append(entries[2]!);
      expect(calls).toBeGreaterThan(2);
      const read = await journalOf().read();
      expect(isUniversalValueEqual(read[0], entries[2])).toBe(true);
    });

    it('refuses a write that makes no progress, and the fragment it left is refused next time', async () => {
      let first = true;
      const io: FileRecoveryJournalIo = {
        writeSync: (fd, data) => {
          if (first) {
            first = false;
            return writeSync(fd, data.subarray(0, 5));
          }
          return 0;
        },
      };
      const journal = journalOf(io);
      await expect(journal.append(entries[0]!)).rejects.toThrow('no progress');
      await expect(journal.read()).rejects.toMatchObject({ code: 'torn-tail' });
      await expect(journal.append(entries[1]!)).rejects.toMatchObject({ code: 'torn-tail' });
    });

    it('does not acknowledge an append whose flush failed', async () => {
      const io: FileRecoveryJournalIo = {
        fsyncSync: () => {
          throw new Error('disk gone');
        },
      };
      const journal = journalOf(io);
      await expect(journal.append(entries[0]!)).rejects.toThrow('disk gone');
      // The line is whole but was never acknowledged; the next use re-reads the file as it is.
      expect((await journalOf().read()).length).toBe(1);
    });
  });

  it('reads what another instance appended since it last looked', async () => {
    const reader = journalOf();
    expect(await reader.read()).toEqual([]);
    await journalOf().append(entries[0]!);
    expect(await reader.read()).toHaveLength(1);
  });
});
