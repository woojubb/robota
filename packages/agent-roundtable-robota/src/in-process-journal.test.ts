import { describe, expect, it } from 'vitest';
import type { TExecutionJournalRecord } from '@robota-sdk/agent-core';
import { createInProcessJournal } from './in-process-journal';

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
