import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ExecutionRecoveryError, isUniversalValueEqual } from '@robota-sdk/agent-core';
import type { TExecutionJournalRecord } from '@robota-sdk/agent-core';

import { ExecutionJournalStoreError } from '../execution-journal-store.js';
import { NodeExecutionJournalStore, SESSION_JOURNALS_DIRECTORY } from '../node.js';
import { NodeSessionStore } from '../node.js';

const EXECUTION = 'exec_1';
let baseDir: string;

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'journal-store-'));
});
afterEach(() => rmSync(baseDir, { recursive: true, force: true }));

function request(recordId: string, extra: Record<string, unknown> = {}): TExecutionJournalRecord {
  return {
    kind: 'model-request',
    recordId,
    executionId: EXECUTION,
    callId: `call-${recordId}`,
    providerId: 'p',
    modelId: 'm',
    messages: [],
    options: {},
    ...extra,
  } as TExecutionJournalRecord;
}

function store(
  options: ConstructorParameters<typeof NodeExecutionJournalStore>[1] = { sealing: 'plain' },
) {
  return new NodeExecutionJournalStore(baseDir, options);
}

function journalFile(): string {
  const directory = join(baseDir, SESSION_JOURNALS_DIRECTORY, 's1');
  const name = readdirSync(directory).find((entry) => entry.endsWith('.jsonl'));
  return join(directory, name!);
}

