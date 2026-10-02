import { describe, expect, it } from 'vitest';
import type { TExecutionJournalRecord } from '../../interfaces/execution-journal';
import { recoverToolBatch } from '../execution-recovery-state';

function records(dispatched = false): TExecutionJournalRecord[] {
  const identity = {
    executionId: 'run',
    actionId: 'action',
    parentCallId: 'model',
    toolCallId: 'tail',
    toolName: 'fixture',
  };
  return [
    {
      recordId: 'model-record',
      executionId: 'run',
      callId: 'model',
      providerId: 'fixture',
      modelId: 'fixture',
      kind: 'model-cache-hit',
      response: {
        id: 'response',
        timestamp: new Date(0),
        role: 'assistant',
        state: 'complete',
        content: null,
        toolCalls: [
          { id: 'tail', type: 'function', function: { name: 'fixture', arguments: '{}' } },
        ],
      },
      checkpoint: {
        version: 1,
        effectAdmission: 'required',
        messages: [],
        round: 1,
        contextLimit: 1000,
        cumulativeInputTokens: 0,
        sameToolInputCounts: [],
      },
    },
    ...(dispatched
      ? [
          { ...identity, recordId: 'intent', kind: 'tool-intent' as const, parameters: {} },
          { ...identity, recordId: 'dispatch', kind: 'tool-dispatch' as const },
        ]
      : []),
    {
      ...identity,
      recordId: 'settlement',
      kind: 'tool-result',
      result: {
        executionId: 'tail',
        toolName: 'fixture',
        success: false,
        result: null,
        error: 'Skipped after failure',
        metadata: { errorCode: 'tool_call_skipped', dispatchStatus: 'not-dispatched' },
      },
    },
  ];
}

describe('durable skipped settlements', () => {
  it('restores a skipped call that never had decodable intent or dispatch', () => {
    const batch = recoverToolBatch(records(), 'run', 'model');
    expect(batch.actions.get('tail')).toMatchObject({
      intent: false,
      dispatched: false,
      effectStarted: false,
      result: { success: false, metadata: { errorCode: 'tool_call_skipped' } },
    });
  });

  it('rejects a dispatched call claiming to have been skipped', () => {
    expect(() => recoverToolBatch(records(true), 'run', 'model')).toThrow(
      'Skipped tool result cannot claim',
    );
  });

  it.each(['success', 'payload', 'identity', 'status'])('rejects a forged skipped %s', (field) => {
    const source = records();
    const record = source[source.length - 1];
    if (record.kind !== 'tool-result') throw new Error('Missing fixture settlement');
    if (field === 'success') record.result.success = true;
    if (field === 'payload') record.result.result = 'applied';
    if (field === 'identity') record.result.executionId = 'other-call';
    if (field === 'status') record.result.metadata!.dispatchStatus = 'dispatched';
    expect(() => recoverToolBatch(source, 'run', 'model')).toThrow();
  });
});
