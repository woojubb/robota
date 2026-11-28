import type { TExecutionJournalRecord } from '@robota-sdk/agent-core';
import type {
  AttemptRecovery,
  AttemptRecoveryInput,
  CallSettlement,
  JsonValue,
  ParticipantCheckpoint,
  ParticipantRequest,
} from '@robota-sdk/agent-roundtable';
import {
  AGENT_SESSION_CHECKPOINT_VERSION,
  decodeSessionCheckpoint,
  encodeSessionCheckpoint,
  type SessionCheckpointState,
} from './checkpoint-codec';
import type { CallEnforcement } from './enforcement';
import { RuntimeParticipantError } from './errors';
import { effectReport, usageReport } from './metering-journal';
import { hideUnansweredRequest, type RecoveryJournalEntry } from './recovery-journal';

/** The phase of a turn an attempt is in: its first run, or the continuation of a parked wait. */
export function turnPhase(checkpoint: ParticipantCheckpoint | null): string {
  if (checkpoint?.version !== AGENT_SESSION_CHECKPOINT_VERSION) return 'run';
  const { pending } = decodeSessionCheckpoint(checkpoint);
  return pending && pending.requestIds.length > 0 ? `wait:${pending.requestIds.join(',')}` : 'run';
}

/** Request ids of the reconciliation requests an effect started without a result parks. */
export function effectRequestId(actionId: string): string {
  return `effect:${actionId}`;
}

type EffectStart = Extract<TExecutionJournalRecord, { kind: 'tool-effect-start' }>;
type Indexed<T> = { index: number; record: T };

function jsonOrNull(value: unknown): JsonValue {
  try {
    return JSON.parse(JSON.stringify(value ?? null)) as JsonValue;
  } catch {
    return null;
  }
}

/** What the journal proves about each reserved call; everything it cannot prove stays counted. */
function settleCalls(
  entries: readonly RecoveryJournalEntry[],
  reserved: AttemptRecoveryInput['reservedCalls'],
  enforcement: CallEnforcement | undefined,
): CallSettlement[] {
  const records: Indexed<TExecutionJournalRecord>[] = [];
  entries.forEach((entry, index) => {
    if (entry.kind === 'record') records.push({ index, record: entry.record });
  });
  const modelRecords = (callId: string) =>
    records.filter(({ record }) => 'callId' in record && record.callId === callId);

  return reserved.map(({ callId, kind }): CallSettlement => {
    if (kind === 'model') {
      const own = modelRecords(callId);
      const response = own.find(({ record }) => record.kind === 'model-response')?.record;
      if (response?.kind === 'model-response')
        return {
          kind: 'settled',
          callId,
          report: usageReport(
            callId,
            'completed',
            response.response,
            undefined,
            enforcement?.providerAttempts,
          ),
        };
      if (own.some(({ record }) => record.kind === 'model-failure'))
        return {
          kind: 'settled',
          callId,
          report: { callId, outcome: 'failed', provenance: 'unknown', final: true },
        };
      // A request journaled without an answer may have reached the provider; none journaled never did,
      // because the provider is only called once the request is durably written.
      return own.some(({ record }) => record.kind === 'model-request')
        ? { kind: 'uncertain', callId }
        : { kind: 'not-dispatched', callId };
    }
    const noteIndex = entries.findIndex(
      (entry) => entry.kind === 'effect-call' && entry.callId === callId,
    );
    const note = entries[noteIndex];
    // An id this adapter never wrote cannot be tied to anything it journaled.
    if (note?.kind !== 'effect-call') return { kind: 'uncertain', callId };
    const start = records.find(
      ({ record }) => record.kind === 'tool-effect-start' && record.actionId === note.actionId,
    ) as Indexed<EffectStart> | undefined;
    // The call is admitted before the start record is appended, and the effect runs only after it is
    // durable, so a call whose action never started cannot have run anything.
    if (!start) return { kind: 'not-dispatched', callId };
    const owner = entries.findLastIndex(
      (entry, index) =>
        index < start.index && entry.kind === 'effect-call' && entry.actionId === note.actionId,
    );
    if (owner !== noteIndex) return { kind: 'not-dispatched', callId };
    const result = records.find(
      ({ record }) => record.kind === 'tool-result' && record.actionId === note.actionId,
    );
    if (!result) return { kind: 'uncertain', callId };
    // A model-backed effect's consumption is the host's to say; only a money-only one is fully known.
    return enforcement?.paidTools.get(start.record.toolName) === 0
      ? { kind: 'settled', callId, report: effectReport(callId, 0, true) }
      : { kind: 'uncertain', callId };
  });
}

