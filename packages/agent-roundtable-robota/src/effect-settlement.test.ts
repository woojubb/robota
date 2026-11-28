import { describe, expect, it } from 'vitest';
import type { TExecutionJournalRecord } from '@robota-sdk/agent-core';
import { settleReconciledEffect } from './effect-settlement';
import { attemptJournal, ScopeLog, type RecoveryJournalEntry } from './recovery-journal';

function setup() {
  const entries: RecoveryJournalEntry[] = [];
  const journal = attemptJournal(
    new ScopeLog({
      durability: 'durable',
      append: async (entry) => {
        entries.push(structuredClone(entry));
      },
      read: async () => structuredClone(entries),
    }),
    { attemptId: 'a1', sessionId: 's1', cwd: '/work' },
  );
  return { entries, journal };
}

const records: TExecutionJournalRecord[] = [
  {
    kind: 'model-request',
    recordId: 'c1:request',
    executionId: 'e1',
    callId: 'c1',
    providerId: 'p',
    modelId: 'm',
    messages: [],
    options: {},
    checkpoint: { continuation: { loadedDeferredTools: ['lazy'] } },
  } as unknown as TExecutionJournalRecord,
  {
    kind: 'model-response',
    recordId: 'c1:response',
    executionId: 'e1',
    callId: 'c1',
    providerId: 'p',
    modelId: 'm',
    response: {
      id: 'r',
      role: 'assistant',
      content: null,
      state: 'complete',
      timestamp: new Date(0),
    },
  } as unknown as TExecutionJournalRecord,
  {
    kind: 'tool-effect-start',
    recordId: 'act-1:effect-start',
    executionId: 'e1',
    actionId: 'act-1',
    parentCallId: 'c1',
    toolCallId: 't1',
    toolName: 'pay',
    parameters: {},
  } as TExecutionJournalRecord,
];

const settlement = (answer: unknown, actionId = 'act-1') => ({
  requestId: `effect:${actionId}`,
  request: { actionId },
  answer: answer as never,
});

async function seeded() {
  const fixture = setup();
  for (const record of records) await fixture.journal.append(record);
  return fixture;
}

function results(entries: RecoveryJournalEntry[]) {
  return entries.flatMap((entry) =>
    entry.kind === 'record' && entry.record.kind === 'tool-result' ? [entry.record] : [],
  );
}

describe('settleReconciledEffect', () => {
  it("journals the host's value as the effect's successful result", async () => {
    const { entries, journal } = await seeded();
    await settleReconciledEffect(journal, 'e1', settlement({ result: { receipt: 7 } }));
    expect(results(entries)).toEqual([
      expect.objectContaining({
        recordId: 'act-1:result',
        actionId: 'act-1',
        parentCallId: 'c1',
        toolCallId: 't1',
        toolName: 'pay',
        loadedDeferredTools: ['lazy'],
        result: { executionId: 't1', toolName: 'pay', success: true, result: { receipt: 7 } },
      }),
    ]);
  });

  it('journals a host error as a failed result', async () => {
    const { entries, journal } = await seeded();
    await settleReconciledEffect(journal, 'e1', settlement({ error: 'declined' }));
    expect(results(entries)[0]).toMatchObject({
      result: { success: false, error: 'declined', toolName: 'pay' },
    });
  });

  it('changes nothing when the same effect is settled again', async () => {
    const { entries, journal } = await seeded();
    await settleReconciledEffect(journal, 'e1', settlement({ result: 'x' }));
    await settleReconciledEffect(journal, 'e1', settlement({ result: 'x' }));
    expect(results(entries)).toHaveLength(1);
  });

  it.each([
    ['an answer with neither a result nor an error', {}],
    ['an empty error', { error: '' }],
    ['a non-object answer', 'paid'],
  ])('refuses %s', async (_name, answer) => {
    const { entries, journal } = await seeded();
    await expect(settleReconciledEffect(journal, 'e1', settlement(answer))).rejects.toMatchObject({
      code: 'invalid-response',
    });
    expect(results(entries)).toHaveLength(0);
  });

  it('refuses a request that does not name an effect that started', async () => {
    const { journal } = await seeded();
    await expect(
      settleReconciledEffect(journal, 'e1', {
        requestId: 'effect:other',
        request: { actionId: 'act-1' },
        answer: { result: 1 },
      }),
    ).rejects.toMatchObject({ code: 'invalid-response' });
    await expect(
      settleReconciledEffect(journal, 'e1', settlement({ result: 1 }, 'act-9')),
    ).rejects.toMatchObject({
      code: 'invalid-response',
      message: expect.stringContaining('No effect'),
    });
  });
});