describe('NodeExecutionJournalStore', () => {
  it('stores records durably and reads them back from a fresh store', async () => {
    const written = request('a', {
      messages: [{ role: 'user', content: 'hi', timestamp: new Date(1) }],
    });
    await store().forSession('s1').append(written);
    await store().forSession('s1').append(request('b'));
    const read = await store().forSession('s1').read(EXECUTION);
    expect(read).toHaveLength(2);
    expect(isUniversalValueEqual(read[0], written)).toBe(true);
    expect(await store().forSession('s1').read('other')).toEqual([]);
    expect(await store().forSession('s2').read(EXECUTION)).toEqual([]);
  });

  it('treats a repeated identical record as a no-op and refuses a different one at the same id', async () => {
    const journal = store().forSession('s1');
    await journal.append(request('a'));
    const before = readFileSync(journalFile());
    await journal.append(request('a'));
    await store().forSession('s1').append(request('a'));
    expect(readFileSync(journalFile()).equals(before)).toBe(true);
    await expect(journal.append(request('a', { providerId: 'other' }))).rejects.toMatchObject({
      code: 'conflict',
    });
    expect(readFileSync(journalFile()).equals(before)).toBe(true);
  });

  function recordingIo(steps: string[]) {
    return {
      writeSync: (_fd: number, data: Uint8Array) => {
        steps.push('write');
        appendFileSync(journalPathFor('s1'), data);
        return data.length;
      },
      fsyncSync: () => void steps.push('fsync-file'),
      syncDirectory: (directory: string) => void steps.push(`fsync-dir:${basename(directory)}`),
    };
  }

  it('flushes the line before the append returns, and the directory entries once', async () => {
    const steps: string[] = [];
    const journal = store({ sealing: 'plain', io: recordingIo(steps) }).forSession('s1');
    await journal.append(request('a'));
    const afterFirst = steps.slice(steps.indexOf('fsync-file') + 1);
    expect(steps.indexOf('write')).toBeLessThan(steps.indexOf('fsync-file'));
    // The file's own entry, then each level above it, once.
    expect(afterFirst).toEqual([
      'fsync-dir:s1',
      `fsync-dir:${SESSION_JOURNALS_DIRECTORY}`,
      `fsync-dir:${basename(baseDir)}`,
    ]);
    const before = steps.length;
    await journal.append(request('b'));
    expect(steps.slice(before)).toEqual(['write', 'fsync-file']);
  });

  it('a fresh instance flushes the directory once for a file an earlier append left behind', async () => {
    // The earlier process may have died between its file flush and its directory flush, so that
    // append was never acknowledged; the next acknowledged one must flush the entry itself.
    await store().forSession('s1').append(request('a'));
    const steps: string[] = [];
    const journal = store({ sealing: 'plain', io: recordingIo(steps) }).forSession('s1');
    await journal.append(request('b'));
    await journal.append(request('c'));
    expect(steps.filter((step) => step === 'fsync-dir:s1')).toHaveLength(1);
    expect(steps.filter((step) => step === `fsync-dir:${SESSION_JOURNALS_DIRECTORY}`)).toHaveLength(
      1,
    );
    expect(steps.filter((step) => step === 'write')).toHaveLength(2);
  });

  it('a fresh instance flushes the directories once before returning a seal an earlier call left', async () => {
    // The earlier process may have died after linking the seal and before flushing its entry; an
    // abandoned seal lost on power failure would make the execution resumable again.
    await store().forSession('s1').append(request('a'));
    await store().forSession('s1').seal(EXECUTION, { reason: 'abandoned' });
    const steps: string[] = [];
    const journal = store({ sealing: 'plain', io: recordingIo(steps) }).forSession('s1');
    await journal.seal(EXECUTION, { reason: 'abandoned' });
    await journal.seal(EXECUTION, { reason: 'abandoned' });
    expect(steps).toEqual([
      'fsync-dir:s1',
      `fsync-dir:${SESSION_JOURNALS_DIRECTORY}`,
      `fsync-dir:${basename(baseDir)}`,
    ]);
  });

  it('continues a short write', async () => {
    const journal = store({
      sealing: 'plain',
      io: {
        writeSync: (fd, data) => {
          const part = data.subarray(0, 7);
          appendFileSync(journalPathFor('s1'), part);
          return part.length;
        },
      },
    }).forSession('s1');
    await journal.append(request('a'));
    expect(await store().forSession('s1').read(EXECUTION)).toHaveLength(1);
  });

  it('refuses a torn tail on read and append, never truncating it', async () => {
    const journal = store().forSession('s1');
    await journal.append(request('a'));
    appendFileSync(journalFile(), '{"v":1,"n":1,"r":{"$o":[["kind"');
    const damaged = readFileSync(journalFile());
    await expect(store().forSession('s1').read(EXECUTION)).rejects.toMatchObject({
      code: 'torn-tail',
    });
    await expect(store().forSession('s1').append(request('b'))).rejects.toMatchObject({
      code: 'torn-tail',
    });
    // The executing process saw it too: its cached view does not hide the damage.
    await expect(journal.append(request('b'))).rejects.toMatchObject({ code: 'torn-tail' });
    expect(readFileSync(journalFile()).equals(damaged)).toBe(true);
    expect(await journal.unresolved()).toEqual([EXECUTION]);
  });

  it('refuses a failed append the next time instead of writing after its fragment', async () => {
    const journal = store({
      sealing: 'plain',
      io: {
        writeSync: (_fd, data) => {
          appendFileSync(journalPathFor('s1'), data.subarray(0, 5));
          throw new Error('disk full');
        },
      },
    }).forSession('s1');
    await expect(journal.append(request('a'))).rejects.toThrow('disk full');
    await expect(journal.append(request('a'))).rejects.toMatchObject({ code: 'torn-tail' });
  });

  it('refuses a corrupt record, a numbering gap and a foreign execution', async () => {
    const journal = store().forSession('s1');
    await journal.append(request('a'));
    await journal.append(request('b'));
    const lines = readFileSync(journalFile(), 'utf8').split('\n');
    const rewrite = (text: string) => writeFileSync(journalFile(), text);

    rewrite(`${lines[0]}\nnot json\n`);
    await expect(store().forSession('s1').read(EXECUTION)).rejects.toMatchObject({
      code: 'corrupt-record',
    });
    rewrite(`${lines[1]}\n`);
    await expect(store().forSession('s1').read(EXECUTION)).rejects.toMatchObject({
      code: 'corrupt-record',
    });
    const foreign = JSON.parse(lines[0]!);
    foreign.r.$o.find(([key]: [string]) => key === 'executionId')[1] = 'exec_2';
    rewrite(`${JSON.stringify(foreign)}\n`);
    await expect(store().forSession('s1').read(EXECUTION)).rejects.toMatchObject({
      code: 'corrupt-record',
    });
  });

  it('seals: further appends are refused, the seal is idempotent and never changes reason', async () => {
    const journal = store().forSession('s1');
    await journal.append(request('a'));
    expect(await journal.unresolved()).toEqual([EXECUTION]);
    const seal = await journal.seal(EXECUTION, { reason: 'completed' });
    expect(seal).toMatchObject({ reason: 'completed', records: 1 });
    expect(await journal.unresolved()).toEqual([]);
    await expect(journal.append(request('b'))).rejects.toMatchObject({ code: 'sealed' });
    await expect(store().forSession('s1').append(request('b'))).rejects.toMatchObject({
      code: 'sealed',
    });
    expect(await journal.seal(EXECUTION, { reason: 'completed' })).toEqual(seal);
    await expect(journal.seal(EXECUTION, { reason: 'abandoned' })).rejects.toMatchObject({
      code: 'sealed',
    });
    expect(await store().forSession('s1').sealOf(EXECUTION)).toEqual(seal);
    // A settled execution's records stay readable.
    expect(await journal.read(EXECUTION)).toHaveLength(1);
  });

  it('an abandoned execution cannot be read for a resume, and a damaged one can still be abandoned', async () => {
    const journal = store().forSession('s1');
    await journal.append(request('a'));
    appendFileSync(journalFile(), 'partial');
    const bytes = readFileSync(journalFile());
    const seal = await journal.seal(EXECUTION, { reason: 'abandoned', note: 'it may have run' });
    expect(seal).toMatchObject({ reason: 'abandoned', note: 'it may have run', records: 1 });
    expect(readFileSync(journalFile()).equals(bytes)).toBe(true);
    await expect(store().forSession('s1').read(EXECUTION)).rejects.toBeInstanceOf(
      ExecutionRecoveryError,
    );
    expect(await journal.unresolved()).toEqual([]);
  });

  it('reports a damaged seal as a corrupt record', async () => {
    const journal = store().forSession('s1');
    await journal.append(request('a'));
    await journal.seal(EXECUTION, { reason: 'completed' });
    const directory = join(baseDir, SESSION_JOURNALS_DIRECTORY, 's1');
    const sealed = readdirSync(directory).find((name) => name.endsWith('.sealed'))!;
    writeFileSync(join(directory, sealed), '{"v":1,');
    await expect(store().forSession('s1').sealOf(EXECUTION)).rejects.toMatchObject({
      code: 'corrupt-record',
    });
  });

  it('keeps files and directories owner-only', async () => {
    if (process.platform === 'win32') return;
    const previous = process.umask(0o022);
    try {
      const journal = store().forSession('s1');
      await journal.append(request('a'));
      await journal.seal(EXECUTION, { reason: 'completed' });
      const directory = join(baseDir, SESSION_JOURNALS_DIRECTORY, 's1');
      expect(statSync(directory).mode & 0o077).toBe(0);
      for (const name of readdirSync(directory))
        expect(statSync(join(directory, name)).mode & 0o077).toBe(0);
    } finally {
      process.umask(previous);
    }
  });

  it('tightens a journal an older writer left readable', async () => {
    if (process.platform === 'win32') return;
    const journal = store().forSession('s1');
    await journal.append(request('a'));
    const { chmodSync } = await import('node:fs');
    chmodSync(journalFile(), 0o644);
    await journal.append(request('b'));
    expect(statSync(journalFile()).mode & 0o077).toBe(0);
  });

  it('refuses unsafe identities', async () => {
    expect(() => store().forSession('../x')).toThrow(/Invalid session id/);
    const journal = store().forSession('s1');
    await expect(journal.append(request('a', { executionId: '' }))).rejects.toMatchObject({
      code: 'invalid-identity',
    });
    await expect(
      journal.append(request('a', { executionId: 'x'.repeat(200) })),
    ).rejects.toMatchObject({
      code: 'invalid-identity',
    });
    await expect(journal.append(request(''))).rejects.toMatchObject({ code: 'invalid-identity' });
  });

  it('refuses to be built for a host that seals its artifacts', () => {
    const sealer = { sealBytes: () => new Uint8Array(), openBytes: () => new Uint8Array() };
    expect(() => store({ sealing: { sealer } as never })).toThrow(ExecutionJournalStoreError);
  });

  it('is removed with its session', () => {
    const sessions = new NodeSessionStore(baseDir, { sealing: 'plain' });
    return (async () => {
      await store().forSession('s1').append(request('a'));
      expect(existsSync(join(baseDir, SESSION_JOURNALS_DIRECTORY, 's1'))).toBe(true);
      sessions.delete('s1');
      expect(existsSync(join(baseDir, SESSION_JOURNALS_DIRECTORY, 's1'))).toBe(false);
    })();
  });
});

function journalPathFor(sessionId: string): string {
  const directory = join(baseDir, SESSION_JOURNALS_DIRECTORY, sessionId);
  const name = Buffer.from(EXECUTION, 'utf8').toString('hex');
  return join(directory, `${name}.jsonl`);
}
