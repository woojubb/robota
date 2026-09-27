import { describe, expect, it } from 'vitest';
import type { TExecutionJournalRecord } from '@robota-sdk/agent-core';
import {
  clearInProcessJournal,
  createInProcessJournal,
  forgetInProcessJournal,
} from './in-process-journal';

function record(recordId: string, executionId: string): TExecutionJournalRecord {
  return {
    recordId,
    executionId,
    kind: 'model-failure',
    callId: 'call-1',
    providerId: 'p',
    modelId: 'm',
    error: { name: 'Error', message: 'boom' },
  };
}

describe('createInProcessJournal', () => {
  it('reads back exactly what was appended, in order', async () => {
    const journal = createInProcessJournal('session-a');
    await journal.append(record('r1', 'exec-1'));
    await journal.append(record('r2', 'exec-1'));
    await expect(journal.read('exec-1')).resolves.toEqual([
      record('r1', 'exec-1'),
      record('r2', 'exec-1'),
    ]);
  });

  it('scopes records by executionId', async () => {
    const journal = createInProcessJournal('session-b');
    await journal.append(record('r1', 'exec-1'));
    await journal.append(record('r2', 'exec-2'));
    await expect(journal.read('exec-1')).resolves.toEqual([record('r1', 'exec-1')]);
    await expect(journal.read('exec-2')).resolves.toEqual([record('r2', 'exec-2')]);
  });

  it('is idempotent for a repeated identical recordId', async () => {
    const journal = createInProcessJournal('session-c');
    await journal.append(record('r1', 'exec-1'));
    await journal.append(record('r1', 'exec-1'));
    await expect(journal.read('exec-1')).resolves.toEqual([record('r1', 'exec-1')]);
  });

  it('rejects a conflicting append for an already-used recordId', async () => {
    const journal = createInProcessJournal('session-d');
    await journal.append(record('r1', 'exec-1'));
    const conflicting: TExecutionJournalRecord = {
      recordId: 'r1',
      executionId: 'exec-1',
      kind: 'model-failure',
      callId: 'call-2',
      providerId: 'p',
      modelId: 'm',
      error: { name: 'Error', message: 'boom' },
    };
    await expect(journal.append(conflicting)).rejects.toThrow();
  });

  it('shares its records across separate calls for the same sessionId (same process)', async () => {
    const first = createInProcessJournal('session-shared');
    await first.append(record('r1', 'exec-1'));
    const second = createInProcessJournal('session-shared');
    await expect(second.read('exec-1')).resolves.toEqual([record('r1', 'exec-1')]);
  });

  it('keeps separate sessions independent', async () => {
    const a = createInProcessJournal('session-x');
    const b = createInProcessJournal('session-y');
    await a.append(record('r1', 'exec-1'));
    await expect(b.read('exec-1')).resolves.toEqual([]);
  });
});

// SHOULD 7: the default journal never freed a settled execution's records, or a session's whole
// entry once its lease ended — both grew the module-level map for as long as the process ran.
describe('clearInProcessJournal', () => {
  it('empties every record kept for a session, across every executionId', async () => {
    const journal = createInProcessJournal('session-clear-1');
    await journal.append(record('r1', 'exec-1'));
    await journal.append(record('r2', 'exec-2'));
    clearInProcessJournal('session-clear-1');
    await expect(journal.read('exec-1')).resolves.toEqual([]);
    await expect(journal.read('exec-2')).resolves.toEqual([]);
  });

  it('is visible to a journal instance created for the same session before the clear', async () => {
    const first = createInProcessJournal('session-clear-2');
    await first.append(record('r1', 'exec-1'));
    const second = createInProcessJournal('session-clear-2');
    clearInProcessJournal('session-clear-2');
    await expect(second.read('exec-1')).resolves.toEqual([]);
  });

  it('is a harmless no-op for a session that was never used', () => {
    expect(() => clearInProcessJournal('session-never-used')).not.toThrow();
  });

  it('leaves other sessions untouched', async () => {
    const a = createInProcessJournal('session-clear-3');
    const b = createInProcessJournal('session-clear-4');
    await a.append(record('r1', 'exec-1'));
    await b.append(record('r2', 'exec-2'));
    clearInProcessJournal('session-clear-3');
    await expect(a.read('exec-1')).resolves.toEqual([]);
    await expect(b.read('exec-2')).resolves.toEqual([record('r2', 'exec-2')]);
  });
});

describe('forgetInProcessJournal', () => {
  it('removes the whole entry: a later journal for the same session starts empty', async () => {
    const first = createInProcessJournal('session-forget-1');
    await first.append(record('r1', 'exec-1'));
    forgetInProcessJournal('session-forget-1');
    const second = createInProcessJournal('session-forget-1');
    await expect(second.read('exec-1')).resolves.toEqual([]);
  });

  it('is a harmless no-op for a session that was never used', () => {
    expect(() => forgetInProcessJournal('session-never-used-2')).not.toThrow();
  });
});
