import type { TExecutionJournalRecord } from '@robota-sdk/agent-core';
import type { JsonValue } from '@robota-sdk/agent-roundtable';
import { effectRequestId } from './attempt-recovery';
import { RuntimeParticipantError } from './errors';
import type { AttemptJournal } from './recovery-journal';

/**
 * What the host answers to the reconciliation request an effect started without a result parks:
 * `{ result }` when the effect completed and produced that value, `{ error }` when it did not, so the
 * model sees a failed call. Either way the effect is settled and never started again.
 */
export interface EffectSettlement {
  requestId: string;
  /** The request's own data, from which the effect is identified. */
  request: JsonValue;
  /** The host's answer. */
  answer: JsonValue;
}

function invalid(message: string): never {
  throw new RuntimeParticipantError('invalid-response', message);
}

function fields(value: JsonValue): Record<string, JsonValue> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/** Journals the host's settlement of one effect as that effect's result; repeating it changes nothing. */
export async function settleReconciledEffect(
  journal: AttemptJournal,
  executionId: string,
  settlement: EffectSettlement,
): Promise<void> {
  const { actionId } = fields(settlement.request);
  if (typeof actionId !== 'string' || effectRequestId(actionId) !== settlement.requestId)
    invalid('The reconciliation request does not name an effect');
  const answer = fields(settlement.answer);
  const failed = 'error' in answer;
  if (
    failed ? typeof answer.error !== 'string' || answer.error.length === 0 : !('result' in answer)
  )
    invalid('A reconciliation answer is `{ result }` or `{ error }` with a non-empty message');

  const records = await journal.read(executionId);
  const start = records.find(
    (record): record is Extract<TExecutionJournalRecord, { kind: 'tool-effect-start' }> =>
      record.kind === 'tool-effect-start' && record.actionId === actionId,
  );
  if (!start) invalid('No effect started under this action');
  if (records.some((record) => record.kind === 'tool-result' && record.actionId === actionId))
    return;
  // The residency a settled action carries is the one its round was running with.
  const round = records.findLast(
    (record) =>
      (record.kind === 'model-request' || record.kind === 'model-cache-hit') &&
      record.callId === start.parentCallId,
  );
  const loaded =
    round && 'checkpoint' in round
      ? (round.checkpoint?.continuation?.loadedDeferredTools ?? [])
      : [];
  await journal.append({
    kind: 'tool-result',
    recordId: `${actionId}:result`,
    executionId,
    actionId,
    parentCallId: start.parentCallId,
    toolCallId: start.toolCallId,
    toolName: start.toolName,
    result: failed
      ? {
          executionId: start.toolCallId,
          toolName: start.toolName,
          success: false,
          error: answer.error as string,
        }
      : {
          executionId: start.toolCallId,
          toolName: start.toolName,
          success: true,
          result: answer.result as never,
        },
    loadedDeferredTools: [...loaded],
  });
}
