import { describe, expect, it } from 'vitest';
import type { TExecutionJournalRecord } from '@robota-sdk/agent-core';
import {
  assertDurableJournal,
  attemptJournal,
  hideUnansweredRequest,
  ScopeLog,
  type RecoveryJournal,
  type RecoveryJournalEntry,
} from './recovery-journal';

const attempt = { attemptId: 'a1', sessionId: 's1', cwd: '/work' };

function memory(durability: RecoveryJournal['durability'] = 'durable') {
  const entries: RecoveryJournalEntry[] = [];
  const journal: RecoveryJournal = {
    durability,
    append: async (entry) => {
      entries.push(structuredClone(entry));
    },
    read: async () => structuredClone(entries),
  };
  return { entries, journal };
}

const request = (callId: string, executionId = 'e1'): TExecutionJournalRecord =>
  ({
    kind: 'model-request',
    recordId: `${callId}:request`,
    executionId,
    callId,
    providerId: 'p',
    modelId: 'm',
    messages: [],
    options: {},
  }) as TExecutionJournalRecord;
const response = (callId: string): TExecutionJournalRecord =>
  ({
    kind: 'model-response',
    recordId: `${callId}:response`,
    executionId: 'e1',
    callId,
    providerId: 'p',
    modelId: 'm',
    response: {
      id: 'r',
      role: 'assistant',
      content: 'x',
      state: 'complete',
      timestamp: new Date(0),
    },
  }) as TExecutionJournalRecord;
const failure = (callId: string): TExecutionJournalRecord =>
  ({
    kind: 'model-failure',
    recordId: `${callId}:failure`,
    executionId: 'e1',
    callId,
    providerId: 'p',
    modelId: 'm',
    error: { name: 'Error', message: 'boom' },
  }) as TExecutionJournalRecord;
const intent = (actionId: string, parentCallId: string): TExecutionJournalRecord =>
  ({
    kind: 'tool-intent',
    recordId: `${actionId}:intent`,
    executionId: 'e1',
    actionId,
    parentCallId,
    toolCallId: 't1',
    toolName: 'pay',
    parameters: {},
  }) as TExecutionJournalRecord;
const start = (actionId: string): TExecutionJournalRecord =>
  ({
    kind: 'tool-effect-start',
    recordId: `${actionId}:effect-start`,
    executionId: 'e1',
    actionId,
    parentCallId: 'c1',
    toolCallId: 't1',
    toolName: 'pay',
    parameters: {},
  }) as TExecutionJournalRecord;

describe('hideUnansweredRequest', () => {
  it('hides a trailing request that got no response, with its failure', () => {
    const settled = [request('c1'), response('c1'), intent('x', 'c1')];
    expect(hideUnansweredRequest([...settled, request('c2')])).toEqual(settled);
    expect(hideUnansweredRequest([...settled, request('c2'), failure('c2')])).toEqual(settled);
  });

  it('hides every unanswered request at the tail, not only the latest', () => {
    const settled = [request('c1'), response('c1')];
    expect(hideUnansweredRequest([...settled, request('c2'), request('c3')])).toEqual(settled);
    expect(
      hideUnansweredRequest([
        ...settled,
        request('c2'),
        request('c3'),
        failure('c3'),
        request('c4'),
      ]),
    ).toEqual(settled);
  });

  it('hides the only request, leaving nothing to continue', () => {
    expect(hideUnansweredRequest([request('c1')])).toEqual([]);
  });

  it('keeps every request that was answered', () => {
    const records = [request('c1'), response('c1'), request('c2'), response('c2')];
    expect(hideUnansweredRequest(records)).toEqual(records);
  });

  it('keeps a journal that has no request at all', () => {
    expect(hideUnansweredRequest([])).toEqual([]);
  });
});

