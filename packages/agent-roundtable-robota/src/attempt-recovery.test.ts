import { describe, expect, it } from 'vitest';
import type { TExecutionJournalRecord } from '@robota-sdk/agent-core';
import type { AttemptRecovery, ParticipantCheckpoint } from '@robota-sdk/agent-roundtable';
import { classifyAttempt, turnPhase } from './attempt-recovery';
import { decodeSessionCheckpoint, encodeSessionCheckpoint } from './checkpoint-codec';
import { normalizeEnforcement } from './enforcement';
import type { RecoveryJournalEntry } from './recovery-journal';

const enforcement = normalizeEnforcement({
  providerAttempts: 1,
  requestOverheadTokens: 0,
  paidTools: { money: { tokens: 0 }, model: { tokens: 40 } },
});

const turn = {
  conversationId: 'c',
  participantId: 'p',
  turnId: 't1',
  attemptId: 'a1',
  groupId: 'g1',
  context: { baseRevision: 0, messages: [] },
};

const binding: RecoveryJournalEntry = {
  kind: 'binding',
  attemptId: 'a1',
  sessionId: 's1',
  executionId: 'e1',
  cwd: '/work',
};

const record = (value: Record<string, unknown>): RecoveryJournalEntry => ({
  kind: 'record',
  record: { executionId: 'e1', ...value } as unknown as TExecutionJournalRecord,
});
/** A request that carries the round checkpoint a continued execution is rebuilt from. */
const request = (callId: string) =>
  record({
    kind: 'model-request',
    recordId: `${callId}:request`,
    callId,
    checkpoint: { version: 1 },
  });
const response = (callId: string) =>
  record({
    kind: 'model-response',
    recordId: `${callId}:response`,
    callId,
    response: {
      id: 'r',
      role: 'assistant',
      content: 'x',
      state: 'complete',
      timestamp: new Date(0),
    },
  });
const note = (actionId: string, callId: string): RecoveryJournalEntry => ({
  kind: 'effect-call',
  attemptId: 'a1',
  actionId,
  callId,
});
const effect = (kind: 'tool-effect-start' | 'tool-result', actionId: string, toolName = 'money') =>
  record({
    kind,
    recordId: `${actionId}:${kind}`,
    actionId,
    parentCallId: 'c1',
    toolCallId: 't1',
    toolName,
    parameters: {},
  });

const settledCheckpoint = (): ParticipantCheckpoint =>
  encodeSessionCheckpoint({
    sessionId: 's1',
    cwd: '/work',
    firstTurnDone: true,
    history: [],
    pending: null,
  });

function classify(
  entries: RecoveryJournalEntry[],
  reserved: { callId: string; kind: 'model' | 'tool-effect' }[],
  checkpoint: ParticipantCheckpoint | null = null,
): AttemptRecovery {
  return classifyAttempt({
    entries,
    input: {
      conversationId: 'c',
      participantId: 'p',
      turn,
      checkpoint,
      reservedCalls: reserved,
    },
    enforcement,
  });
}

const model = (callId: string) => ({ callId, kind: 'model' as const });
const paid = (callId: string) => ({ callId, kind: 'tool-effect' as const });