function startedWithoutResult(records: readonly TExecutionJournalRecord[]): EffectStart[] {
  return records.filter(
    (record): record is EffectStart =>
      record.kind === 'tool-effect-start' &&
      !records.some((other) => other.kind === 'tool-result' && other.actionId === record.actionId),
  );
}

function reconciliationRequest(start: EffectStart): ParticipantRequest {
  return {
    id: effectRequestId(start.actionId),
    kind: 'reconciliation',
    reason: `Tool ${start.toolName} started without a recorded result`,
    data: {
      executionId: start.executionId,
      actionId: start.actionId,
      parentCallId: start.parentCallId,
      toolCallId: start.toolCallId,
      toolName: start.toolName,
      parameters: jsonOrNull(start.parameters),
    },
  };
}

/**
 * Classifies the kill point of one interrupted attempt from the adapter's own journal and answers
 * every reserved call exactly once.
 * - The turn already returned (its end is journaled): `settled`.
 * - Nothing of the attempt reached the journal: `not-started`.
 * - A tool effect started without a result: `uncertain`, parked for the host, never run again.
 * - A settled round exists: `resume` from the journal; a request that never got a response is
 *   hidden, so the provider is asked again under a new call id, and a journaled final response
 *   completes with no provider call.
 * - Otherwise the turn runs again from where it started.
 */
export function classifyAttempt(options: {
  entries: readonly RecoveryJournalEntry[];
  input: AttemptRecoveryInput;
  enforcement: CallEnforcement | undefined;
}): AttemptRecovery {
  const { entries, input, enforcement } = options;
  const { attemptId } = input.turn;
  const calls = settleCalls(entries, input.reservedCalls, enforcement);
  const before: SessionCheckpointState | null = input.checkpoint
    ? decodeSessionCheckpoint(input.checkpoint)
    : null;
  const phase = turnPhase(input.checkpoint);

  const end = entries.findLast(
    (entry) => entry.kind === 'turn-end' && entry.attemptId === attemptId && entry.phase === phase,
  );
  if (end?.kind === 'turn-end')
    return { kind: 'settled', outcome: end.outcome, checkpoint: end.checkpoint, calls };

  const binding = entries.findLast(
    (entry) => entry.kind === 'binding' && entry.attemptId === attemptId,
  );
  if (binding?.kind !== 'binding') {
    if (calls.every((call) => call.kind === 'not-dispatched'))
      return { kind: 'not-started', calls };
    // Calls the journal cannot account for and no execution to continue: only the host can say more.
    if (!input.checkpoint)
      throw new RuntimeParticipantError(
        'journal-missing',
        'The journal holds no execution for this attempt, yet calls of it are reserved',
      );
    return { kind: 'resume', checkpoint: input.checkpoint, calls };
  }
  const records = hideUnansweredRequest(
    entries.flatMap((entry) =>
      entry.kind === 'record' && entry.record.executionId === binding.executionId
        ? [entry.record]
        : [],
    ),
  );
  const parked = (requestIds: string[], firstTurnDone: boolean): ParticipantCheckpoint =>
    encodeSessionCheckpoint({
      sessionId: binding.sessionId,
      cwd: binding.cwd,
      firstTurnDone,
      history: null,
      pending: { executionId: binding.executionId, requestIds },
    });

  const effects = startedWithoutResult(records);
  if (effects.length > 0) {
    const requests = effects.map(reconciliationRequest);
    return {
      kind: 'uncertain',
      requests,
      checkpoint: parked(
        requests.map((request) => request.id),
        true,
      ),
      calls,
    };
  }
  const settledRound = records.some(
    (record) =>
      (record.kind === 'model-request' || record.kind === 'model-cache-hit') && record.checkpoint,
  );
  if (!settledRound) {
    // Not even a request was journaled and nothing admitted counts as dispatched: the turn never began.
    const requested = entries.some(
      (entry) => entry.kind === 'record' && entry.record.executionId === binding.executionId,
    );
    if (!requested && calls.every((call) => call.kind === 'not-dispatched'))
      return { kind: 'not-started', calls };
    // Nothing the journal holds can be continued; the turn runs again from the state it started in.
    return {
      kind: 'resume',
      checkpoint:
        input.checkpoint ??
        encodeSessionCheckpoint({
          sessionId: binding.sessionId,
          cwd: binding.cwd,
          firstTurnDone: false,
          history: null,
          pending: null,
        }),
      calls,
    };
  }
  // A turn that was itself continuing a parked wait keeps that wait's checkpoint: its responses are
  // still addressed to it. A first run continues the execution the journal names, with no requests.
  const resuming = (before?.pending?.requestIds.length ?? 0) > 0;
  return {
    kind: 'resume',
    checkpoint: resuming ? input.checkpoint! : parked([], before?.firstTurnDone ?? false),
    calls,
  };
}