describe('ScopeLog', () => {
  it('treats an identical record as one and refuses a different one under the same id', async () => {
    const { entries, journal } = memory();
    const log = new ScopeLog(journal);
    await log.append({ kind: 'record', record: request('c1') });
    await log.append({ kind: 'record', record: request('c1') });
    expect(entries).toHaveLength(1);
    await expect(
      log.append({ kind: 'record', record: { ...request('c1'), providerId: 'other' } as never }),
    ).rejects.toThrow(/already used with different content/);
  });

  it('sees what an earlier writer left, so a restart does not repeat it', async () => {
    const { entries, journal } = memory();
    await new ScopeLog(journal).append({ kind: 'record', record: request('c1') });
    await new ScopeLog(journal).append({ kind: 'record', record: request('c1') });
    expect(entries).toHaveLength(1);
  });

  it('keeps entries in the order they were appended, even when appended at once', async () => {
    const { entries, journal } = memory();
    const log = new ScopeLog(journal);
    await Promise.all(
      ['c1', 'c2', 'c3'].map((id) => log.append({ kind: 'record', record: request(id) })),
    );
    expect(entries.map((entry) => entry.kind === 'record' && entry.record.recordId)).toEqual([
      'c1:request',
      'c2:request',
      'c3:request',
    ]);
  });
});

describe('attemptJournal', () => {
  it('writes the binding before the first record of an execution passes through, once', async () => {
    const { entries, journal } = memory();
    const attempts = attemptJournal(new ScopeLog(journal), attempt);
    await attempts.append(request('c1'));
    await attempts.append(response('c1'));
    await attempts.append(request('c2', 'e2'));
    expect(entries.map((entry) => entry.kind)).toEqual([
      'binding',
      'record',
      'record',
      'binding',
      'record',
    ]);
    expect(entries[0]).toEqual({ kind: 'binding', ...attempt, executionId: 'e1' });
    expect(entries[3]).toMatchObject({ kind: 'binding', attemptId: 'a1', executionId: 'e2' });
  });

  it('does not bind twice when the same attempt writes again after a restart', async () => {
    const { entries, journal } = memory();
    await attemptJournal(new ScopeLog(journal), attempt).append(request('c1'));
    await attemptJournal(new ScopeLog(journal), attempt).append(response('c1'));
    expect(entries.filter((entry) => entry.kind === 'binding')).toHaveLength(1);
  });

  it('reads an execution without a trailing request that got no response', async () => {
    const { journal } = memory();
    const attempts = attemptJournal(new ScopeLog(journal), attempt);
    await attempts.append(request('c1'));
    await attempts.append(response('c1'));
    await attempts.append(request('c2'));
    expect((await attempts.read('e1')).map((record) => record.recordId)).toEqual([
      'c1:request',
      'c1:response',
    ]);
    expect(await attempts.read('other')).toEqual([]);
  });

  it('records a fresh call id for a paid effect before returning it, the same one for the same action', async () => {
    const { entries, journal } = memory();
    const attempts = attemptJournal(new ScopeLog(journal), attempt);
    const callId = await attempts.effectCalls.claim(start('act-1') as never);
    expect(callId).toMatch(/^tool-effect:/);
    expect(callId).not.toContain('act-1');
    expect(entries.map((entry) => entry.kind)).toEqual(['binding', 'effect-call']);
    expect(entries[1]).toEqual({
      kind: 'effect-call',
      attemptId: 'a1',
      actionId: 'act-1',
      callId,
    });
    expect(await attempts.effectCalls.claim(start('act-1') as never)).toBe(callId);
    expect(entries).toHaveLength(2);
  });

  it('takes a new id for the same action once an attempt is resumed by a new journal', async () => {
    const { journal } = memory();
    const first = await attemptJournal(new ScopeLog(journal), attempt).effectCalls.claim(
      start('act-1') as never,
    );
    const second = await attemptJournal(new ScopeLog(journal), attempt).effectCalls.claim(
      start('act-1') as never,
    );
    expect(second).not.toBe(first);
  });

  it('never hands out an id whose note could not be written', async () => {
    const { journal } = memory();
    let failing = true;
    const flaky: RecoveryJournal = {
      ...journal,
      append: async (entry) => {
        if (failing && entry.kind === 'effect-call') throw new Error('disk full');
        return journal.append(entry);
      },
    };
    const attempts = attemptJournal(new ScopeLog(flaky), attempt);
    await expect(attempts.effectCalls.claim(start('act-1') as never)).rejects.toThrow('disk full');
    failing = false;
    await expect(attempts.effectCalls.claim(start('act-1') as never)).resolves.toMatch(
      /^tool-effect:/,
    );
  });
});

describe('assertDurableJournal', () => {
  it('refuses a journal that can lose what it acknowledged', () => {
    expect(() => assertDurableJournal(memory('volatile').journal)).toThrow(
      expect.objectContaining({ code: 'journal-not-durable' }),
    );
    expect(() => assertDurableJournal(memory('durable').journal)).not.toThrow();
  });
});