describe('classifyAttempt: kill points', () => {
  it('starts again when nothing of the attempt reached the journal, refunding what was admitted', () => {
    expect(classify([], [model('m1')])).toEqual({
      kind: 'not-started',
      calls: [{ kind: 'not-dispatched', callId: 'm1' }],
    });
    // Bound but no record yet: the request is journaled before the provider is called.
    expect(classify([binding], [model('m1')])).toMatchObject({ kind: 'not-started' });
  });

  it('runs the turn again from where it began when only a request with no response exists', () => {
    const answer = classify([binding, request('m1')], [model('m1')]);
    expect(answer).toMatchObject({
      kind: 'resume',
      calls: [{ kind: 'uncertain', callId: 'm1' }],
    });
    // The first turn has no checkpoint: the saved session id is what the rerun keeps.
    const { checkpoint } = answer as Extract<AttemptRecovery, { kind: 'resume' }>;
    expect(decodeSessionCheckpoint(checkpoint)).toEqual({
      sessionId: 's1',
      cwd: '/work',
      firstTurnDone: false,
      history: null,
      pending: null,
    });
    const before = settledCheckpoint();
    expect(classify([binding, request('m1')], [model('m1')], before)).toMatchObject({
      kind: 'resume',
      checkpoint: before,
    });
  });

  it('continues the execution when an earlier round settled and the next request got no response', () => {
    const answer = classify(
      [binding, request('m1'), response('m1'), request('m2')],
      [model('m2')],
      settledCheckpoint(),
    );
    expect(answer).toMatchObject({ kind: 'resume', calls: [{ kind: 'uncertain', callId: 'm2' }] });
    const { checkpoint } = answer as Extract<AttemptRecovery, { kind: 'resume' }>;
    expect(decodeSessionCheckpoint(checkpoint)).toMatchObject({
      sessionId: 's1',
      history: null,
      pending: { executionId: 'e1', requestIds: [] },
    });
  });

  it('settles a journaled response with its report and continues without a provider call', () => {
    const answer = classify([binding, request('m1'), response('m1')], [model('m1')]);
    expect(answer).toMatchObject({
      kind: 'resume',
      calls: [
        {
          kind: 'settled',
          callId: 'm1',
          report: { callId: 'm1', outcome: 'completed', final: true },
        },
      ],
    });
  });

  it('settles a failed call as failed with unknown usage', () => {
    const entries = [
      binding,
      request('m1'),
      record({ kind: 'model-failure', recordId: 'm1:failure', callId: 'm1' }),
    ];
    expect(classify(entries, [model('m1')])).toMatchObject({
      calls: [
        {
          kind: 'settled',
          callId: 'm1',
          report: { outcome: 'failed', provenance: 'unknown', final: true },
        },
      ],
    });
  });

  it('refunds a paid effect whose admission was committed but whose start was never journaled', () => {
    const entries = [binding, request('m1'), response('m1'), note('act-1', 'tool-effect:one')];
    expect(classify(entries, [paid('tool-effect:one')])).toMatchObject({
      kind: 'resume',
      calls: [{ kind: 'not-dispatched', callId: 'tool-effect:one' }],
    });
  });

  it('refunds an earlier admission a later one superseded, and keeps the one that started', () => {
    const entries = [
      binding,
      request('m1'),
      response('m1'),
      note('act-1', 'tool-effect:one'),
      note('act-1', 'tool-effect:two'),
      effect('tool-effect-start', 'act-1'),
    ];
    const answer = classify(entries, [paid('tool-effect:one'), paid('tool-effect:two')]);
    expect(answer).toMatchObject({
      kind: 'uncertain',
      calls: [
        { kind: 'not-dispatched', callId: 'tool-effect:one' },
        { kind: 'uncertain', callId: 'tool-effect:two' },
      ],
    });
  });

  it('parks an effect that started without a result as a reconciliation request, never to run again', () => {
    const entries = [
      binding,
      request('m1'),
      response('m1'),
      note('act-1', 'tool-effect:one'),
      effect('tool-effect-start', 'act-1'),
    ];
    const answer = classify(entries, [paid('tool-effect:one')]);
    expect(answer).toMatchObject({
      kind: 'uncertain',
      requests: [
        {
          id: 'effect:act-1',
          kind: 'reconciliation',
          data: { actionId: 'act-1', toolName: 'money', executionId: 'e1' },
        },
      ],
      calls: [{ kind: 'uncertain', callId: 'tool-effect:one' }],
    });
    const { checkpoint } = answer as Extract<AttemptRecovery, { kind: 'uncertain' }>;
    expect(decodeSessionCheckpoint(checkpoint).pending).toEqual({
      executionId: 'e1',
      requestIds: ['effect:act-1'],
    });
  });

  it('reuses a journaled result: a money-only effect is settled, a model-backed one stays counted', () => {
    const base = [binding, request('m1'), response('m1')];
    const money = [
      ...base,
      note('act-1', 'tool-effect:one'),
      effect('tool-effect-start', 'act-1', 'money'),
      effect('tool-result', 'act-1', 'money'),
    ];
    expect(classify(money, [paid('tool-effect:one')])).toMatchObject({
      kind: 'resume',
      calls: [
        {
          kind: 'settled',
          callId: 'tool-effect:one',
          report: { outcome: 'completed', provenance: 'reported', final: true },
        },
      ],
    });
    const backed = [
      ...base,
      note('act-1', 'tool-effect:one'),
      effect('tool-effect-start', 'act-1', 'model'),
      effect('tool-result', 'act-1', 'model'),
    ];
    expect(classify(backed, [paid('tool-effect:one')])).toMatchObject({
      calls: [{ kind: 'uncertain', callId: 'tool-effect:one' }],
    });
  });

  it('keeps counted a call it cannot tie to anything it journaled', () => {
    expect(
      classify([binding, request('m1'), response('m1')], [paid('tool-effect:alien')]),
    ).toMatchObject({ calls: [{ kind: 'uncertain', callId: 'tool-effect:alien' }] });
  });

  it('answers a turn whose end is journaled with that outcome and checkpoint', () => {
    const checkpoint = settledCheckpoint();
    const entries: RecoveryJournalEntry[] = [
      binding,
      request('m1'),
      response('m1'),
      {
        kind: 'turn-end',
        attemptId: 'a1',
        phase: 'run',
        outcome: { kind: 'speak', content: 'hi' },
        checkpoint,
      },
    ];
    expect(classify(entries, [model('m1')])).toEqual({
      kind: 'settled',
      outcome: { kind: 'speak', content: 'hi' },
      checkpoint,
      calls: [{ kind: 'settled', callId: 'm1', report: expect.objectContaining({ callId: 'm1' }) }],
    });
  });

  it('answers every reserved call exactly once', () => {
    const entries = [binding, request('m1'), response('m1'), request('m2')];
    const reserved = [model('m1'), model('m2'), model('m3'), paid('tool-effect:x')];
    const { calls } = classify(entries, reserved);
    expect(calls.map((call) => call.callId)).toEqual(reserved.map((call) => call.callId));
  });
});

describe('classifyAttempt: phases of one attempt', () => {
  const waiting: ParticipantCheckpoint = encodeSessionCheckpoint({
    sessionId: 's1',
    cwd: '/work',
    firstTurnDone: true,
    history: null,
    pending: { executionId: 'e1', requestIds: ['q1'] },
  });
  const waitEnd = (outcomeText: string, phase: string): RecoveryJournalEntry => ({
    kind: 'turn-end',
    attemptId: 'a1',
    phase,
    outcome: { kind: 'speak', content: outcomeText },
    checkpoint: settledCheckpoint(),
  });

  it('names the phase from the checkpoint the attempt started from', () => {
    expect(turnPhase(null)).toBe('run');
    expect(turnPhase(settledCheckpoint())).toBe('run');
    expect(turnPhase(waiting)).toBe('wait:q1');
  });

  it("does not mistake the first phase's end for the end of the phase that continued a wait", () => {
    const entries = [binding, request('m1'), response('m1'), waitEnd('first', 'run')];
    // A turn continuing the wait is in phase `wait:q1`; the `run` end belongs to the phase before it.
    expect(classify(entries, [], waiting)).toMatchObject({ kind: 'resume', checkpoint: waiting });
    expect(classify([...entries, waitEnd('second', 'wait:q1')], [], waiting)).toMatchObject({
      kind: 'settled',
      outcome: { kind: 'speak', content: 'second' },
    });
  });
});
